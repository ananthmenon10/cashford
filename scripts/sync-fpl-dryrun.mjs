// Phase 1 step 4: fetch + validate the FPL snapshot and print the writes the real sync WOULD
// make. Writes nothing, takes no lease.
//
//   node --env-file=.env.local scripts/sync-fpl-dryrun.mjs

import { createClient } from "@supabase/supabase-js";
import { fetchFplSnapshot, normalizeClubName } from "../lib/fpl.ts";

const svc = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false }, db: { schema: "cashford" } },
);

const COMPETITION_SLUG = "pl-2026-27";
const SEASON = "2026-27";

const snapshot = await fetchFplSnapshot();
if (!snapshot) {
  console.error("✗ snapshot rejected — the real sync would log a sync_issue and skip");
  process.exit(1);
}
console.log(
  `✓ snapshot: ${snapshot.events.length} events · ${snapshot.teams.length} teams · ${snapshot.fixtures.length} fixtures`,
);
console.log(`  GW1 deadline: ${snapshot.events[0].deadlineAt}`);
console.log(`  GW38 deadline: ${snapshot.events[snapshot.events.length - 1].deadlineAt}`);

const { data: competition } = await svc
  .from("competitions").select("id, status").eq("slug", COMPETITION_SLUG).maybeSingle();
if (!competition) {
  console.error(`✗ competition ${COMPETITION_SLUG} not found — apply the migration first`);
  process.exit(1);
}
console.log(`  competition status: ${competition.status}`);

// Team resolution, read-only.
const { data: mapped } = await svc
  .from("team_provider_ids").select("team_id, provider_key")
  .eq("provider", "fpl").eq("season", SEASON);
const byKey = new Map((mapped ?? []).map((r) => [String(r.provider_key), r.team_id]));
const { data: teams } = await svc.from("teams").select("id, name");
const byName = new Map((teams ?? []).map((t) => [normalizeClubName(t.name), t.id]));

const wouldCreate = [];
const resolved = new Map();
for (const t of snapshot.teams) {
  const existing = byKey.get(String(t.fplTeamId)) ?? byName.get(normalizeClubName(t.name));
  if (existing) resolved.set(t.fplTeamId, existing);
  else wouldCreate.push(t.name);
}
console.log(`  teams resolved: ${resolved.size}/${snapshot.teams.length}`);
if (wouldCreate.length) console.log(`  would CREATE teams: ${wouldCreate.join(", ")}`);
const wouldMap = snapshot.teams.filter((t) => !byKey.has(String(t.fplTeamId))).length;
console.log(`  would add fpl provider mappings: ${wouldMap}`);

// Gameweeks and fixtures, read-only.
const { data: gws } = await svc
  .from("gameweeks").select("fpl_event_id, number, deadline_at, status")
  .eq("competition_id", competition.id);
const gwByEvent = new Map((gws ?? []).map((g) => [Number(g.fpl_event_id), g]));
const newGws = snapshot.events.filter((e) => !gwByEvent.has(e.fplEventId));
const changedDeadlines = snapshot.events.filter((e) => {
  const g = gwByEvent.get(e.fplEventId);
  return g && g.deadline_at !== e.deadlineAt;
});
console.log(`  would INSERT gameweeks: ${newGws.length}`);
console.log(`  deadline changes proposed: ${changedDeadlines.length}`);
for (const e of changedDeadlines.slice(0, 10)) {
  const g = gwByEvent.get(e.fplEventId);
  console.log(`    gw ${e.number}: ${g.deadline_at} → ${e.deadlineAt} (gw status ${g.status})`);
}

const { data: fxs } = await svc
  .from("fixtures").select("fpl_fixture_id, kickoff_at, external_id")
  .eq("competition_id", competition.id).not("fpl_fixture_id", "is", null);
const fxByFpl = new Map((fxs ?? []).map((f) => [Number(f.fpl_fixture_id), f]));
const newFixtures = snapshot.fixtures.filter((f) => !fxByFpl.has(f.fplFixtureId));
const movedKickoffs = snapshot.fixtures.filter((f) => {
  const x = fxByFpl.get(f.fplFixtureId);
  return x && x.kickoff_at !== f.kickoffAt;
});
const unmatchable = snapshot.fixtures.filter((f) => {
  const x = fxByFpl.get(f.fplFixtureId);
  return x && x.external_id === null;
});
console.log(`  would INSERT fixtures: ${newFixtures.length}`);
console.log(`  kickoff changes proposed: ${movedKickoffs.length}`);
console.log(`  existing fixtures with no ESPN id: ${unmatchable.length}`);

const unassigned = snapshot.fixtures.filter((f) => f.fplEventId === null).length;
const tbc = snapshot.fixtures.filter((f) => f.kickoffAt === null).length;
console.log(`  FPL fixtures with no gameweek: ${unassigned} · with no kickoff time: ${tbc}`);
const skipped = snapshot.fixtures.filter(
  (f) => !resolved.has(f.homeFplTeamId) || !resolved.has(f.awayFplTeamId),
).length;
console.log(`  fixtures the payload would SKIP (unresolved club): ${skipped}`);

console.log("\n✓ dry run complete — nothing was written");
