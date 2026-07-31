// Phase 2 code review, ROUND 2 — the proofs that need more than one session.
//
//   Part A  the REAL dispatcher (lib/gameweek-db.ts) run repeatedly over the population seeded
//           by round2-test.sql: 40 unrepairable corrupt pots, one abandoned claim, one dirty
//           pot. Proves both money-bearing pots are settled within a bounded number of passes,
//           that the corrupt backlog drains instead of recurring, and that the same unresolved
//           finding is filed once and not once per tick.
//   Part B  join_league vs archive_league in BOTH interleavings, two real sessions with a
//           barrier. Proves no 40P01 and no lock timeout, and that the result is one of the two
//           valid serial outcomes.
//   Part C  the same lock graph at the row level, old strength vs new, so part B is known to
//           have teeth: FOR UPDATE on league_competitions deadlocks against join's foreign-key
//           insert; FOR NO KEY UPDATE does not.
//
// Disposable cluster only. Run after round2-test.sql:
//   node scripts/disposable-db/round2-proof.mts
import { registerHooks } from "node:module";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import pg from "pg";

// lib/*.ts imports its siblings without an extension; Node needs to be told.
registerHooks({
  resolve(spec, ctx, next) {
    if (spec.startsWith(".") && !/\.[cm]?[jt]s$/.test(spec)) {
      const url = new URL(spec + ".ts", ctx.parentURL);
      if (existsSync(fileURLToPath(url))) return { url: url.href, shortCircuit: true };
    }
    return next(spec, ctx);
  },
});

const { dispatchGameweekSettlements } = await import("../../lib/gameweek-db.ts");

const CONN = { host: "localhost", port: 55432, user: "postgres", password: "postgres", database: "postgres" };
const U1 = "00000000-0000-0000-0000-0000000002a1";
const U3 = "00000000-0000-0000-0000-0000000002a3";

let failures = 0;
const ok = (label: string, cond: boolean, extra = "") => {
  if (!cond) failures++;
  console.log(`${cond ? "PASS " : "FAIL "} ${label}${extra ? "  — " + extra : ""}`);
};
const eq = (label: string, got: unknown, want: unknown) =>
  ok(label, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);

const main = new pg.Client(CONN);
await main.connect();
const q = async (sql: string, params: unknown[] = []) => (await main.query(sql, params)).rows;

const ID: Record<string, string> = Object.fromEntries(
  (await q("select k, v from r2_ids")).map((r) => [r.k, r.v]),
);

// ---------------------------------------------------------------------------------------
// The supabase-js stand-in: only the calls the worker actually makes.
// ---------------------------------------------------------------------------------------
const admin: any = {
  from: (table: string) => ({
    insert: async (row: any) => {
      const keys = Object.keys(row);
      await main.query(
        `insert into cashford.${table} (${keys.join(",")}) values (${keys.map((_, i) => `$${i + 1}`).join(",")})`,
        keys.map((k) => (typeof row[k] === "object" && row[k] !== null ? JSON.stringify(row[k]) : row[k])),
      );
      return { data: null, error: null };
    },
  }),
  async rpc(name: string, args: Record<string, unknown>) {
    const keys = Object.keys(args);
    // PostgREST returns an array of rows for a set-returning function, the bare value otherwise.
    const setReturning = name === "gameweek_settlement_candidates";
    const sql = setReturning
      ? `select * from cashford.${name}(${keys.map((k, i) => `${k} => $${i + 1}`).join(",")})`
      : `select cashford.${name}(${keys.map((k, i) => `${k} => $${i + 1}`).join(",")}) as r`;
    try {
      const rows = await q(sql, keys.map((k) => {
        const v = (args as any)[k];
        return typeof v === "object" && v !== null ? JSON.stringify(v) : v;
      }));
      return { data: setReturning ? rows : rows[0].r, error: null };
    } catch (e: any) {
      return { data: null, error: { message: e.message } };
    }
  },
};

const openIssues = async () =>
  Number((await q(
    `select count(*) from cashford.sync_issues
      where kind = 'missing-result-row' and resolved_at is null`,
  ))[0].count);
const settledOf = async (id: string) =>
  (await q("select status, settled_at from cashford.gameweek_contests where id = $1", [id]))[0];

// The pass counts below are exact, so the seed has to be untouched: one run per fresh cluster.
const alreadyRun = Number((await q(
  "select count(*) from cashford.sync_issues where kind = 'missing-result-row'",
))[0].count);
if (alreadyRun > 0) {
  console.error("round2-proof has already run on this cluster. Re-run up.sh + round2-test.sql first.");
  process.exit(1);
}

console.log("\n=== part A: bounded progress past 40 unrepairable corrupt pots ===");

