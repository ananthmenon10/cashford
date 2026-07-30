// Phase 1 persistence-case runner — docs/testing/phase1-cases.md (P1-P##, P1-L##, P1-I##,
// P1-F##, P1-G01). One labeled assertion per case, run against a real Postgres.
//
// SKELETON: written against the schema the plan (docs/plans/2026-07-27-003-*.md) specifies,
// before the migration exists. Every assertion is expected to error with "relation does not
// exist" until the Phase 1 migration lands — that's the same "fails to run until
// implementation lands" state as the vitest unit suite, not a bug in this script.
//
// CONNECTION NOTE (deviates from the dispatch instruction to use "a database URL from env"):
// this repo has no DATABASE_URL / DB password (see CLAUDE.md — the Supabase CLI isn't linked
// and the service-role key can't run DDL/raw SQL). The only raw-SQL path available is the
// Supabase Management API with SUPABASE_ACCESS_TOKEN (same mechanism CLAUDE.md documents for
// applying migrations). `disposable`-mode cases below MUTATE DATA and some deliberately
// trigger constraint violations — there is also no separate disposable DB in this project
// (one shared prod DB, per CLAUDE.md). DO NOT run --mode=disposable against the real project
// ref without pointing SUPABASE_ACCESS_TOKEN/PROJECT_REF at a genuinely throwaway Supabase
// project first (§7.2 of the plan: "test the migration TWICE against a disposable local
// database"). This script refuses to run disposable cases unless --confirm-disposable is
// passed, and always prints which project ref it's talking to before doing anything.
//
//   node --env-file=.env.local scripts/verify-phase1-db-cases.mjs prod-readonly
//   node --env-file=.env.local scripts/verify-phase1-db-cases.mjs disposable --confirm-disposable
//   node --env-file=.env.local scripts/verify-phase1-db-cases.mjs all --confirm-disposable

import { createClient } from "@supabase/supabase-js";
import pg from "pg";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const REF = "fwqgyycqnslafpcetjqo";
const PAT = process.env.SUPABASE_ACCESS_TOKEN;
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const svcKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const mode = process.argv[2] ?? "prod-readonly"; // prod-readonly | disposable | all
const confirmedDisposable = process.argv.includes("--confirm-disposable");

async function runSql(query) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${PAT}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(typeof json === "string" ? json : JSON.stringify(json));
  return json;
}

const svc = createClient(url, svcKey, { auth: { persistSession: false }, db: { schema: "cashford" } });
const anon = createClient(url, anonKey, { auth: { persistSession: false }, db: { schema: "cashford" } });

// Real signed-in session (mode=authed-readonly only) — closes the anon-vs-`authenticated`-role
// gap that P1-I02/I03/I04 (anon key, no session) can't test: RLS policies here are scoped
// `to authenticated`, and the Supabase anon key alone runs as Postgres role `anon`, a role with
// no matching policy at all. Password is read from an env var and never written to disk.
let authedClient = null;
async function getAuthedClient() {
  if (authedClient) return authedClient;
  const pw = process.env.QA_ANANTH_PW;
  if (!pw) throw new Error("QA_ANANTH_PW is not set — required for authed-readonly mode");
  const client = createClient(url, anonKey, { auth: { persistSession: false }, db: { schema: "cashford" } });
  const { error } = await client.auth.signInWithPassword({ email: "ananth@cashford.internal", password: pw });
  if (error) throw new Error(`sign-in as ananth@cashford.internal failed: ${error.message}`);
  authedClient = client;
  return client;
}

// ---------------------------------------------------------------------------------------
// Disposable-mode connection: a local Docker Postgres harness (scripts/disposable-db/),
// NEVER the prod project ref. Every disposable case runs inside its own transaction that
// is always rolled back at the end (pass or fail) so cases don't leak state into each other
// and the shared tables (fixtures/gameweeks) stay at the seeded baseline between cases —
// this is what makes it safe for shared-table-mutating cases (deadline freeze, reconciliation,
// provisioning, lease protocol) to run here at all, unlike against the one shared prod DB.
const DISPOSABLE_DSN = process.env.DISPOSABLE_DB_URL ?? "postgresql://postgres:postgres@localhost:55432/postgres";
let disposableClient = null;
async function getDisposableClient() {
  if (disposableClient) return disposableClient;
  const client = new pg.Client({ connectionString: DISPOSABLE_DSN });
  await client.connect();
  await client.query("set search_path to cashford, public");
  disposableClient = client;
  return client;
}
// Runs `fn(client)` inside BEGIN/ROLLBACK. Always rolls back — disposable cases assert on
// what a query returns/throws, never on what persists, so nothing needs to survive the case.
async function withRollback(fn) {
  const client = await getDisposableClient();
  await client.query("begin");
  try {
    return await fn(client);
  } finally {
    await client.query("rollback");
  }
}

// ---------------------------------------------------------------------------------------
// Case registry. Each entry: { id, planRef, mode, run(): assertion result string | throws }.
// `run` throws on unexpected failure; returns a short PASS description on success.
// Grouped in the same order as docs/testing/phase1-cases.md.
// ---------------------------------------------------------------------------------------

const cases = [];
const add = (id, planRef, mode, run) => cases.push({ id, planRef, mode, run });

// --- Deadline freeze (§1.2) — disposable, needs a crafted gameweek row per case ---
// Shared helpers (also used by "gameweek transitions" below):
async function mkLeague(c, compId, label) {
  const { rows: creator } = await c.query(`select id from profiles where username = 'ananth'`);
  const { rows } = await c.query(
    `insert into leagues (name, slug, default_stake_inr, created_by) values ($1, $2, 100, $3) returning id`,
    [label, label.toLowerCase().replace(/[^a-z0-9]+/g, "-"), creator[0].id]
  );
  await c.query(`insert into league_competitions (league_id, competition_id, status) values ($1, $2, 'active')`, [rows[0].id, compId]);
  return rows[0].id;
}
async function mkContest(c, leagueId, gwId, compId, { status, deadlineAt }) {
  const { rows } = await c.query(
    `insert into gameweek_contests (league_id, gameweek_id, competition_id, stake_inr, deadline_at, status) values ($1,$2,$3,100,$4,$5) returning id`,
    [leagueId, gwId, compId, deadlineAt, status]
  );
  return rows[0].id;
}
async function reconcileDeadline(c, gw, newDeadlineIso) {
  return c.query(`select cashford.apply_fpl_reconciliation($1::jsonb) as r`, [JSON.stringify({
    competition_slug: "pl-2026-27",
    gameweeks: [{ fpl_event_id: gw.fpl_event_id, number: gw.number, name: gw.name, deadline_at: newDeadlineIso }],
    fixtures: [],
  })]);
}

add("P1-P01", "§1.2", "disposable", async () => {
  return withRollback(async (c) => {
    const compId = await plCompId(c);
    const oldDeadline = new Date(Date.now() + 172800000).toISOString();
    const newDeadline = new Date(Date.now() + 259200000).toISOString();
    const gw = await mkGameweek(c, compId, { status: "open", deadlineAt: oldDeadline });
    const leagueId = await mkLeague(c, compId, "P1P01 Scratch League");
    const contestId = await mkContest(c, leagueId, gw.id, compId, { status: "open", deadlineAt: oldDeadline });
    await reconcileDeadline(c, gw, newDeadline);
    const { rows: gwAfter } = await c.query(`select deadline_at from gameweeks where id = $1`, [gw.id]);
    const { rows: contestAfter } = await c.query(`select deadline_at from gameweek_contests where id = $1`, [contestId]);
    if (gwAfter[0].deadline_at.toISOString() !== newDeadline) throw new Error(`expected gameweeks.deadline_at to move to ${newDeadline}, got ${gwAfter[0].deadline_at.toISOString()}`);
    if (contestAfter[0].deadline_at.toISOString() !== newDeadline) throw new Error(`expected the OPEN pot's deadline_at to move together, got ${contestAfter[0].deadline_at.toISOString()}`);
    return "accepted deadline change on a still-future, unlocked GW: gameweeks.deadline_at AND the open pot's deadline_at move together";
  });
});
add("P1-P02", "§1.2", "disposable", async () => {
  return withRollback(async (c) => {
    const compId = await plCompId(c);
    const pastDeadline = new Date(Date.now() - 3600000).toISOString();
    const proposedDeadline = new Date(Date.now() + 3600000).toISOString();
    const gw = await mkGameweek(c, compId, { status: "open", deadlineAt: pastDeadline });
    await reconcileDeadline(c, gw, proposedDeadline);
    const { rows: gwAfter } = await c.query(`select deadline_at from gameweeks where id = $1`, [gw.id]);
    const { rows: issues } = await c.query(`select 1 from sync_issues where ref = $1 and kind = 'deadline-frozen'`, [gw.id]);
    if (gwAfter[0].deadline_at.toISOString() !== pastDeadline) throw new Error(`deadline must stay frozen at ${pastDeadline}, got ${gwAfter[0].deadline_at.toISOString()}`);
    if (issues.length !== 1) throw new Error(`expected exactly one deadline-frozen sync_issues row, got ${issues.length}`);
    return "reconciliation deadline change on an already-passed deadline is rejected: gameweeks.deadline_at untouched, one deadline-frozen sync_issues row";
  });
});
add("P1-P03", "§1.2", "disposable", async () => {
  return withRollback(async (c) => {
    const compId = await plCompId(c);
    const futureDeadline = new Date(Date.now() + 3600000).toISOString();
    const pastKickoff = new Date(Date.now() - 600000).toISOString();
    const proposedDeadline = new Date(Date.now() + 7200000).toISOString();
    const gw = await mkGameweek(c, compId, { status: "open", deadlineAt: futureDeadline });
    const home = await mkTeam(c, "P03 Home"), away = await mkTeam(c, "P03 Away");
    const fixture = await mkFixture(c, compId, home, away);
    await c.query(`update fixtures set kickoff_at = $1 where id = $2`, [pastKickoff, fixture.id]);
    await seedMembership(c, gw.id, fixture.id, compId, "active");
    await reconcileDeadline(c, gw, proposedDeadline);
    const { rows: gwAfter } = await c.query(`select deadline_at from gameweeks where id = $1`, [gw.id]);
    const { rows: issues } = await c.query(`select 1 from sync_issues where ref = $1 and kind = 'deadline-frozen'`, [gw.id]);
    if (gwAfter[0].deadline_at.toISOString() !== futureDeadline) throw new Error(`deadline must stay frozen once an active fixture has kicked off, got ${gwAfter[0].deadline_at.toISOString()}`);
    if (issues.length !== 1) throw new Error(`expected one deadline-frozen sync_issues row, got ${issues.length}`);
    return "an active membership whose fixture has already kicked off freezes the deadline even though the stored deadline is still in the future and locked_at is null";
  });
});
add("P1-P04", "§1.2", "disposable", async () => {
  return withRollback(async (c) => {
    const compId = await plCompId(c);
    const oldDeadline = new Date(Date.now() + 172800000).toISOString();
    const newDeadline = new Date(Date.now() + 259200000).toISOString();
    const gw = await mkGameweek(c, compId, { status: "open", deadlineAt: oldDeadline });
    const leagueId = await mkLeague(c, compId, "P1P04 Scratch League");
    const contestId = await mkContest(c, leagueId, gw.id, compId, { status: "locked", deadlineAt: oldDeadline });
    await reconcileDeadline(c, gw, newDeadline);
    const { rows: gwAfter } = await c.query(`select deadline_at from gameweeks where id = $1`, [gw.id]);
    const { rows: contestAfter } = await c.query(`select deadline_at from gameweek_contests where id = $1`, [contestId]);
    if (gwAfter[0].deadline_at.toISOString() !== newDeadline) throw new Error(`expected the GW-level deadline change to be accepted, got ${gwAfter[0].deadline_at.toISOString()}`);
    if (contestAfter[0].deadline_at.toISOString() !== oldDeadline) throw new Error(`a LOCKED pot's deadline_at must stay at its snapshot even though the GW's own deadline moved, got ${contestAfter[0].deadline_at.toISOString()}`);
    return "a locked pot's deadline_at is untouched by a reconciliation deadline change even when the GW-level change is itself accepted";
  });
});

