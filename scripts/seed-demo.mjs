// Demo harness for settlement/state QA. Creates an isolated "Demo League" with
// 4 demo users (demo1..demo4, password Demo-1234!) and controllable finished
// fixtures — one per representative case — then contests + predictions so a
// cron tick will lock+settle them. Cross-check vs lib/settlement golden tests.
//
//   node --env-file=.env.local scripts/seed-demo.mjs setup
//   node --env-file=.env.local scripts/seed-demo.mjs check
//   node --env-file=.env.local scripts/seed-demo.mjs cleanup
//
// Demo users have must_change_password=false (browser login lands straight in app).

import { createClient } from "@supabase/supabase-js";
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false }, db: { schema: "cashford" } });
const mode = process.argv[2] ?? "setup";

const USERS = ["demo1", "demo2", "demo3", "demo4"]; // d1..d4
const PW = "Demo-1234!";
const SLUG = "demo-league";
const EXT_BASE = 990000;

// Each case: fixture result + the 4 users' picks (null = didn't enter). KO has advancer.
// outcome h/d/a; score [home,away]. Verified against golden tests.
const CASES = [
  { key: "C1 1-winner",  ko: false, ft: [2, 0], picks: { demo1: ["h", 2, 1], demo2: ["a", 0, 1], demo3: ["d", 1, 1], demo4: ["a", 1, 2] } },
  { key: "C3 2v2",       ko: false, ft: [2, 0], picks: { demo1: ["h", 1, 0], demo2: ["h", 2, 0], demo3: ["a", 0, 1], demo4: ["d", 1, 1] } },
  { key: "C13 draw",     ko: false, ft: [1, 1], picks: { demo1: ["d", 1, 1], demo2: ["h", 2, 1], demo3: ["a", 0, 1], demo4: ["d", 0, 0] } },
  { key: "C2 rounding",  ko: false, ft: [2, 0], picks: { demo1: ["h", 1, 0], demo2: ["h", 2, 0], demo3: ["h", 3, 0], demo4: ["a", 0, 1] } },
  { key: "void insuff",  ko: false, ft: [1, 0], picks: { demo1: ["h", 1, 0] } },
  { key: "not_entered",  ko: false, ft: [1, 0], picks: { demo1: ["h", 2, 1], demo2: ["h", 1, 0], demo3: ["a", 0, 1] } },
  { key: "KO advance",   ko: true,  ft: [1, 1], adv: "home", picks: { demo1: ["h", 1, 1], demo2: ["a", 0, 1], demo3: ["h", 2, 0], demo4: ["a", 1, 2] } },
];
const OUT = { h: "home", d: "draw", a: "away" };

async function userId(uname) {
  const { data } = await admin.auth.admin.listUsers({ perPage: 200 });
  return data.users.find((u) => u.email === `${uname}@cashford.internal`)?.id;
}

if (mode === "cleanup") {
  const { data: lg } = await admin.from("leagues").select("id").eq("slug", SLUG).maybeSingle();
  if (lg) {
    const { data: cs } = await admin.from("contests").select("id").eq("league_id", lg.id);
    const ids = (cs ?? []).map((c) => c.id);
    if (ids.length) {
      await admin.from("transfers").delete().in("contest_id", ids);
      await admin.from("contest_results").delete().in("contest_id", ids);
      await admin.from("predictions").delete().in("contest_id", ids);
      await admin.from("contest_audit_log").delete().in("contest_id", ids);
      await admin.from("contests").delete().in("id", ids);
    }
    await admin.from("league_members").delete().eq("league_id", lg.id);
    await admin.from("leagues").delete().eq("id", lg.id);
  }
  await admin.from("fixtures").delete().gte("external_id", EXT_BASE);
  for (const u of USERS) { const id = await userId(u); if (id) await admin.auth.admin.deleteUser(id); }
  console.log("cleanup: done");
  process.exit(0);
}

