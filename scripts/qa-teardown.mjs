// QA teardown — deletes ONLY namespaced test data created during /ce:work verification.
//   Test users   : email starts with "qa-"   and ends with "@cashford.internal"
//   Test leagues : slug  starts with "zz-qa-"
// HARD GUARDS: never touches the 3 real leagues or non-qa accounts. Dry-run by default.
//
//   node --env-file=.env.local scripts/qa-teardown.mjs           # dry run (lists only)
//   node --env-file=.env.local scripts/qa-teardown.mjs --apply   # actually delete
//
import { createClient } from "@supabase/supabase-js";

const APPLY = process.argv.includes("--apply");
const REAL_LEAGUE_SLUGS = new Set(["kk-bois", "pes-bois", "solid-yenne-boys"]);
const REAL_USER_EMAILS = new Set(["ananth@cashford.internal"]); // belt-and-suspenders

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }, db: { schema: "cashford" },
});

const tag = APPLY ? "DELETE" : "DRY-RUN would delete";

// ── 1. zz-qa-* leagues (and their dependent rows, in FK-safe order) ──────────────
const { data: qaLeagues, error: lerr } = await admin.from("leagues").select("id, slug, name").like("slug", "zz-qa-%");
if (lerr) { console.error("leagues query:", lerr.message); process.exit(1); }
for (const lg of qaLeagues ?? []) {
  if (REAL_LEAGUE_SLUGS.has(lg.slug)) { console.error(`GUARD TRIPPED — refusing real league ${lg.slug}`); continue; }
  console.log(`${tag} league: ${lg.slug} (${lg.name})`);
  if (!APPLY) continue;
  const { data: contests } = await admin.from("contests").select("id").eq("league_id", lg.id);
  const cids = (contests ?? []).map((c) => c.id);
  if (cids.length) {
    await admin.from("predictions").delete().in("contest_id", cids);
    await admin.from("contest_results").delete().in("contest_id", cids);
    await admin.from("contest_audit_log").delete().in("contest_id", cids);
    await admin.from("contests").delete().eq("league_id", lg.id);
  }
  await admin.from("transfers").delete().eq("league_id", lg.id);
  await admin.from("league_invites").delete().eq("league_id", lg.id);
  await admin.from("league_members").delete().eq("league_id", lg.id);
  const { error } = await admin.from("leagues").delete().eq("id", lg.id);
  if (error) console.error(`  ✗ ${lg.slug}: ${error.message}`); else console.log(`  ✓ ${lg.slug} removed`);
}

// ── 2. qa-* test users (auth delete cascades the profile) ────────────────────────
const { data: list, error: uerr } = await admin.auth.admin.listUsers({ perPage: 1000 });
if (uerr) { console.error("listUsers:", uerr.message); process.exit(1); }
let n = 0;
for (const u of list.users) {
  const email = u.email ?? "";
  const isQa = email.startsWith("qa-") && email.endsWith("@cashford.internal");
  if (!isQa || REAL_USER_EMAILS.has(email)) continue;
  console.log(`${tag} user: ${email}`);
  n++;
  if (!APPLY) continue;
  const { error } = await admin.auth.admin.deleteUser(u.id);
  if (error) console.error(`  ✗ ${email}: ${error.message}`); else console.log(`  ✓ ${email} removed`);
}

console.log(`\n${APPLY ? "Done" : "Dry run complete"} — ${qaLeagues?.length ?? 0} zz-qa league(s), ${n} qa user(s).`);
if (!APPLY) console.log("Re-run with --apply to delete.");
