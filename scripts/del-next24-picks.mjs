// One-off QC helper: delete ananth's predictions for the games shown in the home "Next 24h" list
// (fixtures kicking off within 24h, EXCLUDING the soonest one — that's the UP NEXT spotlight).
// Captures every pick it touches so it can be restored. Touches REAL leagues — use only on request.
//
//   node --env-file=.env.local scripts/del-next24-picks.mjs list     # read-only: show what would go
//   node --env-file=.env.local scripts/del-next24-picks.mjs delete   # capture + delete
//   node --env-file=.env.local scripts/del-next24-picks.mjs restore '<json from delete output>'

import { createClient } from "@supabase/supabase-js";

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false }, db: { schema: "cashford" },
});
const mode = process.argv[2] ?? "list";

const { data: u } = await admin.auth.admin.listUsers({ perPage: 200 });
const ananth = u.users.find((x) => x.email === "ananth@cashford.internal");
if (!ananth) { console.error("ananth not found"); process.exit(1); }

if (mode === "restore") {
  const rows = JSON.parse(process.argv[3]);
  for (const r of rows) {
    await admin.from("predictions").upsert(
      { contest_id: r.contest_id, user_id: ananth.id, outcome: r.outcome, pred_home: r.pred_home, pred_away: r.pred_away },
      { onConflict: "contest_id,user_id" });
  }
  console.log(`Restored ${rows.length} prediction(s).`);
  process.exit(0);
}

const now = Date.now();
const horizon = new Date(now + 24 * 60 * 60 * 1000).toISOString();
const { data: fixtures } = await admin.from("fixtures")
  .select("id, home_label, away_label, kickoff_at")
  .gt("kickoff_at", new Date(now).toISOString())
  .lte("kickoff_at", horizon)
  .order("kickoff_at", { ascending: true });

if (!fixtures?.length) { console.log("No fixtures kick off within the next 24h."); process.exit(0); }
const spotlight = fixtures[0];                 // soonest = UP NEXT spotlight (kept)
const listFixtures = fixtures.slice(1);        // the "Next 24h" LIST games (targets)
console.log(`Spotlight (kept): ${spotlight.home_label} v ${spotlight.away_label}  ${spotlight.kickoff_at}`);
console.log(`Next-24h list games: ${listFixtures.length}`);
const fxById = new Map(fixtures.map((f) => [f.id, f]));

const { data: contests } = await admin.from("contests")
  .select("id, fixture_id, leagues(name)")
  .in("fixture_id", listFixtures.map((f) => f.id));
const cById = new Map((contests ?? []).map((c) => [c.id, c]));

const { data: preds } = await admin.from("predictions")
  .select("id, contest_id, outcome, pred_home, pred_away")
  .eq("user_id", ananth.id)
  .in("contest_id", (contests ?? []).map((c) => c.id));

const rows = (preds ?? []).map((p) => {
  const c = cById.get(p.contest_id);
  const f = fxById.get(c.fixture_id);
  const league = Array.isArray(c.leagues) ? c.leagues[0]?.name : c.leagues?.name;
  return { contest_id: p.contest_id, outcome: p.outcome, pred_home: p.pred_home, pred_away: p.pred_away,
           _league: league, _match: `${f.home_label} v ${f.away_label}`, _ko: f.kickoff_at };
});

console.log(`\nananth predictions in those games: ${rows.length}`);
for (const r of rows) console.log(`  • ${r._match}  [${r._league}]  ${r.outcome} ${r.pred_home}-${r.pred_away}`);

if (mode === "delete" && rows.length) {
  const ids = rows.map((r) => r.contest_id);
  const { error } = await admin.from("predictions").delete().eq("user_id", ananth.id).in("contest_id", ids);
  if (error) { console.error("delete failed:", error.message); process.exit(1); }
  console.log(`\nDELETED ${rows.length} prediction(s).`);
  console.log("RESTORE RECORD (pass to `restore`):");
  console.log(JSON.stringify(rows.map(({ contest_id, outcome, pred_home, pred_away }) => ({ contest_id, outcome, pred_home, pred_away }))));
}