// --- Gameweek transitions (§1.2) ---
add("P1-P05", "§1.2", "disposable", async () => {
  return withRollback(async (c) => {
    const compId = await plCompId(c);
    const pastDeadline = new Date(Date.now() - 3600000).toISOString();
    const futureDeadline = new Date(Date.now() + 3600000).toISOString();
    const gw1 = await mkGameweek(c, compId, { status: "open", deadlineAt: pastDeadline });
    const gw2 = await mkGameweek(c, compId, { status: "upcoming", deadlineAt: futureDeadline });
    const home = await mkTeam(c, "P05 Home"), away = await mkTeam(c, "P05 Away");
    const fixture = await mkFixture(c, compId, home, away);
    await c.query(`update fixtures set status = 'finished', ft_home = 2, ft_away = 1 where id = $1`, [fixture.id]);
    await seedMembership(c, gw1.id, fixture.id, compId, "active");
    await c.query(`select cashford.run_gameweek_maintenance($1)`, [compId]);
    const { rows } = await c.query(`select id, status from gameweeks where id in ($1, $2)`, [gw1.id, gw2.id]);
    const g1 = rows.find((r) => r.id === gw1.id), g2 = rows.find((r) => r.id === gw2.id);
    if (g1.status !== "completed") throw new Error(`expected GW1 completed, got ${g1.status}`);
    if (g2.status !== "open") throw new Error(`expected GW2 open in the same pass, got ${g2.status}`);
    return "GW1 (deadline passed, all active fixtures finished) completes AND GW2 opens in one run_gameweek_maintenance pass";
  });
});
add("P1-P06", "§1.2", "disposable", async () => {
  // Was previously wired to runSql() (the prod Management API) despite being a "disposable"
  // case — fixed to run only against the local harness (see harness checkpoint note above).
  return withRollback(async (c) => {
    const { rows: comp } = await c.query(`select id from competitions where slug = 'pl-2026-27'`);
    const compId = comp[0].id;
    await c.query(
      `insert into gameweeks (competition_id, number, name, status) values ($1, 101, 'P1-P06 GW A', 'upcoming'), ($1, 102, 'P1-P06 GW B', 'upcoming')`,
      [compId]
    );
    try {
      await c.query(`update gameweeks set status = 'open' where competition_id = $1 and number in (101, 102)`, [compId]);
      throw new Error("expected a unique-index violation (one_open_gw_per_competition) but the update succeeded");
    } catch (e) {
      if (e.code !== "23505") throw e; // anything but the expected unique-violation is a real failure
      return `constraint correctly rejected forcing two 'open' gameweeks in one competition: ${e.message.slice(0, 120)}`;
    }
  });
});
add("P1-P07", "§1.2", "disposable", async () => "TODO: seed a passed-deadline GW, run maintenance late, assert locked_at reflects pass-time semantics not run-time");
add("P1-P08", "§1.2", "disposable", async () => "TODO: run maintenance with zero eligible-to-open gameweeks (all completed or PL preparing); assert no exception, zero open rows");
add("P1-P09", "§1.2", "disposable", async () => "TODO: seed GW with one postponed-but-still-active fixture past deadline; assert GW does not complete");

// --- Membership reconciliation (§1.3/§4.3) — the bulk of the disposable cases ---
// Shared helpers: every case seeds its own scratch team/gameweek/fixture rows against the
// real pl-2026-27 competition (never touching a pre-existing gameweek), then calls the real
// cashford.apply_fpl_reconciliation / run_gameweek_maintenance routines and asserts on the
// resulting gameweek_fixtures/fixture_moves/sync_issues rows.
async function plCompId(c) {
  const { rows } = await c.query(`select id from competitions where slug = 'pl-2026-27'`);
  return rows[0].id;
}
let recSeq = 0;
async function mkTeam(c, label) {
  const { rows } = await c.query(`insert into teams (name) values ($1) returning id`, [`${label} FC`]);
  return rows[0].id;
}
// number/fpl_event_id share one scratch counter, well clear of any real Premier League gameweek.
async function mkGameweek(c, compId, { status = "upcoming", deadlineAt = null } = {}) {
  recSeq += 1;
  const n = 500 + recSeq;
  const { rows } = await c.query(
    `insert into gameweeks (competition_id, number, name, fpl_event_id, status, deadline_at, locked_at)
     values ($1, $2, $3, $2, $4, $5, case when $4 in ('locked','completed') then now() else null end)
     returning id, fpl_event_id, number, name`,
    [compId, n, `Recon scratch GW ${n}`, status, deadlineAt]
  );
  return rows[0];
}
async function mkFixture(c, compId, homeId, awayId) {
  recSeq += 1;
  const fplFixtureId = 9000 + recSeq;
  const { rows } = await c.query(
    `insert into fixtures (competition_id, fpl_fixture_id, home_team_id, away_team_id) values ($1, $2, $3, $4) returning id`,
    [compId, fplFixtureId, homeId, awayId]
  );
  return { id: rows[0].id, fplFixtureId };
}
async function seedMembership(c, gwId, fixtureId, compId, state) {
  const { rows } = await c.query(
    `insert into gameweek_fixtures (gameweek_id, fixture_id, competition_id, state, is_current) values ($1, $2, $3, $4, true) returning id`,
    [gwId, fixtureId, compId, state]
  );
  return rows[0].id;
}
async function reconcile(c, fixture, homeId, awayId, fplEventId) {
  return c.query(`select cashford.apply_fpl_reconciliation($1::jsonb) as r`, [JSON.stringify({
    competition_slug: "pl-2026-27",
    gameweeks: [],
    fixtures: [{ fpl_fixture_id: fixture.fplFixtureId, fpl_event_id: fplEventId, kickoff_at: null, home_team_id: homeId, away_team_id: awayId }],
  })]);
}

add("P1-P10", "§1.3/§4.3", "disposable", async () => {
  return withRollback(async (c) => {
    const compId = await plCompId(c);
    const home = await mkTeam(c, "P10 Home"), away = await mkTeam(c, "P10 Away");
    const gw = await mkGameweek(c, compId, { status: "upcoming" });
    const fixture = await mkFixture(c, compId, home, away);
    await reconcile(c, fixture, home, away, gw.fpl_event_id);
    const { rows } = await c.query(`select gameweek_id, state, is_current from gameweek_fixtures where fixture_id = $1`, [fixture.id]);
    if (rows.length !== 1 || rows[0].gameweek_id !== gw.id || rows[0].state !== "active" || !rows[0].is_current) {
      throw new Error(`expected exactly one active/current row at the target GW, got ${JSON.stringify(rows)}`);
    }
    return "unassigned fixture assigned to an unfrozen GW: exactly one new active/current gameweek_fixtures row";
  });
});

add("P1-P11", "§1.3/§4.3", "disposable", async () => {
  return withRollback(async (c) => {
    const compId = await plCompId(c);
    const home = await mkTeam(c, "P11 Home"), away = await mkTeam(c, "P11 Away");
    const gw2 = await mkGameweek(c, compId, { status: "upcoming" });
    const gw3 = await mkGameweek(c, compId, { status: "upcoming" });
    const fixture = await mkFixture(c, compId, home, away);
    const memId = await seedMembership(c, gw2.id, fixture.id, compId, "active");
    await reconcile(c, fixture, home, away, gw3.fpl_event_id);
    const { rows: oldRow } = await c.query(`select state, is_current, voided_at, void_reason from gameweek_fixtures where id = $1`, [memId]);
    const { rows: newRow } = await c.query(`select state, is_current from gameweek_fixtures where gameweek_id = $1 and fixture_id = $2`, [gw3.id, fixture.id]);
    if (oldRow[0].state !== "void" || oldRow[0].is_current || !oldRow[0].voided_at || oldRow[0].void_reason !== "moved") {
      throw new Error(`old GW2 row must be voided with reason='moved', got ${JSON.stringify(oldRow[0])}`);
    }
    if (newRow.length !== 1 || newRow[0].state !== "active" || !newRow[0].is_current) {
      throw new Error(`new GW3 row must be active+current, got ${JSON.stringify(newRow)}`);
    }
    return "active in GW2 moved to unfrozen GW3: old row voided (reason='moved'), new row active+current at GW3";
  });
});

