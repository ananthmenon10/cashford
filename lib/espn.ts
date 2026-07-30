// ESPN live-score poll (Phase 6) + knockout team resolution (Phase 9).
// ESPN public API, no key. Updates existing fixtures' scores/status/advancer and
// fills in knockout teams once the bracket resolves. Runs inside the cron tick.
//
// Phase 1: the poll is competition-aware. The slug comes from the fixtures that need polling
// (joined through competitions), never from competition status — so World Cup corrections keep
// working after the cup is archived. Scores land through cashford.apply_score_update, which
// owns the provenance rules in §2.

type Admin = ReturnType<typeof import("./supabase/service").createServiceRoleClient>;
const SCOREBOARD = (slug: string) =>
  `https://site.api.espn.com/apis/site/v2/sports/soccer/${slug}/scoreboard`;
const WC_SLUG = "fifa.world";
const CORRECTION_HORIZON_MS = 48 * 3600e3;

function mapStatus(name = "", state = "") {
  if (name === "STATUS_POSTPONED") return "postponed";
  if (name === "STATUS_CANCELED" || name === "STATUS_CANCELLED") return "cancelled";
  if (name === "STATUS_ABANDONED" || name === "STATUS_FORFEIT") return "abandoned";
  if (state === "post") return "finished";
  if (state === "in") return "live";
  return "scheduled";
}
function isReal(c: any) {
  const abbr = c?.team?.abbreviation ?? "";
  const name = c?.team?.displayName ?? "";
  if (!c?.team?.id) return false;
  if (/^\d/.test(abbr)) return false;
  if (/group|place|winner|runner|loser|tbd/i.test(name)) return false;
  return true;
}
const ymd = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, "");
const numScore = (s: any) => (s === undefined || s === null || s === "" ? null : Number.parseInt(s, 10));

type DueFixture = {
  id: string;
  external_id: number;
  status: string;
  is_knockout: boolean;
  home_team_id: string | null;
  away_team_id: string | null;
  kickoff_at: string | null;
  espn_slug: string;
  format: string;
  season: string;
};

// Fixtures worth an ESPN call right now: live, kicking off within the next 30 minutes (or
// started up to 3h ago), or finished within the 48h correction horizon. Fixtures with no
// external_id are invisible to ESPN and are excluded — FPL is their only source.
async function dueFixtures(admin: Admin, now: Date): Promise<DueFixture[]> {
  const since = new Date(now.getTime() - 3 * 3600e3).toISOString();
  const until = new Date(now.getTime() + 30 * 60e3).toISOString();
  const correctionSince = new Date(now.getTime() - CORRECTION_HORIZON_MS).toISOString();

  const { data } = await admin
    .from("fixtures")
    .select(
      "id, external_id, status, is_knockout, home_team_id, away_team_id, kickoff_at, competitions!inner(espn_slug, format, season)",
    )
    .not("external_id", "is", null)
    .or(
      [
        "status.eq.live",
        `and(status.eq.scheduled,kickoff_at.gte.${since},kickoff_at.lte.${until})`,
        `and(status.eq.finished,kickoff_at.gte.${correctionSince})`,
      ].join(","),
    );

  return (data ?? [])
    .map((r: any) => ({
      id: r.id,
      external_id: Number(r.external_id),
      status: r.status,
      is_knockout: r.is_knockout,
      home_team_id: r.home_team_id,
      away_team_id: r.away_team_id,
      kickoff_at: r.kickoff_at,
      espn_slug: r.competitions?.espn_slug,
      format: r.competitions?.format,
      season: r.competitions?.season,
    }))
    .filter((r: DueFixture) => !!r.espn_slug);
}

async function fetchScoreboard(slug: string, from: string, to: string): Promise<any[] | null> {
  try {
    const res = await fetch(`${SCOREBOARD(slug)}?dates=${from}-${to}`);
    return (await res.json()).events ?? [];
  } catch {
    return null;
  }
}

