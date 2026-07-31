import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { lockDueContests, settleFinishedContests } from "@/lib/settle-contest";
import { pollScores, resolveKnockoutBracket } from "@/lib/espn";
import { pollInsights } from "@/lib/espn-insights";
import { syncFpl, gameweekMaintenance } from "@/lib/sync-fpl";
import { dispatchGameweekSettlements } from "@/lib/gameweek-db";
import { createSummaryFetcher } from "@/lib/espn-summary-fetch";
import {
  pollInsightsLeased,
} from "@/lib/poll-insights";
import {
  claimInsightsWriter,
  isMissingInsightsWriterRpcError,
  releasePhase4Lease,
} from "@/lib/poll-lease";
import { reconcileMatchCache } from "@/lib/reconcile-match-cache";
import { pollMatchData } from "@/lib/poll-match-data";
import { pollCommentary } from "@/lib/poll-commentary";
import { deriveStandings, pollStandings } from "@/lib/poll-standings";
import { pollTeamNews } from "@/lib/poll-team-news";
import { pollUnderstat } from "@/lib/poll-understat";
import { pollSlowProviders } from "@/lib/poll-slow-providers";

export const dynamic = "force-dynamic";
export const preferredRegion = "bom1"; // co-located with Supabase (ap-south-1)
export const maxDuration = 300;

function authorized(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const auth = req.headers.get("authorization");
  if (auth === `Bearer ${secret}`) return true; // Vercel Cron / scheduled callers
  return req.nextUrl.searchParams.get("secret") === secret; // manual trigger
}

async function phase4Step<T>(run: () => Promise<T>) {
  const startedAt = new Date().toISOString();
  try {
    const result = await run();
    return {
      startedAt,
      finishedAt: new Date().toISOString(),
      ...(typeof result === "object" && result !== null
        ? result
        : { result }),
    };
  } catch (error) {
    return {
      startedAt,
      finishedAt: new Date().toISOString(),
      error: error instanceof Error ? error.message : "unknown Phase 4 error",
    };
  }
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
  // One row-locked handoff selects the only insights writer for this tick. The legacy writer
  // also holds the row lease, so a concurrent tick cannot run it twice or race an arming/revert.
  // Until that migration is live, the RPC is absent; keep the old writer path alive in that case.
  let insightsWriter: Awaited<ReturnType<typeof claimInsightsWriter>> | null = null;
  let writerClaimError: unknown = null;
  try {
    insightsWriter = await claimInsightsWriter(admin);
  } catch (error) {
    writerClaimError = error;
  }
  let insights: unknown = { checked: 0, updated: 0 };
  const missingWriterRpc =
    writerClaimError !== null &&
    isMissingInsightsWriterRpcError(writerClaimError);
  if (insightsWriter?.writer === "legacy" || missingWriterRpc) {
    insights = await phase4Step(async () => {
      try {
        return await pollInsights(admin);
      } finally {
        if (insightsWriter?.writer === "legacy") {
          await releasePhase4Lease(admin, "espn_insights", insightsWriter.token, {
            nextDueAt: "infinity",
          });
        }
      }
    });
  }
  const summaryFetcher = createSummaryFetcher();
  const leasedInsights = await phase4Step(async () => {
    if (writerClaimError) throw writerClaimError;
    if (insightsWriter?.writer === "leased") {
      return pollInsightsLeased(
        admin,
        summaryFetcher,
        new Date(),
        insightsWriter.token,
      );
    }
    return {
      lease: insightsWriter?.writer === "none" ? insightsWriter.reason : "not_due",
      fetches: 0,
      writes: 0,
    };
  });
  const phase4 = {
    insights: leasedInsights,
    reconcile: await phase4Step(() => reconcileMatchCache(admin)),
    matchData: await phase4Step(() =>
      pollMatchData(admin, summaryFetcher),
    ),
    commentary: await phase4Step(() =>
      pollCommentary(admin, summaryFetcher),
    ),
    standings: await phase4Step(() => pollStandings(admin)),
    derivedStandings: await phase4Step(() => deriveStandings(admin)),
    teamNews: await phase4Step(() => pollTeamNews(admin)),
    understat: await phase4Step(() => pollUnderstat(admin)),
    fotmob: await phase4Step(() => pollSlowProviders(admin)),
  };
  return NextResponse.json({
    ok: true,
    fotmobEnabled: process.env.FOTMOB_ENABLED === "true",
    fpl,
    poll,
    ko,
    locks,
    settles,
    gameweeks,
    gwSettles,
    insights,
    phase4,
    summary: summaryFetcher.stats(),
    at: new Date().toISOString(),
  });
}

// pg_cron calls this via net.http_post (POST); manual triggers use GET ?secret=
export const GET = handle;
export const POST = handle;
