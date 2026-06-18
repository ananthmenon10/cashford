// Isolated prod test harness. Creates "Test League" + test users + adds ananth,
// with demo fixtures (external_id 980001+) that ESPN never touches — so I can
// MIMIC ESPN by setting their status/score directly and watch state transitions
// without affecting real leagues.
//
//   node --env-file=.env.local scripts/test-harness.mjs setup
//   node --env-file=.env.local scripts/test-harness.mjs mimic <homeLabel> <state> [h] [a] [min]
//        states: 1h | ht | 2h | ft | sched   e.g. mimic Gamma 2h 2 1 70 ; mimic Gamma ft 2 1
//   node --env-file=.env.local scripts/test-harness.mjs cleanup
//
// Test users: testa..testd (password Test-1234!, must_change_password=false).
// ananth is added as a member (view via own login). Drive lock/settle with the
// prod cron tick (curl /api/cron/tick?secret=...).

import { createClient } from "@supabase/supabase-js";
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth:{persistSession:false}, db:{schema:"cashford"} });
const mode = process.argv[2];
const SLUG = "test-league";
const TEST_USERS = ["testa","testb","testc","testd"];
const EXT = { Alpha: 980001, Gamma: 980002 };

const uidOf = async (u) => { const { data } = await admin.auth.admin.listUsers({ perPage:300 }); return data.users.find(x=>x.email===`${u}@cashford.internal`)?.id; };

if (mode === "cleanup") {
  const { data: lg } = await admin.from("leagues").select("id").eq("slug",SLUG).maybeSingle();
  if (lg) {
    const { data: cs } = await admin.from("contests").select("id").eq("league_id",lg.id); const ids=(cs??[]).map(c=>c.id);
    if (ids.length){ await admin.from("transfers").delete().in("contest_id",ids); await admin.from("contest_results").delete().in("contest_id",ids); await admin.from("predictions").delete().in("contest_id",ids); await admin.from("contest_audit_log").delete().in("contest_id",ids); await admin.from("contests").delete().in("id",ids); }
    await admin.from("league_members").delete().eq("league_id",lg.id);
    await admin.from("leagues").delete().eq("id",lg.id);
  }
  await admin.from("fixtures").delete().in("external_id", Object.values(EXT));
  for (const u of TEST_USERS) { const id = await uidOf(u); if (id) await admin.auth.admin.deleteUser(id); }
  console.log("test-league cleaned");
  process.exit(0);
}

if (mode === "mimic") {
  const home = process.argv[3], state = process.argv[4];
  const h = process.argv[5] != null ? parseInt(process.argv[5],10) : null;
  const a = process.argv[6] != null ? parseInt(process.argv[6],10) : null;
  const min = process.argv[7] != null ? parseInt(process.argv[7],10) : null;
  const MAP = {
    "1h": { status:"live", status_detail:"STATUS_FIRST_HALF" },
    "ht": { status:"live", status_detail:"STATUS_HALFTIME", minute:45 },
    "2h": { status:"live", status_detail:"STATUS_SECOND_HALF" },
    "ft": { status:"finished", status_detail:"STATUS_FULL_TIME", finished_at:new Date().toISOString() },
    "sched": { status:"scheduled", status_detail:"STATUS_SCHEDULED" },
  };
  const patch = { ...MAP[state], updated_at:new Date().toISOString() };
  if (h != null) patch.ft_home = h;
  if (a != null) patch.ft_away = a;
  if (min != null) patch.minute = min;
  const { error } = await admin.from("fixtures").update(patch).eq("external_id", EXT[home]);
  console.log(error ? "ERR "+error.message : `mimicked ${home} → ${JSON.stringify(patch)}`);
  process.exit(0);
}

// ---- setup ----
const idmap = {};
for (const u of TEST_USERS) {
  let id = await uidOf(u);
  if (!id) { const { data } = await admin.auth.admin.createUser({ email:`${u}@cashford.internal`, password:"Test-1234!", email_confirm:true, user_metadata:{ username:u, display_name:u.toUpperCase(), must_change_password:false } }); id = data.user.id; }
  idmap[u] = id;
}
idmap.ananth = await uidOf("ananth");
const { data: lg } = await admin.from("leagues").upsert({ name:"Test League", slug:SLUG, default_stake_inr:500 }, { onConflict:"slug" }).select("id").single();
for (const u of [...TEST_USERS, "ananth"]) await admin.from("league_members").upsert({ league_id:lg.id, user_id:idmap[u] }, { onConflict:"league_id,user_id" });

const iso = (mins) => new Date(Date.now() + mins*60000).toISOString();
async function fixture(home, away, kickoffMin) {
  const { data } = await admin.from("fixtures").upsert({ external_id:EXT[home], round:"group", is_knockout:false, home_label:home, away_label:away, kickoff_at:iso(kickoffMin), status:"scheduled", status_detail:"STATUS_SCHEDULED" }, { onConflict:"external_id" }).select("id").single();
  return data.id;
}
async function contest(fid, lockMin) {
  const { data } = await admin.from("contests").upsert({ league_id:lg.id, fixture_id:fid, stake_inr:500, status:"open", lock_at:iso(lockMin), is_knockout:false }, { onConflict:"league_id,fixture_id" }).select("id").single();
  return data.id;
}
async function pred(cid, user, o, h, a) { await admin.from("predictions").upsert({ contest_id:cid, user_id:idmap[user], outcome:o, pred_home:h, pred_away:a, updated_at:new Date().toISOString() }, { onConflict:"contest_id,user_id" }); }

// Fixture Alpha — OPEN (kickoff +180m). testa left unpredicted (to test making a pick).
const fa = await fixture("Alpha","Bravo",180); const ca = await contest(fa, 180);
await pred(ca,"testb","home",1,0); await pred(ca,"testc","away",0,2); await pred(ca,"testd","draw",1,1); await pred(ca,"ananth","home",2,1);
// Fixture Gamma — to be driven live→ft (kickoff -10m so it locks). All 5 predict.
const fg = await fixture("Gamma","Delta",-10); const cg = await contest(fg, -10);
await pred(cg,"testa","home",2,1); await pred(cg,"testb","away",0,1); await pred(cg,"testc","draw",1,1); await pred(cg,"testd","home",1,0); await pred(cg,"ananth","home",2,0);

console.log("Test League ready (members: testa-d + ananth). Login: testa / Test-1234!");
console.log("Alpha = OPEN (testa can pick). Gamma = ready to drive: mimic Gamma 1h 0 0 5 → tick → ...");
