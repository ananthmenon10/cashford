// Phase 2 integration smoke (plan §6 "Integration", §8 step 5). One golden scenario end to
// end against the REAL database, on throwaway data only, with ordered cleanup.
//
//   node --env-file=.env.local scripts/verify-phase2.mjs
//   node --env-file=.env.local scripts/verify-phase2.mjs --keep     # skip cleanup for a poke-around
//
// Scenario: 5 members in a scratch league on a scratch competition · 4 enter, 1 skips · a
// fixture is added so the enterers go needs_update · 3 resolve, 1 does not and becomes invalid
// at the deadline · scripted scores land · the worker settles · transfers, per-entry results
// and the Dues aggregation are checked · a score revision flips the winner · the worker
// re-settles, reversing the old transfers · Σ non-reversed net is still 0 · a non-entrant
// league member can see everyone's picks after the deadline.
//
// SAFETY: every row this script creates is under a `zz-p2-<runid>` name/slug, on its OWN
// competition and its OWN fixtures, so it never writes to the World Cup fixtures, the PL
// fixtures the real leagues will play, or any real league. It asserts that before it starts
// and again before it deletes. There is no separate staging DB (see CLAUDE.md), which is
// exactly why the scratch competition exists.

import { createClient } from "@supabase/supabase-js";
import { registerHooks } from "node:module";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

// The worker under test is TypeScript and imports its siblings without a file extension, which
// node's type-stripping resolver does not do. One resolve hook, then a dynamic import — the
// alternative is a second copy of the dispatcher here, which would test nothing.
registerHooks({
  resolve(spec, ctx, next) {
    if (spec.startsWith(".") && !/\.[cm]?[jt]s$/.test(spec)) {
      const candidate = new URL(spec + ".ts", ctx.parentURL);
      if (existsSync(fileURLToPath(candidate))) return { url: candidate.href, shortCircuit: true };
    }
    return next(spec, ctx);
  },
});
const { dispatchGameweekSettlements, leagueNetByUser } = await import("../lib/gameweek-db.ts");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const svcKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !anonKey || !svcKey) {
  console.error("missing env: run with --env-file=.env.local");
  process.exit(1);
}

const REAL_LEAGUES = ["Solid Yenne Boys", "KK Bois", "PES Bois"];
const KEEP = process.argv.includes("--keep");
const RUN = Date.now().toString(36);
const TAG = `zz-p2-${RUN}`;
const PW = "Zz-P2-verify!1";

const svc = createClient(url, svcKey, { auth: { persistSession: false }, db: { schema: "cashford" } });

