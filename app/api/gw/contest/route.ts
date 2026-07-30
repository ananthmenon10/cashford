import { NextResponse } from "next/server";
import { z } from "zod";
import { badRequest, requireUser } from "@/lib/gw-api";

export const dynamic = "force-dynamic";

const querySchema = z.object({ league: z.string().uuid(), gw: z.string().uuid() });

// GET /api/gw/contest?league=&gw= — pot state for the entry screen (§7).
// Read-only and RLS-scoped: a league the caller is not in reads as absent, not as forbidden,
// so this endpoint cannot be used to probe which leagues exist.
export async function GET(req: Request) {
  const auth = await requireUser();
  if (!auth.ok) return auth.res;

  const url = new URL(req.url);
  const q = querySchema.safeParse({ league: url.searchParams.get("league"), gw: url.searchParams.get("gw") });
  if (!q.success) return badRequest("league and gw must both be uuids");

  const { data: contest } = await auth.db
    .from("gameweek_contests")
    .select("id, stake_inr, deadline_at, status, competition_id")
    .eq("league_id", q.data.league)
    .eq("gameweek_id", q.data.gw)
    .maybeSingle();
  if (!contest) return NextResponse.json({ error: "no pot for that league and gameweek" }, { status: 404 });

  // Entrants count only the entries that will be scored: 'invalid' is a post-deadline
  // incomplete entry and takes no part in the pot.
  const [{ data: entries }, { data: mine }, { data: result }] = await Promise.all([
    auth.db.from("gameweek_entries").select("user_id, status").eq("gameweek_contest_id", contest.id),
    auth.db
      .from("gameweek_entries")
      .select("id, status, updated_at")
      .eq("gameweek_contest_id", contest.id)
      .eq("user_id", auth.userId)
      .maybeSingle(),
    auth.db
      .from("gameweek_results")
      .select("outcome, void_reason, pot_inr, tiebreak_used, settled_at")
      .eq("gameweek_contest_id", contest.id)
      .maybeSingle(),
  ]);

  const counted = (entries ?? []).filter((e) => e.status !== "invalid");

  return NextResponse.json({
    contestId: contest.id,
    status: contest.status,
    stakeInr: contest.stake_inr,
    deadlineAt: contest.deadline_at,
    entrants: counted.length,
    potInr: result?.pot_inr ?? counted.length * contest.stake_inr,
    myEntry: mine ? { entryId: mine.id, status: mine.status, updatedAt: mine.updated_at } : null,
    result: result
      ? {
          outcome: result.outcome,
          voidReason: result.void_reason,
          tiebreakUsed: result.tiebreak_used,
          settledAt: result.settled_at,
        }
      : null,
  });
}
