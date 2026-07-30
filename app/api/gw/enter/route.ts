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

// POST /api/gw/enter — first entry into a gameweek pot (§7, L1).
export async function POST(req: Request) {
  const auth = await requireUser();
  if (!auth.ok) return auth.res;

  const body = await readBody(req, bodySchema);
  if (!body.ok) return body.res;

  const { data, error } = await auth.db.rpc("enter_gameweek", {
    p_league_id: body.data.leagueId,
    p_gameweek_id: body.data.gameweekId,
    p_picks: toSqlPicks(body.data.picks),
  });
  if (error) return routineError(error);
  if (!data) return badRequest("entry was not written");

  const r = data as { entry_id: string; status: string; picks: number; created: boolean };
  return NextResponse.json({
    entryId: r.entry_id,
    status: r.status,
    picks: r.picks,
    created: r.created,
  });
}
