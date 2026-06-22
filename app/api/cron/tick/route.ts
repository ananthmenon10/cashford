import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { lockDueContests, settleFinishedContests } from "@/lib/settle-contest";
import { pollScores } from "@/lib/espn";
import { pollInsights } from "@/lib/espn-insights";
import { isAuthorized } from "@/lib/cron-auth";

export const dynamic = "force-dynamic";
export const preferredRegion = "bom1"; // co-located with Supabase (ap-south-1)

function authorized(req: NextRequest) {
  return isAuthorized({
    header: req.headers.get("authorization"),
    queryParam: req.nextUrl.searchParams.get("secret"),
  });
}

// Lock due contests, then settle finished ones. Idempotent — safe to call often.
async function handle(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const admin = createServiceRoleClient();
  const poll = await pollScores(admin);          // ESPN: live scores + KO team resolution
  const locks = await lockDueContests(admin);    // open → locked (void <2)
  const settles = await settleFinishedContests(admin); // finished → settle
  const insights = await pollInsights(admin);    // ESPN: warm odds/form/H2H for upcoming fixtures
  return NextResponse.json({ ok: true, poll, locks, settles, insights, at: new Date().toISOString() });
}

// pg_cron calls this via net.http_post (POST); manual triggers use GET ?secret=
export const GET = handle;
export const POST = handle;
