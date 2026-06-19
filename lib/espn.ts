// ESPN live-score poll (Phase 6) + knockout team resolution (Phase 9).
// ESPN public API, no key. Updates existing fixtures' scores/status/advancer and
// fills in knockout teams once the bracket resolves. Runs inside the cron tick.

type Admin = ReturnType<typeof import("./supabase/service").createServiceRoleClient>;
const BASE = "https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard";

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

export async function pollScores(admin: Admin) {
  const now = new Date();
  // Guard: skip the ESPN call unless something is live or kicking off soon (§17.6).
  const since = new Date(now.getTime() - 3 * 3600e3).toISOString();
  const until = new Date(now.getTime() + 30 * 60e3).toISOString();
  const { count } = await admin.from("fixtures").select("*", { count: "exact", head: true })
    .or(`status.eq.live,and(status.eq.scheduled,kickoff_at.gte.${since},kickoff_at.lte.${until})`);
  if (!count) return { fetched: 0, updated: 0, resolved: 0, skipped: true };

  // Window covering recently-started + about-to-start matches (not the whole tournament).
  const from = ymd(new Date(now.getTime() - 12 * 3600e3));
  const to = ymd(new Date(now.getTime() + 12 * 3600e3));
  let events: any[] = [];
  try {
    const res = await fetch(`${BASE}?dates=${from}-${to}`);
    events = (await res.json()).events ?? [];
  } catch {
    return { fetched: 0, updated: 0, resolved: 0, error: "espn fetch failed" };
  }

  // One lookup of our fixtures for the window — no per-event round trip.
  const ids = events.map((e) => Number(e.id));
  const { data: rows } = await admin.from("fixtures")
    .select("id, external_id, status, is_knockout, home_team_id, away_team_id").in("external_id", ids);
  const byExt = new Map((rows ?? []).map((r) => [r.external_id, r]));

  let updated = 0, resolved = 0;
  for (const e of events) {
    const fx = byExt.get(Number(e.id));
    if (!fx) continue;

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
    const needsResolve = isReal(home) && isReal(away) && (!fx.home_team_id || !fx.away_team_id);
    if (!isLive && !terminalChange && !needsResolve) continue;

    const patch: Record<string, any> = {
      status,
      status_detail: e.status?.type?.name ?? null,
      updated_at: now.toISOString(),
    };
    if (isLive || status === "finished") {
      patch.ft_home = numScore(home?.score);
      patch.ft_away = numScore(away?.score);
    }
    if (isLive) patch.minute = Number.parseInt(e.status?.displayClock ?? "", 10) || null;
    if (status === "finished") patch.finished_at = now.toISOString();

    // Resolve knockout teams once ESPN has real countries (bracket filled in)
    if (needsResolve) {
      const { data: t } = await admin.from("teams").upsert(
        [
          { external_id: Number(home.team.id), name: home.team.displayName, short_name: home.team.abbreviation, flag_url: home.team.logo },
          { external_id: Number(away.team.id), name: away.team.displayName, short_name: away.team.abbreviation, flag_url: away.team.logo },
        ],
        { onConflict: "external_id" },
      ).select("id, external_id");
      const id = (ext: number) => t?.find((x) => x.external_id === ext)?.id ?? null;
      patch.home_team_id = id(Number(home.team.id));
      patch.away_team_id = id(Number(away.team.id));
      patch.home_label = home.team.displayName;
      patch.away_label = away.team.displayName;
      resolved++;
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
    if (upErr) { console.error(`poll: fixture ${fx.external_id} update failed: ${upErr.message}`); continue; }
    updated++;
  }
  return { fetched: events.length, updated, resolved };
}
