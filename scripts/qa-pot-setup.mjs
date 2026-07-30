// QA pot-integrity setup — seeds a SETTLED contest so we can test that removing a
// winner mid-tournament does NOT break the dues ledger. Creates only qa-/zz-qa- data.
//   node --env-file=.env.local scripts/qa-pot-setup.mjs
// Teardown via scripts/qa-teardown.mjs --apply (handles zz-qa-* contests/results).
import { createClient } from "@supabase/supabase-js";

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }, db: { schema: "cashford" },
});

const PW = "qa-test-1234";
const USERS = [
  { username: "qa-p4cap", display: "QA P4 Captain" },
  { username: "qa-p4win", display: "QA P4 Winner" },
  { username: "qa-p4lose", display: "QA P4 Loser" },
];

async function ensureUser(u) {
  const email = `${u.username}@cashford.internal`;
  const { data: list } = await admin.auth.admin.listUsers({ perPage: 1000 });
  const existing = list.users.find((x) => x.email === email);
  if (existing) return existing.id;
  const { data, error } = await admin.auth.admin.createUser({
    email, password: PW, email_confirm: true,
    user_metadata: { username: u.username, display_name: u.display, is_admin: false, must_change_password: false },
  });
  if (error) throw new Error(`createUser ${u.username}: ${error.message}`);
  return data.user.id;
}

const ids = {};
for (const u of USERS) ids[u.username] = await ensureUser(u);

// League (captain = qa-p4cap, stake 50)
const { data: lg, error: lerr } = await admin.from("leagues")
  .upsert({ name: "ZZ QA Pot", slug: "zz-qa-pot", default_stake_inr: 50, created_by: ids["qa-p4cap"] }, { onConflict: "slug" })
  .select("id").single();
if (lerr) throw new Error(`league: ${lerr.message}`);

for (const k of Object.keys(ids))
  await admin.from("league_members").upsert({ league_id: lg.id, user_id: ids[k] }, { onConflict: "league_id,user_id" });

// Pick a finished fixture if any (cosmetic only — dues read contest_results, not the fixture).
const { data: fx } = await admin.from("fixtures").select("id, ft_home, is_knockout").order("ft_home", { ascending: false, nullsFirst: false }).limit(1);
const fixture = fx?.[0];
if (!fixture) throw new Error("no fixtures found");

// Settled contest (₹50). lock_at in the past so cron treats it as done, status already 'settled'.
const { data: contest, error: cerr } = await admin.from("contests")
  .upsert({ league_id: lg.id, fixture_id: fixture.id, stake_inr: 50, status: "settled", lock_at: "2026-06-01T00:00:00Z", is_knockout: fixture.is_knockout ?? false },
    { onConflict: "league_id,fixture_id" })
  .select("id").single();
if (cerr) throw new Error(`contest: ${cerr.message}`);

// Predictions (realism) — winner home 2-1, loser away 0-1.
await admin.from("predictions").upsert([
  { contest_id: contest.id, user_id: ids["qa-p4win"], outcome: "home", pred_home: 2, pred_away: 1 },
  { contest_id: contest.id, user_id: ids["qa-p4lose"], outcome: "away", pred_home: 0, pred_away: 1 },
], { onConflict: "contest_id,user_id" });

// Settled results: winner takes loser's ₹50 stake → +50 / -50 (balanced pot). Captain didn't predict.
await admin.from("contest_results").upsert([
  { contest_id: contest.id, user_id: ids["qa-p4win"], result: "win", net_inr: 50 },
  { contest_id: contest.id, user_id: ids["qa-p4lose"], result: "loss", net_inr: -50 },
], { onConflict: "contest_id,user_id" });

console.log("✓ Seeded league zz-qa-pot (settled contest, balanced pot):");
console.log(`   captain login : qa-p4cap / ${PW}`);
console.log(`   winner        : qa-p4win  (net +50)  ← remove this one`);
console.log(`   loser         : qa-p4lose (net -50)`);
console.log(`   expected dues : qa-p4lose owes qa-p4win ₹50; board sums to 0`);
