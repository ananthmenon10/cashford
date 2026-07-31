// One-off: set a known password for ananth@cashford.internal (QA/dev login account,
// not a protected real-league-member account) so browser-verification can log in.
//   node --env-file=.env.local scripts/qa-reset-ananth-pw.mjs
import { createClient } from "@supabase/supabase-js";

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false }, db: { schema: "cashford" } });

const { data: list } = await admin.auth.admin.listUsers({ perPage: 200 });
const user = list.users.find((u) => u.email === "ananth@cashford.internal");
if (!user) { console.log("✗ ananth@cashford.internal not found"); process.exit(1); }

const pw = "Ananth-QA-2026!";
const { error } = await admin.auth.admin.updateUserById(user.id, { password: pw });
if (error) { console.log("✗", error.message); process.exit(1); }
console.log("✓ password set:", pw);
