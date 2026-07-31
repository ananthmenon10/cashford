// Phase 1 step 5 (post-sync): the data acceptance gate. Everything here must pass before
// activate_competition is called.
//
//   node --env-file=.env.local scripts/verify-phase1.mjs
//
// Checks: 38 gameweeks · 380 fixtures each with a current membership (or a logged reason) ·
// deadlines equal to the LIVE FPL snapshot (never a hardcoded table) · World Cup fixture rows
// byte-identical to the preflight checksum · real leagues untouched · at most one open gameweek.

import { createClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fetchFplSnapshot } from "../lib/fpl.ts";

const svc = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false }, db: { schema: "cashford" } },
);

const COMPETITION_SLUG = "pl-2026-27";
const REAL_LEAGUES = ["Solid Yenne Boys", "KK Bois", "PES Bois"];
const SNAPSHOT_PATH = "scripts/.phase1-snapshot.json";

let failures = 0;
const ok = (label, cond, extra = "") => {
  if (!cond) failures++;
  console.log(`${cond ? "✓" : "✗ FAIL"} ${label}${extra ? "  — " + extra : ""}`);
};

const { data: competition } = await svc
  .from("competitions").select("id, status").eq("slug", COMPETITION_SLUG).single();

// ---- gameweeks -------------------------------------------------------------------------
const { data: gws } = await svc
  .from("gameweeks").select("id, number, fpl_event_id, status, deadline_at")
  .eq("competition_id", competition.id).order("number");
ok("38 gameweeks", gws?.length === 38, `got ${gws?.length}`);
const open = (gws ?? []).filter((g) => g.status === "open");
ok("at most one open gameweek", open.length <= 1, `${open.length} open`);

// ---- deadlines match the live snapshot -------------------------------------------------
const snapshot = await fetchFplSnapshot();
ok("FPL snapshot fetched for comparison", !!snapshot);
if (snapshot) {
  const byEvent = new Map(snapshot.events.map((e) => [e.fplEventId, e]));
  const mismatched = (gws ?? []).filter((g) => {
    const e = byEvent.get(Number(g.fpl_event_id));
    if (!e) return true;
    return new Date(g.deadline_at).getTime() !== new Date(e.deadlineAt).getTime();
  });
  // A frozen deadline is a legitimate mismatch, but it must be explained by a sync_issue.
  const { data: frozen } = await svc
    .from("sync_issues").select("ref").eq("kind", "deadline-frozen");
  const frozenRefs = new Set((frozen ?? []).map((f) => String(f.ref)));
  const unexplained = mismatched.filter((g) => !frozenRefs.has(String(g.id)));
  ok("gameweek deadlines match the live FPL snapshot", unexplained.length === 0,
    unexplained.map((g) => `gw ${g.number}`).join(", "));
}

// ---- fixtures and membership -----------------------------------------------------------
const { count: fixtureCount } = await svc
  .from("fixtures").select("id", { count: "exact", head: true })
  .eq("competition_id", competition.id);
ok("380 PL fixtures", fixtureCount === 380, `got ${fixtureCount}`);

const gwIds = new Set((gws ?? []).map((g) => g.id));
const { data: memberships } = await svc
  .from("gameweek_fixtures").select("fixture_id, gameweek_id, state, is_current, void_reason");
const current = (memberships ?? []).filter((m) => m.is_current && gwIds.has(m.gameweek_id));
const currentByFixture = new Map(current.map((m) => [m.fixture_id, m]));

const { data: plFixtures } = await svc
  .from("fixtures").select("id, fpl_fixture_id, external_id")
  .eq("competition_id", competition.id);
const missing = (plFixtures ?? []).filter((f) => !currentByFixture.has(f.id));

// A fixture with no current membership is acceptable only when FPL itself has no gameweek for
// it AND, if it used to be assigned, the unassignment was recorded. Anything else is data loss.
const { data: allMoves } = await svc
  .from("fixture_moves").select("fixture_id, new_membership_id");
const unassignedMoves = (allMoves ?? []).filter((m) => m.new_membership_id === null);
const unassignedFor = new Set(unassignedMoves.map((m) => String(m.fixture_id)));
const everMoved = new Set((allMoves ?? []).map((m) => String(m.fixture_id)));
const fplEventByFixture = new Map(
  (snapshot?.fixtures ?? []).map((f) => [Number(f.fplFixtureId), f.fplEventId]),
);