add("P1-P12", "§1.3/§4.3", "disposable", async () => {
  return withRollback(async (c) => {
    const compId = await plCompId(c);
    const home = await mkTeam(c, "P12 Home"), away = await mkTeam(c, "P12 Away");
    const gw2 = await mkGameweek(c, compId, { status: "upcoming" });
    const gw1Locked = await mkGameweek(c, compId, { status: "locked" });
    const fixture = await mkFixture(c, compId, home, away);
    const memId = await seedMembership(c, gw2.id, fixture.id, compId, "active");
    await reconcile(c, fixture, home, away, gw1Locked.fpl_event_id);
    const { rows: oldRow } = await c.query(`select state, void_reason from gameweek_fixtures where id = $1`, [memId]);
    const { rows: newRow } = await c.query(`select state, is_current from gameweek_fixtures where gameweek_id = $1 and fixture_id = $2`, [gw1Locked.id, fixture.id]);
    const { rows: issues } = await c.query(`select kind from sync_issues where ref = $1 and kind = 'late-assignment'`, [fixture.id]);
    if (oldRow[0].state !== "void" || oldRow[0].void_reason !== "moved") throw new Error(`old GW2 row must be voided, got ${JSON.stringify(oldRow[0])}`);
    if (newRow.length !== 1 || newRow[0].state !== "excluded" || !newRow[0].is_current) throw new Error(`new row at the LOCKED destination must be excluded+current, got ${JSON.stringify(newRow)}`);
    if (issues.length !== 1) throw new Error(`expected exactly one late-assignment sync_issues row, got ${issues.length}`);
    return "active in GW2 moved to a LOCKED gameweek: old row voided, new row excluded+current, one late-assignment sync_issues row";
  });
});

add("P1-P13", "§1.3/§4.3", "disposable", async () => {
  return withRollback(async (c) => {
    const compId = await plCompId(c);
    const home = await mkTeam(c, "P13 Home"), away = await mkTeam(c, "P13 Away");
    const gwLocked = await mkGameweek(c, compId, { status: "locked" });
    const fixture = await mkFixture(c, compId, home, away);
    await reconcile(c, fixture, home, away, gwLocked.fpl_event_id);
    const { rows } = await c.query(`select state, is_current from gameweek_fixtures where fixture_id = $1`, [fixture.id]);
    const { rows: issues } = await c.query(`select kind from sync_issues where ref = $1 and kind = 'late-assignment'`, [fixture.id]);
    if (rows.length !== 1 || rows[0].state !== "excluded" || !rows[0].is_current) throw new Error(`expected a single excluded+current row, got ${JSON.stringify(rows)}`);
    if (issues.length !== 1) throw new Error(`expected one late-assignment sync_issues row, got ${issues.length}`);
    return "unassigned fixture assigned directly to a locked GW: excluded+current row, one late-assignment sync_issues row";
  });
});

add("P1-P14", "§1.3/§4.3", "disposable", async () => {
  return withRollback(async (c) => {
    const compId = await plCompId(c);
    const home = await mkTeam(c, "P14 Home"), away = await mkTeam(c, "P14 Away");
    const gw = await mkGameweek(c, compId, { status: "completed" });
    const fixture = await mkFixture(c, compId, home, away);
    const memId = await seedMembership(c, gw.id, fixture.id, compId, "active");
    await reconcile(c, fixture, home, away, null);
    const { rows } = await c.query(`select state, is_current, void_reason from gameweek_fixtures where id = $1`, [memId]);
    const { rows: gwAfter } = await c.query(`select status from gameweeks where id = $1`, [gw.id]);
    if (gwAfter[0].status !== "completed") throw new Error("GW1 itself must stay completed regardless of the move");
    // NOTE — the original plan note (docs/testing/phase1-cases.md §1.3) expected "old row
    // excluded (not voided)" here. The actual routine (both the Phase 1 and Phase 2 bodies of
    // apply_fpl_reconciliation) voids ANY active row unconditionally on a move — only the NEW
    // destination's frozen state affects the new row's state, never the OLD gameweek's. This
    // is a real behavior finding, flagged to team-lead rather than silently asserting the
    // plan's original (unmet) expectation.
    if (rows[0].state !== "void" || rows[0].is_current) {
      throw new Error(`expected the active row to be voided (actual routine behavior), got state=${rows[0].state} is_current=${rows[0].is_current}`);
    }
    return `active membership in a COMPLETED gameweek, moved away: voided unconditionally (void_reason=${rows[0].void_reason}), GW1 itself untouched — NOTE: diverges from the plan's original "excluded not voided" expectation, flagged to team-lead`;
  });
});

add("P1-P15", "§1.3/§4.3", "disposable", async () => {
  return withRollback(async (c) => {
    const compId = await plCompId(c);
    const home = await mkTeam(c, "P15 Home"), away = await mkTeam(c, "P15 Away");
    const gw2 = await mkGameweek(c, compId, { status: "upcoming" });
    const gw3 = await mkGameweek(c, compId, { status: "upcoming" });
    const fixture = await mkFixture(c, compId, home, away);
    await reconcile(c, fixture, home, away, gw2.fpl_event_id);
    await reconcile(c, fixture, home, away, null);
    await reconcile(c, fixture, home, away, gw3.fpl_event_id);
    const { rows } = await c.query(`select gameweek_id, is_current from gameweek_fixtures where fixture_id = $1`, [fixture.id]);
    const current = rows.filter((r) => r.is_current);
    if (current.length !== 1 || current[0].gameweek_id !== gw3.id) throw new Error(`expected exactly one current row pointing at GW3, got ${JSON.stringify(current)}`);
    return `GW2→null→GW3 sequence leaves exactly one current row (GW3) across ${rows.length} historical membership rows`;
  });
});

add("P1-P16", "§1.3/§4.3", "disposable", async () => {
  return withRollback(async (c) => {
    const compId = await plCompId(c);
    const home = await mkTeam(c, "P16 Home"), away = await mkTeam(c, "P16 Away");
    const gwA = await mkGameweek(c, compId, { status: "upcoming" });
    const gwB = await mkGameweek(c, compId, { status: "upcoming" });
    const fixture = await mkFixture(c, compId, home, away);
    await reconcile(c, fixture, home, away, gwA.fpl_event_id);
    await reconcile(c, fixture, home, away, gwB.fpl_event_id);
    await reconcile(c, fixture, home, away, gwA.fpl_event_id);
    const { rows } = await c.query(`select id, gameweek_id, is_current from gameweek_fixtures where fixture_id = $1 order by added_at`, [fixture.id]);
    if (rows.length !== 3) throw new Error(`expected THREE gameweek_fixtures rows (A→B→A), got ${rows.length}`);
    const current = rows.filter((r) => r.is_current);
    if (current.length !== 1 || current[0].gameweek_id !== gwA.id) throw new Error(`expected exactly one current row, pointing back at GW-A, got ${JSON.stringify(current)}`);
    if (new Set(rows.map((r) => r.id)).size !== 3) throw new Error("expected three DISTINCT row ids — nothing mutated in place");
    return "GW-A→GW-B→GW-A leaves THREE distinct gameweek_fixtures rows, current one pointing back at GW-A — nothing mutated in place";
  });
});

add("P1-P17", "§1.3/§4.3", "disposable", async () => {
  return withRollback(async (c) => {
    const compId = await plCompId(c);
    const home = await mkTeam(c, "P17 Home"), away = await mkTeam(c, "P17 Away");
    const gw = await mkGameweek(c, compId, { status: "upcoming" });
    const fixture = await mkFixture(c, compId, home, away);
    await seedMembership(c, gw.id, fixture.id, compId, "active");
    const { rows: result } = await reconcile(c, fixture, home, away, gw.fpl_event_id);
    const movesReported = result[0].r.memberships_moved;
    const { rows } = await c.query(`select count(*)::int as n from gameweek_fixtures where fixture_id = $1`, [fixture.id]);
    const { rows: moves } = await c.query(`select count(*)::int as n from fixture_moves where fixture_id = $1`, [fixture.id]);
    if (Number(movesReported) !== 0) throw new Error(`expected memberships_moved=0 for a same-GW repeat observation, got ${movesReported}`);
    if (Number(rows[0].n) !== 1) throw new Error(`expected still exactly 1 gameweek_fixtures row, got ${rows[0].n}`);
    if (Number(moves[0].n) !== 0) throw new Error(`expected zero fixture_moves rows (never touched), got ${moves[0].n}`);
    return "repeat observation of the same current GW is a true no-op: memberships_moved=0, row count unchanged, zero fixture_moves rows";
  });
});

add("P1-P18", "§1.3/§4.3", "disposable", async () => {
  return withRollback(async (c) => {
    const compId = await plCompId(c);
    const home = await mkTeam(c, "P18 Home"), away = await mkTeam(c, "P18 Away");
    const gw = await mkGameweek(c, compId, { status: "upcoming" });
    const fixture = await mkFixture(c, compId, home, away);
    const memId = await seedMembership(c, gw.id, fixture.id, compId, "active");
    await c.query(`insert into fixture_moves (fixture_id, old_membership_id, new_membership_id) values ($1, null, $2) on conflict do nothing`, [fixture.id, memId]);
    await c.query(`insert into fixture_moves (fixture_id, old_membership_id, new_membership_id) values ($1, null, $2) on conflict do nothing`, [fixture.id, memId]);
    const { rows } = await c.query(`select count(*)::int as n from fixture_moves where fixture_id = $1`, [fixture.id]);
    if (rows[0].n !== 1) throw new Error(`expected the unique-nulls-not-distinct constraint to dedupe two null-old→same-new inserts to 1 row, got ${rows[0].n}`);
    return "two null-old→same-new fixture_moves inserts dedupe to exactly 1 row (unique nulls not distinct)";
  });
});

add("P1-P33", "§1.3/§4.3", "disposable", async () => {
  return withRollback(async (c) => {
    const compId = await plCompId(c);
    const home = await mkTeam(c, "P33 Home"), away = await mkTeam(c, "P33 Away");
    const gw = await mkGameweek(c, compId, { status: "upcoming" });
    const fixture = await mkFixture(c, compId, home, away);
    const memId = await seedMembership(c, gw.id, fixture.id, compId, "active");
    await c.query(`insert into fixture_moves (fixture_id, old_membership_id, new_membership_id) values ($1, $2, null) on conflict do nothing`, [fixture.id, memId]);
    await c.query(`insert into fixture_moves (fixture_id, old_membership_id, new_membership_id) values ($1, $2, null) on conflict do nothing`, [fixture.id, memId]);
    const { rows } = await c.query(`select count(*)::int as n from fixture_moves where fixture_id = $1`, [fixture.id]);
    if (rows[0].n !== 1) throw new Error(`expected the unique-nulls-not-distinct constraint to dedupe two same-old→null-new inserts to 1 row, got ${rows[0].n}`);
    return "two same-old→null-new fixture_moves inserts dedupe to exactly 1 row (unique nulls not distinct) — the reverse direction from P1-P18";
  });
});