if (mode === "check") {
  const { data: lg } = await admin.from("leagues").select("id").eq("slug", SLUG).single();
  const { data: cs } = await admin.from("contests").select("id, status, void_reason, fixtures(external_id)").eq("league_id", lg.id);
  const ids = {};
  for (const u of USERS) ids[await userId(u)] = u;
  for (const c of cs.sort((a, b) => a.fixtures.external_id - b.fixtures.external_id)) {
    const { data: rs } = await admin.from("contest_results").select("user_id, result, net_inr").eq("contest_id", c.id);
    const nets = (rs ?? []).map((r) => `${ids[r.user_id]}:${r.net_inr}`).join(" ");
    const sum = (rs ?? []).reduce((t, r) => t + r.net_inr, 0);
    console.log(`#${c.fixtures.external_id - EXT_BASE} ${c.status}${c.void_reason ? "(" + c.void_reason + ")" : ""}  ${nets}  Σ=${sum}`);
  }
  process.exit(0);
}

// setup
const idmap = {};
for (const u of USERS) {
  let id = await userId(u);
  if (!id) {
    const { data } = await admin.auth.admin.createUser({ email: `${u}@cashford.internal`, password: PW, email_confirm: true, user_metadata: { username: u, display_name: u.toUpperCase(), is_admin: false, must_change_password: false } });
    id = data.user.id;
  }
  idmap[u] = id;
}
const { data: lg } = await admin.from("leagues").upsert({ name: "Demo League", slug: SLUG, default_stake_inr: 500 }, { onConflict: "slug" }).select("id").single();
for (const u of USERS) await admin.from("league_members").upsert({ league_id: lg.id, user_id: idmap[u] }, { onConflict: "league_id,user_id" });

const past = (mins) => new Date(Date.now() - mins * 60000).toISOString();
for (let i = 0; i < CASES.length; i++) {
  const cse = CASES[i];
  const ext = EXT_BASE + i + 1;
  const { data: fx } = await admin.from("fixtures").upsert({
    external_id: ext, round: cse.ko ? "r32" : "group", is_knockout: cse.ko,
    home_label: `Demo ${i + 1} Home`, away_label: `Demo ${i + 1} Away`,
    kickoff_at: past(60), status: "finished", status_detail: cse.ko ? "PEN" : "FT",
    ft_home: cse.ft[0], ft_away: cse.ft[1],
    ...(cse.ko ? { pen_home: 4, pen_away: 3 } : {}),
  }, { onConflict: "external_id" }).select("id, home_team_id, away_team_id").single();
  // advancer for KO: we have no real teams, so set advancer_team_id null but encode side via a sentinel?
  // settle() needs advancer side; with null team ids we can't store advancer_team_id. So for KO demo,
  // set home_team_id/away_team_id to a shared demo team and advancer accordingly.
  if (cse.ko) {
    const { data: dt } = await admin.from("teams").upsert([{ external_id: 999001, name: "Demo Home", short_name: "DMH" }, { external_id: 999002, name: "Demo Away", short_name: "DMA" }], { onConflict: "external_id" }).select("id, external_id");
    const home = dt.find((t) => t.external_id === 999001).id, away = dt.find((t) => t.external_id === 999002).id;
    await admin.from("fixtures").update({ home_team_id: home, away_team_id: away, advancer_team_id: cse.adv === "home" ? home : away }).eq("id", fx.id);
  }
  const { data: contest } = await admin.from("contests").upsert({ league_id: lg.id, fixture_id: fx.id, stake_inr: 500, status: "open", lock_at: past(30), is_knockout: cse.ko }, { onConflict: "league_id,fixture_id" }).select("id").single();
  await admin.from("predictions").delete().eq("contest_id", contest.id);
  for (const [u, pk] of Object.entries(cse.picks)) {
    await admin.from("predictions").insert({ contest_id: contest.id, user_id: idmap[u], outcome: OUT[pk[0]], pred_home: pk[1], pred_away: pk[2] });
  }
  console.log(`set up #${i + 1} ${cse.key}`);
}
console.log("\nDemo League ready. Trigger settlement: GET /api/cron/tick?secret=...  Then `check`.");
console.log("Browser login: demo1 / Demo-1234!");
