// Disposable Postgres only. Run after the full migration chain. Proves
// cashford.claim_insights_writer's legacy/leased handoff semantics: the dark
// (infinity) key keeps the legacy poller in charge, an armed key hands exactly
// one concurrent caller the lease, and reverting to infinity does not let
// legacy resume until the held lease naturally expires.
import pg from "pg";

const connection = {
  host: "localhost",
  port: 55432,
  user: "postgres",
  password: "postgres",
  database: "postgres",
};
const key = "espn_insights";
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

// (a) dark key: legacy stays in charge.
await reset("infinity");
const dark = await row("select * from cashford.claim_insights_writer(300)");
check(
  "W-1 dark espn_insights key returns writer=legacy",
  dark.writer === "legacy" && dark.reason === null,
  JSON.stringify(dark),
);
// Legacy's claim still takes the short lease (so a second dark-path caller
// doesn't also think it's legacy mid-run).
const darkState = await row(
  "select lease_token, lease_until from cashford.sync_state where key = $1",
  [key],
);
check(
  "W-1b legacy claim stamps a lease",
  darkState.lease_token === dark.token && darkState.lease_until !== null,
);

// (b) armed key: exactly one of N concurrent claims gets 'leased', rest 'none'.
await reset("2000-01-01T00:00:00Z");
const fleetSize = 20;
const fleet = await Promise.all(Array.from({ length: fleetSize }, () => client()));
const fleetResults = await Promise.all(
  fleet.map((c) => c.query("select * from cashford.claim_insights_writer(300)")),
);
const outcomes = fleetResults.map((r) => r.rows[0]);
const leasedCount = outcomes.filter((o) => o.writer === "leased").length;
const noneCount = outcomes.filter((o) => o.writer === "none").length;
const legacyCount = outcomes.filter((o) => o.writer === "legacy").length;
check(
  "W-2 armed key: exactly one leased writer, rest none/leased-reason, zero legacy",
  leasedCount === 1 && noneCount === fleetSize - 1 && legacyCount === 0,
  `leased=${leasedCount} none=${noneCount} legacy=${legacyCount}`,
);
const noneReasons = new Set(outcomes.filter((o) => o.writer === "none").map((o) => o.reason));
check(
  "W-2b the losing claims all cite reason=leased",
  noneReasons.size === 1 && noneReasons.has("leased"),
  JSON.stringify([...noneReasons]),
);
await Promise.all(fleet.map((c) => c.end()));

// (c) revert to infinity while the lease is still held: legacy must NOT resume early.
await reset("2000-01-01T00:00:00Z");
const leaseHolder = await row("select * from cashford.claim_insights_writer(2)");
check("W-3 setup: leaseHolder actually got the lease", leaseHolder.writer === "leased");
await main.query(
  "update cashford.sync_state set next_due_at = 'infinity' where key = $1",
  [key],
);
const duringHeldLease = await row("select * from cashford.claim_insights_writer(300)");
check(
  "W-3a legacy does not resume while the leased lease is still live, even after revert to infinity",
  duringHeldLease.writer === "none" && duringHeldLease.reason === "leased",
  JSON.stringify(duringHeldLease),
);

// Wait for the 2-second lease to actually expire, then confirm legacy resumes.
await new Promise((resolve) => setTimeout(resolve, 2_500));
const afterExpiry = await row("select * from cashford.claim_insights_writer(300)");
check(
  "W-3b legacy resumes once the held lease has expired and next_due_at is infinity",
  afterExpiry.writer === "legacy" && afterExpiry.reason === null,
  JSON.stringify(afterExpiry),
);

await reset("infinity");
await main.end();
console.log(
  failures
    ? `${failures} PHASE-4 INSIGHTS-WRITER PROOF FAILURE(S)`
    : "ALL PHASE-4 INSIGHTS-WRITER PROOFS PASSED",
);
process.exit(failures ? 1 : 0);