const pass1 = await dispatchGameweekSettlements(admin);          // default limit 40
eq("pass 1 settles BOTH money-bearing pots", [pass1.settled, pass1.aborted], [2, 0]);
ok("pass 1 also dispatched the corrupt rows that fit", pass1.scanned === 40, `scanned ${pass1.scanned}`);

const exp1 = await settledOf(ID.pot_exp);
const dir1 = await settledOf(ID.pot_dirty);
eq("the abandoned claim is out of 'settling' and settled", exp1.status, "settled");
ok("the abandoned claim now has money on it",
  Number((await q("select count(*) from cashford.transfers where gameweek_contest_id = $1", [ID.pot_exp]))[0].count) > 0);
eq("the dirty pot was re-settled", dir1.status, "settled");
eq("the dirty pot consumed its current input version",
  Number((await q("select settled_version from cashford.gameweek_results where gameweek_contest_id = $1",
    [ID.pot_dirty]))[0].settled_version), 4);

const issuesAfter1 = await openIssues();
eq("pass 1 filed one finding per corrupt row it reached", issuesAfter1, 38);

const pass2 = await dispatchGameweekSettlements(admin);
eq("pass 2 has no money work left", [pass2.settled, pass2.aborted], [0, 0]);
eq("pass 2 reaches only the corrupt rows pass 1 could not fit", pass2.scanned, 2);
eq("every corrupt row is now on file exactly once", await openIssues(), 40);

const pass3 = await dispatchGameweekSettlements(admin);
// This is the finding: under the reviewed code every pass returned the same 40 corrupt rows
// forever and the expired claim was never reached.
eq("pass 3 finds nothing at all — the queue is drained", pass3.scanned, 0);
eq("pass 3 files no duplicate findings", await openIssues(), 40);

const pass4 = await dispatchGameweekSettlements(admin);
eq("pass 4 stays drained", [pass4.scanned, await openIssues()], [0, 40]);
eq("no corrupt row ever collected two open findings",
  Number((await q(
    `select count(*) from (select ref from cashford.sync_issues
       where kind = 'missing-result-row' and resolved_at is null
       group by ref having count(*) > 1) d`,
  ))[0].count), 0);

// A newly corrupted pot must still be picked up: suppression is per-finding, not permanent.
await q(`delete from cashford.gameweek_results where gameweek_contest_id = $1`, [ID.pot_dirty]);
const pass5 = await dispatchGameweekSettlements(admin);
eq("a NEW corrupt row is still reported", [pass5.scanned, await openIssues()], [1, 41]);

console.log("\n=== part B: join_league vs archive_league, both interleavings, real routines ===");

// Every session fails fast rather than hanging, so a lock cycle or a missed wakeup is a visible
// failure and not a stuck test run.
async function session(sub: string | null) {
  const c = new pg.Client(CONN);
  await c.connect();
  // Longer than the 1s default deadlock_timeout, so a genuine cycle is reported as 40P01 and
  // only a real missed wakeup shows up as a timeout.
  await c.query("set lock_timeout = '8s'");
  if (sub) await c.query(`set request.jwt.claim.sub = '${sub}'`);
  return c;
}

// Is the given backend blocked on a lock right now? Proves the two sessions really overlapped
// rather than running one after the other.
async function waitingOnLock(pid: number) {
  for (let i = 0; i < 40; i++) {
    const r = await q(
      `select wait_event_type from pg_stat_activity where pid = $1`, [pid],
    );
    if (r[0]?.wait_event_type === "Lock") return true;
    await new Promise((res) => setTimeout(res, 100));
  }
  return false;
}
const pidOf = async (c: pg.Client) => Number((await c.query("select pg_backend_pid() as p")).rows[0].p);

async function resetLifecycle() {
  await q("update cashford.leagues set status = 'active' where id = $1", [ID.l_life]);
  await q("update cashford.league_competitions set status = 'active' where league_id = $1", [ID.l_life]);
  await q("delete from cashford.member_competitions where league_id = $1 and user_id = $2", [ID.l_life, U3]);
  await q("delete from cashford.league_members where league_id = $1 and user_id = $2", [ID.l_life, U3]);
}

