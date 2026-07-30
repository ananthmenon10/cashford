import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { lockDueContests, settleFinishedContests } from "@/lib/settle-contest";
import { pollScores, resolveKnockoutBracket } from "@/lib/espn";
import { pollInsights } from "@/lib/espn-insights";
import { syncFpl, gameweekMaintenance } from "@/lib/sync-fpl";
import { dispatchGameweekSettlements } from "@/lib/gameweek-db";

export const dynamic = "force-dynamic";
export const preferredRegion = "bom1"; // co-located with Supabase (ap-south-1)

function authorized(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const auth = req.headers.get("authorization");
  if (auth === `Bearer ${secret}`) return true; // Vercel Cron / scheduled callers
  return req.nextUrl.searchParams.get("secret") === secret; // manual trigger
}

// Lock due contests, then settle finished ones. Idempotent — safe to call often.
async function handle(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const admin = createServiceRoleClient();
  // Order matters (§6): FPL first so fixture/gameweek shape is current before scores land,
  // then legacy cup settlement, then gameweek stamping, then insights warming.
  const fpl = await syncFpl(admin);              // FPL: gameweeks/fixtures (lease-gated, ~6h)
  const poll = await pollScores(admin);          // ESPN: live scores + near-term KO team resolution
  // Fill the upcoming bracket (R16/QF/SF/final) as soon as ESPN knows it — not just ±12h
  // out. Runs at :00/:15/:30/:45 (cron fires every minute) to stay light on the ESPN API;
  // the resolver itself no-ops when nothing is pending. Manual ?secret= triggers always run.
  const manual = req.nextUrl.searchParams.get("secret") !== null;
  const ko = manual || new Date().getMinutes() % 15 === 0
    ? await resolveKnockoutBracket(admin)
    : { skipped: "throttled" };
  const locks = await lockDueContests(admin);    // open → locked (void <2)
  const settles = await settleFinishedContests(admin); // finished → settle
  const gameweeks = await gameweekMaintenance(admin); // upcoming → open → locked → completed
  // Settlement runs after maintenance in the same tick: maintenance is what marks pots ready
  // (locked, entries resolved) and what voids the <2-entrant ones, so waiting a minute would
  // only delay every settlement by a tick for no gain.
  const gwSettles = await dispatchGameweekSettlements(admin);
  const insights = await pollInsights(admin);    // ESPN: warm odds/form/H2H for upcoming fixtures
  return NextResponse.json({ ok: true, fpl, poll, ko, locks, settles, gameweeks, gwSettles, insights, at: new Date().toISOString() });
}

// pg_cron calls this via net.http_post (POST); manual triggers use GET ?secret=
export const GET = handle;
export const POST = handle;
