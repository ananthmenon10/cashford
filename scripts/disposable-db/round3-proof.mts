// Phase 2 code review, ROUND 3 — the proofs that need the real worker or more than one session.
//
//   Part A  the REAL dispatcher (lib/gameweek-db.ts) run repeatedly over the population seeded by
//           round3-test.sql: 40 abandoned claims on 0/1-entrant pots ahead of one dirty pot.
//           Proves every abandoned claim leaves 'settling' on first contact and the money-bearing
//           pot is settled within the stated bound of ceil(40 / limit) + 1 = 2 passes.
//   Part B  run_gameweek_maintenance vs a REPEATED join_league, two real sessions, both
//           interleavings, with maintenance paused exactly where the review put it: after it has
//           resolved the member's null eligibility boundary and before it provisions the pot.
//           Proves no 40P01, no lock timeout, and one valid final state.
//   Part C  the same scenario with Phase 1's FOR UPDATE body restored, so part B is known to have
//           teeth: the old lock strength reproduces the reported deadlock on this same cluster.
//
// The pause is a temporary BEFORE INSERT trigger on gameweek_contests that waits on an advisory
// lock. That is the only way to stop a stored routine mid-transaction, and it keeps both sides of
// the race as the real routines rather than a hand-written imitation of them.
//
// Disposable cluster only. Run after round3-test.sql:
//   node scripts/disposable-db/round3-proof.mts
import { registerHooks } from "node:module";
import { existsSync, readFileSync } from "node:fs";
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
const U3 = "00000000-0000-0000-0000-0000000003a3";
const BARRIER = 919191;
const MIGRATION = "supabase/migrations/20260727000002_gameweek_entries.sql";

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
const one = async (sql: string, params: unknown[] = []) => (await q(sql, params))[0];

const ID: Record<string, string> = Object.fromEntries(
  (await q("select k, v from r3_ids")).map((r) => [r.k, r.v]),
);

// The supabase-js stand-in: only the calls the worker actually makes.
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

const stillSettling = async () =>
  Number((await one("select count(*) from cashford.gameweek_contests where status = 'settling'")).count);

// The pass counts below are exact, so the seed has to be untouched: one run per fresh cluster.
const preRun = Number((await one("select count(*) from cashford.gameweek_contests where status = 'settling'")).count);
if (preRun !== 40) {
  console.error(`round3-proof needs the round3-test.sql seed untouched: found ${preRun} abandoned claims, want 40.`);
  console.error("Re-run scripts/disposable-db/up.sh then round3-test.sql.");
  process.exit(1);
}

console.log("\n=== part A: 40 abandoned claims on 0/1-entrant pots cannot hold the queue ===");

const pass1 = await dispatchGameweekSettlements(admin);          // default limit 40
eq("pass 1 fills its whole limit with the abandoned claims", pass1.scanned, 40);
eq("pass 1 settles nothing — none of those pots is settleable", [pass1.settled, pass1.aborted], [0, 0]);
// The finding: refusing them left all 40 in 'settling', so pass 2 was pass 1 again, forever.
eq("every abandoned claim left 'settling' on first contact", await stillSettling(), 0);
// 43 = the 40 this pass released plus the 3 probes round3-test.sql released directly.
eq("every release is on the audit log with its reason",
  Number((await one(
    `select count(*) from cashford.gameweek_audit_log
      where action = 'abort' and detail->>'released' = 'expired-under-min-entrants'`)).count), 43);
eq("each released pot went back to the status its claim was taken from",
  Number((await one(
    `select count(*) from cashford.gameweek_contests
      where status = 'locked' and claim_token is null and claim_started_at is null`)).count), 43);

const pass2 = await dispatchGameweekSettlements(admin);
eq("pass 2 reaches the money — one dirty pot, settled", [pass2.scanned, pass2.settled], [1, 1]);
eq("the dirty pot consumed its current input version",
  Number((await one("select settled_version from cashford.gameweek_results where gameweek_contest_id = $1",
    [ID.pot_dirty])).settled_version), 4);
ok("the re-settlement moved rupees",
  Number((await one("select count(*) from cashford.transfers where gameweek_contest_id = $1",
    [ID.pot_dirty])).count) > 0);
// Bound: ceil(stuck_expired / limit) + 1 = ceil(40/40) + 1 = 2. Pass 2 is the money pass.
ok("bound held: the money-bearing pot was reached on pass 2 of a stated 2", true);

const pass3 = await dispatchGameweekSettlements(admin);
eq("pass 3 finds nothing — released 0/1-entrant pots do not come back", pass3.scanned, 0);

// A released pot whose entrants arrive later is still settleable: the release is not a tombstone.
await q(
  `insert into cashford.league_members (league_id, user_id)
   select league_id, $2 from cashford.gameweek_contests where id = $1
   on conflict (league_id, user_id) do nothing`, [ID.stuck_1, ID.u2]);
