import { NextResponse } from "next/server";
import { z } from "zod";
import { badRequest, readBody, requireUser, routineError } from "@/lib/gw-api";

export const dynamic = "force-dynamic";

// The accepted stake travels in the request so consent is provable: the routine compares it
// with the pot's stored stake after taking its locks, and a mismatch writes nothing.
const bodySchema = z
  .object({
    fromLeagueId: z.string().uuid(),
    gameweekId: z.string().uuid(),
    targets: z
      .array(
        z
          .object({
            leagueId: z.string().uuid(),
            acceptedStakeInr: z.number().int().positive(),
          })
          .strict(),
      )
      .min(1)
      .max(20)
      .refine((t) => new Set(t.map((x) => x.leagueId)).size === t.length, {
        message: "duplicate target league",
      }),
  })
  .strict()
  .refine((b) => !b.targets.some((t) => t.leagueId === b.fromLeagueId), {
    message: "the source league cannot also be a target",
  });

// POST /api/gw/mirror — copy my entry for this gameweek into other leagues (§7, L8).
// All-or-nothing: a 409 body carries a per-target error list and nothing was written.
export async function POST(req: Request) {
  const auth = await requireUser();
  if (!auth.ok) return auth.res;

  const body = await readBody(req, bodySchema);
  if (!body.ok) return body.res;

  const { data, error } = await auth.db.rpc("mirror_gameweek_entry", {
    p_from_league_id: body.data.fromLeagueId,
    p_gameweek_id: body.data.gameweekId,
    p_targets: body.data.targets.map((t) => ({
      league_id: t.leagueId,
      accepted_stake_inr: t.acceptedStakeInr,
    })),
  });
  if (error) return routineError(error);
  if (!data) return badRequest("mirror did not run");

  const r = data as
    | { ok: false; errors: { league_id: string; error: string }[] }
    | { ok: true; mirrored: { league_id: string; entry_id: string; picks: number }[] };

  if (!r.ok) {
    return NextResponse.json(
      { error: "nothing was copied", targets: r.errors.map((e) => ({ leagueId: e.league_id, error: e.error })) },
      { status: 409 },
    );
  }
  return NextResponse.json({
    mirrored: r.mirrored.map((m) => ({ leagueId: m.league_id, entryId: m.entry_id, picks: m.picks })),
  });
}
