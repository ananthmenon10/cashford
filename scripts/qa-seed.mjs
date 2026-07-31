// QA test environment for preview testing. Creates two throwaway leagues
// (QA Alpha / QA Bravo) with ananth + 3 dummy members, contests for all
// future-lock fixtures, and a few predictions — so the cross-league, predicted-
// fraction, and card-state flows can be exercised WITHOUT touching real leagues.
//
//   node --env-file=/Users/ananthmenon/AI/projects/cashford/.env.local qa-seed.mjs setup
//   node --env-file=... qa-seed.mjs cleanup
//
// Dummy users have must_change_password=false so they can log in if needed.

import { createClient } from "@supabase/supabase-js";

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false }, db: { schema: "cashford" },
});
const mode = process.argv[2] ?? "setup";

const LEAGUES = [
  { name: "QA Alpha", slug: "qa-alpha" },
  { name: "QA Bravo", slug: "qa-bravo" },
];
const DUMMIES = ["qa1", "qa2", "qa3"];
const PW = "Qa-1234!";

async function userIdByEmail(email) {
  const { data } = await admin.auth.admin.listUsers({ perPage: 200 });
  return data.users.find((u) => u.email === email)?.id;
}

if (mode === "cleanup") {
  for (const l of LEAGUES) {
    const { data: lg } = await admin.from("leagues").select("id").eq("slug", l.slug).maybeSingle();
    if (!lg) continue;
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
  for (const u of DUMMIES) { const id = await userIdByEmail(`${u}@cashford.internal`); if (id) await admin.auth.admin.deleteUser(id); }
  console.log("QA cleanup: done");
  process.exit(0);
}

// --- setup ---
const ananthId = await userIdByEmail("ananth@cashford.internal");
if (!ananthId) { console.error("ananth not found"); process.exit(1); }

const dummyId = {};
for (const u of DUMMIES) {
  let id = await userIdByEmail(`${u}@cashford.internal`);
  if (!id) {
    const { data, error } = await admin.auth.admin.createUser({
      email: `${u}@cashford.internal`, password: PW, email_confirm: true,
      user_metadata: { username: u, display_name: u.toUpperCase(), is_admin: false, must_change_password: false },
    });
    if (error) { console.error(`${u}:`, error.message); process.exit(1); }
    id = data.user.id;
  }
  dummyId[u] = id;
}

const { data: fixDb } = await admin.from("fixtures").select("id, kickoff_at, is_knockout");
const now = Date.now();

for (const l of LEAGUES) {
  const { data: lg } = await admin.from("leagues")
    .upsert({ name: l.name, slug: l.slug, default_stake_inr: 500 }, { onConflict: "slug" })
    .select("id").single();
  for (const id of [ananthId, ...Object.values(dummyId)])
    await admin.from("league_members").upsert({ league_id: lg.id, user_id: id }, { onConflict: "league_id,user_id" });

  const contests = [];
  for (const f of fixDb) {
    const lock = new Date(f.kickoff_at).getTime();
    if (lock <= now) continue; // only future-lock (open) contests
    contests.push({ league_id: lg.id, fixture_id: f.id, stake_inr: 500, status: "open", lock_at: new Date(lock).toISOString(), is_knockout: f.is_knockout });
  }
  if (contests.length) await admin.from("contests").upsert(contests, { onConflict: "league_id,fixture_id", ignoreDuplicates: true });

  // Seed a couple of dummy predictions on the EARLIEST open contests so the
  // "X/Y joined" fraction + reveal grid have data. qa1 & qa2 predict; qa3 + ananth don't.
  const { data: openContests } = await admin.from("contests")
    .select("id, is_knockout, fixtures(kickoff_at)")
    .eq("league_id", lg.id).eq("status", "open")
    .order("fixture_id", { ascending: true }).limit(50);
  const sorted = (openContests ?? []).sort((a, b) =>
    new Date((Array.isArray(a.fixtures) ? a.fixtures[0] : a.fixtures).kickoff_at) - new Date((Array.isArray(b.fixtures) ? b.fixtures[0] : b.fixtures).kickoff_at));
  for (const c of sorted.slice(0, 2)) {
    // consistent picks (home 2-1) — non-draw works for KO too
    for (const u of ["qa1", "qa2"]) {
      await admin.from("predictions").upsert(
        { contest_id: c.id, user_id: dummyId[u], outcome: "home", pred_home: 2, pred_away: 1 },
        { onConflict: "contest_id,user_id" });
    }
  }
  console.log(`${l.name}: ${contests.length} new contests, members=4, seeded picks on ${Math.min(2, sorted.length)} open contests`);
}

console.log("\nQA setup done. Log in as ananth on the preview; QA Alpha & QA Bravo will appear.");
console.log("Dummy logins (if needed): qa1 / qa2 / qa3  password " + PW);