export async function pollScores(admin: Admin) {
  const now = new Date();
  const due = await dueFixtures(admin, now);
  if (due.length === 0) return { fetched: 0, updated: 0, resolved: 0, skipped: true };

  // One scoreboard call per slug, over a window derived from the due fixtures themselves.
  const bySlug = new Map<string, DueFixture[]>();
  for (const fx of due) {
    const list = bySlug.get(fx.espn_slug);
    if (list) list.push(fx);
    else bySlug.set(fx.espn_slug, [fx]);
  }

  let fetched = 0, updated = 0, resolved = 0;
  const errors: string[] = [];
  for (const [slug, fixtures] of bySlug) {
    const times = fixtures
      .map((f) => (f.kickoff_at ? new Date(f.kickoff_at).getTime() : now.getTime()))
      .filter((t) => Number.isFinite(t));
    const from = ymd(new Date(Math.min(...times) - 12 * 3600e3));
    const to = ymd(new Date(Math.max(...times) + 12 * 3600e3));

    const events = await fetchScoreboard(slug, from, to);
    if (!events) {
      errors.push(`${slug}: espn fetch failed`);
      continue;
    }
    fetched += events.length;

    const byExt = new Map(events.map((e: any) => [Number(e.id), e]));
    for (const fx of fixtures) {
      const e = byExt.get(fx.external_id);
      if (!e) continue;
      const r = await applyEvent(admin, fx, e, now);
      if (r.updated) updated++;
      if (r.resolved) resolved++;
    }
  }

  return errors.length > 0
    ? { fetched, updated, resolved, error: errors.join("; ") }
    : { fetched, updated, resolved };
}

async function applyEvent(admin: Admin, fx: DueFixture, e: any, now: Date) {
  const comp = e.competitions?.[0];
  const cs = comp?.competitors ?? [];
  const home = cs.find((c: any) => c.homeAway === "home") ?? cs[0];
  const away = cs.find((c: any) => c.homeAway === "away") ?? cs[1];
  const state = e.status?.type?.state;
  const status = mapStatus(e.status?.type?.name, state);

  // Only touch games *by their start time*: live now, a just-changed terminal
  // state (finished/postponed/cancelled/abandoned), or a knockout whose teams
  // just got decided. Scheduled-future / already-recorded games are skipped.
  const isLive = state === "in";
  const terminalChange =
    (status === "finished" || status === "postponed" || status === "cancelled" || status === "abandoned") &&
    fx.status !== status;
  // A fixture that finished within the correction horizon is re-checked: apply_score_update
  // decides whether the score actually moved and whether a revision is allowed.
  const correctionWatch = fx.status === "finished" && status === "finished";
  const needsResolve = isReal(home) && isReal(away) && (!fx.home_team_id || !fx.away_team_id);
  if (!isLive && !terminalChange && !correctionWatch && !needsResolve) {
    return { updated: false, resolved: false };
  }

  // Scores and status go through the routine — it owns the §2 provenance predicates and
  // writes result_revisions (or a sync_issue) atomically with the fixture update.
  const hasScore = isLive || status === "finished";
  const { data: scoreResult, error: scoreErr } = await admin.rpc("apply_score_update", {
    p_fixture_id: fx.id,
    p_home: hasScore ? numScore(home?.score) : null,
    p_away: hasScore ? numScore(away?.score) : null,
    p_source: "espn",
    p_status: status,
  });
  if (scoreErr) {
    console.error(`poll: fixture ${fx.external_id} score update failed: ${scoreErr.message}`);
    return { updated: false, resolved: false };
  }
  // applied:false is a REJECTION, not an error — the routine refused this observation (settled
  // contests exist, or the fixture is gone). Nothing below may run: writing advancer_team_id
  // from a rejected result would change the recorded knockout winner while the money that was
  // already paid out on the old one stays put.
  if ((scoreResult as any)?.applied !== true) {
    console.warn(
      `poll: fixture ${fx.external_id} update rejected: ${(scoreResult as any)?.reason ?? "unknown"}`,
    );
    return { updated: false, resolved: false };
  }

  // Everything the routine does not own: display state, team resolution, advancer.
  const patch: Record<string, any> = {
    status_detail: e.status?.type?.name ?? null,
    updated_at: now.toISOString(),
  };
  if (isLive) patch.minute = Number.parseInt(e.status?.displayClock ?? "", 10) || null;

  let didResolve = false;
  if (needsResolve) {
    patch.home_team_id = await resolveEspnTeam(admin, home.team, fx.season);
    patch.away_team_id = await resolveEspnTeam(admin, away.team, fx.season);
    patch.home_label = home.team.displayName;
    patch.away_label = away.team.displayName;
    didResolve = true;
  }

  // Knockout advancer — ONLY for knockout fixtures (a group fixture must keep
  // advancer_team_id null per chk_advancer_ko_only, else the update fails).
  const hid = patch.home_team_id ?? fx.home_team_id;
  const aid = patch.away_team_id ?? fx.away_team_id;
  if (status === "finished" && fx.is_knockout) {
    if (home?.winner && hid) patch.advancer_team_id = hid;
    else if (away?.winner && aid) patch.advancer_team_id = aid;
  }

  const { error: upErr } = await admin.from("fixtures").update(patch).eq("id", fx.id);
  if (upErr) {
    console.error(`poll: fixture ${fx.external_id} update failed: ${upErr.message}`);
    return { updated: false, resolved: false };
  }
  return { updated: true, resolved: didResolve };
}

