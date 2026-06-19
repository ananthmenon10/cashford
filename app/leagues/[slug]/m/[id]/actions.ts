"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

export type MirrorResult = { contestId: string; ok: boolean; reason: string | null };
export type SubmitState = { error: string | null; ok?: boolean; mirrored?: MirrorResult[] };

export async function submitPrediction(
  input: {
    contestId: string; slug: string;
    outcome: "home" | "draw" | "away"; predHome: number; predAway: number;
    alsoTargets?: string[]; // sibling contest ids to mirror the same pick into (other leagues)
  },
): Promise<SubmitState> {
  if (input.predHome < 0 || input.predAway < 0) return { error: "Scores can't be negative." };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const row = (contestId: string) => ({
    contest_id: contestId,
    user_id: user.id,
    outcome: input.outcome,
    pred_home: input.predHome,
    pred_away: input.predAway,
    updated_at: new Date().toISOString(),
  });

  // Primary write first. RLS enforces: own row, password changed, league member, before lock
  // (+10s); the trigger rejects a draw on a knockout contest.
  const { error } = await supabase.from("predictions").upsert(row(input.contestId), { onConflict: "contest_id,user_id" });
  if (error) {
    if (/row-level security/i.test(error.message)) return { error: "This contest is locked." };
    if (/knockout/i.test(error.message)) return { error: "No draws in a knockout — pick a side." };
    return { error: error.message };
  }

  // Mirror the same pick into the chosen sibling contests. Each is its own upsert (a multi-row
  // upsert is all-or-nothing under RLS WITH CHECK — one locked sibling would roll back the rest),
  // so partial success is reported per-target. RLS re-guards every write (own row, membership,
  // lock); on top we fixture-bind the targets so a tampered client can't write into a different
  // match, and we drop the primary id.
  const mirrored: MirrorResult[] = [];
  const targets = (input.alsoTargets ?? []).filter((id) => id !== input.contestId);
  if (targets.length) {
    const { data: primary } = await supabase.from("contests").select("fixture_id").eq("id", input.contestId).single();
    const { data: valid } = primary
      ? await supabase.from("contests")
          .select("id, leagues(slug)")
          .eq("fixture_id", primary.fixture_id)
          .in("id", targets)
          .neq("id", input.contestId)
      : { data: [] as { id: string; leagues: unknown }[] };
    for (const t of valid ?? []) {
      const { error: e } = await supabase.from("predictions").upsert(row(t.id), { onConflict: "contest_id,user_id" });
      const ok = !e;
      mirrored.push({ contestId: t.id, ok, reason: e ? (/row-level security/i.test(e.message) ? "locked" : "error") : null });
      if (ok) {
        const lg = (Array.isArray(t.leagues) ? t.leagues[0] : t.leagues) as { slug?: string } | null;
        if (lg?.slug) { revalidatePath(`/leagues/${lg.slug}`); revalidatePath(`/leagues/${lg.slug}/m/${t.id}`); }
      }
    }
  }

  revalidatePath(`/leagues/${input.slug}`);
  revalidatePath(`/leagues/${input.slug}/m/${input.contestId}`);
  return { error: null, ok: true, mirrored };
}
