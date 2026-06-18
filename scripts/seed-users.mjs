// Seed the 5 player accounts + league memberships.
// Run: node --env-file=.env.local scripts/seed-users.mjs
// Creates auth users with temp passwords + must_change_password=true; the
// on_auth_user_created trigger mirrors each into cashford.profiles, then we
// attach league memberships. Idempotent: re-running skips existing users.

import { createClient } from "@supabase/supabase-js";
import { randomInt } from "node:crypto";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const admin = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
  db: { schema: "cashford" },
});

const USERS = [
  { username: "ananth", display: "Ananth", is_admin: true, leagues: ["kk-bois", "pes-bois"] },
  { username: "utkarsh", display: "Utkarsh", is_admin: false, leagues: ["kk-bois", "pes-bois"] },
  { username: "sharan", display: "Sharan", is_admin: false, leagues: ["kk-bois"] },
  { username: "hashir", display: "Hashir", is_admin: false, leagues: ["kk-bois"] },
  { username: "harsh", display: "Harsh", is_admin: false, leagues: ["pes-bois"] },
];

const WORDS = ["Goal", "Pitch", "Volley", "Header", "Striker", "Keeper", "Winger", "Corner", "Brace", "Worldie"];
const tempPassword = () => `Cashford-${WORDS[randomInt(WORDS.length)]}${randomInt(1000, 9999)}!`;

const { data: leagues, error: lerr } = await admin.from("leagues").select("id, slug");
if (lerr) { console.error("leagues fetch:", lerr.message); process.exit(1); }
const leagueId = Object.fromEntries(leagues.map((l) => [l.slug, l.id]));

const created = [];
for (const u of USERS) {
  const email = `${u.username}@cashford.internal`;
  const password = tempPassword();
  let userId;

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      username: u.username,
      display_name: u.display,
      is_admin: u.is_admin,
      must_change_password: true,
    },
  });

  if (error) {
    if (/registered|already|exists/i.test(error.message)) {
      const { data: list } = await admin.auth.admin.listUsers({ perPage: 200 });
      userId = list.users.find((x) => x.email === email)?.id;
      console.log(`• ${u.username}: already exists, reusing`);
    } else {
      console.error(`✗ ${u.username}: ${error.message}`);
      continue;
    }
  } else {
    userId = data.user.id;
    created.push({ username: u.username, password });
    console.log(`✓ ${u.username}: created`);
  }

  for (const slug of u.leagues) {
    const lid = leagueId[slug];
    if (!lid || !userId) continue;
    const { error: merr } = await admin
      .from("league_members")
      .upsert({ league_id: lid, user_id: userId }, { onConflict: "league_id,user_id" });
    if (merr) console.error(`  ✗ membership ${u.username}/${slug}: ${merr.message}`);
  }
}

if (created.length) {
  console.log("\n=== TEMP PASSWORDS — share out-of-band; users change on first login ===");
  for (const c of created) console.log(`  ${c.username.padEnd(10)} ${c.password}`);
}
console.log("\nDone.");
