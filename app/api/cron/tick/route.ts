import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { lockDueContests, settleFinishedContests } from "@/lib/settle-contest";
import { pollScores } from "@/lib/espn";

export const dynamic = "force-dynamic";

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
  const poll = await pollScores(admin);          // ESPN: live scores + KO team resolution
  const locks = await lockDueContests(admin);    // open → locked (void <2)
  const settles = await settleFinishedContests(admin); // finished → settle
  return NextResponse.json({ ok: true, poll, locks, settles, at: new Date().toISOString() });
}

// pg_cron calls this via net.http_post (POST); manual triggers use GET ?secret=
export const GET = handle;
export const POST = handle;
