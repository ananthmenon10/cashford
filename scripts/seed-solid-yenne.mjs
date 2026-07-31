// Create the "Solid Yenne Boys" league (stake ₹50) + 6 player accounts, add all 7
// members (ananth is the 7th, already exists), and create contests for every
// remaining (future-lock) WC fixture at ₹50. Temp passwords printed at the end —
// share out-of-band; each user changes theirs on first login (must_change_password).
//
//   node --env-file=.env.local scripts/seed-solid-yenne.mjs
// Idempotent: re-running skips existing users/league/contests.

import { createClient } from "@supabase/supabase-js";
import { randomInt } from "node:crypto";

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }, db: { schema: "cashford" },
});

const LEAGUE = { name: "Solid Yenne Boys", slug: "solid-yenne-boys", stake: 50 };
// username (login id, lowercase) + display name as given by Ananth.
const PLAYERS = [
  { username: "gp", display: "GP" },
  { username: "vishwa", display: "Vishwa" },
  { username: "rishank", display: "Rishank" },
  { username: "umayr", display: "Umayr" },
  { username: "rishi", display: "Rishi" },
  { username: "divij", display: "Divij" },
];

const WORDS = ["Goal", "Pitch", "Volley", "Header", "Striker", "Keeper", "Winger", "Corner", "Brace", "Worldie"];
const tempPassword = () => `Cashford-${WORDS[randomInt(WORDS.length)]}${randomInt(1000, 9999)}!`;

async function userIdByEmail(email) {
  const { data } = await admin.auth.admin.listUsers({ perPage: 200 });
  return data.users.find((u) => u.email === email)?.id;
}

// 1. League (₹50 default stake)
const { data: lg, error: lerr } = await admin.from("leagues")
  .upsert({ name: LEAGUE.name, slug: LEAGUE.slug, default_stake_inr: LEAGUE.stake }, { onConflict: "slug" })
  .select("id").single();
if (lerr) { console.error("league:", lerr.message); process.exit(1); }

// 2. ananth (must already exist) + 6 new players
const ananthId = await userIdByEmail("ananth@cashford.internal");
if (!ananthId) { console.error("ananth not found — aborting"); process.exit(1); }

const created = [];
const memberIds = [ananthId];
for (const p of PLAYERS) {
  const email = `${p.username}@cashford.internal`;
  let id = await userIdByEmail(email);
  if (!id) {
    const password = tempPassword();
    const { data, error } = await admin.auth.admin.createUser({
      email, password, email_confirm: true,
      user_metadata: { username: p.username, display_name: p.display, is_admin: false, must_change_password: true },
    });
    if (error) { console.error(`✗ ${p.username}: ${error.message}`); continue; }
    id = data.user.id;
    created.push({ username: p.username, password });
    console.log(`✓ ${p.username} created`);
  } else {
    console.log(`• ${p.username} already exists, reusing`);
  }
  memberIds.push(id);
}

// 3. Memberships (all 7)
for (const uid of memberIds)
  await admin.from("league_members").upsert({ league_id: lg.id, user_id: uid }, { onConflict: "league_id,user_id" });
console.log(`members attached: ${memberIds.length}`);

// 4. Contests for every remaining (future-lock) fixture at ₹50
const { data: fixDb } = await admin.from("fixtures").select("id, kickoff_at, is_knockout");
const now = Date.now();
const contests = [];
for (const f of fixDb ?? []) {
  const lock = new Date(f.kickoff_at).getTime();
  if (lock <= now) continue; // only fixtures whose lock (=kickoff) is still ahead
  contests.push({ league_id: lg.id, fixture_id: f.id, stake_inr: LEAGUE.stake, status: "open", lock_at: new Date(lock).toISOString(), is_knockout: f.is_knockout });
}
if (contests.length) {
  const { error: cerr } = await admin.from("contests").upsert(contests, { onConflict: "league_id,fixture_id", ignoreDuplicates: true });
  if (cerr) { console.error("contests:", cerr.message); process.exit(1); }
}
console.log(`contests created (₹${LEAGUE.stake}, future-lock): ${contests.length}`);

if (created.length) {
  console.log("\n=== TEMP PASSWORDS (share out-of-band; users change on first login) ===");
  for (const c of created) console.log(`  ${c.username.padEnd(10)} ${c.password}`);
}
console.log("\nDone. League 'Solid Yenne Boys' ready.");