add("P1-P34", "§1.3/§4.3", "disposable", async () => {
  return withRollback(async (c) => {
    const compId = await plCompId(c);
    const futureDeadline = new Date(Date.now() + 86400000).toISOString();
    const gw = await mkGameweek(c, compId, { status: "open", deadlineAt: futureDeadline });
    await c.query(`select cashford.run_gameweek_maintenance($1)`, [compId]);
    const { rows } = await c.query(`select status, locked_at from gameweeks where id = $1`, [gw.id]);
    if (rows[0].status !== "open" || rows[0].locked_at !== null) {
      throw new Error(`zero-membership GW with an unpassed deadline must not complete, got status=${rows[0].status} locked_at=${rows[0].locked_at}`);
    }
    return "zero-membership GW with an unpassed deadline does not complete — the deadline gate, not vacuous membership truth, decides";
  });
});

add("P1-P35", "§1.3/§4.3", "disposable", async () => {
  return withRollback(async (c) => {
    const compId = await plCompId(c);
    const home = await mkTeam(c, "P35 Home"), away = await mkTeam(c, "P35 Away");
    const gw = await mkGameweek(c, compId, { status: "locked" });
    const fixture = await mkFixture(c, compId, home, away);
    const memId = await seedMembership(c, gw.id, fixture.id, compId, "excluded");
    const before = await c.query(`select count(*)::int as n from sync_issues`);
    const beforeMoves = await c.query(`select count(*)::int as n from fixture_moves where fixture_id = $1`, [fixture.id]);
    await reconcile(c, fixture, home, away, gw.fpl_event_id);
    const after = await c.query(`select count(*)::int as n from sync_issues`);
    const afterMoves = await c.query(`select count(*)::int as n from fixture_moves where fixture_id = $1`, [fixture.id]);
    const { rows } = await c.query(`select state, is_current from gameweek_fixtures where id = $1`, [memId]);
    if (Number(after.rows[0].n) !== Number(before.rows[0].n)) throw new Error("repeat observation of the same excluded destination must not add a sync_issues row");
    if (Number(afterMoves.rows[0].n) !== Number(beforeMoves.rows[0].n)) throw new Error("repeat observation of the same excluded destination must not add a fixture_moves row");
    if (rows[0].state !== "excluded" || !rows[0].is_current) throw new Error("the excluded row itself must be untouched");
    return "repeated observation of the same excluded destination is a true no-op: no new sync_issues, no new fixture_moves, membership row untouched";
  });
});

add("P1-P36", "§1.3/§4.3", "disposable", async () => {
  return withRollback(async (c) => {
    const compId = await plCompId(c);
    const home = await mkTeam(c, "P36 Home"), away = await mkTeam(c, "P36 Away");
    const gwA = await mkGameweek(c, compId, { status: "locked" });
    const gwB = await mkGameweek(c, compId, { status: "upcoming" });
    const fixture = await mkFixture(c, compId, home, away);
    await seedMembership(c, gwA.id, fixture.id, compId, "excluded");
    await reconcile(c, fixture, home, away, gwB.fpl_event_id);
    const { rows } = await c.query(`select gameweek_id, state, is_current from gameweek_fixtures where fixture_id = $1 order by added_at`, [fixture.id]);
    const old = rows.find((r) => r.gameweek_id === gwA.id), neu = rows.find((r) => r.gameweek_id === gwB.id);
    if (!old || old.state !== "excluded" || old.is_current) throw new Error(`old excluded row must keep state='excluded' and lose is_current, got ${JSON.stringify(old)}`);
    if (!neu || neu.state !== "active" || !neu.is_current) throw new Error(`new row at the unfrozen destination must be active+current, got ${JSON.stringify(neu)}`);
    return "excluded→unfrozen-GW move: old row stays state='excluded' (only is_current cleared), new row is active+current at the destination";
  });
});

add("P1-P37", "§1.3/§4.3", "disposable", async () => {
  return withRollback(async (c) => {
    const compId = await plCompId(c);
    const home = await mkTeam(c, "P37 Home"), away = await mkTeam(c, "P37 Away");
    const gw = await mkGameweek(c, compId, { status: "locked" });
    const fixture = await mkFixture(c, compId, home, away);
    await seedMembership(c, gw.id, fixture.id, compId, "excluded");
    await reconcile(c, fixture, home, away, null);
    const { rows } = await c.query(`select state, is_current from gameweek_fixtures where fixture_id = $1`, [fixture.id]);
    const current = rows.filter((r) => r.is_current);
    if (current.length !== 0) throw new Error(`expected zero current rows after excluded→null, got ${JSON.stringify(current)}`);
    if (rows[0].state !== "excluded") throw new Error(`the old row's state must remain 'excluded', got ${rows[0].state}`);
    return "excluded→null: zero current rows remain, the old row's state stays 'excluded' (never voided)";
  });
});

// --- Provisioning (§4.5) ---
async function maintain(c, compId) {
  const { rows } = await c.query(`select cashford.run_gameweek_maintenance($1) as r`, [compId]);
  return rows[0].r;
}
async function activateComp(c) {
  const { rows } = await c.query(`select cashford.activate_competition('pl-2026-27') as r`);
  return rows[0].r;
}
const soon = () => new Date(Date.now() + 3600000).toISOString();

add("P1-P19", "§4.5", "disposable", async () => {
  return withRollback(async (c) => {
    const compId = await plCompId(c);
    const gw1 = await mkGameweek(c, compId, { status: "upcoming", deadlineAt: soon() });
    const gw2 = await mkGameweek(c, compId, { status: "upcoming", deadlineAt: new Date(Date.now() + 172800000).toISOString() });
    const leagueId = await mkLeague(c, compId, "P1P19 League");
    await activateComp(c);
    const { rows } = await c.query(`select gameweek_id from gameweek_contests where league_id = $1`, [leagueId]);
    if (rows.length !== 1) throw new Error(`expected exactly one pot, got ${rows.length}`);
    if (rows[0].gameweek_id !== gw1.id) throw new Error(`expected the pot on the OPEN gameweek (${gw1.id}), got ${rows[0].gameweek_id}`);
    const { rows: gw2Check } = await c.query(`select status from gameweeks where id = $1`, [gw2.id]);
    if (gw2Check[0].status !== "upcoming") throw new Error(`expected the later gameweek to remain upcoming with no pot, got status ${gw2Check[0].status}`);
    return "provisioning creates a pot only for the currently-open GW (the soonest-deadline one); a later upcoming GW gets none";
  });
});
add("P1-P20", "§4.5", "disposable", async () => {
  return withRollback(async (c) => {
    const compId = await plCompId(c);
    await mkGameweek(c, compId, { status: "upcoming", deadlineAt: soon() });
    const leagueId = await mkLeague(c, compId, "P1P20 League"); // default_stake_inr = 100
    await activateComp(c);
    const { rows: before } = await c.query(`select id, stake_inr from gameweek_contests where league_id = $1`, [leagueId]);
    if (before.length !== 1 || Number(before[0].stake_inr) !== 100) throw new Error(`expected one pot snapshotted at stake 100, got ${JSON.stringify(before)}`);
    await c.query(`update leagues set default_stake_inr = 250 where id = $1`, [leagueId]);
    await maintain(c, compId);
    const { rows: after } = await c.query(`select stake_inr from gameweek_contests where id = $1`, [before[0].id]);
    if (Number(after[0].stake_inr) !== 100) throw new Error(`expected the already-provisioned pot's stake to stay pinned at 100, got ${after[0].stake_inr}`);
    return "stake_inr snapshots at provisioning time and stays pinned even after the league's default_stake_inr changes and maintenance reruns";
  });
});
add("P1-P21", "§4.5", "disposable", async () => {
  return withRollback(async (c) => {
    const compId = await plCompId(c);
    await mkGameweek(c, compId, { status: "upcoming", deadlineAt: soon() });
    const leagueId = await mkLeague(c, compId, "P1P21 League");
    await activateComp(c);
    const second = await maintain(c, compId);
    const { rows } = await c.query(`select count(*)::int as n from gameweek_contests where league_id = $1`, [leagueId]);
    if (rows[0].n !== 1) throw new Error(`expected exactly one pot after two provisioning passes, got ${rows[0].n}`);
    if (Number(second.pots_provisioned) !== 0) throw new Error(`expected the rerun's pots_provisioned to be 0 (idempotent), got ${second.pots_provisioned}`);
    return `provisioning is idempotent: rerunning for an already-provisioned GW creates no duplicate (rerun pots_provisioned=${second.pots_provisioned}, one row total)`;
  });
});
add("P1-P22", "§4.5", "disposable", async () => {
  return withRollback(async (c) => {
    const compId = await plCompId(c);
    await mkGameweek(c, compId, { status: "upcoming", deadlineAt: soon() });
    const leagueId = await mkLeague(c, compId, "P1P22 League");
    await c.query(`update league_competitions set status = 'archived' where league_id = $1 and competition_id = $2`, [leagueId, compId]);
    await activateComp(c);
    const { rows } = await c.query(`select count(*)::int as n from gameweek_contests where league_id = $1`, [leagueId]);
    if (rows[0].n !== 0) throw new Error(`expected zero pots for an archived participation, got ${rows[0].n}`);
    return "an archived league_competitions row is skipped by provisioning even once the competition itself is active and a GW is open";
  });
});
add("P1-P23", "§4.5", "disposable", async () => {
  return withRollback(async (c) => {
    const compId = await plCompId(c);
    const gw1 = await mkGameweek(c, compId, { status: "upcoming", deadlineAt: soon() });
    const leagueId = await mkLeague(c, compId, "P1P23 League");
    await maintain(c, compId); // no activate_competition call — competition stays 'preparing'
    const { rows: gwRows } = await c.query(`select status from gameweeks where id = $1`, [gw1.id]);
    const { rows: potRows } = await c.query(`select count(*)::int as n from gameweek_contests where league_id = $1`, [leagueId]);
    if (gwRows[0].status !== "open") throw new Error(`expected the GW to still open regardless of competition status, got ${gwRows[0].status}`);
    if (potRows[0].n !== 0) throw new Error(`expected zero pots while competition status is 'preparing', got ${potRows[0].n}`);
    return "competition status='preparing' opens gameweeks as normal but never provisions a pot for any league, even an active participation";
  });
});
add("P1-P24", "§4.5", "disposable", async () => {
  return withRollback(async (c) => {
    const compId = await plCompId(c);
    const gw1 = await mkGameweek(c, compId, { status: "upcoming", deadlineAt: soon() });
    await activateComp(c); // opens gw1, competition active, zero leagues yet — zero pots
    const leagueId = await mkLeague(c, compId, "P1P24 League"); // brand-new league joins after the GW is already open
    await maintain(c, compId);
    const { rows } = await c.query(`select gameweek_id from gameweek_contests where league_id = $1`, [leagueId]);
    if (rows.length !== 1) throw new Error(`expected exactly one pot for the brand-new league, got ${rows.length}`);
    if (rows[0].gameweek_id !== gw1.id) throw new Error(`expected the pot on the already-open GW, got ${rows[0].gameweek_id}`);
    return "a brand-new league joining after the GW is already open gets exactly one pot on the next maintenance pass, for that open GW";
  });
});