// Interleaving 1: join gets there first, archive arrives while join is still open.
await resetLifecycle();
{
  const j = await session(U3);
  const a = await session(U1);
  let err: string | null = null;
  try {
    await j.query("begin");
    await j.query("select cashford.join_league('r2-lifecycle-token')");

    await a.query("begin");
    const aPid = await pidOf(a);
    const archiving = a.query("select cashford.archive_league($1)", [ID.l_life]);
    ok("interleaving 1: archive really is blocked on join's locks", await waitingOnLock(aPid));

    await j.query("commit");
    await archiving;
    await a.query("commit");
  } catch (e: any) {
    err = `${e.code ?? ""} ${e.message}`;
  }
  ok("interleaving 1: no deadlock and no lock timeout", err === null, err ?? "");

  const st = (await q(
    `select l.status as league, lc.status as comp,
            exists (select 1 from cashford.member_competitions
                     where league_id = l.id and user_id = $2) as joined
       from cashford.leagues l
       join cashford.league_competitions lc on lc.league_id = l.id
      where l.id = $1`, [ID.l_life, U3],
  ))[0];
  // Valid serial outcome: join, then archive. The joiner is in, and both status rows moved.
  eq("interleaving 1: one valid serial outcome (join then archive)",
    [st.league, st.comp, st.joined], ["archived", "archived", true]);
  await j.end(); await a.end();
}

// Interleaving 2: archive gets there first. The joiner must be refused, not deadlocked.
await resetLifecycle();
{
  const j = await session(U3);
  const a = await session(U1);
  let joinErr: string | null = null;
  let lifecycleErr: string | null = null;
  try {
    await a.query("begin");
    await a.query("select cashford.archive_league($1)", [ID.l_life]);

    await j.query("begin");
    const jPid = await pidOf(j);
    const joining = j.query("select cashford.join_league('r2-lifecycle-token')").catch((e: any) => {
      joinErr = `${e.code ?? ""} ${e.message}`;
    });
    ok("interleaving 2: join really is blocked on archive's locks", await waitingOnLock(jPid));

    await a.query("commit");
    await joining;
    await j.query("rollback");
  } catch (e: any) {
    lifecycleErr = `${e.code ?? ""} ${e.message}`;
  }
  ok("interleaving 2: neither session deadlocked or timed out", lifecycleErr === null, lifecycleErr ?? "");
  ok("interleaving 2: the join is refused because the league is archived",
    /league is archived/.test(joinErr ?? ""), joinErr ?? "no error");

  const st = (await q(
    `select l.status as league,
            exists (select 1 from cashford.member_competitions
                     where league_id = l.id and user_id = $2) as joined
       from cashford.leagues l where l.id = $1`, [ID.l_life, U3],
  ))[0];
  eq("interleaving 2: one valid serial outcome (archive then refused join)",
    [st.league, st.joined], ["archived", false]);
  await j.end(); await a.end();
}

console.log("\n=== part C: the lock graph itself — old strength deadlocks, new strength does not ===");

// Both halves replay the exact cycle from the review at the row level: session J takes the
// leagues row (join's first lock) and then needs a foreign-key lock on a league_competitions row
// to insert member_competitions; session A holds that league_competitions row and then needs the
// leagues row. Only the strength of A's row lock differs.
async function lockGraph(strength: "for update" | "for no key update") {
  await resetLifecycle();
  // member_competitions also has a foreign key to league_members, and that one must be satisfied
  // or the insert fails before it ever reaches the lock we are testing.
  await q(
    `insert into cashford.league_members (league_id, user_id) values ($1, $2)
       on conflict (league_id, user_id) do nothing`, [ID.l_life, U3],
  );
  const J = await session(null);
  const A = await session(null);
  let code = "none";
  try {
    await J.query("begin");
    await A.query("begin");
    await J.query("select 1 from cashford.leagues where id = $1 for update", [ID.l_life]);
    await A.query(
      `select 1 from cashford.league_competitions where league_id = $1 ${strength}`, [ID.l_life],
    );

    // J's insert needs FOR KEY SHARE on A's league_competitions row.
    const jIns = J.query(
      `insert into cashford.member_competitions
         (league_id, user_id, competition_id, eligible_from_gameweek_id)
       values ($1, $2, $3, $4) on conflict do nothing`,
      [ID.l_life, U3, ID.c, ID.gw],
    ).catch((e: any) => { code = e.code ?? "err"; });
    // A's update needs FOR NO KEY UPDATE on J's leagues row.
    const aUpd = A.query(
      "update cashford.leagues set status = 'archived' where id = $1", [ID.l_life],
    ).catch((e: any) => { code = e.code ?? "err"; });

    // J first: with the safe strength it never blocks, so A can only finish once J commits.
    await jIns;
    await J.query("commit").catch(() => {});
    await aUpd;
    await A.query("commit").catch(() => {});
  } finally {
    await J.end(); await A.end();
  }
  return code;
}

eq("FOR UPDATE on the eligibility row reproduces the reported 40P01", await lockGraph("for update"), "40P01");
eq("FOR NO KEY UPDATE closes the cycle: no deadlock", await lockGraph("for no key update"), "none");

await resetLifecycle();
await main.end();
console.log(failures === 0 ? "\nALL ROUND-2 MULTI-SESSION PROOFS PASSED" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
