// Integration check for the new code paths, run as the real qa1 user (RLS-enforced),
// since the local browser tool is down. Verifies: auth, league-page reads, the
// service-role "joined" count, the home open-contest query, and the cross-league
// prediction mirror write — then cleans up its test predictions.
//
//   node --env-file=.env.local scripts/qa-verify.mjs

import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const svcKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const anon = createClient(url, anonKey, { auth: { persistSession: false }, db: { schema: "cashford" } });
const svc = createClient(url, svcKey, { auth: { persistSession: false }, db: { schema: "cashford" } });

const ok = (label, cond, extra = "") => console.log(`${cond ? "✓" : "✗ FAIL"} ${label}${extra ? "  — " + extra : ""}`);

// 1. Auth as qa1
const { data: auth, error: aerr } = await anon.auth.signInWithPassword({ email: "qa1@cashford.internal", password: "Qa-1234!" });
ok("qa1 sign-in", !aerr && !!auth?.user, aerr?.message ?? "");
if (aerr) process.exit(1);
const qa1 = auth.user.id;

// 2. QA Alpha + Bravo league ids (RLS: qa1 is a member)
const { data: lgs } = await anon.from("leagues").select("id, slug").in("slug", ["qa-alpha", "qa-bravo"]);
const alpha = lgs.find((l) => l.slug === "qa-alpha")?.id;
const bravo = lgs.find((l) => l.slug === "qa-bravo")?.id;
ok("qa1 sees QA Alpha + Bravo (RLS)", !!alpha && !!bravo);

// 3. League-page read: contests for QA Alpha (RLS-scoped)
const { data: alphaContests, error: cerr } = await anon.from("contests")
  .select("id, status, lock_at, fixture_id, fixtures(home_label, away_label, kickoff_at)")
  .eq("league_id", alpha);
ok("league-page contests read", !cerr && (alphaContests?.length ?? 0) > 0, cerr?.message ?? `${alphaContests?.length} contests`);

// 4. Service-role "joined" count (item 4) — must not error, returns counts
const ids = (alphaContests ?? []).map((c) => c.id);
const { data: predRows, error: perr } = await svc.from("predictions").select("contest_id").in("contest_id", ids);
ok("service-role joined-count query (item 4)", !perr, perr?.message ?? `${predRows?.length} pred rows across ${ids.length} contests`);

// 5. Home open-contests query as qa1 (item 5): RLS-scoped, ordered by lock asc
const { data: openC, error: oerr } = await anon.from("contests")
  .select("id, league_id, lock_at, fixtures(home_label, away_label, kickoff_at)")
  .eq("status", "open").order("lock_at", { ascending: true });
const now = Date.now();
const futureOpen = (openC ?? []).filter((c) => new Date(c.lock_at).getTime() > now);
ok("home next-fixture query (item 5)", !oerr && futureOpen.length > 0, oerr?.message ?? `${futureOpen.length} future-open contests visible`);

// 6. Cross-league mirror write as qa1 (v30 + item 1): same fixture in Alpha & Bravo.
//    Pick a future-open Alpha contest whose fixture also has an open Bravo contest.
const { data: bravoContests } = await anon.from("contests").select("id, fixture_id, lock_at, status").eq("league_id", bravo);
const bravoByFixture = new Map((bravoContests ?? []).map((c) => [c.fixture_id, c]));
const target = (alphaContests ?? []).find((c) => {
  const b = bravoByFixture.get(c.fixture_id);
  return c.status === "open" && new Date(c.lock_at).getTime() > now && b && b.status === "open" && new Date(b.lock_at).getTime() > now;
});
if (!target) { ok("found shared open fixture for mirror test", false, "none"); process.exit(1); }
const bravoTarget = bravoByFixture.get(target.fixture_id);

const row = (cid) => ({ contest_id: cid, user_id: qa1, outcome: "home", pred_home: 2, pred_away: 1, updated_at: new Date().toISOString() });
const { error: w1 } = await anon.from("predictions").upsert(row(target.id), { onConflict: "contest_id,user_id" });
ok("qa1 writes own prediction in QA Alpha (RLS allows)", !w1, w1?.message ?? "");
const { error: w2 } = await anon.from("predictions").upsert(row(bravoTarget.id), { onConflict: "contest_id,user_id" });
ok("qa1 mirrors same pick to QA Bravo sibling (cross-league)", !w2, w2?.message ?? "");

// 7. Read back both
const { data: back } = await svc.from("predictions").select("contest_id, outcome, pred_home, pred_away").in("contest_id", [target.id, bravoTarget.id]).eq("user_id", qa1);
ok("both predictions persisted", (back?.length ?? 0) === 2, `${back?.length} rows`);

// cleanup the test writes
await svc.from("predictions").delete().in("contest_id", [target.id, bravoTarget.id]).eq("user_id", qa1);
console.log("\n(cleaned up qa1 test predictions)");