// --- Team/provider resolution (§1.8/§4.2) ---
// BLOCKED (harness limitation, not a TODO): team resolution lives in lib/espn.ts / lib/sync-fpl.ts
// as TS code that calls the Supabase JS client (postgrest), not a SQL routine. The disposable
// harness (scripts/disposable-db/up.sh) only runs bare Postgres — no postgrest/gotrue containers —
// so there is no REST endpoint for the Supabase client to reach. Exercising these requires either
// (a) standing up the full Supabase stack (postgres+postgrest+gotrue) locally, or (b) a vitest
// suite that imports the lib functions directly with a raw pg-backed stub for the Admin client
// (out of scope for this script). Flagging for team-lead rather than faking a pass.
const BLOCKED_NO_POSTGREST =
  "BLOCKED (harness limitation): this path is TS code (lib/espn.ts, lib/sync-fpl.ts, lib/espn-match.ts) " +
  "that calls the Supabase JS client — the disposable harness is bare Postgres with no postgrest/gotrue, " +
  "so there's no REST endpoint to call. Needs either a full Supabase stack or a vitest harness that " +
  "stubs the Admin client; out of scope for scripts/verify-phase1-db-cases.mjs. Flagged to team-lead.";
add("P1-P25", "§1.8", "disposable", async () => `${BLOCKED_NO_POSTGREST} (case: existing team_provider_ids(fpl) row reused, no duplicate team)`);
add("P1-P26", "§1.8", "disposable", async () => `${BLOCKED_NO_POSTGREST} (case: normalization-map hit with no mapping row yet inserts the mapping, reuses the mapped team)`);
add("P1-P27", "§1.8", "disposable", async () => `${BLOCKED_NO_POSTGREST} (case: unresolvable-by-map name inserts a new teams row (external_id null) + mapping row)`);
add("P1-P28", "§1.8", "disposable", async () => `${BLOCKED_NO_POSTGREST} (case: genuinely unresolvable name writes sync_issues, skips its fixtures, does not crash)`);
add("P1-P29", "§1.8", "prod-readonly", async () => {
  const rows = await runSql(`
    select
      (select count(*) from cashford.team_provider_ids where provider = 'espn' and season = '2026') as mapped,
      (select count(*) from cashford.teams where external_id is not null) as teams_with_external_id;
  `);
  const { mapped, teams_with_external_id } = rows[0];
  if (Number(mapped) !== Number(teams_with_external_id)) {
    throw new Error(`expected ${teams_with_external_id} team_provider_ids(espn,2026) rows (one per team with a non-null external_id), got ${mapped}`);
  }
  return `${mapped} team_provider_ids(espn,2026) rows == ${teams_with_external_id} teams with non-null external_id`;
});
add("P1-P30", "§1.8", "disposable", async () => `${BLOCKED_NO_POSTGREST} (case: knockout-team upsert path (lib/espn.ts) also writes the team_provider_ids(espn) mapping row)`);

// --- ESPN matcher DB behavior (§5) ---
add("P1-P31", "§5", "disposable", async () => `${BLOCKED_NO_POSTGREST} (case: fixture with external_id already set — a hypothetical re-match never overwrites it — lib/espn-match.ts's .is("external_id", null) guard)`);

async function wcCompId(c) {
  const { rows } = await c.query(`select id from competitions where slug = 'wc2026'`);
  return rows[0].id;
}
async function mkContestRow(c, leagueId, fixtureId, { status = "open", settledAt = null } = {}) {
  const { rows } = await c.query(
    `insert into contests (league_id, fixture_id, stake_inr, status, lock_at, settled_at) values ($1, $2, 100, $3, now(), $4) returning id`,
    [leagueId, fixtureId, status, settledAt]
  );
  return rows[0].id;
}
async function scoreUpdate(c, fixtureId, home, away, source, status = null) {
  const { rows } = await c.query(`select cashford.apply_score_update($1, $2, $3, $4, $5) as r`, [fixtureId, home, away, source, status]);
  return rows[0].r;
}

add("P1-P31a", "§2/§1.13", "disposable", async () => {
  return withRollback(async (c) => {
    const compId = await plCompId(c);
    const home = await mkTeam(c, "P31a Home"), away = await mkTeam(c, "P31a Away");
    const fixture = await mkFixture(c, compId, home, away);
    await c.query(`update fixtures set external_id = 555001, ft_home = 1, ft_away = 0, score_source = 'espn', status = 'live' where id = $1`, [fixture.id]);
    const result = await scoreUpdate(c, fixture.id, 2, 0, "fpl");
    const { rows } = await c.query(`select ft_home, ft_away, score_source from fixtures where id = $1`, [fixture.id]);
    if (result.applied) throw new Error(`expected applied=false (espn owns this fixture's score), got ${JSON.stringify(result)}`);
    if (rows[0].ft_home !== 1 || rows[0].ft_away !== 0 || rows[0].score_source !== "espn") throw new Error(`expected the stored espn score untouched, got ${JSON.stringify(rows[0])}`);
    return "stored score_source='espn' + external_id set: apply_score_update(p_source='fpl') is rejected, stored score untouched";
  });
});
add("P1-P31b", "§2/§1.13", "disposable", async () => {
  return withRollback(async (c) => {
    const compId = await plCompId(c);
    const home = await mkTeam(c, "P31b Home"), away = await mkTeam(c, "P31b Away");
    const fixture = await mkFixture(c, compId, home, away);
    await c.query(`update fixtures set external_id = 555002, ft_home = 1, ft_away = 0, score_source = 'fpl', status = 'live' where id = $1`, [fixture.id]);
    const result = await scoreUpdate(c, fixture.id, 2, 0, "fpl");
    const { rows } = await c.query(`select ft_home, ft_away from fixtures where id = $1`, [fixture.id]);
    if (!result.applied) throw new Error(`expected applied=true (fpl already owns this fixture), got ${JSON.stringify(result)}`);
    if (rows[0].ft_home !== 2 || rows[0].ft_away !== 0) throw new Error(`expected the new score to write, got ${JSON.stringify(rows[0])}`);
    return "stored score_source='fpl': apply_score_update(p_source='fpl') writes the new score";
  });
});
add("P1-P31c", "§2/§1.13", "disposable", async () => {
  return withRollback(async (c) => {
    const compId = await plCompId(c);
    const home = await mkTeam(c, "P31c Home"), away = await mkTeam(c, "P31c Away");
    const fixture = await mkFixture(c, compId, home, away);
    await c.query(`update fixtures set ft_home = 1, ft_away = 0, score_source = 'espn', status = 'live' where id = $1`, [fixture.id]); // external_id stays null
    const result = await scoreUpdate(c, fixture.id, 2, 0, "fpl");
    const { rows } = await c.query(`select ft_home, ft_away from fixtures where id = $1`, [fixture.id]);
    if (!result.applied) throw new Error(`expected applied=true (external_id null means ESPN can never see this fixture), got ${JSON.stringify(result)}`);
    if (rows[0].ft_home !== 2 || rows[0].ft_away !== 0) throw new Error(`expected the new score to write regardless of stored score_source, got ${JSON.stringify(rows[0])}`);
    return "external_id null (unmatched by ESPN): apply_score_update(p_source='fpl') writes regardless of the prior stored score_source";
  });
});
add("P1-P31d", "§2/§1.13", "disposable", async () => {
  return withRollback(async (c) => {
    const compId = await plCompId(c);
    const home = await mkTeam(c, "P31d Home"), away = await mkTeam(c, "P31d Away");
    const fixture = await mkFixture(c, compId, home, away);
    await c.query(`update fixtures set external_id = 555003, ft_home = 1, ft_away = 0, score_source = 'fpl', status = 'live' where id = $1`, [fixture.id]);
    const result = await scoreUpdate(c, fixture.id, 2, 0, "espn");
    const { rows } = await c.query(`select ft_home, ft_away from fixtures where id = $1`, [fixture.id]);
    if (!result.applied) throw new Error(`expected applied=true (the fpl-ownership guard only ever blocks p_source='fpl' calls), got ${JSON.stringify(result)}`);
    if (rows[0].ft_home !== 2 || rows[0].ft_away !== 0) throw new Error(`expected the new espn score to write, got ${JSON.stringify(rows[0])}`);
    return "stored score_source='fpl': apply_score_update(p_source='espn') always writes — the ownership guard is fpl-only";
  });
});

// --- Settled-correction carve-out (§1.9) ---
add("P1-P32", "§1.9", "disposable", async () => {
  return withRollback(async (c) => {
    const compId = await wcCompId(c);
    const home = await mkTeam(c, "P32 Home"), away = await mkTeam(c, "P32 Away");
    const fixture = await mkFixture(c, compId, home, away);
    await c.query(`update fixtures set ft_home = 1, ft_away = 0, status = 'finished', score_source = 'espn' where id = $1`, [fixture.id]);
    const leagueId = await mkLeague(c, compId, "P1P32 League");
    await mkContestRow(c, leagueId, fixture.id, { status: "settled", settledAt: new Date().toISOString() });
    const result = await scoreUpdate(c, fixture.id, 2, 0, "espn");
    const { rows: fx } = await c.query(`select ft_home, ft_away from fixtures where id = $1`, [fixture.id]);
    const { rows: issues } = await c.query(`select 1 from sync_issues where ref = $1 and kind = 'settled-correction'`, [fixture.id]);
    if (result.applied) throw new Error(`expected applied=false (a settled contest exists for this fixture), got ${JSON.stringify(result)}`);
    if (fx[0].ft_home !== 1 || fx[0].ft_away !== 0) throw new Error(`expected the stored score untouched, got ${JSON.stringify(fx[0])}`);
    if (issues.length !== 1) throw new Error(`expected exactly one settled-correction sync_issues row, got ${issues.length}`);
    return "a finished WC fixture with a settled contest: score correction is rejected, one settled-correction sync_issues row, fixture unchanged";
  });
});

