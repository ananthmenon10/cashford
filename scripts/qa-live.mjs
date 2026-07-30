// Synthetic LIVE match in QA Alpha so the "on track to win/lose ±X" tracker can be seen.
// ananth picks Home 2-1, qa1 picks Away 0-1, qa2 picks Draw 1-1 (3 entrants, ₹500).
//   node --env-file=.env.local scripts/qa-live.mjs            # live, score 2-0 (ananth on track +1000)
//   node --env-file=.env.local scripts/qa-live.mjs 0 2        # flip: away leading (ananth on track -500)
//   node --env-file=.env.local scripts/qa-live.mjs cleanup
// View: log in as ananth → QA Alpha → Live tab. (Card auto-refreshes every 20s.)

import { createClient } from "@supabase/supabase-js";
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false }, db: { schema: "cashford" } });

const EXT = 995001;
const arg = process.argv[2];
const userId = async (u) => (await admin.auth.admin.listUsers({ perPage: 200 })).data.users.find((x) => x.email === `${u}@cashford.internal`)?.id;

if (arg === "cleanup") {
  const { data: fx } = await admin.from("fixtures").select("id").eq("external_id", EXT).maybeSingle();
  if (fx) {
    const { data: cs } = await admin.from("contests").select("id").eq("fixture_id", fx.id);
    const ids = (cs ?? []).map((c) => c.id);
    if (ids.length) { await admin.from("predictions").delete().in("contest_id", ids); await admin.from("contests").delete().in("id", ids); }
    await admin.from("fixtures").delete().eq("id", fx.id);
  }
  console.log("live demo cleaned up");
  process.exit(0);
}

const home = Number(arg ?? 2);
const away = Number(process.argv[3] ?? 0);

const { data: lg } = await admin.from("leagues").select("id").eq("slug", "qa-alpha").single();
const { data: fx } = await admin.from("fixtures").upsert({
  external_id: EXT, round: "group", is_knockout: false,
  home_label: "Live Demo FC", away_label: "Test United",
  kickoff_at: new Date(Date.now() - 30 * 60000).toISOString(),
  status: "live", status_detail: "STATUS_FIRST_HALF", minute: 63,
  ft_home: home, ft_away: away,
}, { onConflict: "external_id" }).select("id").single();

const { data: contest } = await admin.from("contests").upsert(
  { league_id: lg.id, fixture_id: fx.id, stake_inr: 500, status: "locked", lock_at: new Date(Date.now() - 31 * 60000).toISOString(), is_knockout: false },
  { onConflict: "league_id,fixture_id" }).select("id").single();

const picks = [
  ["ananth", "home", 2, 1],
  ["qa1", "away", 0, 1],
  ["qa2", "draw", 1, 1],
];
for (const [u, outcome, ph, pa] of picks) {
  const id = await userId(u);
  if (!id) { console.log(`(skip ${u}: not found)`); continue; }
  await admin.from("predictions").upsert({ contest_id: contest.id, user_id: id, outcome, pred_home: ph, pred_away: pa }, { onConflict: "contest_id,user_id" });
}

console.log(`Live demo set: Live Demo FC ${home}-${away} Test United (QA Alpha, live).`);
console.log(`Expected: home ${home > away ? "leads" : away > home ? "trails" : "level"} → ananth (Home 2-1) on track to ${home > away ? "WIN +₹1,000" : away > home ? "LOSE ₹500" : "level / push"}.`);
console.log("View: ananth → QA Alpha → Live tab.");
