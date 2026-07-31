// Phase-1 gate: two-user RLS check for knockout_predictions / knockout_brackets.
// Verifies no-peek + write/lock/delete gates at the WIRE (not just in the UI).
// Self-contained: sets up isolated qa users + a league, runs assertions, tears down.
// Namespaced zz-qa-ko* / qako* — NEVER touches the 3 real leagues.
//
//   node --env-file=.env.local scripts/qa-knockout-verify.mjs [setup|verify|cleanup]
//   (no arg = setup → verify → cleanup)

import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const svcKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const svc = createClient(url, svcKey, { auth: { persistSession: false }, db: { schema: "cashford" } });
const anonClient = () => createClient(url, anonKey, { auth: { persistSession: false }, db: { schema: "cashford" } });

const LEAGUE = "zz-qa-ko";
const USERS = [
  { email: "qako1@cashford.internal", username: "qako1" },
  { email: "qako2@cashford.internal", username: "qako2" },
];
const PW = "Qa-1234!";
const TID = "wc2026";

let pass = 0,
  fail = 0;
const ok = (label, cond, extra = "") => {
  console.log(`${cond ? "✓" : "✗ FAIL"} ${label}${extra ? "  — " + extra : ""}`);
  cond ? pass++ : fail++;
};

async function ensureUser(email, username) {
  const { data: list } = await svc.auth.admin.listUsers({ page: 1, perPage: 1000 });
  let u = list.users.find((x) => x.email === email);
  if (!u) {
    const { data, error } = await svc.auth.admin.createUser({
      email,
      password: PW,
      email_confirm: true,
      user_metadata: { username, must_change_password: false },
    });
    if (error) throw new Error(`createUser ${email}: ${error.message}`);
    u = data.user;
  } else {
    await svc.auth.admin.updateUserById(u.id, { password: PW, user_metadata: { username, must_change_password: false } });
  }
  return u.id;
}

async function setup() {
  const ids = [];
  for (const { email, username } of USERS) ids.push(await ensureUser(email, username));
  // profiles are mirrored by the on_auth_user_created trigger; ensure they exist
  for (let i = 0; i < ids.length; i++) {
    await svc.from("profiles").upsert({ id: ids[i], username: USERS[i].username }, { onConflict: "id" });
  }
  // league + memberships (both users in the same league → leaguemates)
  const { data: lg } = await svc
    .from("leagues")
    .upsert({ name: "ZZ QA Knockout", slug: LEAGUE, default_stake_inr: 50, created_by: ids[0] }, { onConflict: "slug" })
    .select("id")
    .single();
  for (const id of ids) await svc.from("league_members").upsert({ league_id: lg.id, user_id: id }, { onConflict: "league_id,user_id" });
  console.log(`setup: users ${ids.join(", ")} in league ${lg.id}`);
  return { ids, leagueId: lg.id };
}

async function pickFixtures() {
  // a clearly-future knockout fixture (both teams resolved) + a finished one
  const { data: fx } = await svc
    .from("fixtures")
    .select("id, external_id, kickoff_at, home_team_id, away_team_id, advancer_team_id, status")
    .eq("is_knockout", true);
  const now = Date.now();
  const future = fx
    .filter((f) => f.home_team_id && f.away_team_id && new Date(f.kickoff_at).getTime() > now + 3600e3)
    .sort((a, b) => new Date(a.kickoff_at) - new Date(b.kickoff_at))[0];
  const past = fx.filter((f) => new Date(f.kickoff_at).getTime() < now - 3600e3 && f.advancer_team_id)[0];
  return { future, past };
}

