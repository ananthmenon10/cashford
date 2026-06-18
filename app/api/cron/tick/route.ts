import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { lockDueContests, settleFinishedContests } from "@/lib/settle-contest";

export const dynamic = "force-dynamic";

function authorized(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const auth = req.headers.get("authorization");
  if (auth === `Bearer ${secret}`) return true; // Vercel Cron / scheduled callers
  return req.nextUrl.searchParams.get("secret") === secret; // manual trigger
}

// Lock due contests, then settle finished ones. Idempotent — safe to call often.
export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const admin = createServiceRoleClient();
  const locks = await lockDueContests(admin);
  const settles = await settleFinishedContests(admin);
  return NextResponse.json({ ok: true, locks, settles, at: new Date().toISOString() });
}