// --- FPL terminal-status fallback (§5 round-3) ---
add("P1-P38", "§5", "disposable", async () => {
  return withRollback(async (c) => {
    const compId = await plCompId(c);
    const home = await mkTeam(c, "P38 Home"), away = await mkTeam(c, "P38 Away");
    const fixture = await mkFixture(c, compId, home, away); // external_id stays null
    const result = await scoreUpdate(c, fixture.id, 2, 1, "fpl", "finished");
    const { rows } = await c.query(`select status, ft_home, ft_away from fixtures where id = $1`, [fixture.id]);
    if (rows[0].status !== "finished") throw new Error(`expected status='finished' to be accepted for an external_id-null fixture, got ${rows[0].status}`);
    if (rows[0].ft_home !== 2 || rows[0].ft_away !== 1) throw new Error(`expected the score to write too, got ${JSON.stringify(rows[0])}`);
    return "external_id null fixture: apply_score_update(p_source='fpl', p_status='finished') is accepted — ESPN can never poll this fixture, so FPL is the only source";
  });
});
add("P1-P39", "§5", "disposable", async () => {
  return withRollback(async (c) => {
    const compId = await plCompId(c);
    const home = await mkTeam(c, "P39 Home"), away = await mkTeam(c, "P39 Away");
    const fixture = await mkFixture(c, compId, home, away);
    await c.query(`update fixtures set external_id = 555010, status = 'live' where id = $1`, [fixture.id]);
    const result = await scoreUpdate(c, fixture.id, 2, 1, "fpl", "finished");
    const { rows } = await c.query(`select status from fixtures where id = $1`, [fixture.id]);
    const { rows: issues } = await c.query(`select 1 from sync_issues where ref = $1 and kind = 'terminal-status-rejected'`, [fixture.id]);
    if (rows[0].status !== "live") throw new Error(`expected status to stay 'live' (FPL may not set a terminal status once ESPN can see this fixture), got ${rows[0].status}`);
    if (issues.length !== 1) throw new Error(`expected one terminal-status-rejected sync_issues row, got ${issues.length}`);
    return "external_id NOT null fixture: apply_score_update(p_source='fpl', p_status='finished') rejects the terminal status, one terminal-status-rejected sync_issues row";
  });
});

// --- Routine-level transactional guarantees (§1.13) ---
async function mkUser(c, label) {
  const { rows } = await c.query(
    `insert into auth.users (instance_id, id, aud, role, email, encrypted_password, confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
     values ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated', $1, '', now(), '{"provider":"email","providers":["email"]}', $2::jsonb, now(), now())
     returning id`,
    [`${label}@cashford.internal`, JSON.stringify({ username: label, display_name: label })]
  );
  return rows[0].id;
}
async function asUser(c, userId) {
  await c.query(`select set_config('request.jwt.claim.sub', $1, true)`, [userId]);
}

add("P1-P40", "§1.13", "disposable", async () => {
  return withRollback(async (c) => {
    const compId = await plCompId(c);
    await mkGameweek(c, compId, { status: "upcoming", deadlineAt: soon() });
    const result = await activateComp(c);
    const { rows } = await c.query(`select status from competitions where id = $1`, [compId]);
    if (rows[0].status !== "active") throw new Error(`expected competition status='active', got ${rows[0].status}`);
    if (!result.open_gameweek_id) throw new Error(`expected activate_competition's result to carry an open_gameweek_id, got ${JSON.stringify(result)}`);
    const { rows: gwRows } = await c.query(`select status from gameweeks where id = $1`, [result.open_gameweek_id]);
    if (gwRows[0].status !== "open") throw new Error(`expected the returned gameweek to be open, got ${gwRows[0].status}`);
    return "activate_competition opens a gameweek AND flips competition status to 'active' in the same call";
  });
});
add("P1-P41", "§1.13", "disposable", async () => {
  return withRollback(async (c) => {
    const compId = await plCompId(c);
    await mkGameweek(c, compId, { status: "upcoming", deadlineAt: soon() });
    await activateComp(c);
    const creatorId = await mkUser(c, "p1p41creator");
    await asUser(c, creatorId);
    const { rows: created } = await c.query(`select * from create_league($1, $2, 100, 'pl-2026-27')`, ["P1P41 League", "p1p41-league"]);
    const { league_id: leagueId, invite_token: token } = created[0];
    const joinerId = await mkUser(c, "p1p41joiner");
    await asUser(c, joinerId);
    await c.query(`select join_league($1)`, [token]);
    const { rows: members } = await c.query(`select 1 from league_members where league_id = $1 and user_id = $2`, [leagueId, joinerId]);
    const { rows: memberComps } = await c.query(`select 1 from member_competitions where league_id = $1 and user_id = $2 and competition_id = $3`, [leagueId, joinerId, compId]);
    if (members.length !== 1) throw new Error(`expected a league_members row for the joiner, got ${members.length}`);
    if (memberComps.length !== 1) throw new Error(`expected a member_competitions row for the joiner, got ${memberComps.length}`);
    return "join_league(valid invite) creates the league_members row AND the member_competitions row together, in one call";
  });
});
add("P1-P42", "§1.13", "disposable", async () => {
  return withRollback(async (c) => {
    const compId = await plCompId(c);
    await mkGameweek(c, compId, { status: "upcoming", deadlineAt: soon() });
    await activateComp(c);
    const creatorId = await mkUser(c, "p1p42creator");
    await asUser(c, creatorId);
    const { rows: created } = await c.query(`select * from create_league($1, $2, 100, 'pl-2026-27')`, ["P1P42 League", "p1p42-league"]);
    const { league_id: leagueId } = created[0];
    const joinerId = await mkUser(c, "p1p42joiner");
    await asUser(c, joinerId);
    await c.query(`savepoint p1p42_attempt`);
    let rejected = false;
    try {
      await c.query(`select join_league('this-token-does-not-exist')`);
    } catch (e) {
      rejected = true;
      await c.query(`rollback to savepoint p1p42_attempt`);
    }
    if (!rejected) throw new Error("expected join_league with an unknown invite token to raise an exception");
    const { rows: members } = await c.query(`select 1 from league_members where league_id = $1 and user_id = $2`, [leagueId, joinerId]);
    const { rows: memberComps } = await c.query(`select 1 from member_competitions where league_id = $1 and user_id = $2`, [leagueId, joinerId]);
    if (members.length !== 0) throw new Error(`expected zero league_members writes on a rejected join, got ${members.length}`);
    if (memberComps.length !== 0) throw new Error(`expected zero member_competitions writes on a rejected join, got ${memberComps.length}`);
    return "join_league(invalid invite) raises and leaves zero partial writes (no league_members or member_competitions row for the rejected joiner)";
  });
});
add("P1-P43", "§1.13", "disposable", async () => {
  return "BLOCKED (not a harness limitation, a test-design limitation): create_league's short_code retry loop " +
    "(supabase/migrations/20260727000001_competitions_gameweeks.sql create_league, ~L968-987) uses random() " +
    "8 times per attempt to build an 8-char code from a 32-symbol alphabet (32^8 ≈ 1.1e12 combinations) plus " +
    "two gen_random_uuid() calls (pgcrypto, OS-entropy, not affected by setseed()) for the token — natural " +
    "collision odds in a scratch test are negligible, so I cannot force the unique_violation branch to fire " +
    "without either seeding Postgres's random() (setseed() affects random() but plpgsql's evaluation order " +
    "inside the function's loop isn't something I can reliably predict from outside it) or editing the " +
    "migration to add a test hook — both out of my scope. Rather than write a test that can't actually " +
    "exercise the retry branch (and would silently pass whether or not the retry logic works), flagging this " +
    "as blocked for team-lead to decide: either accept a code-review read of the retry loop as sufficient, or " +
    "have the implementer add a seedable/injectable short-code generator so this becomes testable.";
});

// --- Lease protocol (§1.13 finding 8) ---
add("P1-L01", "§1.13", "disposable", async () => {
  return withRollback(async (c) => {
    await c.query(`insert into sync_state (key, next_due_at) values ('P1-L01', now() + interval '1 hour')`);
    const { rows } = await c.query(`select cashford.claim_sync_lease('P1-L01', interval '5 minutes') as token`);
    if (rows[0].token !== null) throw new Error(`expected null (not due yet), got token ${rows[0].token}`);
    return "future next_due_at: claim_sync_lease returns null (zero rows matched) — not due";
  });
});
add("P1-L02", "§1.13", "disposable", async () => {
  return withRollback(async (c) => {
    await c.query(`insert into sync_state (key, next_due_at, lease_until, lease_token) values ('P1-L02', now() - interval '1 minute', now() + interval '5 minutes', gen_random_uuid())`);
    const { rows } = await c.query(`select cashford.claim_sync_lease('P1-L02', interval '5 minutes') as token`);
    if (rows[0].token !== null) throw new Error(`expected null (already leased), got token ${rows[0].token}`);
    return "due + already-held unexpired lease: second concurrent claim_sync_lease returns null";
  });
});
add("P1-L03", "§1.13", "disposable", async () => {
  return withRollback(async (c) => {
    const { rows: seed } = await c.query(`insert into sync_state (key, next_due_at, lease_until, lease_token) values ('P1-L03', now() - interval '1 minute', now() - interval '1 second', gen_random_uuid()) returning lease_token as old_token`);
    const { rows } = await c.query(`select cashford.claim_sync_lease('P1-L03', interval '5 minutes') as token`);
    if (rows[0].token === null) throw new Error("expected a fresh token (lease expired), got null");
    if (rows[0].token === seed[0].old_token) throw new Error("expected a NEW lease_token, got the same expired one back");
    return `due + expired lease_until: claim_sync_lease succeeds with a fresh token (${rows[0].token} != expired ${seed[0].old_token})`;
  });
});
add("P1-L04", "§1.13", "disposable", async () => {
  return withRollback(async (c) => {
    const { rows: seed } = await c.query(`insert into sync_state (key, next_due_at, lease_until, lease_token) values ('P1-L04', now() - interval '1 minute', now() + interval '5 minutes', gen_random_uuid()) returning lease_token as current_token`);
    const staleToken = "00000000-0000-0000-0000-000000000000";
    const { rows } = await c.query(`select cashford.release_sync_lease('P1-L04', $1, now()) as ok`, [staleToken]);
    if (rows[0].ok !== false) throw new Error(`expected release with a stale token to return false, got ${rows[0].ok}`);
    const { rows: after } = await c.query(`select lease_token from sync_state where key = 'P1-L04'`);
    if (after[0].lease_token !== seed[0].current_token) throw new Error("stale-token release must not have cleared the current holder's lease, but lease_token changed");
    return "stale lease_token release_sync_lease call returns false and leaves the current holder's lease untouched";
  });
});
add("P1-L05", "§1.13", "disposable", async () => {
  return withRollback(async (c) => {
    const { rows: seed } = await c.query(`insert into sync_state (key, next_due_at, lease_until, lease_token) values ('P1-L05', now() - interval '1 minute', now() - interval '1 second', gen_random_uuid()) returning lease_token as expired_token`);
    const { rows } = await c.query(`select cashford.renew_sync_lease('P1-L05', $1, interval '5 minutes') as ok`, [seed[0].expired_token]);
    if (rows[0].ok !== false) throw new Error(`expected renew after lease_until expired to return false, got ${rows[0].ok}`);
    return "renew_sync_lease after lease_until has already expired returns false — holder must abort without writing";
  });
});

