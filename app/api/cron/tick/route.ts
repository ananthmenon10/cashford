import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { lockDueContests, settleFinishedContests } from "@/lib/settle-contest";
import { pollScores, resolveKnockoutBracket } from "@/lib/espn";
import { pollInsights } from "@/lib/espn-insights";

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
  const insights = await pollInsights(admin);    // ESPN: warm odds/form/H2H for upcoming fixtures
  return NextResponse.json({ ok: true, poll, ko, locks, settles, insights, at: new Date().toISOString() });
}

// pg_cron calls this via net.http_post (POST); manual triggers use GET ?secret=
export const GET = handle;
export const POST = handle;
