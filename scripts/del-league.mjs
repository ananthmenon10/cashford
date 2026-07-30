// Remove a league and all its data (members, contests, predictions, results, transfers) from the
// shared DB, FK-safe order. Irreversible — `inventory` dumps the full rows first as a backup.
//
//   node --env-file=.env.local scripts/del-league.mjs inventory "Test League"
//   node --env-file=.env.local scripts/del-league.mjs delete    "Test League"

import { createClient } from "@supabase/supabase-js";

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false }, db: { schema: "cashford" },
});
const mode = process.argv[2] ?? "inventory";
const name = process.argv[3] ?? "Test League";

const { data: lg } = await admin.from("leagues").select("id, name, slug").eq("name", name).maybeSingle();
if (!lg) { console.log(`No league named "${name}".`); process.exit(0); }

const { data: members } = await admin.from("league_members").select("user_id").eq("league_id", lg.id);
const { data: cs } = await admin.from("contests").select("id").eq("league_id", lg.id);
const cids = (cs ?? []).map((c) => c.id);
const { data: preds } = cids.length ? await admin.from("predictions").select("contest_id, user_id, outcome, pred_home, pred_away").in("contest_id", cids) : { data: [] };
const { data: results } = cids.length ? await admin.from("contest_results").select("contest_id, user_id, result, net_inr").in("contest_id", cids) : { data: [] };
const { data: transfers } = await admin.from("transfers").select("id, contest_id, from_user_id, to_user_id, amount_inr").eq("league_id", lg.id);

console.log(`League: ${lg.name}  (slug=${lg.slug}, id=${lg.id})`);
console.log(`  members=${members?.length ?? 0}  contests=${cids.length}  predictions=${preds?.length ?? 0}  results=${results?.length ?? 0}  transfers=${transfers?.length ?? 0}`);

if (mode === "inventory") {
  console.log("BACKUP_JSON=" + JSON.stringify({ league: lg, members, contests: cs, predictions: preds, results, transfers }));
  process.exit(0);
}

if (mode === "delete") {
  if (cids.length) {
    await admin.from("transfers").delete().in("contest_id", cids);
    await admin.from("contest_results").delete().in("contest_id", cids);
    await admin.from("predictions").delete().in("contest_id", cids);
    await admin.from("contest_audit_log").delete().in("contest_id", cids).then(() => {}, () => {});
    await admin.from("contests").delete().in("id", cids);
  }
  await admin.from("transfers").delete().eq("league_id", lg.id);
  await admin.from("league_members").delete().eq("league_id", lg.id);
  const { error } = await admin.from("leagues").delete().eq("id", lg.id);
  if (error) { console.error("delete failed:", error.message); process.exit(1); }
  const { data: check } = await admin.from("leagues").select("id").eq("id", lg.id).maybeSingle();
  console.log(check ? "STILL EXISTS — delete failed" : "DELETED — league fully removed.");
}
