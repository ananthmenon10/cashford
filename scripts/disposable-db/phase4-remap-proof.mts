// Disposable Postgres only. Run after the full migration chain. Proves
// cashford.replace_provider_fixture_id's transactional guarantee: the delete
// of a stale mapping and the insert of the new one are one transaction, a
// forced failure on the insert side rolls back the delete, and providers are
// isolated from each other's rows despite sharing an external_id namespace
// only within (provider, external_id).
import pg from "pg";

const connection = {
  host: "localhost",
  port: 55432,
  user: "postgres",
  password: "postgres",
  database: "postgres",
};
let failures = 0;

function check(label: string, condition: boolean, detail = "") {
  if (!condition) failures++;
  console.log(
    `${condition ? "PASS" : "FAIL"} ${label}${detail ? ` — ${detail}` : ""}`,
  );
}

const main = new pg.Client(connection);
await main.connect();
const rows = async (sql: string, values: unknown[] = []) =>
  (await main.query(sql, values)).rows;
const row = async (sql: string, values: unknown[] = []) => (await rows(sql, values))[0];

await main.query("begin");
const comp = await row(
  `insert into cashford.competitions(slug, name, format, season, fpl_source, status)
   values ('phase4-remap-proof', 'Phase4 Remap Proof', 'league', '2026-27', false, 'active')
   returning id`,
);
const teamA = await row(
  `insert into cashford.teams(name, short_name) values ('Remap A', 'RMA') returning id`,
);
const teamB = await row(
  `insert into cashford.teams(name, short_name) values ('Remap B', 'RMB') returning id`,
);
const fixtureOld = await row(
  `insert into cashford.fixtures(competition_id, kickoff_at, home_team_id, away_team_id, status)
   values ($1, now() + interval '1 day', $2, $3, 'scheduled') returning id`,
  [comp.id, teamA.id, teamB.id],
);
const fixtureNew = await row(
  `insert into cashford.fixtures(competition_id, kickoff_at, home_team_id, away_team_id, status)
   values ($1, now() + interval '2 day', $2, $3, 'scheduled') returning id`,
  [comp.id, teamA.id, teamB.id],
);
await main.query(
  `insert into cashford.fixture_provider_ids(fixture_id, provider, external_id, confidence)
   values ($1, 'fotmob', 'remap-proof-ext', 'exact')`,
  [fixtureOld.id],
);
await main.query("commit");

// (a) normal remap moves the external id from the old fixture to the new one.
const before = await row(
  "select fixture_id from cashford.fixture_provider_ids where provider = 'fotmob' and external_id = 'remap-proof-ext'",
);
const removed = await row(
  "select cashford.replace_provider_fixture_id($1, 'fotmob', 'remap-proof-ext', 'exact', null) as value",
  [fixtureNew.id],
);
const after = await row(
  "select fixture_id from cashford.fixture_provider_ids where provider = 'fotmob' and external_id = 'remap-proof-ext'",
);
check(
  "R-1 normal remap reports one row removed and moves the mapping to the new fixture",
  removed.value === 1 && before.fixture_id === fixtureOld.id && after.fixture_id === fixtureNew.id,
  JSON.stringify({ removed: removed.value, before: before.fixture_id, after: after.fixture_id }),
);

// (b) forced failure on the insert side must roll back the delete. Re-seed the
// original mapping, then force the insert half to violate the fixture FK by
// passing a fixture id that doesn't exist.
await main.query(
  `insert into cashford.fixture_provider_ids(fixture_id, provider, external_id, confidence)
   values ($1, 'fotmob', 'remap-proof-ext-2', 'exact')`,
  [fixtureOld.id],
);
const bogusFixture = "00000000-0000-0000-0000-000000000000";
let insertFailed = false;
try {
  await main.query(
    "select cashford.replace_provider_fixture_id($1, 'fotmob', 'remap-proof-ext-2', 'exact', null)",
    [bogusFixture],
  );
} catch {
  insertFailed = true;
}
const originalIntact = await row(
  "select fixture_id from cashford.fixture_provider_ids where provider = 'fotmob' and external_id = 'remap-proof-ext-2'",
);
check(
  "R-2 a forced insert failure rolls back the delete — the original mapping survives",
  insertFailed && originalIntact !== undefined && originalIntact.fixture_id === fixtureOld.id,
  JSON.stringify({ insertFailed, originalIntact }),
);

// (c) provider isolation: a fotmob remap must not touch an understat row that
// happens to share the same external_id (the unique constraint is scoped to
// (provider, external_id), and the delete inside the function is provider-filtered).
await main.query(
  `insert into cashford.fixture_provider_ids(fixture_id, provider, external_id, confidence)
   values ($1, 'understat', 'shared-ext-id', 'exact')`,
  [fixtureOld.id],
);
await main.query(
  "select cashford.replace_provider_fixture_id($1, 'fotmob', 'shared-ext-id', 'exact', null)",
  [fixtureNew.id],
);
const understatRow = await row(
  "select fixture_id from cashford.fixture_provider_ids where provider = 'understat' and external_id = 'shared-ext-id'",
);
const fotmobRow = await row(
  "select fixture_id from cashford.fixture_provider_ids where provider = 'fotmob' and external_id = 'shared-ext-id'",
);
check(
  "R-3 a fotmob remap does not delete an understat row sharing the same external_id",
  understatRow !== undefined &&
    understatRow.fixture_id === fixtureOld.id &&
    fotmobRow !== undefined &&
    fotmobRow.fixture_id === fixtureNew.id,
  JSON.stringify({ understatRow, fotmobRow }),
);

await main.query("delete from cashford.fixtures where competition_id = $1", [comp.id]);
await main.query("delete from cashford.competitions where id = $1", [comp.id]);
await main.query("delete from cashford.teams where id in ($1, $2)", [teamA.id, teamB.id]);
await main.end();
console.log(
  failures
    ? `${failures} PHASE-4 REMAP PROOF FAILURE(S)`
    : "ALL PHASE-4 REMAP PROOFS PASSED",
);
process.exit(failures ? 1 : 0);
