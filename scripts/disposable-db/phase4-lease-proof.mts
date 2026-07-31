// Disposable Postgres only. Run after the full migration chain and
// scripts/disposable-db/phase4-persistence.sql. This file is written for the
// separate prover; this implementation run must not start Docker or execute it.
import pg from "pg";

const connection = {
  host: "localhost",
  port: 55432,
  user: "postgres",
  password: "postgres",
  database: "postgres",
};
const key = "espn_match_data";
let failures = 0;

function check(label: string, condition: boolean, detail = "") {
  if (!condition) failures++;
  console.log(
    `${condition ? "PASS" : "FAIL"} ${label}${detail ? ` — ${detail}` : ""}`,
  );
}

async function client() {
  const value = new pg.Client(connection);
  await value.connect();
  return value;
}

const main = await client();
const rows = async (sql: string, values: unknown[] = []) =>
  (await main.query(sql, values)).rows;
const row = async (sql: string, values: unknown[] = []) =>
  (await rows(sql, values))[0];
const state = () =>
  row(
    "select row_to_json(s)::text as value from cashford.sync_state s where key = $1",
    [key],
  );
const reset = async (
  due: string,
  leaseUntil: string | null = null,
  token: string | null = null,
) => {
  await main.query(
    `update cashford.sync_state
        set next_due_at = $2, lease_until = $3, lease_token = $4,
            last_run_at = null
      where key = $1`,
    [key, due, leaseUntil, token],
  );
};

await reset("2000-01-01T00:00:00Z");
const claimed = await row(
  "select * from cashford.claim_phase4_lease($1, 300)",
  [key],
);
const claimedState = await row(
  "select lease_token, lease_until, last_run_at from cashford.sync_state where key = $1",
  [key],
);
check(
  "P-30 due unleased key is claimed and stamped",
  claimed.outcome === "claimed" &&
    claimed.token === claimedState.lease_token &&
    claimedState.lease_until !== null &&
    claimedState.last_run_at !== null,
);

await reset("infinity");
const darkBefore = await state();
const dark = await row(
  "select * from cashford.claim_phase4_lease($1, 300)",
  [key],
);
const darkAfter = await state();
check(
  "P-31 dark key returns not_due and is byte-identical",
  dark.outcome === "not_due" && darkBefore.value === darkAfter.value,
);

const heldToken = "00000000-0000-0000-0000-000000004032";
await reset(
  "2000-01-01T00:00:00Z",
  new Date(Date.now() + 60_000).toISOString(),
  heldToken,
);
const heldBefore = await state();
const held = await row(
  "select * from cashford.claim_phase4_lease($1, 300)",
  [key],
);
const heldAfter = await state();
check(
  "P-32 live lease returns leased and is byte-identical",
  held.outcome === "leased" && heldBefore.value === heldAfter.value,
);

await reset("2000-01-01T00:00:00Z");
const racerA = await client();
const racerB = await client();
const raced = await Promise.all([
  racerA.query("select * from cashford.claim_phase4_lease($1, 300)", [key]),
  racerB.query("select * from cashford.claim_phase4_lease($1, 300)", [key]),
]);
const outcomes = raced.map((result) => result.rows[0].outcome).sort();
check(
  "P-33 two claims yield exactly claimed plus leased",
  JSON.stringify(outcomes) === JSON.stringify(["claimed", "leased"]),
  JSON.stringify(outcomes),
);
await racerA.end();
await racerB.end();

await reset("2000-01-01T00:00:00Z");
const fleetSize = 20;
const fleet = await Promise.all(Array.from({ length: fleetSize }, () => client()));
const fleetResults = await Promise.all(
  fleet.map((c) => c.query("select * from cashford.claim_phase4_lease($1, 300)", [key])),
);
const fleetOutcomes = fleetResults.map((result) => result.rows[0].outcome);
const claimedCount = fleetOutcomes.filter((o) => o === "claimed").length;
const leasedCount = fleetOutcomes.filter((o) => o === "leased").length;
check(
  "P-33b 20 concurrent claimants yield exactly one claimed, rest leased",
  claimedCount === 1 && leasedCount === fleetSize - 1,
  `claimed=${claimedCount} leased=${leasedCount} other=${fleetOutcomes.length - claimedCount - leasedCount}`,
);
await Promise.all(fleet.map((c) => c.end()));

await reset("infinity");
const claimFirst = await row(
  "select * from cashford.claim_phase4_lease($1, 300)",
  [key],
);
const armSecond = await row(
  "select cashford.arm_sync_key($1, clock_timestamp()) as value",
  [key],
);
check(
  "P-34 claim-first then arm gives not_due then arms",
  claimFirst.outcome === "not_due" && armSecond.value === true,
);
await reset("infinity");
await row("select cashford.arm_sync_key($1, clock_timestamp()) as value", [key]);
const armFirst = await row(
  "select * from cashford.claim_phase4_lease($1, 300)",
  [key],
);
check("P-34 arm-first then claim gives claimed", armFirst.outcome === "claimed");

