// Sync WC2026 fixtures + teams from ESPN's public API (no key), then create contests.
// Probe (no writes):  node --env-file=.env.local scripts/sync-fixtures.mjs
// Apply (writes DB):  node --env-file=.env.local scripts/sync-fixtures.mjs apply
//
// ESPN soccer scoreboard caps at 100 events/response, so we fetch the group
// window and the knockout window separately (72 + 32 = 104). Knockout rounds
// are assigned positionally from the date-sorted bracket (16/8/4/2/1/1).

import { createClient } from "@supabase/supabase-js";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SR = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !SR) { console.error("Missing Supabase env"); process.exit(1); }
const MODE = process.argv[2] === "apply" ? "apply" : "probe";
const LOCK_MS = 0; // predictions lock at kickoff (previously 30 min before)
const BASE = "https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard";

const db = createClient(URL, SR, { auth: { persistSession: false }, db: { schema: "cashford" } });

const fetchRange = async (range) => {
  const r = await fetch(`${BASE}?dates=${range}`);
  const j = await r.json();
  return j.events ?? [];
};

function mapStatus(name, state) {
  if (name === "STATUS_POSTPONED") return "postponed";
  if (name === "STATUS_CANCELED" || name === "STATUS_CANCELLED") return "cancelled";
  if (name === "STATUS_ABANDONED" || name === "STATUS_FORFEIT") return "abandoned";
  if (state === "post") return "finished";
  if (state === "in") return "live";
  return "scheduled";
}
function koRound(i) {
  if (i < 16) return "r32";
  if (i < 24) return "r16";
  if (i < 28) return "qf";
  if (i < 30) return "sf";
  if (i < 31) return "third";
  return "final";
}
// A competitor is a real country (not a "Group A 2nd Place" / "2A" placeholder).
function isReal(c) {
  const abbr = c.team?.abbreviation ?? "";
  const name = c.team?.displayName ?? "";
  if (!c.team?.id) return false;
  if (/^\d/.test(abbr)) return false;
  if (/group|place|winner|runner|loser|tbd/i.test(name)) return false;
  return true;
}
const numScore = (s) => (s === undefined || s === null || s === "" ? null : Number.parseInt(s, 10));

// --- fetch both windows ---
const groupEv = await fetchRange("20260611-20260627");
let koEv = await fetchRange("20260628-20260719");
koEv = koEv.sort((a, b) => new Date(a.date) - new Date(b.date));

const norm = [
  ...groupEv.map((e) => ({ e, round: "group", ko: false })),
  ...koEv.map((e, i) => ({ e, round: koRound(i), ko: true })),
];
console.log(`fetched: group=${groupEv.length} knockout=${koEv.length} total=${norm.length}`);

// summary
const byRound = {}, byStatus = {};
let tbd = 0;
for (const { e, round } of norm) {
  byRound[round] = (byRound[round] ?? 0) + 1;
  const st = mapStatus(e.status?.type?.name, e.status?.type?.state);
  byStatus[st] = (byStatus[st] ?? 0) + 1;
  const cs = e.competitions[0].competitors;
  if (!cs.every(isReal)) tbd++;
}
console.log("rounds:", byRound);
console.log("status:", byStatus);
console.log("fixtures with a TBD team:", tbd);

if (MODE === "probe") { console.log("\n[probe] no writes. Re-run with `apply`."); process.exit(0); }

// --- teams (real only) ---
const teamMap = new Map();
for (const { e } of norm) {
  for (const c of e.competitions[0].competitors) {
    if (isReal(c)) {
      teamMap.set(Number(c.team.id), {
        external_id: Number(c.team.id),
        name: c.team.displayName,
        short_name: c.team.abbreviation ?? null,
        flag_url: c.team.logo ?? null,
      });
    }
  }
}
const teams = [...teamMap.values()];
let r = await db.from("teams").upsert(teams, { onConflict: "external_id" });
if (r.error) { console.error("teams:", r.error.message); process.exit(1); }
const { data: teamRows } = await db.from("teams").select("id, external_id");
const teamId = new Map(teamRows.map((t) => [t.external_id, t.id]));
console.log(`teams upserted: ${teams.length}`);

// --- fixtures ---
const fixRows = norm.map(({ e, round, ko }) => {
  const comp = e.competitions[0];
  const cs = comp.competitors;
  const home = cs.find((c) => c.homeAway === "home") ?? cs[0];
  const away = cs.find((c) => c.homeAway === "away") ?? cs[1];
  const st = mapStatus(e.status?.type?.name, e.status?.type?.state);
  const scored = st === "live" || st === "finished";
  const advancer = ko
    ? (home.winner && isReal(home) ? teamId.get(Number(home.team.id))
      : away.winner && isReal(away) ? teamId.get(Number(away.team.id)) : null)
    : null;
  return {
    external_id: Number(e.id),
    round,
    is_knockout: ko,
    home_team_id: isReal(home) ? teamId.get(Number(home.team.id)) : null,
    away_team_id: isReal(away) ? teamId.get(Number(away.team.id)) : null,
    home_label: home.team?.displayName ?? null,
    away_label: away.team?.displayName ?? null,
    venue: [comp.venue?.fullName, comp.venue?.address?.city].filter(Boolean).join(", ") || null,
    kickoff_at: e.date,
    status: st,
    status_detail: e.status?.type?.name ?? null,
    ft_home: scored ? numScore(home.score) : null,
    ft_away: scored ? numScore(away.score) : null,
    advancer_team_id: advancer,
  };
});
r = await db.from("fixtures").upsert(fixRows, { onConflict: "external_id" });
if (r.error) { console.error("fixtures:", r.error.message); process.exit(1); }
console.log(`fixtures upserted: ${fixRows.length}`);

// --- contests (one per league per fixture, future-lock only · §7.6) ---
const { data: fixDb } = await db.from("fixtures").select("id, kickoff_at, is_knockout");
const { data: leagues } = await db.from("leagues").select("id, default_stake_inr");
const now = Date.now();
const contests = [];
for (const lg of leagues) {
  for (const f of fixDb) {
    const lock = new Date(f.kickoff_at).getTime() - LOCK_MS;
    if (lock <= now) continue;
    contests.push({
      league_id: lg.id, fixture_id: f.id, stake_inr: lg.default_stake_inr,
      status: "open", lock_at: new Date(lock).toISOString(), is_knockout: f.is_knockout,
    });
  }
}
if (contests.length) {
  r = await db.from("contests").upsert(contests, { onConflict: "league_id,fixture_id", ignoreDuplicates: true });
  if (r.error) { console.error("contests:", r.error.message); process.exit(1); }
}
console.log(`contests created (future-lock): ${contests.length}`);
console.log("\nDone.");