// ESPN team id → cashford team id via team_provider_ids (§1.8), creating the team the first
// time we see it. `teams.external_id` is still written so the cup-era screens keep working.
async function resolveEspnTeam(admin: Admin, team: any, season: string): Promise<string | null> {
  const espnId = String(team.id);
  const { data: mapped } = await admin
    .from("team_provider_ids")
    .select("team_id")
    .eq("provider", "espn")
    .eq("season", season)
    .eq("provider_key", espnId)
    .maybeSingle();
  if (mapped?.team_id) return mapped.team_id;

  const { data: row } = await admin
    .from("teams")
    .upsert(
      {
        external_id: Number(team.id),
        name: team.displayName,
        short_name: team.abbreviation,
        flag_url: team.logo,
      },
      { onConflict: "external_id" },
    )
    .select("id")
    .maybeSingle();
  if (!row?.id) return null;

  await admin
    .from("team_provider_ids")
    .upsert(
      { team_id: row.id, provider: "espn", season, provider_key: espnId },
      { onConflict: "provider,season,provider_key" },
    );
  return row.id;
}

// Fill in upcoming knockout fixtures' teams as the bracket resolves — independent of
// pollScores's live ±12h window, so the next round populates during the multi-day gap
// *before* its matches (not only ~12h prior). Cheap by design: one tiny DB read each
// call, and the ESPN fetch is skipped entirely once no upcoming KO fixture is a
// placeholder. Throttle the cadence at the caller (the cron fires every minute).
export async function resolveKnockoutBracket(admin: Admin) {
  const now = new Date();
  // Upcoming knockout fixtures still missing a team (the bracket hasn't filled them yet).
  const { data: pending } = await admin.from("fixtures")
    .select("id, external_id, kickoff_at, home_team_id, away_team_id, competitions!inner(season)")
    .eq("is_knockout", true)
    .not("external_id", "is", null)
    .gt("kickoff_at", now.toISOString())
    .or("home_team_id.is.null,away_team_id.is.null");
  if (!pending?.length) return { pending: 0, resolved: 0, skipped: true };

  // One ESPN fetch spanning just the pending fixtures (≤32 KO events, under the 100 cap).
  const times = pending.map((p) => new Date(p.kickoff_at).getTime());
  const from = ymd(new Date(Math.min(...times) - 24 * 3600e3));
  const to = ymd(new Date(Math.max(...times) + 24 * 3600e3));
  // Knockout brackets only exist in the cup competition, so the slug is fixed here.
  const events = await fetchScoreboard(WC_SLUG, from, to);
  if (!events) return { pending: pending.length, resolved: 0, error: "espn fetch failed" };
  const byExt = new Map(events.map((e: any) => [Number(e.id), e]));

  let resolved = 0;
  for (const fx of pending) {
    const cs = byExt.get(fx.external_id)?.competitions?.[0]?.competitors ?? [];
    const home = cs.find((c: any) => c.homeAway === "home") ?? cs[0];
    const away = cs.find((c: any) => c.homeAway === "away") ?? cs[1];
    if (!isReal(home) || !isReal(away)) continue; // ESPN bracket still TBD — leave the placeholder

    const season = (fx as any).competitions?.season;
    const { error: upErr } = await admin.from("fixtures").update({
      home_team_id: await resolveEspnTeam(admin, home.team, season),
      away_team_id: await resolveEspnTeam(admin, away.team, season),
      home_label: home.team.displayName,
      away_label: away.team.displayName,
      updated_at: now.toISOString(),
    }).eq("id", fx.id);
    if (upErr) { console.error(`resolveKO: fixture ${fx.external_id} update failed: ${upErr.message}`); continue; }
    resolved++;
  }
  return { pending: pending.length, resolved };
}