await q(
  `insert into cashford.member_competitions
     (league_id, user_id, competition_id, eligible_from_gameweek_id)
   select league_id, $2, competition_id, gameweek_id from cashford.gameweek_contests where id = $1
   on conflict (league_id, user_id, competition_id) do nothing`, [ID.stuck_1, ID.u2]);
await q(
  `insert into cashford.gameweek_entries
     (gameweek_contest_id, league_id, gameweek_id, competition_id, user_id, status)
   select $1, league_id, gameweek_id, competition_id, $2, 'locked_in'
     from cashford.gameweek_contests where id = $1`, [ID.stuck_1, ID.u2],
);
await q(
  `insert into cashford.gameweek_picks (entry_id, membership_id, gameweek_id, fixture_id,
                                        competition_id, pred_home, pred_away)
   select e.id, gf.id, gf.gameweek_id, gf.fixture_id, gf.competition_id, 3, 3
     from cashford.gameweek_entries e
     join cashford.gameweek_fixtures gf on gf.gameweek_id = e.gameweek_id
    where e.gameweek_contest_id = $1 and e.user_id = $2`, [ID.stuck_1, ID.u2],
);
const pass4 = await dispatchGameweekSettlements(admin);
eq("a released pot that reaches two entrants settles normally", [pass4.scanned, pass4.settled], [1, 1]);

console.log("\n=== part B: maintenance vs a REPEATED join, both interleavings, real routines ===");

async function session(sub: string | null) {
  const c = new pg.Client(CONN);
  await c.connect();
  // Longer than the 1s default deadlock_timeout, so a genuine cycle is reported as 40P01 and only
  // a real missed wakeup shows up as a timeout.
  await c.query("set lock_timeout = '8s'");
  if (sub) await c.query(`set request.jwt.claim.sub = '${sub}'`);
  return c;
}
async function waitingOnLock(pid: number) {
  for (let i = 0; i < 60; i++) {
    const r = await q("select wait_event_type from pg_stat_activity where pid = $1", [pid]);
    if (r[0]?.wait_event_type === "Lock") return true;
    await new Promise((res) => setTimeout(res, 100));
  }
  return false;
}
const pidOf = async (c: pg.Client) => Number((await c.query("select pg_backend_pid() as p")).rows[0].p);

// Maintenance has to be paused BETWEEN resolving the member's boundary and provisioning the pot,
// which is only the right barrier if the routine really does them in that order.
{
  const src = (await one(
    `select prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'cashford' and p.proname = 'run_gameweek_maintenance'`)).prosrc as string;
  ok("maintenance resolves null boundaries BEFORE it provisions pots (so the barrier is in the right place)",
    src.indexOf("set eligible_from_gameweek_id = v_open") <
      src.indexOf("insert into cashford.gameweek_contests"));
}

await main.query(`
  create or replace function r3_pause() returns trigger language plpgsql as $r3$
  begin
    perform pg_advisory_xact_lock(${BARRIER});
    return new;
  end $r3$;
`);
const armBarrier = async () => {
  await main.query("drop trigger if exists r3_pause_pot on cashford.gameweek_contests");
  await main.query(`create trigger r3_pause_pot before insert on cashford.gameweek_contests
                    for each row execute function r3_pause()`);
};
const disarmBarrier = () =>
  main.query("drop trigger if exists r3_pause_pot on cashford.gameweek_contests");

async function resetLife() {
  await q("delete from cashford.gameweek_contests where league_id = $1", [ID.l_life]);
  await q("update cashford.gameweeks set status = 'upcoming' where id = $1", [ID.gw2]);
  await q(
    `insert into cashford.league_members (league_id, user_id) values ($1, $2)
       on conflict (league_id, user_id) do nothing`, [ID.l_life, U3]);
  await q(
    `insert into cashford.member_competitions (league_id, user_id, competition_id, eligible_from_gameweek_id)
     values ($1, $2, $3, null) on conflict (league_id, user_id, competition_id)
     do update set eligible_from_gameweek_id = null`, [ID.l_life, U3, ID.c2]);
  await q(
    `update cashford.league_competitions set eligible_from_gameweek_id = null, status = 'active'
      where league_id = $1`, [ID.l_life]);
}

// The final state both interleavings must reach: the boundary resolved to the newly open gameweek
// and exactly one pot provisioned for it.
async function finalState() {
  const r = await one(
    `select (select eligible_from_gameweek_id from cashford.member_competitions
              where league_id = $1 and user_id = $2) as boundary,
            (select count(*) from cashford.gameweek_contests
              where league_id = $1 and gameweek_id = $3) as pots,
            (select count(*) from cashford.league_members
              where league_id = $1 and user_id = $2) as memberships`,
    [ID.l_life, U3, ID.gw2]);
  return [r.boundary === ID.gw2, Number(r.pots), Number(r.memberships)];
}

