// Reset Solid Yenne Boys players' temp passwords to: <username> + random 3-digit number
// (easy to type/remember; must_change_password stays true so they set their own on first login).
//   node --env-file=.env.local scripts/reset-passwords.mjs
import { createClient } from "@supabase/supabase-js";
import { randomInt } from "node:crypto";

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false }, db: { schema: "cashford" } });
const USERS = ["gp", "vishwa", "rishank", "umayr", "rishi", "divij"];

const { data: list } = await admin.auth.admin.listUsers({ perPage: 200 });
const idByEmail = new Map(list.users.map((u) => [u.email, u.id]));

const out = [];
for (const u of USERS) {
  const id = idByEmail.get(`${u}@cashford.internal`);
  if (!id) { console.log(`✗ ${u}: not found`); continue; }
  let digits = randomInt(100, 1000);            // 3-digit
  let pw = `${u}${digits}`;
  let { error } = await admin.auth.admin.updateUserById(id, { password: pw });
  // Supabase min length is 6; "gp"+3 digits = 5, so bump to 4 digits if rejected.
  if (error && /(length|at least|6 char|short)/i.test(error.message)) {
    digits = randomInt(1000, 10000);            // 4-digit fallback
    pw = `${u}${digits}`;
    ({ error } = await admin.auth.admin.updateUserById(id, { password: pw }));
  }
  if (error) { console.log(`✗ ${u}: ${error.message}`); continue; }
  out.push({ u, pw });
  console.log(`✓ ${u}`);
}
console.log("\n=== NEW PASSWORDS ===");
for (const c of out) console.log(`  ${c.u.padEnd(10)} ${c.pw}`);