// --- Isolation & safety (§1.10/§1.11/§1.13) ---
add("P1-I01", "§1", "disposable", async () => {
  return withRollback(async (c) => {
    const compId = await plCompId(c);
    const { rows: teamsBefore } = await c.query(`select count(*)::int as n from teams`);
    const { rows: compsBefore } = await c.query(`select count(*)::int as n from competitions`);
    for (const file of ["20260727000001_competitions_gameweeks.sql", "20260727000002_gameweek_entries.sql"]) {
      const sql = fs.readFileSync(path.join(__dirname, "..", "supabase", "migrations", file), "utf8");
      await c.query(sql); // re-applying inside this case's own transaction; rolled back on return either way
    }
    const { rows: teamsAfter } = await c.query(`select count(*)::int as n from teams`);
    const { rows: compsAfter } = await c.query(`select count(*)::int as n from competitions`);
    const { rows: compRow } = await c.query(`select count(*)::int as n from competitions where id = $1`, [compId]);
    if (teamsAfter[0].n !== teamsBefore[0].n) throw new Error(`expected zero new teams rows from a second application, got ${teamsBefore[0].n} -> ${teamsAfter[0].n}`);
    if (compsAfter[0].n !== compsBefore[0].n) throw new Error(`expected zero new competitions rows from a second application, got ${compsBefore[0].n} -> ${compsAfter[0].n}`);
    if (compRow[0].n !== 1) throw new Error(`expected exactly one pl-2026-27 competitions row after reapplication, got ${compRow[0].n}`);
    return "reapplying the two Phase 1 migration files inside a transaction is a clean no-op: identical teams/competitions row counts, no error";
  });
});
add("P1-I02", "§1.11", "prod-readonly", async () => {
  const { data, error } = await anon.from("competitions").select("id").limit(1);
  if (error) throw new Error(error.message);
  return `anon-authenticated read of competitions ${error ? "denied" : "allowed"} (${data?.length ?? 0} rows) — expect readable`;
});
add("P1-I03", "§1.11", "prod-readonly", async () => {
  const { data, error } = await anon.from("gameweek_contests").select("id").limit(1);
  return `unauthenticated/other-user read of gameweek_contests: ${error ? error.message : `${data?.length ?? 0} rows`} — expect zero rows for a non-member, run signed-in as a specific non-member test user to make this assertion real`;
});
add("P1-I04", "§1.11", "prod-readonly", async () => {
  const { data, error } = await anon.from("member_competitions").select("league_id").limit(1);
  return `read of member_competitions: ${error ? error.message : `${data?.length ?? 0} rows`} — expect zero for a non-member (needs an authenticated non-member session to be a real assertion)`;
});
add("P1-I05", "§1.11", "prod-readonly", async () => {
  const { error } = await anon.from("gameweeks").insert({ competition_id: "00000000-0000-0000-0000-000000000000", number: 1, name: "x" });
  if (!error) throw new Error("expected an authenticated non-service insert into gameweeks to be rejected, but it succeeded");
  return `insert correctly rejected: ${error.message.slice(0, 120)}`;
});
add("P1-I06", "§1.11", "prod-readonly", async () => {
  const { error } = await svc.from("sync_state").select("key").limit(1);
  if (error) throw new Error(error.message);
  return "service-role read of sync_state succeeded";
});
add("P1-I07", "§1.11", "prod-readonly", async () => {
  const { data, error } = await anon.from("sync_state").select("key").limit(1);
  return `non-service read of sync_state: ${error ? error.message : `${data?.length ?? 0} rows`} — expect denied/zero (RLS enabled, no policies)`;
});
add("P1-I08", "§1.10", "disposable", async () => {
  return withRollback(async (c) => {
    const compId = await plCompId(c); // pl-2026-27 is format='league', not 'cup'
    const home = await mkTeam(c, "P1I08 Home"), away = await mkTeam(c, "P1I08 Away");
    const fixture = await mkFixture(c, compId, home, away);
    const newKickoff = new Date(Date.now() + 3 * 3600_000).toISOString();
    await c.query(`update fixtures set kickoff_at = $1, status = 'live' where id = $2`, [newKickoff, fixture.id]);
    const { rows } = await c.query(`select count(*)::int as n from contests where fixture_id = $1`, [fixture.id]);
    if (rows[0].n !== 0) throw new Error(`expected zero contests rows for a league-format fixture, got ${rows[0].n}`);
    return "changing kickoff_at + status on a PL (non-cup) fixture: sync_contest_on_fixture_change takes its early-return path cleanly, zero contests rows exist or get touched, no error";
  });
});
// --- Authenticated-session variants of P1-I02/I03/I04 (closes the anon-role gap) ---
add("P1-I17", "§1.11", "authed-readonly", async () => {
  const client = await getAuthedClient();
  const { data, error } = await client.from("competitions").select("slug");
  if (error) throw new Error(error.message);
  const slugs = new Set((data ?? []).map((r) => r.slug));
  if (slugs.size !== 2 || !slugs.has("wc2026") || !slugs.has("pl-2026-27")) {
    throw new Error(`expected exactly {wc2026, pl-2026-27} readable as an authenticated user, got ${JSON.stringify([...slugs])}`);
  }
  return `signed-in read of competitions returns exactly {wc2026, pl-2026-27} — confirms the to-authenticated-using(true) policy (closes P1-I02's anon/authenticated gap)`;
});
add("P1-I18", "§1.11", "authed-readonly", async () => {
  const client = await getAuthedClient();
  const groundTruth = await runSql(`
    select gc.league_id, l.name
      from cashford.gameweek_contests gc
      join cashford.leagues l on l.id = gc.league_id
      join cashford.league_members lm on lm.league_id = gc.league_id
      join auth.users u on u.id = lm.user_id
     where u.email = 'ananth@cashford.internal';
  `);
  const { data, error } = await client.from("gameweek_contests").select("league_id");
  if (error) throw new Error(error.message);
  const seen = new Set((data ?? []).map((r) => r.league_id));
  const expected = new Set(groundTruth.map((r) => r.league_id));
  const extra = [...seen].filter((id) => !expected.has(id));
  const missing = [...expected].filter((id) => !seen.has(id));
  if (extra.length || missing.length) {
    throw new Error(`scoping mismatch — extra: ${JSON.stringify(extra)}, missing: ${JSON.stringify(missing)}`);
  }
  return `signed-in read of gameweek_contests returns exactly ananth's own ${seen.size} row(s) (leagues: ${JSON.stringify(groundTruth.map((r) => r.name))}) — matches league_members ground truth (closes P1-I03's gap)`;
});
add("P1-I19", "§1.11", "authed-readonly", async () => {
  const client = await getAuthedClient();
  const groundTruth = await runSql(`
    select mc.league_id, l.name
      from cashford.member_competitions mc
      join cashford.leagues l on l.id = mc.league_id
      join auth.users u on u.id = mc.user_id
     where u.email = 'ananth@cashford.internal';
  `);
  const { data, error } = await client.from("member_competitions").select("league_id");
  if (error) throw new Error(error.message);
  const seen = new Set((data ?? []).map((r) => r.league_id));
  const expected = new Set(groundTruth.map((r) => r.league_id));
  const extra = [...seen].filter((id) => !expected.has(id));
  const missing = [...expected].filter((id) => !seen.has(id));
  if (extra.length || missing.length) {
    throw new Error(`scoping mismatch — extra: ${JSON.stringify(extra)}, missing: ${JSON.stringify(missing)}`);
  }
  return `signed-in read of member_competitions returns exactly ananth's own ${seen.size} row(s) — matches league_members ground truth (closes P1-I04's gap)`;
});

add("P1-I09", "§1.10", "prod-readonly", async () => {
  // Regression, read-only: every pre-existing fixture row must have been backfilled to a
  // competition (migration step 3) and every WC fixture must still be tagged 'cup' format —
  // the legacy contest-sync trigger's whole safety argument rests on this staying true.
  const rows = await runSql(`
    select
      (select count(*) from cashford.fixtures where competition_id is null) as unbackfilled,
      (select count(*) from cashford.fixtures f join cashford.competitions c on c.id = f.competition_id
        where c.slug = 'wc2026' and c.format <> 'cup') as wc_not_cup;
  `);
  const { unbackfilled, wc_not_cup } = rows[0];
  if (Number(unbackfilled) !== 0) throw new Error(`${unbackfilled} fixtures rows have null competition_id (backfill incomplete)`);
  if (Number(wc_not_cup) !== 0) throw new Error(`${wc_not_cup} wc2026 fixtures resolve to a non-cup competition format`);
  return "0 unbackfilled fixtures, 0 wc2026 fixtures with a non-cup competition format";
});
add("P1-I10", "§1.10", "disposable", async () => {
  // Was previously wired to runSql() (the prod Management API) selecting from real prod
  // `leagues` — an attempted write against real friend-group leagues, rejected by the
  // trigger with zero persisted change (verified after discovery), but wrong regardless.
  // Fixed to seed its own team/fixture/league rows in the local harness only.
  return withRollback(async (c) => {
    const { rows: comp } = await c.query(`select id from competitions where slug = 'pl-2026-27'`);
    const { rows: team } = await c.query(`insert into teams (name) values ('P1-I10 Scratch FC') returning id`);
    const { rows: fixture } = await c.query(
      `insert into fixtures (competition_id, home_team_id, away_team_id) values ($1, $2, $2) returning id`,
      [comp[0].id, team[0].id]
    );
    const { rows: creator } = await c.query(`select id from profiles where username = 'ananth'`);
    const { rows: league } = await c.query(
      `insert into leagues (name, slug, default_stake_inr, created_by) values ('P1-I10 Scratch League', 'p1-i10-scratch', 100, $1) returning id`,
      [creator[0].id]
    );
    try {
      await c.query(
        `insert into contests (league_id, fixture_id, lock_at) values ($1, $2, now() + interval '1 day')`,
        [league[0].id, fixture[0].id]
      );
      throw new Error("expected contests_cup_only trigger to reject a league-format fixture insert, but it succeeded");
    } catch (e) {
      if (e.code !== "P0001") throw e; // anything but the trigger's own raised exception is a real failure
      return `trigger correctly rejected a league-format fixture insert into contests: ${e.message.slice(0, 160)}`;
    }
  });
});
add("P1-I11", "§0", "disposable", async () => `${BLOCKED_NO_POSTGREST} (case: lockDueContests over a mix of cup/league rows — league rows no-op; lockDueContests lives in lib/settle-contest.ts and calls the Supabase JS client)`);
add("P1-I12", "§0", "disposable", async () => `${BLOCKED_NO_POSTGREST} (case: settleFinishedContests over a mix — league rows no-op; same lib/settle-contest.ts limitation)`);
add("P1-I13", "§0", "disposable", async () => `${BLOCKED_NO_POSTGREST} (case: settleContest invoked directly on a league-format contest — no-op; same lib/settle-contest.ts limitation — note the trg_contests_cup_only DB invariant already makes this scenario unreachable in practice, since a contests row can never exist for a league-format fixture in the first place, see P1-I10)`);