await reset(
  "2000-01-01T00:00:00Z",
  new Date(Date.now() + 60_000).toISOString(),
  heldToken,
);
const leaseFirst = await row(
  "select * from cashford.claim_phase4_lease($1, 300)",
  [key],
);
await row(
  "select cashford.release_sync_lease($1, $2, clock_timestamp() + interval '1 hour') as value",
  [key, heldToken],
);
check("P-34 claim-first then release gives leased", leaseFirst.outcome === "leased");

await reset(
  "2000-01-01T00:00:00Z",
  new Date(Date.now() + 60_000).toISOString(),
  heldToken,
);
await row(
  "select cashford.release_sync_lease($1, $2, clock_timestamp() + interval '1 hour') as value",
  [key, heldToken],
);
const releaseFirst = await row(
  "select * from cashford.claim_phase4_lease($1, 300)",
  [key],
);
check(
  "P-34c release-first then claim gives not_due (release re-arms the schedule)",
  releaseFirst.outcome === "not_due",
);

await reset(
  "2000-01-01T00:00:00Z",
  new Date(Date.now() + 60_000).toISOString(),
  heldToken,
);
await row(
  "select cashford.release_sync_lease($1, $2, $3) as value",
  [key, heldToken, "2000-01-01T00:00:00Z"],
);
const reclaimedAfterRelease = await row(
  "select * from cashford.claim_phase4_lease($1, 300)",
  [key],
);
check(
  "P-34d a lease released with a past next_due_at is immediately re-claimable",
  reclaimedAfterRelease.outcome === "claimed",
);

await reset(
  "2000-01-01T00:00:00Z",
  "2000-01-01T00:00:01Z",
  heldToken,
);
const expired = await row(
  "select * from cashford.claim_phase4_lease($1, 300)",
  [key],
);
check("P-34 expired lease is claimed", expired.outcome === "claimed");

await reset(
  "2000-01-01T00:00:00Z",
  new Date(Date.now() + 1_000).toISOString(),
  heldToken,
);
const blocker = await client();
const waiter = await client();
await blocker.query("begin");
await blocker.query(
  "select 1 from cashford.sync_state where key = $1 for update",
  [key],
);
const waitingClaim = waiter.query(
  "select * from cashford.claim_phase4_lease($1, 300)",
  [key],
);
await new Promise((resolve) => setTimeout(resolve, 1_500));
await blocker.query("commit");
const waited = (await waitingClaim).rows[0];
check(
  "P-34b a wait past expiry uses the clock after the lock",
  waited.outcome === "claimed",
  waited.outcome,
);
await blocker.end();
await waiter.end();

const fplBefore = await row(
  "select row_to_json(s)::text as value from cashford.sync_state s where key = 'fpl-sync'",
);
let rejected = false;
try {
  await main.query("select * from cashford.claim_phase4_lease('fpl-sync', 300)");
} catch {
  rejected = true;
}
const fplAfter = await row(
  "select row_to_json(s)::text as value from cashford.sync_state s where key = 'fpl-sync'",
);
check(
  "P-35 fpl-sync is rejected and unchanged",
  rejected && fplBefore.value === fplAfter.value,
);

for (const routine of [
  "cashford.arm_sync_key(text,timestamptz)",
  "cashford.claim_phase4_lease(text,integer)",
  "cashford.release_sync_lease_jittered(text,uuid,integer,integer)",
]) {
  const privilege = await row(
    `select has_function_privilege('public', $1, 'execute') as public,
            has_function_privilege('anon', $1, 'execute') as anon,
            has_function_privilege('authenticated', $1, 'execute') as authenticated,
            has_function_privilege('service_role', $1, 'execute') as service`,
    [routine],
  );
  check(
    `P-36 ${routine} is service-role only`,
    !privilege.public &&
      !privilege.anon &&
      !privilege.authenticated &&
      privilege.service,
  );
}

await main.query(
  `update cashford.sync_state
      set next_due_at = 'infinity', lease_until = null, lease_token = null
    where key in (
      'espn_insights','espn_match_data','espn_commentary',
      'espn_standings','derived_standings','espn_reconcile',
      'team_news','understat_xg','fotmob_slow'
    )`,
);
await main.end();
console.log(failures ? `${failures} PHASE-4 LEASE PROOF FAILURE(S)` : "ALL PHASE-4 LEASE PROOFS PASSED");
process.exit(failures ? 1 : 0);
