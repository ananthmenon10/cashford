// Shared plumbing for the /api/gw/* route handlers (Phase 2 plan §7).
//
// Every gameweek mutation is one routine call on the SESSION-SCOPED client, so auth.uid()
// inside the routine is the real user and RLS still applies. The service-role client is
// reserved for settlement and sync. Zod here is the outer check only — shape, ranges,
// duplicates, extra fields. The routine re-validates membership, eligibility, completeness,
// the deadline (by clock_timestamp after taking its locks), and fixture activity, because a
// check made before the locks is a guess.

import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

export const pickSchema = z
  .object({
    fixtureId: z.string().uuid(),
    predHome: z.number().int().min(0).max(99),
    predAway: z.number().int().min(0).max(99),
  })
  .strict();

export const picksSchema = z
  .array(pickSchema)
  .min(1)
  .max(20)
  .refine((picks) => new Set(picks.map((p) => p.fixtureId)).size === picks.length, {
    message: "duplicate fixture in picks",
  });

/** Picks in the routine's snake_case shape. */
export function toSqlPicks(picks: z.infer<typeof picksSchema>) {
  return picks.map((p) => ({ fixture_id: p.fixtureId, pred_home: p.predHome, pred_away: p.predAway }));
}

export function badRequest(message: string, extra?: Record<string, unknown>) {
  return NextResponse.json({ error: message, ...extra }, { status: 400 });
}

/**
 * Parse a JSON body against a schema. Returns the value or a response to return as-is.
 * Zod's messages are developer-facing; only the first issue's path is surfaced, because a
 * client that sends the wrong shape has a bug, not a user problem.
 */
export async function readBody<T extends z.ZodTypeAny>(
  req: Request,
  schema: T,
): Promise<{ ok: true; data: z.infer<T> } | { ok: false; res: NextResponse }> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return { ok: false, res: badRequest("invalid JSON body") };
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const where = first.path.length ? `${first.path.join(".")}: ` : "";
    return { ok: false, res: badRequest(`${where}${first.message}`) };
  }
  return { ok: true, data: parsed.data };
}

/** The session client plus the caller's id, or a 401. */
export async function requireUser(): Promise<
  | { ok: true; db: Awaited<ReturnType<typeof createClient>>; userId: string }
  | { ok: false; res: NextResponse }
> {
  const db = await createClient();
  const { data } = await db.auth.getUser();
  if (!data.user) return { ok: false, res: NextResponse.json({ error: "not signed in" }, { status: 401 }) };
  return { ok: true, db, userId: data.user.id };
}

/**
 * Turn a routine error into a response. The routines raise prose written for the player
 * ("predictions for this gameweek are closed"), so the message passes through. A 409 marks
 * the cases where reloading is the fix — the client uses it to refetch instead of re-showing
 * the same stale form.
 */
export function routineError(error: { message: string; code?: string }) {
  const m = error.message;
  const conflict = /closed|already|reload|no longer|stake is/i.test(m);
  return NextResponse.json({ error: m }, { status: conflict ? 409 : 400 });
}