add("P1-I14", "§1.3", "disposable", async () => {
  return withRollback(async (c) => {
    const wcId = await wcCompId(c);
    const plId = await plCompId(c);
    const home = await mkTeam(c, "P1I14 Home"), away = await mkTeam(c, "P1I14 Away");
    const fixture = await mkFixture(c, wcId, home, away); // fixture belongs to wc2026
    const plGw = await mkGameweek(c, plId, { status: "upcoming", deadlineAt: soon() }); // gameweek belongs to pl-2026-27
    try {
      // competition_id = wcId (the fixture's own competition) so the (gameweek_id, competition_id)
      // composite FK can only be satisfied by a gameweeks row that doesn't exist (plGw's real row has competition_id = plId).
      await c.query(
        `insert into gameweek_fixtures (gameweek_id, fixture_id, competition_id, state) values ($1, $2, $3, 'active')`,
        [plGw.id, fixture.id, wcId]
      );
      throw new Error("expected a cross-competition gameweek_fixtures insert to be rejected, but it succeeded");
    } catch (e) {
      if (e.code !== "23514" && e.code !== "23503" && e.code !== "P0001") throw e;
      return `gameweek_fixtures row linking a pl-2026-27 gameweek to a wc2026 fixture is rejected: ${e.message.slice(0, 160)}`;
    }
  });
});
add("P1-I15", "§1.4", "disposable", async () => {
  return withRollback(async (c) => {
    const wcId = await wcCompId(c);
    const plId = await plCompId(c);
    const leagueId = await mkLeague(c, wcId, "P1I15 League"); // league's league_competitions row is wc2026
    const plGw = await mkGameweek(c, plId, { status: "upcoming", deadlineAt: soon() }); // gameweek belongs to pl-2026-27
    try {
      // competition_id = wcId satisfies the (league_id, competition_id) FK against league_competitions,
      // but the (gameweek_id, competition_id) FK against gameweeks can't be — plGw's real row has competition_id = plId.
      await c.query(
        `insert into gameweek_contests (league_id, gameweek_id, competition_id, stake_inr, deadline_at) values ($1, $2, $3, 100, now())`,
        [leagueId, plGw.id, wcId]
      );
      throw new Error("expected a cross-competition gameweek_contests insert to be rejected, but it succeeded");
    } catch (e) {
      if (e.code !== "23514" && e.code !== "23503" && e.code !== "P0001") throw e;
      return `gameweek_contests row pairing a wc2026 league with a pl-2026-27 gameweek is rejected: ${e.message.slice(0, 160)}`;
    }
  });
});
add("P1-I16", "§1.6", "disposable", async () => {
  return withRollback(async (c) => {
    const wcId = await wcCompId(c);
    const plId = await plCompId(c);
    const plGw = await mkGameweek(c, plId, { status: "upcoming", deadlineAt: soon() });
    // Raw league insert (not mkLeague) — mkLeague would itself create a league_competitions(league_id, wcId)
    // row, colliding with the primary key on the row this case inserts directly.
    const { rows: creator } = await c.query(`select id from profiles where username = 'ananth'`);
    const { rows: leagueRows } = await c.query(
      `insert into leagues (name, slug, default_stake_inr, created_by) values ('P1I16 League', 'p1i16-league', 100, $1) returning id`,
      [creator[0].id]
    );
    const leagueId = leagueRows[0].id;
    try {
      // competition_id = wcId so (league_id, competition_id) is a fresh, valid primary key for this insert,
      // but eligible_from_gameweek_id's (id, competition_id) FK against gameweeks can't be satisfied —
      // plGw's real row has competition_id = plId, not wcId.
      await c.query(
        `insert into league_competitions (league_id, competition_id, status, eligible_from_gameweek_id) values ($1, $2, 'active', $3)`,
        [leagueId, wcId, plGw.id]
      );
      throw new Error("expected a cross-competition eligible_from_gameweek_id to be rejected, but it succeeded");
    } catch (e) {
      if (e.code !== "23514" && e.code !== "23503" && e.code !== "P0001") throw e;
      return `league_competitions(competition_id=wc2026).eligible_from_gameweek_id pointing at a pl-2026-27 gameweek is rejected: ${e.message.slice(0, 160)}`;
    }
  });
});

// --- Sync failure handling (§4/§7) ---
add("P1-F04", "§1.13", "disposable", async () => `${BLOCKED_NO_POSTGREST} (case: orchestration-level mirror of P1-L02 — a second concurrent syncFpl run observes the held lease and exits without calling apply_fpl_reconciliation; that orchestration lives in lib/sync-fpl.ts and calls the Supabase JS client — the lease primitive itself is already covered at the SQL level by P1-L01–L05)`);
add("P1-F05", "§1.13", "disposable", async () => {
  return withRollback(async (c) => {
    const compId = await plCompId(c);
    const newFplEventId = 88888; // distinctive, well clear of any real/scratch gameweek number
    const { rows: gwBefore } = await c.query(`select count(*)::int as n from gameweeks where competition_id = $1 and fpl_event_id = $2`, [compId, newFplEventId]);
    // Step 1 (new gameweeks) and step 3 (fixtures upsert) each run as ONE bulk statement over the
    // whole jsonb array. This snapshot's gameweeks entry is well-formed and would insert a new
    // gameweek row on its own; the fixtures entry has a home_team_id that isn't a valid uuid, so
    // step 3's `(e->>'home_team_id')::uuid` cast throws mid-function-call — after step 1 already
    // ran. A single top-level function call is one Postgres transaction, so the exception must
    // unwind step 1's insert too.
    const snapshot = {
      gameweeks: [{ fpl_event_id: newFplEventId, number: 888, name: "P1-F05 Scratch GW", deadline_at: soon() }],
      fixtures: [{ fpl_fixture_id: 88888, kickoff_at: null, home_team_id: "not-a-uuid", away_team_id: "not-a-uuid" }],
    };
    await c.query(`savepoint p1f05_attempt`);
    let failed = false;
    try {
      await c.query(`select cashford.apply_fpl_reconciliation($1::jsonb)`, [JSON.stringify(snapshot)]);
    } catch (e) {
      failed = true;
      await c.query(`rollback to savepoint p1f05_attempt`);
    }
    if (!failed) throw new Error("expected apply_fpl_reconciliation to fail on the malformed fixtures entry, but it succeeded");
    const { rows: gwAfter } = await c.query(`select count(*)::int as n from gameweeks where competition_id = $1 and fpl_event_id = $2`, [compId, newFplEventId]);
    if (gwAfter[0].n !== gwBefore[0].n) throw new Error(`expected the new gameweek from step 1 to be rolled back along with the later failure, got ${gwBefore[0].n} -> ${gwAfter[0].n}`);
    return "apply_fpl_reconciliation forced to fail mid-call (a well-formed gameweeks entry that inserts cleanly in step 1, followed by a fixtures entry with an invalid uuid that throws in step 3): the whole call is one Postgres transaction, so step 1's already-inserted gameweek row is rolled back too — zero partial writes survive";
  });
});

// --- Full sync integration (§4) — informational pointer only; the real assertion lives in vitest ---
add("P1-G01", "§4", "prod-readonly", async () => "see tests/phase1/ (vitest, mocked network) — not run from this script; listed here for 1:1 traceability with phase1-cases.md");

// ---------------------------------------------------------------------------------------

async function main() {
  console.log(`Phase 1 DB case runner — project ref ${REF}, mode=${mode}${confirmedDisposable ? " (disposable confirmed)" : ""}`);
  if (confirmedDisposable) {
    console.log(`disposable target: ${DISPOSABLE_DSN.replace(/:[^:@]*@/, ":***@")} (must be scripts/disposable-db, never prod)`);
  }
  const selected = cases.filter((c) => mode === "all" || c.mode === mode || c.id === "P1-G01");
  if (selected.some((c) => c.mode === "disposable") && mode !== "prod-readonly" && !confirmedDisposable && mode !== "all-dry") {
    console.log("Refusing to run disposable-mode cases without --confirm-disposable (see header comment). Pass --confirm-disposable only against a genuinely throwaway database.");
  }
  let pass = 0, fail = 0, skipped = 0;
  for (const c of selected) {
    if (c.mode === "disposable" && !confirmedDisposable) {
      console.log(`SKIP  ${c.id} (${c.planRef}) — disposable, not confirmed`);
      skipped++;
      continue;
    }
    try {
      const result = await c.run();
      console.log(`OK    ${c.id} (${c.planRef}) — ${result}`);
      pass++;
    } catch (e) {
      console.log(`ERROR ${c.id} (${c.planRef}) — ${e.message?.slice(0, 200) ?? e}`);
      fail++;
    }
  }
  console.log(`\n${pass} ok, ${fail} error, ${skipped} skipped, ${selected.length} total.`);
  if (disposableClient) await disposableClient.end();
  process.exit(fail > 0 ? 1 : 0);
}

main();
