// Single-league QA setup for the home Matches tab (PRD: verify the 1-league path —
// cards with NO "in N leagues" chip, whole-card tap → match page, no expander).
// Creates ONE throwaway league "QA Solo" with two users who belong to ONLY that league,
// open contests for upcoming fixtures, and a few seeded picks so the open/picked/joined
// states render. Never touches real leagues.
//
//   node --env-file=/Users/ananthmenon/AI/projects/cashford/.env.local scripts/qa-solo.mjs setup
//   node --env-file=... scripts/qa-solo.mjs cleanup
//
// qasolo is the single-league test user → log in as qasolo to QC the 1-league view.

import { createClient } from "@supabase/supabase-js";

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false }, db: { schema: "cashford" },
});
const mode = process.argv[2] ?? "setup";

const LEAGUE = { name: "QA Solo", slug: "qa-solo" };
const USERS = ["qasolo", "qasolo2"]; // both ONLY in QA Solo → single-league
const PW = "Qa-1234!";

async function userIdByEmail(email) {
  const { data } = await admin.auth.admin.listUsers({ perPage: 200 });
  return data.users.find((u) => u.email === email)?.id;
}

if (mode === "cleanup") {
  const { data: lg } = await admin.from("leagues").select("id").eq("slug", LEAGUE.slug).maybeSingle();
  if (lg) {
    const { data: cs } = await admin.from("contests").select("id").eq("league_id", lg.id);
    const ids = (cs ?? []).map((c) => c.id);
    if (ids.length) {
      await admin.from("transfers").delete().in("contest_id", ids);
      await admin.from("contest_results").delete().in("contest_id", ids);
      await admin.from("predictions").delete().in("contest_id", ids);
      await admin.from("contest_audit_log").delete().in("contest_id", ids).then(() => {}, () => {});
      await admin.from("contests").delete().in("id", ids);
    }
    await admin.from("league_members").delete().eq("league_id", lg.id);
    await admin.from("leagues").delete().eq("id", lg.id);
  }
  for (const u of USERS) { const id = await userIdByEmail(`${u}@cashford.internal`); if (id) await admin.auth.admin.deleteUser(id); }
  console.log("QA Solo cleanup: done");
  process.exit(0);
}

// --- setup ---
const uid = {};
for (const u of USERS) {
  let id = await userIdByEmail(`${u}@cashford.internal`);
  if (!id) {
    const { data, error } = await admin.auth.admin.createUser({
      email: `${u}@cashford.internal`, password: PW, email_confirm: true,
      user_metadata: { username: u, display_name: u.toUpperCase(), is_admin: false, must_change_password: false },
    });
    if (error) { console.error(`${u}:`, error.message); process.exit(1); }
    id = data.user.id;
  }
  uid[u] = id;
}

const { data: lg } = await admin.from("leagues")
  .upsert({ name: LEAGUE.name, slug: LEAGUE.slug, default_stake_inr: 500 }, { onConflict: "slug" })
  .select("id").single();
for (const u of USERS)
  await admin.from("league_members").upsert({ league_id: lg.id, user_id: uid[u] }, { onConflict: "league_id,user_id" });

const { data: fixDb } = await admin.from("fixtures").select("id, kickoff_at, is_knockout");
const now = Date.now();
const contests = [];
for (const f of fixDb) {
  const lock = new Date(f.kickoff_at).getTime();
  if (lock <= now) continue; // future-lock (open) only
  contests.push({ league_id: lg.id, fixture_id: f.id, stake_inr: 500, status: "open", lock_at: new Date(lock).toISOString(), is_knockout: f.is_knockout });
}
if (contests.length) await admin.from("contests").upsert(contests, { onConflict: "league_id,fixture_id", ignoreDuplicates: true });

// Seed picks so single-league open/picked/joined states render: qasolo2 picks the 3 earliest
// (so qasolo sees "1/2 joined"); qasolo picks just the EARLIEST (→ open_picked single-league card),
// leaving the rest open_nopick (→ "Make pick" + a non-zero "picks due" nudge).
const { data: openContests } = await admin.from("contests")
  .select("id, fixtures(kickoff_at)").eq("league_id", lg.id).eq("status", "open").limit(200);
const sorted = (openContests ?? []).sort((a, b) =>
  new Date((Array.isArray(a.fixtures) ? a.fixtures[0] : a.fixtures).kickoff_at) - new Date((Array.isArray(b.fixtures) ? b.fixtures[0] : b.fixtures).kickoff_at));
for (let i = 0; i < Math.min(3, sorted.length); i++) {
  await admin.from("predictions").upsert(
    { contest_id: sorted[i].id, user_id: uid.qasolo2, outcome: "home", pred_home: 2, pred_away: 1 },
    { onConflict: "contest_id,user_id" });
}
if (sorted.length) {
  await admin.from("predictions").upsert(
    { contest_id: sorted[0].id, user_id: uid.qasolo, outcome: "home", pred_home: 1, pred_away: 0 },
    { onConflict: "contest_id,user_id" });
}

console.log(`QA Solo: ${contests.length} open contests, members=2 (single-league).`);
console.log(`Single-league test login:  qasolo   /  ${PW}`);
console.log(`(co-member for joined counts: qasolo2 / ${PW})`);
