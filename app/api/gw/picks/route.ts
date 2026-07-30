import { NextResponse } from "next/server";
import { z } from "zod";
import { badRequest, picksSchema, readBody, requireUser, routineError, toSqlPicks } from "@/lib/gw-api";

export const dynamic = "force-dynamic";

const bodySchema = z
  .object({
    leagueId: z.string().uuid(),
    gameweekId: z.string().uuid(),
    picks: picksSchema,
  })
  .strict();

// POST /api/gw/picks — edit an existing entry before the deadline (§7, L2).
// Same routine as /enter with p_require_existing = true, so an edit against a gameweek the
// player never entered fails instead of quietly creating an entry.
export async function POST(req: Request) {
  const auth = await requireUser();
  if (!auth.ok) return auth.res;

  const body = await readBody(req, bodySchema);
  if (!body.ok) return body.res;

  const { data, error } = await auth.db.rpc("update_gameweek_picks", {
    p_league_id: body.data.leagueId,
    p_gameweek_id: body.data.gameweekId,
    p_picks: toSqlPicks(body.data.picks),
  });
  if (error) return routineError(error);
  if (!data) return badRequest("picks were not written");

  const r = data as { entry_id: string; status: string; picks: number };
  return NextResponse.json({ entryId: r.entry_id, status: r.status, picks: r.picks });
}
