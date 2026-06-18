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
  const from = ymd(new Date(now.getTime() - 36 * 3600e3)); // catch late-finishing US night games
  const to = ymd(new Date(now.getTime() + 24 * 3600e3));
  let events: any[] = [];
  try {
    const res = await fetch(`${BASE}?dates=${from}-${to}`);
    const json = await res.json();
    events = json.events ?? [];
  } catch {
    return { fetched: 0, updated: 0, resolved: 0, error: "espn fetch failed" };
  }

  let updated = 0, resolved = 0;
  for (const e of events) {
    const externalId = Number(e.id);
    const { data: fx } = await admin.from("fixtures")
      .select("id, status, home_team_id, away_team_id").eq("external_id", externalId).maybeSingle();
    if (!fx) continue;

    const comp = e.competitions?.[0];
    const cs = comp?.competitors ?? [];
    const home = cs.find((c: any) => c.homeAway === "home") ?? cs[0];
    const away = cs.find((c: any) => c.homeAway === "away") ?? cs[1];
    const status = mapStatus(e.status?.type?.name, e.status?.type?.state);
    const scored = status === "live" || status === "finished";

    const patch: Record<string, any> = {
      status,
      status_detail: e.status?.type?.name ?? null,
      updated_at: new Date().toISOString(),
    };
    if (scored) {
      patch.ft_home = numScore(home?.score);
      patch.ft_away = numScore(away?.score);
    }
    if (status === "live") patch.minute = Number.parseInt(e.status?.displayClock ?? "", 10) || null;
    if (status === "finished") patch.finished_at = new Date().toISOString();

    // Resolve knockout teams once ESPN has real countries (bracket filled in)
    if (isReal(home) && isReal(away) && (!fx.home_team_id || !fx.away_team_id)) {
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

    // Knockout advancer
    const hid = patch.home_team_id ?? fx.home_team_id;
    const aid = patch.away_team_id ?? fx.away_team_id;
    if (status === "finished") {
      if (home?.winner && hid) patch.advancer_team_id = hid;
      else if (away?.winner && aid) patch.advancer_team_id = aid;
    }

    await admin.from("fixtures").update(patch).eq("id", fx.id);
    updated++;
  }
  return { fetched: events.length, updated, resolved };
}
