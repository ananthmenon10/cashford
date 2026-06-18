"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

export type SubmitState = { error: string | null; ok?: boolean };

export async function submitPrediction(
  input: { contestId: string; slug: string; outcome: "home" | "draw" | "away"; predHome: number; predAway: number },
): Promise<SubmitState> {
  if (input.predHome < 0 || input.predAway < 0) return { error: "Scores can't be negative." };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  // RLS enforces: own row, password changed, league member, before lock (+10s),
  // and the trigger rejects a draw on a knockout contest.
  const { error } = await supabase.from("predictions").upsert(
    {
      contest_id: input.contestId,
      user_id: user.id,
      outcome: input.outcome,
      pred_home: input.predHome,
      pred_away: input.predAway,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "contest_id,user_id" },
  );

  if (error) {
    if (/row-level security/i.test(error.message)) return { error: "This contest is locked." };
    if (/knockout/i.test(error.message)) return { error: "No draws in a knockout — pick a side." };
    return { error: error.message };
  }
  revalidatePath(`/leagues/${input.slug}`);
  revalidatePath(`/leagues/${input.slug}/m/${input.contestId}`);
  return { error: null, ok: true };
}
