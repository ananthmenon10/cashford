// Phase 1 step 1: snapshot the pre-migration database and REFUSE to proceed if any fixture
// falls outside the known World Cup set. Everything that exists today must be classifiable as
// wc2026, because the migration backfills fixtures.competition_id and then sets it NOT NULL.
//
//   node --env-file=.env.local scripts/phase1-preflight.mjs
//
// Writes scripts/.phase1-snapshot.json (gitignored working file) for verify-phase1.mjs to
// compare against. The checksum covers LEGACY COLUMNS ONLY — the new columns obviously change.

import { createClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";

const svc = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false }, db: { schema: "cashford" } },
);

const SNAPSHOT_PATH = "scripts/.phase1-snapshot.json";

// The exact allowlist resolved by the live DB audit on 2026-07-27: 104 real WC fixtures
// (group external_id 760414–760485 plus 32 knockout rows) and 2 QA seed rows.
const GROUP_MIN = 760414;
const GROUP_MAX = 760485;
const QA_SEED = [980001, 980002];

const fail = (msg) => {
  console.error(`✗ ABORT — ${msg}`);
  process.exit(1);
};

const { data: fixtures, error } = await svc
  .from("fixtures")
  .select(
    "id, external_id, round, group_label, is_knockout, home_team_id, away_team_id, home_label, away_label, kickoff_at, status, ft_home, ft_away, advancer_team_id, venue",
  )
  .order("id");
if (error) fail(`could not read fixtures: ${error.message}`);

console.log(`fixtures: ${fixtures.length}`);

// Classification: every row must be a WC row. Knockout rows are identified by is_knockout,
// group rows by their external_id range, and the two QA rows by exact id.
const outsiders = fixtures.filter((f) => {
  const ext = f.external_id === null ? null : Number(f.external_id);
  if (ext !== null && QA_SEED.includes(ext)) return false;
  if (f.is_knockout) return false;
  if (ext !== null && ext >= GROUP_MIN && ext <= GROUP_MAX) return false;
  return true;
});
if (outsiders.length > 0) {
  console.error(outsiders.map((f) => `  ${f.id} ext=${f.external_id} round=${f.round}`).join("\n"));
  fail(`${outsiders.length} fixture(s) are not classifiable as wc2026`);
}
console.log(`✓ all ${fixtures.length} fixtures classify as wc2026`);

const count = async (table) => {
  const { count: n, error: e } = await svc.from(table).select("*", { count: "exact", head: true });
  if (e) fail(`could not count ${table}: ${e.message}`);
  return n ?? 0;
};

const counts = {
  fixtures: fixtures.length,
  teams: await count("teams"),
  contests: await count("contests"),
  predictions: await count("predictions"),
  contest_results: await count("contest_results"),
  transfers: await count("transfers"),
  leagues: await count("leagues"),
  league_members: await count("league_members"),
};
console.log(counts);

// Legacy-column checksum: verify-phase1 re-computes this to prove the migration and the first
// sync did not disturb a single World Cup fixture value.
const canonical = fixtures
  .map((f) =>
    [
      f.id, f.external_id, f.round, f.group_label, f.is_knockout,
      f.home_team_id, f.away_team_id, f.home_label, f.away_label,
      f.kickoff_at, f.status, f.ft_home, f.ft_away,
      f.advancer_team_id, f.venue,
    ].join("|"),
  )
  .join("\n");
const checksum = createHash("sha256").update(canonical).digest("hex");
console.log(`legacy fixture checksum: ${checksum}`);

writeFileSync(
  SNAPSHOT_PATH,
  JSON.stringify(
    { at: new Date().toISOString(), counts, checksum, fixtureIds: fixtures.map((f) => f.id) },
    null,
    2,
  ),
);
console.log(`✓ wrote ${SNAPSHOT_PATH}`);