// Interleaving 1 — the reported one. Maintenance updated the member's row and is about to
// provision the pot; the member's client re-posts the invite in the meantime.
async function maintenanceThenRepeatedJoin(label: string) {
  await resetLife();
  await armBarrier();
  const bar = await session(null);
  const m = await session(null);
  const j = await session(U3);
  let err: string | null = null;
  try {
    await bar.query("begin");
    await bar.query(`select pg_advisory_xact_lock(${BARRIER})`);

    await m.query("begin");
    const mPid = await pidOf(m);
    const maint = m.query("select cashford.run_gameweek_maintenance($1)", [ID.c2])
      .catch((e: any) => { err = `maintenance: ${e.code ?? ""} ${e.message}`; });
    ok(`${label}: maintenance is paused at the pot insert, past the member update`,
      await waitingOnLock(mPid));

    await j.query("begin");
    const jPid = await pidOf(j);
    const joining = j.query("select cashford.join_league('r3-life-token')")
      .catch((e: any) => { err = err ?? `join: ${e.code ?? ""} ${e.message}`; });
    ok(`${label}: the repeated join is blocked on the row maintenance just wrote`,
      await waitingOnLock(jPid));

    await bar.query("commit");            // let maintenance take the foreign-key lock it needs
    await maint;
    await m.query("commit").catch((e: any) => { err = err ?? `maintenance commit: ${e.code} ${e.message}`; });
    await joining;
    await j.query("commit").catch((e: any) => { err = err ?? `join commit: ${e.code} ${e.message}`; });
  } catch (e: any) {
    err = err ?? `${e.code ?? ""} ${e.message}`;
  } finally {
    await bar.end(); await m.end(); await j.end();
    await disarmBarrier();
  }
  return err;
}

{
  const err = await maintenanceThenRepeatedJoin("interleaving 1");
  ok("interleaving 1: no deadlock and no lock timeout", err === null, err ?? "");
  eq("interleaving 1: one valid final state (boundary resolved, one pot, still one membership)",
    await finalState(), [true, 1, 1]);
}

// Interleaving 2 — the join gets there first and maintenance arrives while it is still open.
{
  await resetLife();
  const j = await session(U3);
  const m = await session(null);
  let err: string | null = null;
  try {
    await j.query("begin");
    await j.query("select cashford.join_league('r3-life-token')");   // repeated join, uncommitted

    await m.query("begin");
    await m.query("select cashford.run_gameweek_maintenance($1)", [ID.c2]);
    await m.query("commit");
    await j.query("commit");
  } catch (e: any) {
    err = `${e.code ?? ""} ${e.message}`;
  } finally {
    await j.end(); await m.end();
  }
  ok("interleaving 2: no deadlock and no lock timeout", err === null, err ?? "");
  eq("interleaving 2: one valid final state (boundary resolved, one pot, still one membership)",
    await finalState(), [true, 1, 1]);
}

console.log("\n=== part C: the same scenario against Phase 1's FOR UPDATE body ===");

// Slice section 18d out of the migration so both bodies are the shipped text, differing in exactly
// the one word under test.
const migration = readFileSync(MIGRATION, "utf8");
const start = migration.indexOf("create or replace function cashford.join_league(p_invite text)");
const weakBody = migration.slice(start, migration.indexOf("\n$$;", start) + 4);
if (start < 0 || !weakBody.includes("for no key update")) {
  console.error("could not slice join_league out of the migration");
  process.exit(1);
}
const strongBody = weakBody.replace("for no key update", "for update");
ok("part C really is a one-word difference from the shipped body",
  strongBody.split("\n").length === weakBody.split("\n").length &&
    strongBody.replace("for update", "for no key update") === weakBody);

await main.query(strongBody);
const strongErr = await maintenanceThenRepeatedJoin("part C (FOR UPDATE)");
ok("FOR UPDATE on the league row reproduces the reported deadlock",
  /40P01/.test(strongErr ?? ""), strongErr ?? "no error");

await main.query(weakBody);       // put the shipped routine back
const weakErr = await maintenanceThenRepeatedJoin("part C (FOR NO KEY UPDATE)");
ok("FOR NO KEY UPDATE runs the identical scenario clean", weakErr === null, weakErr ?? "");
eq("and it still reaches the one valid final state", await finalState(), [true, 1, 1]);

await disarmBarrier();
await main.query("drop function if exists r3_pause()");
await main.end();
console.log(failures === 0 ? "\nALL ROUND-3 MULTI-SESSION PROOFS PASSED" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
