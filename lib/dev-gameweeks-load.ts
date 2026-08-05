import type { SupabaseClient } from "@supabase/supabase-js";

type CashfordClient = SupabaseClient<any, "cashford", any>;

function fail(error: { message?: string } | null, context: string) {
  if (error) throw new Error(`${context}: ${error.message ?? "query-failed"}`);
}

export type DevGameweeksPageLoad = {
  competitions: any[];
  gameweeks: any[];
  counts: Map<string, { active: number; excluded: number; void: number }>;
  noEspnId: number | null;
  moves: any[];
  unassignedMoves: number;
  pots: any[];
  potsByGameweek: Map<string, number>;
  issues: any[];
};

/** The read-only data path used by app/dev/gameweeks/page.tsx. */
export async function loadDevGameweeksPage(
  session: CashfordClient,
  admin: CashfordClient,
): Promise<DevGameweeksPageLoad> {
  const competitionsQuery = await session
    .from("competitions")
    .select("id, slug, name, format, season, status, fpl_source")
    .order("slug");
  fail(competitionsQuery.error, "dev-gameweeks-competitions");
  const gameweeksQuery = await session
    .from("gameweeks")
    .select("id, competition_id, number, name, status, deadline_at, locked_at")
    .order("number");
  fail(gameweeksQuery.error, "dev-gameweeks-gameweeks");
  const membershipsQuery = await session
    .from("gameweek_fixtures")
    .select("gameweek_id, state, is_current");
  fail(membershipsQuery.error, "dev-gameweeks-memberships");
  const counts = new Map<string, { active: number; excluded: number; void: number }>();
  for (const membership of membershipsQuery.data ?? []) {
    if (!membership.is_current) continue;
    const count = counts.get(membership.gameweek_id) ?? { active: 0, excluded: 0, void: 0 };
    if (membership.state === "active") count.active++;
    else if (membership.state === "excluded") count.excluded++;
    else count.void++;
    counts.set(membership.gameweek_id, count);
  }
  const noEspnQuery = await session
    .from("fixtures")
    .select("id", { count: "exact", head: true })
    .is("external_id", null);
  fail(noEspnQuery.error, "dev-gameweeks-no-espn");
  const movesQuery = await admin.from("fixture_moves").select("new_membership_id");
  fail(movesQuery.error, "dev-gameweeks-moves");
  const moves = movesQuery.data ?? [];
  const potsQuery = await session
    .from("gameweek_contests")
    .select("id, gameweek_id, status, stake_inr, deadline_at, leagues(name)");
  fail(potsQuery.error, "dev-gameweeks-pots");
  const pots = potsQuery.data ?? [];
  const potsByGameweek = new Map<string, number>();
  for (const pot of pots) {
    potsByGameweek.set(pot.gameweek_id, (potsByGameweek.get(pot.gameweek_id) ?? 0) + 1);
  }
  const issuesQuery = await admin
    .from("sync_issues")
    .select("source, kind, ref, created_at")
    .order("created_at", { ascending: false })
    .limit(25);
  fail(issuesQuery.error, "dev-gameweeks-issues");
  return {
    competitions: competitionsQuery.data ?? [],
    gameweeks: gameweeksQuery.data ?? [],
    counts,
    noEspnId: noEspnQuery.count ?? 0,
    moves,
    unassignedMoves: moves.filter((move: any) => move.new_membership_id === null).length,
    pots,
    potsByGameweek,
    issues: issuesQuery.data ?? [],
  };
}