const unexplainedMissing = missing.filter((f) => {
  if (!snapshot) return true; // cannot justify anything without a snapshot to check against
  const event = fplEventByFixture.get(Number(f.fpl_fixture_id));
  if (event === undefined) return true; // not in FPL at all — should not exist locally either
  if (event !== null) return true; // FPL DOES place it in a gameweek, so we lost the membership
  // FPL has it unassigned. If it was ever assigned here, the unassign must be logged.
  return everMoved.has(String(f.id)) && !unassignedFor.has(String(f.id));
});
ok("every PL fixture has a current gameweek membership, or a justified absence",
  unexplainedMissing.length === 0,
  `${missing.length} missing, ${unexplainedMissing.length} unexplained (${unassignedMoves.length} unassign moves logged)`);

const excluded = current.filter((m) => m.state === "excluded");
const { data: lateIssues } = await svc
  .from("sync_issues").select("ref").eq("kind", "late-assignment");
ok("every excluded membership has a late-assignment issue",
  excluded.length <= (lateIssues?.length ?? 0),
  `${excluded.length} excluded / ${lateIssues?.length ?? 0} issues`);
console.log(`  membership states: ${current.filter((m) => m.state === "active").length} active · ${excluded.length} excluded`);

const unmatched = (plFixtures ?? []).filter((f) => f.external_id === null);
console.log(`  fixtures with no ESPN id (FPL-only scores): ${unmatched.length}`);

// ---- World Cup rows untouched ----------------------------------------------------------
let snapshotFile = null;
try {
  snapshotFile = JSON.parse(readFileSync(SNAPSHOT_PATH, "utf8"));
} catch {
  console.log(`… ${SNAPSHOT_PATH} not found — run scripts/phase1-preflight.mjs before the migration`);
  failures++;
}
if (snapshotFile) {
  const { data: wc } = await svc
    .from("competitions").select("id").eq("slug", "wc2026").single();
  const { data: wcFixtures } = await svc
    .from("fixtures")
    .select(
      "id, external_id, round, group_label, is_knockout, home_team_id, away_team_id, home_label, away_label, kickoff_at, status, ft_home, ft_away, advancer_team_id, venue",
    )
    .eq("competition_id", wc.id)
    .order("id");
  const canonical = (wcFixtures ?? [])
    .map((f) =>
      [
        f.id, f.external_id, f.round, f.group_label, f.is_knockout,
        f.home_team_id, f.away_team_id, f.home_label, f.away_label,
        f.kickoff_at, f.status, f.ft_home, f.ft_away,
        f.advancer_team_id, f.venue,
      ].join("|"),
    )
    .join("\n");
  const checksum = createHash("sha256").update(canonical).digest("hex");
  ok("World Cup fixture legacy columns unchanged", checksum === snapshotFile.checksum,
    `${checksum.slice(0, 12)} vs ${String(snapshotFile.checksum).slice(0, 12)}`);

  const { count: contestCount } = await svc
    .from("contests").select("id", { count: "exact", head: true });
  ok("no new legacy contests were created",
    contestCount === snapshotFile.counts.contests,
    `${contestCount} vs ${snapshotFile.counts.contests}`);
}

// ---- real leagues untouched -------------------------------------------------------------
const { data: real } = await svc.from("leagues").select("id, name").in("name", REAL_LEAGUES);
for (const lg of real ?? []) {
  const { count: pots } = await svc
    .from("gameweek_contests").select("id", { count: "exact", head: true }).eq("league_id", lg.id);
  ok(`${lg.name} has zero gameweek_contests`, pots === 0, `got ${pots}`);
}

// ---- sync issues worth a human's attention ----------------------------------------------
const { data: issues } = await svc
  .from("sync_issues").select("source, kind, ref, created_at")
  .order("created_at", { ascending: false }).limit(20);
if (issues?.length) {
  console.log("\nrecent sync issues:");
  for (const i of issues) console.log(`  ${i.created_at} ${i.source}/${i.kind} ${i.ref ?? ""}`);
}

console.log(failures === 0 ? "\n✓ Phase 1 data verification passed" : `\n✗ ${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
