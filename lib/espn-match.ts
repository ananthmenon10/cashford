// ESPN id matcher (Phase 1 §5). FPL owns fixture existence; ESPN owns live scores and match
// insights. Nothing joins the two automatically, so this walks a whole ESPN season and stamps
// fixtures.external_id where the match is unambiguous.
//
// Match rule (all three must hold): BOTH teams, ordered home/away · kickoff within ±3h ·
// same competition season. Exactly one candidate writes; zero or several log a sync_issue and
// leave external_id null. A fixture with null external_id can never be polled by ESPN, which
// is why apply_score_update lets FPL set terminal status for those fixtures only.
//
// Run this from scripts/, not from the cron — it makes ~400 requests.

import { normalizeClubName } from "./fpl";

type Admin = ReturnType<typeof import("./supabase/service").createServiceRoleClient>;

const CORE = "https://sports.core.api.espn.com/v2/sports/soccer/leagues";
const PAGE_SIZE = 100;
const CONCURRENCY = 6;
const FETCH_TIMEOUT_MS = 10_000;
const KICKOFF_TOLERANCE_MS = 3 * 3600e3;

export type EspnEvent = {
  externalId: string;
  kickoffAt: string;
  homeEspnTeamId: string;
  awayEspnTeamId: string;
};

export type MatchReport = {
  candidates: number;
  matched: number;
  ambiguous: number;
  unmatched: number;
  skipped: number;
};

async function getJson(url: string): Promise<any | null> {
  try {
    const res = await fetch(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (res.status !== 200) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function mapLimited<T, R>(items: T[], fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
      for (let i = next++; i < items.length; i = next++) out[i] = await fn(items[i]);
    }),
  );
  return out;
}

// The core API's season year is the first year of a split season ("2026-27" → 2026).
export function espnSeasonYear(season: string): number {
  return Number(season.slice(0, 4));
}

// ---- the match rule, as a pure decision ---------------------------------------------------
// Keys are opaque: the caller decides what identifies a team (a cashford team id where a
// provider mapping exists, a normalized club name otherwise). All the rule cares about is
// that home and away keys are equal IN ORDER, the kickoff is within ±3h, and the season is
// the same one.

export type MatchCandidate = {
  id: string;
  homeKey: string;
  awayKey: string;
  kickoffAt: string;
  season: string;
};
export type MatchTarget = {
  teamHKey: string;
  teamAKey: string;
  kickoffAt: string;
  season: string;
};
export type MatchDecision =
  | { status: "matched"; externalId: string }
  | { status: "multiple"; count: number }
  | { status: "zero" };

export function matchFixture(candidates: MatchCandidate[], target: MatchTarget): MatchDecision {
  const kickoff = new Date(target.kickoffAt).getTime();
  const hits = candidates.filter(
    (c) =>
      c.homeKey === target.teamHKey &&
      c.awayKey === target.teamAKey &&
      c.season === target.season &&
      Math.abs(new Date(c.kickoffAt).getTime() - kickoff) <= KICKOFF_TOLERANCE_MS,
  );
  if (hits.length === 1) return { status: "matched", externalId: hits[0].id };
  if (hits.length > 1) return { status: "multiple", count: hits.length };
  return { status: "zero" };
}

// ESPN's event list only returns $refs, so the ids come from the listing and the details
// (kickoff, competitors) from one fetch per event.
export async function fetchEspnSeason(
  slug: string,
  seasonYear: number,
): Promise<{ events: EspnEvent[]; teamNames: Map<string, string> } | null> {
  const from = `${seasonYear}0701`;
  const to = `${seasonYear + 1}0701`;
  const refs: string[] = [];

  for (let page = 1; ; page++) {
    const listing = await getJson(
      `${CORE}/${slug}/events?dates=${from}-${to}&limit=${PAGE_SIZE}&page=${page}`,
    );
    if (!listing || !Array.isArray(listing.items)) return null;
    for (const item of listing.items) if (item?.$ref) refs.push(String(item.$ref));
    if (page >= Number(listing.pageCount ?? 1)) break;
  }
  if (refs.length === 0) return null;

  const events: EspnEvent[] = [];
  const raw = await mapLimited(refs, (ref) => getJson(ref));
  for (const ev of raw) {
    const id = ev?.id ? String(ev.id) : null;
    const date = typeof ev?.date === "string" ? ev.date : null;
    const competitors = ev?.competitions?.[0]?.competitors;
    if (!id || !date || !Array.isArray(competitors)) continue;
    const home = competitors.find((c: any) => c?.homeAway === "home")?.id;
    const away = competitors.find((c: any) => c?.homeAway === "away")?.id;
    if (!home || !away) continue;
    events.push({
      externalId: id,
      kickoffAt: new Date(date).toISOString(),
      homeEspnTeamId: String(home),
      awayEspnTeamId: String(away),
    });
  }

  const teamListing = await getJson(`${CORE}/${slug}/seasons/${seasonYear}/teams?limit=${PAGE_SIZE}`);
  const teamNames = new Map<string, string>();
  if (teamListing && Array.isArray(teamListing.items)) {
    const teams = await mapLimited(
      teamListing.items.map((i: any) => String(i?.$ref ?? "")).filter(Boolean),
      (ref: string) => getJson(ref),
    );
    for (const t of teams) {
      if (t?.id && typeof t.displayName === "string") teamNames.set(String(t.id), t.displayName);
    }
  }

  return { events, teamNames };
}