async function verify() {
  const { data: lg } = await svc.from("leagues").select("id").eq("slug", LEAGUE).single();
  const { data: members } = await svc.from("league_members").select("user_id").eq("league_id", lg.id);
  const { data: list } = await svc.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const uid = (email) => list.users.find((u) => u.email === email).id;
  const id1 = uid(USERS[0].email);
  const id2 = uid(USERS[1].email);
  ok("both qa users are leaguemates", members.some((m) => m.user_id === id1) && members.some((m) => m.user_id === id2));

  const { future, past } = await pickFixtures();
  ok("found a future + finished knockout fixture", !!future && !!past, `future=${future?.external_id} past=${past?.external_id}`);
  if (!future || !past) return;

  // clean any prior test rows for these users
  await svc.from("knockout_predictions").delete().in("user_id", [id1, id2]);
  await svc.from("knockout_brackets").delete().in("user_id", [id1, id2]);

  const c1 = anonClient();
  await c1.auth.signInWithPassword({ email: USERS[0].email, password: PW });

  // 1. qa1 writes a pick for a FUTURE fixture (allowed)
  const futureTeam = future.home_team_id;
  const { error: w1 } = await c1.from("knockout_predictions").insert({
    user_id: id1, tournament_id: TID, slot_key: "1:0", fixture_id: future.id, predicted_team_id: futureTeam,
  });
  ok("qa1 CAN write a pick for a future-kickoff slot", !w1, w1?.message ?? "");

  // 2. qa1 CANNOT write a pick for a PAST (kicked-off) fixture
  const { error: w2 } = await c1.from("knockout_predictions").insert({
    user_id: id1, tournament_id: TID, slot_key: "1:1", fixture_id: past.id, predicted_team_id: past.advancer_team_id,
  });
  ok("qa1 CANNOT write a pick after kickoff (RLS rejects)", !!w2, w2 ? "blocked" : "LEAK: write allowed");

  // 3. qa1 CANNOT write into another user's row
  const { error: w3 } = await c1.from("knockout_predictions").insert({
    user_id: id2, tournament_id: TID, slot_key: "1:2", fixture_id: future.id, predicted_team_id: futureTeam,
  });
  ok("qa1 CANNOT write a row for another user", !!w3, w3 ? "blocked" : "LEAK");

  // 4. NO-PEEK: qa2 (leaguemate) CANNOT read qa1's undecided (future) pick
  const c2 = anonClient();
  await c2.auth.signInWithPassword({ email: USERS[1].email, password: PW });
  const { data: peek } = await c2.from("knockout_predictions").select("id").eq("user_id", id1).eq("fixture_id", future.id);
  ok("no-peek: leaguemate CANNOT see an undecided pick", (peek?.length ?? 0) === 0, `saw ${peek?.length ?? 0} rows`);

  // 5. REVEAL: a pick on an already-kicked-off fixture IS visible to a leaguemate.
  //    (service-role seeds it, since the write gate forbids inserting a past-kickoff pick.)
  await svc.from("knockout_predictions").insert({
    user_id: id1, tournament_id: TID, slot_key: "1:3", fixture_id: past.id, predicted_team_id: past.advancer_team_id,
  });
  const { data: reveal } = await c2.from("knockout_predictions").select("id").eq("user_id", id1).eq("fixture_id", past.id);
  ok("reveal: leaguemate CAN see a pick after its match kicked off", (reveal?.length ?? 0) === 1, `saw ${reveal?.length ?? 0} rows`);

  // 6. LOCK gate: with a locked bracket header, qa1 cannot delete/insert picks.
  await svc.from("knockout_brackets").upsert(
    { user_id: id1, tournament_id: TID, locked_at: new Date().toISOString() },
    { onConflict: "user_id,tournament_id" },
  );
  const { error: wLocked } = await c1.from("knockout_predictions").insert({
    user_id: id1, tournament_id: TID, slot_key: "2:0", fixture_id: future.id, predicted_team_id: futureTeam,
  });
  ok("locked bracket blocks new picks (RLS)", !!wLocked, wLocked ? "blocked" : "LEAK: write while locked");
  const { data: delLocked } = await c1.from("knockout_predictions").delete().eq("user_id", id1).eq("slot_key", "1:0").select("id");
  ok("locked bracket blocks deletes (RLS)", (delLocked?.length ?? 0) === 0, `deleted ${delLocked?.length ?? 0}`);

  // 7. UNLOCK: clearing locked_at re-enables editing own future picks.
  await svc.from("knockout_brackets").update({ locked_at: null }).eq("user_id", id1).eq("tournament_id", TID);
  const { data: delOk } = await c1.from("knockout_predictions").delete().eq("user_id", id1).eq("slot_key", "1:0").select("id");
  ok("after unlock, qa1 CAN delete own future pick", (delOk?.length ?? 0) === 1, `deleted ${delOk?.length ?? 0}`);

  // 8. qa1 CANNOT delete a past-kickoff pick (would rewrite history)
  const { data: delPast } = await c1.from("knockout_predictions").delete().eq("user_id", id1).eq("slot_key", "1:3").select("id");
  ok("qa1 CANNOT delete a kicked-off pick", (delPast?.length ?? 0) === 0, `deleted ${delPast?.length ?? 0}`);

  // 9. knockout_brackets: leaguemate cannot read qa1's header (owner-only select)
  const { data: bpeek } = await c2.from("knockout_brackets").select("id").eq("user_id", id1);
  ok("bracket header is owner-only (leaguemate sees none)", (bpeek?.length ?? 0) === 0, `saw ${bpeek?.length ?? 0}`);

  // 10. MEMBERSHIP gate: a user in NO league cannot write picks. Remove qa1 from the
  //     league, attempt a future-slot insert (expect reject), then restore membership.
  await svc.from("league_members").delete().eq("league_id", lg.id).eq("user_id", id1);
  const { error: wNoLeague } = await c1.from("knockout_predictions").insert({
    user_id: id1, tournament_id: TID, slot_key: "2:1", fixture_id: future.id, predicted_team_id: futureTeam,
  });
  ok("non-member CANNOT write picks (membership gate)", !!wNoLeague, wNoLeague ? "blocked" : "LEAK: non-member wrote");
  await svc.from("league_members").upsert({ league_id: lg.id, user_id: id1 }, { onConflict: "league_id,user_id" });

  // cleanup test rows
  await svc.from("knockout_predictions").delete().in("user_id", [id1, id2]);
  await svc.from("knockout_brackets").delete().in("user_id", [id1, id2]);
}

async function cleanup() {
  const { data: list } = await svc.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const ids = USERS.map((u) => list.users.find((x) => x.email === u.email)?.id).filter(Boolean);
  if (ids.length) {
    await svc.from("knockout_predictions").delete().in("user_id", ids);
    await svc.from("knockout_brackets").delete().in("user_id", ids);
  }
  const { data: lg } = await svc.from("leagues").select("id").eq("slug", LEAGUE).maybeSingle();
  if (lg) {
    await svc.from("league_members").delete().eq("league_id", lg.id);
    await svc.from("leagues").delete().eq("id", lg.id);
  }
  for (const id of ids) await svc.auth.admin.deleteUser(id).catch(() => {});
  console.log("cleanup: removed zz-qa-ko league + qako users + test rows");
}

const mode = process.argv[2] ?? "all";
try {
  if (mode === "setup") await setup();
  else if (mode === "verify") await verify();
  else if (mode === "cleanup") await cleanup();
  else {
    await setup();
    await verify();
    await cleanup();
  }
  console.log(`\n${fail === 0 ? "ALL PASS" : "FAILURES"}: ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
} catch (e) {
  console.error("ERROR:", e.message);
  process.exit(1);
}