let failures = 0;
const ok = (label, cond, extra = "") => {
  if (!cond) failures++;
  console.log(`${cond ? "✓" : "✗ FAIL"} ${label}${extra ? "  — " + extra : ""}`);
};
const eq = (label, got, want) => ok(label, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
const must = async (label, p) => {
  const { data, error } = await p;
  if (error) throw new Error(`${label}: ${error.message}`);
  return data;
};

// A logged-in client per member, so auth.uid() inside the routines is the real user — the
// service role would bypass exactly the checks worth testing.
async function session(email) {
  const c = createClient(url, anonKey, { auth: { persistSession: false }, db: { schema: "cashford" } });
  const { error } = await c.auth.signInWithPassword({ email, password: PW });
  if (error) throw new Error(`sign in ${email}: ${error.message}`);
  return c;
}

const ids = { users: [], fixtures: [], gameweeks: [], competitions: [] };

// ---------------------------------------------------------------------------
// Preflight
// ---------------------------------------------------------------------------
{
  const { error } = await svc.rpc("claim_gameweek_settlement", {
    p_contest_id: "00000000-0000-0000-0000-000000000000",
  });
  if (error && /does not exist|schema cache/i.test(error.message)) {
    console.error("Phase 2 migration 20260727000002 is not applied to this database — apply it first.");
    process.exit(2);
  }
}

try {
  // -------------------------------------------------------------------------
  // Setup — scratch competition, gameweek, fixtures, league, members
  // -------------------------------------------------------------------------
  const deadline = new Date(Date.now() + 30 * 60e3); // 30 min out; moved into the past later

  const comp = await must("competition", svc.from("competitions").insert({
    slug: TAG, name: `ZZ Phase2 ${RUN}`, format: "league", season: "verify",
    fpl_source: false, status: "active",
  }).select("id").single());

  const gws = await must("gameweeks", svc.from("gameweeks").insert([
    { competition_id: comp.id, number: 1, name: "ZZ GW1", deadline_at: deadline.toISOString(), status: "upcoming" },
    { competition_id: comp.id, number: 2, name: "ZZ GW2", deadline_at: new Date(Date.now() + 40 * 864e5).toISOString(), status: "upcoming" },
  ]).select("id, number"));
  const gw1 = gws.find((g) => g.number === 1).id;
  ids.gameweeks = gws.map((g) => g.id);

  // Real teams are read-only reference data; the fixtures pointing at them are ours.
  const teams = await must("teams", svc.from("teams").select("id").limit(2));
  const base = 900000 + (Date.now() % 90000);
  const fxRows = [0, 1, 2, 3, 4].map((i) => ({
    external_id: base + i,
    competition_id: comp.id,
    round: "group",
    home_team_id: teams[0].id,
    away_team_id: teams[1].id,
    home_label: `ZZ H${i}`,
    away_label: `ZZ A${i}`,
    kickoff_at: new Date(deadline.getTime() + 60e3).toISOString(),
    status: "scheduled",
  }));
  const fixtures = await must("fixtures", svc.from("fixtures").insert(fxRows).select("id, external_id"));
  fixtures.sort((a, b) => a.external_id - b.external_id);
  ids.fixtures = fixtures.map((f) => f.id);
  const FX = fixtures.map((f) => f.id);

  // Four fixtures at first; the fifth arrives mid-week to drive needs_update.
  await must("gameweek_fixtures", svc.from("gameweek_fixtures").insert(
    FX.slice(0, 4).map((id) => ({ gameweek_id: gw1, fixture_id: id, competition_id: comp.id, state: "active" })),
  ));

  const emails = [1, 2, 3, 4, 5].map((n) => `${TAG}-u${n}@cashford.internal`);
  for (const email of emails) {
    const { data, error } = await svc.auth.admin.createUser({
      email, password: PW, email_confirm: true,
      user_metadata: { username: email.split("@")[0], display_name: email.split("@")[0] },
    });
    if (error) throw new Error(`create ${email}: ${error.message}`);
    ids.users.push(data.user.id);
  }
  const [U1, U2, U3, U4, U5] = ids.users;

  const league = await must("league", svc.from("leagues").insert({
    name: `ZZ-TEST-P2 ${RUN}`, slug: TAG, default_stake_inr: 100, status: "active", created_by: U1,
  }).select("id, name").single());
  ok("scratch league is not a real league", !REAL_LEAGUES.includes(league.name), league.name);

  await must("members", svc.from("league_members").insert(ids.users.map((id) => ({ league_id: league.id, user_id: id }))));
  await must("league_competitions", svc.from("league_competitions").insert({
    league_id: league.id, competition_id: comp.id, status: "active",
  }));
  await must("member_competitions", svc.from("member_competitions").insert(
    ids.users.map((id) => ({ league_id: league.id, user_id: id, competition_id: comp.id })),
  ));

  // Opens GW1, resolves the null eligibility boundaries, provisions the pot.
  const m1 = await must("maintenance open", svc.rpc("run_gameweek_maintenance", { p_competition_id: comp.id }));
  eq("maintenance opened GW1 and provisioned 1 pot", [m1.open_gameweek_id === gw1, m1.pots_provisioned], [true, 1]);

  const pot = await must("pot", svc.from("gameweek_contests")
    .select("id, stake_inr, status, input_version").eq("league_id", league.id).eq("gameweek_id", gw1).single());
  eq("pot open at the league stake", [pot.status, pot.stake_inr], ["open", 100]);

  // -------------------------------------------------------------------------
  // L1/L2 — four enter through the user routines, one skips
  // -------------------------------------------------------------------------
  const S = {};
  for (const [i, email] of emails.entries()) S[ids.users[i]] = await session(email);

  // u1 and u2 differ on one fixture only, so the later revision of that fixture decides the
  // week: 0-0 gives u1 five exacts and the pot; 2-1 gives them to u2. u3 loses either way.
  const PICKS = {
    [U1]: [[1, 0], [2, 1], [0, 0], [0, 0]],
    [U2]: [[1, 0], [2, 1], [0, 0], [2, 1]],
    [U3]: [[0, 1], [0, 0], [3, 3], [0, 3]],
    [U4]: [[2, 2], [1, 3], [1, 4], [3, 0]],
  };
  for (const uid of [U1, U2, U3, U4]) {
    const picks = PICKS[uid].map(([h, a], i) => ({ fixtureId: FX[i], predHome: h, predAway: a }));
    const r = await must(`enter ${uid.slice(0, 8)}`, S[uid].rpc("enter_gameweek", {
      p_league_id: league.id, p_gameweek_id: gw1,
      p_picks: picks.map((p) => ({ fixture_id: p.fixtureId, pred_home: p.predHome, pred_away: p.predAway })),
    }));
    ok(`entry written for ${uid.slice(0, 8)}`, r.picks === 4 && r.status === "entered", JSON.stringify(r));
  }
  const { count: entered } = await svc.from("gameweek_entries")
    .select("id", { count: "exact", head: true }).eq("gameweek_contest_id", pot.id);
  eq("4 entries, u5 skipped", entered, 4);

  // A fifth fixture joins the gameweek: every entry is now incomplete (L8).
  await must("add 5th fixture", svc.from("gameweek_fixtures").insert({
    gameweek_id: gw1, fixture_id: FX[4], competition_id: comp.id, state: "active",
  }));
  await must("refresh completeness", svc.rpc("refresh_entry_completeness", { p_gameweek_id: gw1 }));
  const afterAdd = await must("statuses", svc.from("gameweek_entries")
    .select("user_id, status").eq("gameweek_contest_id", pot.id));
  eq("all 4 entries went needs_update", afterAdd.filter((e) => e.status === "needs_update").length, 4);

  // Three answer the addition; u4 never does.
  const EXTRA = { [U1]: [1, 0], [U2]: [1, 0], [U3]: [4, 4] };
  for (const uid of [U1, U2, U3]) {
    const picks = [...PICKS[uid], EXTRA[uid]].map(([h, a], i) => ({
      fixture_id: FX[i], pred_home: h, pred_away: a,
    }));
    const r = await must(`edit ${uid.slice(0, 8)}`, S[uid].rpc("update_gameweek_picks", {
      p_league_id: league.id, p_gameweek_id: gw1, p_picks: picks,
    }));
    ok(`${uid.slice(0, 8)} resolved to 5 picks`, r.picks === 5 && r.status === "entered", JSON.stringify(r));
  }

  // An edit from someone who never entered must fail rather than create an entry.
  {
    const { error } = await S[U5].rpc("update_gameweek_picks", {
      p_league_id: league.id, p_gameweek_id: gw1,
      p_picks: [{ fixture_id: FX[0], pred_home: 1, pred_away: 0 }],
    });
    ok("edit without an entry is refused", !!error, error?.message ?? "no error");
  }

  // -------------------------------------------------------------------------
  // L3 — the deadline passes
  // -------------------------------------------------------------------------
  const past = new Date(Date.now() - 60e3).toISOString();
  await must("move gw deadline", svc.from("gameweeks").update({ deadline_at: past }).eq("id", gw1));
  await must("move pot deadline", svc.from("gameweek_contests").update({ deadline_at: past }).eq("id", pot.id));

  {
    const { error } = await S[U1].rpc("update_gameweek_picks", {
      p_league_id: league.id, p_gameweek_id: gw1,
      p_picks: PICKS[U1].concat([EXTRA[U1]]).map(([h, a], i) => ({ fixture_id: FX[i], pred_home: h, pred_away: a })),
    });
    ok("editing after the deadline is refused", !!error, error?.message ?? "no error");
  }

  const m2 = await must("maintenance lock", svc.rpc("run_gameweek_maintenance", { p_competition_id: comp.id }));
  eq("3 locked in, 1 invalid, no W1 void", [m2.entries_locked_in, m2.entries_invalid, m2.w1_voids], [3, 1, 0]);

  // -------------------------------------------------------------------------
  // Scores land, the worker settles
  // -------------------------------------------------------------------------
  const RESULTS = [[1, 0], [2, 1], [0, 0], [0, 0], [1, 0]];
  for (const [i, [h, a]] of RESULTS.entries()) {
    const r = await must(`score fx${i}`, svc.rpc("apply_score_update", {
      p_fixture_id: FX[i], p_home: h, p_away: a, p_source: "espn", p_status: "finished",
    }));
    ok(`fx${i} score applied`, r.applied === true, JSON.stringify(r));
  }

  const d1 = await dispatchGameweekSettlements(svc);
  ok("worker settled the pot", d1.settled >= 1, JSON.stringify(d1.detail));

  const res1 = await must("result", svc.from("gameweek_results")
    .select("outcome, pot_inr, tiebreak_used, settled_version").eq("gameweek_contest_id", pot.id).single());
  eq("settled, pot = 3 × ₹100", [res1.outcome, res1.pot_inr], ["settled", 300]);

  const er1 = await must("entry results", svc.from("gameweek_entry_results")
    .select("net_inr, is_winner, points, gameweek_entries!gameweek_entry_results_entry_id_fkey!inner(user_id)").eq("gameweek_contest_id", pot.id));
  eq("3 per-entry result rows", er1.length, 3);
  eq("Σ net = 0", er1.reduce((t, r) => t + r.net_inr, 0), 0);
  const netOf = (rows, uid) => rows.find((r) => r.gameweek_entries.user_id === uid)?.net_inr;
  eq("u1 won ₹200, u2 and u3 paid ₹100 each",
    [netOf(er1, U1), netOf(er1, U2), netOf(er1, U3)], [200, -100, -100]);
  ok("u4's invalid entry has no result row", er1.length === 3 && netOf(er1, U4) === undefined);

  const tr1 = await must("transfers", svc.from("transfers")
    .select("from_user_id, to_user_id, amount_inr, reversed").eq("gameweek_contest_id", pot.id));
  eq("2 live transfers, none reversed", [tr1.length, tr1.filter((t) => t.reversed).length], [2, 0]);
  ok("every transfer pays the winner", tr1.every((t) => t.to_user_id === U1 && t.amount_inr === 100));

  // Dues: the gameweek money shows up in the same aggregation as the legacy cup money. This is
  // the only place the PostgREST embed is exercised for real — gameweek_entry_results has two
  // foreign keys to gameweek_entries, so an unhinted embed comes back as an ambiguity error and
  // the whole gameweek side of Dues would read as ₹0.
  const duesProbe = await svc
    .from("gameweek_entry_results")
    .select("net_inr, gameweek_entries!gameweek_entry_results_entry_id_fkey!inner(user_id, league_id)")
    .eq("gameweek_entries.league_id", league.id);
  ok("the Dues embed resolves against the live schema", !duesProbe.error,
    duesProbe.error?.message ?? "");
  ok("the Dues embed returns the settled gameweek rows",
    (duesProbe.data ?? []).length === 3 && (duesProbe.data ?? []).some((r) => r.net_inr !== 0),
    JSON.stringify(duesProbe.data));

  const dues1 = await leagueNetByUser(svc, league.id, ids.users);
  if (dues1 === "suppressed") throw new Error("dues were suppressed after the first settlement");
  eq("dues match the entry results", [dues1[U1], dues1[U2], dues1[U3], dues1[U4], dues1[U5]], [200, -100, -100, 0, 0]);
  eq("dues sum to zero", Object.values(dues1).reduce((a, b) => a + b, 0), 0);

  // -------------------------------------------------------------------------
  // A revision flips the winner → re-settle with reversal (M5)
  // -------------------------------------------------------------------------
  const rev = await must("revise fx3", svc.rpc("apply_score_update", {
    p_fixture_id: FX[3], p_home: 2, p_away: 1, p_source: "espn", p_status: "finished",
  }));
  eq("revision bumped the pot", [rev.applied, rev.score_changed, rev.contests_bumped], [true, true, 1]);

  const d2 = await dispatchGameweekSettlements(svc);
  ok("worker re-settled the dirty pot", d2.settled >= 1, JSON.stringify(d2.detail));

  const res2 = await must("result 2", svc.from("gameweek_results")
    .select("outcome, settled_version, last_settle_cause").eq("gameweek_contest_id", pot.id).single());
  ok("consumed version advanced", res2.settled_version > res1.settled_version,
    `${res1.settled_version} → ${res2.settled_version}`);
  eq("cause recorded as a result revision", res2.last_settle_cause, "result_revision");

  const tr2 = await must("transfers 2", svc.from("transfers")
    .select("from_user_id, to_user_id, amount_inr, reversed").eq("gameweek_contest_id", pot.id));
  const live = tr2.filter((t) => !t.reversed);
  eq("the first settlement's transfers are reversed, not deleted",
    [tr2.length, tr2.filter((t) => t.reversed).length], [4, 2]);
  ok("the new winner is u2", live.length === 2 && live.every((t) => t.to_user_id === U2), JSON.stringify(live));

  const er2 = await must("entry results 2", svc.from("gameweek_entry_results")
    .select("net_inr, is_winner, gameweek_entries!gameweek_entry_results_entry_id_fkey!inner(user_id)").eq("gameweek_contest_id", pot.id));
  eq("Σ net still 0 after re-settlement", er2.reduce((t, r) => t + r.net_inr, 0), 0);
  eq("u2 now collects", [netOf(er2, U1), netOf(er2, U2), netOf(er2, U3)], [-100, 200, -100]);

  const dues2 = await leagueNetByUser(svc, league.id, ids.users);
  if (dues2 === "suppressed") throw new Error("dues were suppressed after re-settlement");
  eq("dues follow the re-settlement", [dues2[U1], dues2[U2], dues2[U3]], [-100, 200, -100]);

  const audit = await must("audit", svc.from("gameweek_audit_log")
    .select("action, cause, input_version").eq("gameweek_contest_id", pot.id).order("input_version"));
  ok("audit chain records both settlements", audit.filter((a) => a.action === "settle").length >= 2,
    JSON.stringify(audit.map((a) => `${a.action}/${a.cause}@${a.input_version}`)));

  // A second dispatch with nothing dirty must not write again.
  const d3 = await dispatchGameweekSettlements(svc);
  eq("a clean pot is not re-settled", d3.settled, 0);
  const { count: trCount } = await svc.from("transfers")
    .select("id", { count: "exact", head: true }).eq("gameweek_contest_id", pot.id);
  eq("transfer count unchanged by the idle pass", trCount, 4);

  // -------------------------------------------------------------------------
  // Visibility end-state (RLS): picks are public inside the league after the deadline
  // -------------------------------------------------------------------------
  const seen = await must("u5 reads picks", S[U5].from("gameweek_picks").select("entry_id").eq("gameweek_id", gw1));
  eq("a non-entrant member sees all 19 picks after the deadline", seen.length, 19);

  const strangerPot = await S[U5].from("gameweek_contests").select("id").eq("id", pot.id).maybeSingle();
  ok("league members can read their own pot", strangerPot.data?.id === pot.id);

  // -------------------------------------------------------------------------
  // Reconciliation shapes that bump NO active membership (P1-P13/P17/P35/P37).
  // These all leave the L8 touched-gameweek list empty — the shape that used to
  // abort the whole reconciliation transaction on a null FOREACH expression.
  // Needs its own fpl_source competition; the scenario one above is not FPL-sourced.
  // -------------------------------------------------------------------------
  const fplComp = await must("fpl competition", svc.from("competitions").insert({
    slug: `${TAG}-fpl`, name: `ZZ Phase2 FPL ${RUN}`, format: "league", season: "verify",
    fpl_source: true, status: "active",
  }).select("id").single());
  ids.competitions.push(fplComp.id);

  const rgws = await must("fpl gameweeks", svc.from("gameweeks").insert([
    // GW3 open with a live deadline; GW5 locked, so it is a frozen destination.
    { competition_id: fplComp.id, number: 3, name: "ZZ R GW3", fpl_event_id: 3,
      deadline_at: new Date(Date.now() + 2 * 864e5).toISOString(), status: "open" },
    { competition_id: fplComp.id, number: 5, name: "ZZ R GW5", fpl_event_id: 5,
      deadline_at: new Date(Date.now() - 2 * 864e5).toISOString(), status: "locked" },
  ]).select("id, number"));
  const rgw3 = rgws.find((g) => g.number === 3).id;
  const rgw5 = rgws.find((g) => g.number === 5).id;
  ids.gameweeks.push(rgw3, rgw5);

  const rbase = base + 50;
  const rfx = await must("fpl fixtures", svc.from("fixtures").insert([0, 1, 2].map((i) => ({
    competition_id: fplComp.id, fpl_fixture_id: rbase + i, round: "group",
    home_team_id: teams[0].id, away_team_id: teams[1].id,
    home_label: `ZZ RH${i}`, away_label: `ZZ RA${i}`,
    kickoff_at: new Date(Date.now() + 3 * 864e5).toISOString(), status: "scheduled",
  }))).select("id, fpl_fixture_id"));
  rfx.sort((a, b) => a.fpl_fixture_id - b.fpl_fixture_id);
  const [RA, RB, RC] = rfx.map((f) => f.id);
  ids.fixtures.push(RA, RB, RC);

  await must("fpl memberships", svc.from("gameweek_fixtures").insert([
    { gameweek_id: rgw3, fixture_id: RB, competition_id: fplComp.id, state: "active", is_current: true },
    { gameweek_id: rgw5, fixture_id: RC, competition_id: fplComp.id, state: "excluded", is_current: true },
  ]));

  const kick = new Date(Date.now() + 3 * 864e5).toISOString();
  const recon = (fplFixtureId, fplEventId) => svc.rpc("apply_fpl_reconciliation", {
    snapshot: {
      competition_slug: `${TAG}-fpl`,
      gameweeks: [],
      fixtures: [{
        fpl_fixture_id: fplFixtureId, fpl_event_id: fplEventId, kickoff_at: kick,
        home_team_id: teams[0].id, away_team_id: teams[1].id,
      }],
    },
  });

  const reconDeadline = (fplEventId, number, name, deadlineAt) => svc.rpc("apply_fpl_reconciliation", {
    snapshot: {
      competition_slug: `${TAG}-fpl`,
      fixtures: [],
      gameweeks: [{ fpl_event_id: fplEventId, number, name, deadline_at: deadlineAt }],
    },
  });

  // P1-P01..P04 — deadline-only batch. Zero fixtures in the snapshot means the membership
  // loop never runs, which is the same empty-touched-list shape by a different route.
  const newDeadline = new Date(Date.now() + 4 * 864e5).toISOString();
  const p01 = await must("P1-P01 deadline-only batch completes", reconDeadline(3, 3, "ZZ R GW3", newDeadline));
  eq("P1-P01 deadline accepted on the open gameweek, no membership touched",
    [p01.deadlines_updated, p01.memberships_moved], [1, 0]);
  const p01row = await must("P1-P01 gameweek", svc.from("gameweeks").select("deadline_at").eq("id", rgw3).single());
  eq("P1-P01 stored deadline moved", new Date(p01row.deadline_at).toISOString(), newDeadline);

  // A frozen gameweek rejects the change and logs it — still must not crash.
  const p02 = await must("P1-P02 frozen deadline batch completes",
    reconDeadline(5, 5, "ZZ R GW5", new Date(Date.now() + 9 * 864e5).toISOString()));
  eq("P1-P02 frozen deadline rejected", p02.deadlines_updated, 0);
  const frozen = await must("P1-P02 sync_issues", svc.from("sync_issues")
    .select("id").eq("kind", "deadline-frozen").eq("ref", rgw5));
  eq("P1-P02 logged one deadline-frozen issue", frozen.length, 1);

  // P1-P13 — never-assigned fixture assigned straight to a locked gameweek.
  const p13 = await must("P1-P13 reconciliation completes", recon(rbase, 5));
  eq("P1-P13 one move, counted as a late assignment",
    [p13.memberships_moved, p13.late_assignments], [1, 1]);
  const p13row = await must("P1-P13 row", svc.from("gameweek_fixtures")
    .select("state, is_current").eq("fixture_id", RA).eq("gameweek_id", rgw5).single());
  eq("P1-P13 lands excluded + is_current", [p13row.state, p13row.is_current], ["excluded", true]);

  // P1-P17 — repeat observation of the fixture's own current gameweek.
  const p17 = await must("P1-P17 reconciliation completes", recon(rbase + 1, 3));
  eq("P1-P17 repeat observation is a no-op", p17.memberships_moved, 0);
  const p17rows = await must("P1-P17 rows", svc.from("gameweek_fixtures").select("id").eq("fixture_id", RB));
  eq("P1-P17 wrote no extra membership row", p17rows.length, 1);

  // P1-P35 — repeat observation of an already-excluded destination.
  const p35 = await must("P1-P35 reconciliation completes", recon(rbase + 2, 5));
  eq("P1-P35 repeat excluded observation is a no-op",
    [p35.memberships_moved, p35.late_assignments], [0, 0]);

  // P1-P37 — excluded → unassigned.
  const p37 = await must("P1-P37 reconciliation completes", recon(rbase + 2, null));
  eq("P1-P37 excluded churn moves the row but bumps nothing",
    [p37.memberships_moved, p37.contests_bumped], [1, 0]);
  const p37row = await must("P1-P37 row", svc.from("gameweek_fixtures")
    .select("state, is_current").eq("fixture_id", RC).eq("gameweek_id", rgw5).single());
  eq("P1-P37 keeps state=excluded and clears is_current",
    [p37row.state, p37row.is_current], ["excluded", false]);
} catch (e) {
  failures++;
  console.log(`✗ FAIL threw — ${e.message}`);
} finally {
  if (KEEP) {
    console.log(`\n(--keep) scratch data left behind under ${TAG}`);
  } else {
    // Ordered cleanup: children before parents, every delete scoped to this run's ids.
    const league = await svc.from("leagues").select("id, name").eq("slug", TAG).maybeSingle();
    const lid = league.data?.id;
    if (lid && REAL_LEAGUES.includes(league.data.name)) throw new Error("refusing to clean a real league");
    const comp = await svc.from("competitions").select("id").eq("slug", TAG).maybeSingle();
    const cid = comp.data?.id;

    if (lid) {
      const pots = (await svc.from("gameweek_contests").select("id").eq("league_id", lid)).data ?? [];
      const potIds = pots.map((p) => p.id);
      const entries = potIds.length
        ? (await svc.from("gameweek_entries").select("id").in("gameweek_contest_id", potIds)).data ?? []
        : [];
      if (potIds.length) {
        await svc.from("transfers").delete().in("gameweek_contest_id", potIds);
        await svc.from("gameweek_audit_log").delete().in("gameweek_contest_id", potIds);
        await svc.from("gameweek_entry_results").delete().in("gameweek_contest_id", potIds);
        await svc.from("gameweek_results").delete().in("gameweek_contest_id", potIds);
      }
      if (entries.length) await svc.from("gameweek_picks").delete().in("entry_id", entries.map((e) => e.id));
      if (potIds.length) await svc.from("gameweek_entries").delete().in("id", entries.map((e) => e.id));
      if (potIds.length) await svc.from("gameweek_contests").delete().in("id", potIds);
      await svc.from("member_competitions").delete().eq("league_id", lid);
      await svc.from("league_members").delete().eq("league_id", lid);
      await svc.from("league_competitions").delete().eq("league_id", lid);
      await svc.from("leagues").delete().eq("id", lid);
    }
    if (ids.fixtures.length) {
      // fixture_moves references the membership rows, so it goes before them.
      await svc.from("fixture_moves").delete().in("fixture_id", ids.fixtures);
      await svc.from("gameweek_fixtures").delete().in("fixture_id", ids.fixtures);
      await svc.from("result_revisions").delete().in("fixture_id", ids.fixtures);
      await svc.from("sync_issues").delete().in("ref", ids.fixtures);
      await svc.from("fixtures").delete().in("id", ids.fixtures);
    }
    // deadline-frozen issues are keyed by gameweek id, not fixture id.
    if (ids.gameweeks.length) await svc.from("sync_issues").delete().in("ref", ids.gameweeks);
    for (const id of [cid, ...ids.competitions].filter(Boolean)) {
      await svc.from("gameweeks").delete().eq("competition_id", id);
      await svc.from("competitions").delete().eq("id", id);
    }
    for (const id of ids.users) await svc.auth.admin.deleteUser(id);
    console.log("\ncleaned up scratch data");
  }
}

console.log(failures === 0 ? "\n✓ Phase 2 integration smoke passed" : `\n✗ ${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