export async function matchEspnFixtures(
  admin: Admin,
  competitionSlug: string,
): Promise<MatchReport | { error: string }> {
  const { data: competition } = await admin
    .from("competitions")
    .select("id, espn_slug, season")
    .eq("slug", competitionSlug)
    .maybeSingle();
  if (!competition?.espn_slug) return { error: `no espn_slug for ${competitionSlug}` };

  const season: string = competition.season;
  const seasonYear = espnSeasonYear(season);
  const remote = await fetchEspnSeason(competition.espn_slug, seasonYear);
  if (!remote) return { error: "espn season fetch failed" };

  const { data: fixtures } = await admin
    .from("fixtures")
    .select("id, kickoff_at, home_team_id, away_team_id")
    .eq("competition_id", competition.id)
    .is("external_id", null);
  if (!fixtures || fixtures.length === 0) {
    return { candidates: remote.events.length, matched: 0, ambiguous: 0, unmatched: 0, skipped: 0 };
  }

  // ESPN team id → cashford team id: an existing provider mapping first, normalized name second.
  const { data: mappings } = await admin
    .from("team_provider_ids")
    .select("team_id, provider_key")
    .eq("provider", "espn")
    .eq("season", season);
  const espnToTeam = new Map<string, string>(
    (mappings ?? []).map((m: any) => [String(m.provider_key), m.team_id as string]),
  );

  const { data: teams } = await admin.from("teams").select("id, name");
  const nameToTeam = new Map<string, string>(
    (teams ?? []).map((t: any) => [normalizeClubName(t.name), t.id as string]),
  );
  for (const [espnId, name] of remote.teamNames) {
    if (espnToTeam.has(espnId)) continue;
    const teamId = nameToTeam.get(normalizeClubName(name));
    if (teamId) espnToTeam.set(espnId, teamId);
  }

  // Candidate keys are cashford team ids; an unresolved ESPN team gets a key that can never
  // equal one, so it simply never matches.
  const candidates: MatchCandidate[] = remote.events.map((ev) => ({
    id: ev.externalId,
    homeKey: espnToTeam.get(ev.homeEspnTeamId) ?? `espn:${ev.homeEspnTeamId}`,
    awayKey: espnToTeam.get(ev.awayEspnTeamId) ?? `espn:${ev.awayEspnTeamId}`,
    kickoffAt: ev.kickoffAt,
    season,
  }));
  const eventById = new Map(remote.events.map((ev) => [ev.externalId, ev]));

  const report: MatchReport = {
    candidates: remote.events.length,
    matched: 0,
    ambiguous: 0,
    unmatched: 0,
    skipped: 0,
  };
  const issues: any[] = [];

  for (const fx of fixtures) {
    if (!fx.kickoff_at) {
      report.skipped++;
      issues.push({
        source: "espn",
        kind: "espn-match",
        ref: fx.id,
        detail: { reason: "kickoff-tbc" },
      });
      continue;
    }
    const decision = matchFixture(candidates, {
      teamHKey: fx.home_team_id,
      teamAKey: fx.away_team_id,
      kickoffAt: fx.kickoff_at,
      season,
    });

    if (decision.status !== "matched") {
      if (decision.status === "zero") report.unmatched++;
      else report.ambiguous++;
      issues.push({
        source: "espn",
        kind: "espn-match",
        ref: fx.id,
        detail: {
          reason: decision.status === "zero" ? "no-candidate" : "ambiguous",
          candidates: decision.status === "multiple" ? decision.count : 0,
          kickoff_at: fx.kickoff_at,
        },
      });
      continue;
    }

    const hit = eventById.get(decision.externalId)!;
    // `.is("external_id", null)` keeps a concurrent poller's id from being overwritten.
    const { error } = await admin
      .from("fixtures")
      .update({ external_id: decision.externalId })
      .eq("id", fx.id)
      .is("external_id", null);
    if (error) {
      issues.push({
        source: "espn",
        kind: "espn-match",
        ref: fx.id,
        detail: { reason: "write-failed", error: error.message },
      });
      continue;
    }

    await admin.from("team_provider_ids").upsert(
      [
        { team_id: fx.home_team_id, provider: "espn", season, provider_key: hit.homeEspnTeamId },
        { team_id: fx.away_team_id, provider: "espn", season, provider_key: hit.awayEspnTeamId },
      ],
      { onConflict: "provider,season,provider_key" },
    );
    report.matched++;
  }

  if (issues.length > 0) await admin.from("sync_issues").insert(issues);
  return report;
}
