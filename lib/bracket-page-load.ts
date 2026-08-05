import type { SupabaseClient } from "@supabase/supabase-js";
import {
  loadKnockoutLeaderboards,
  loadKnockoutView,
} from "./knockout-data";

type CashfordClient = SupabaseClient<any, "cashford", any>;

function fail(error: { message?: string } | null, context: string) {
  if (error) throw new Error(`${context}: ${error.message ?? "query-failed"}`);
}

export type BracketPageLoad = {
  view: Awaited<ReturnType<typeof loadKnockoutView>>;
  leaderboards: Awaited<ReturnType<typeof loadKnockoutLeaderboards>>;
  readOnly: boolean;
};

/** The server-side read path used by app/bracket/page.tsx. */
export async function loadBracketPage(
  session: CashfordClient,
  admin: CashfordClient,
  userId: string,
): Promise<BracketPageLoad> {
  const view = await loadKnockoutView(session as any, userId);
  const leaderboards = await loadKnockoutLeaderboards(
    session as any,
    userId,
    view.results,
  );
  const competition = await admin
    .from("competitions")
    .select("status")
    .eq("slug", "wc2026")
    .maybeSingle();
  fail(competition.error, "bracket-competition");
  return { view, leaderboards, readOnly: competition.data?.status === "archived" };
}
