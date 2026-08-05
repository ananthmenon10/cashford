import type { SupabaseClient } from "@supabase/supabase-js";

type CashfordClient = SupabaseClient<any, "cashford", any>;

export type ManageLeague = {
  id: string;
  name: string;
  slug: string;
  status: string;
  created_by: string;
  default_stake_inr: number;
};

export type CaptainAccess =
  | { status: "allowed"; league: ManageLeague }
  | { status: "missing" }
  | { status: "forbidden" };

function fail(error: { message?: string } | null, context: string) {
  if (error) throw new Error(`${context}: ${error.message ?? "query-failed"}`);
}

/** Read-only access check used by app/leagues/[slug]/manage/actions.ts. */
export async function loadCaptainAccess(
  admin: CashfordClient,
  slug: string,
  userId: string,
): Promise<CaptainAccess> {
  const leagueQuery = await admin
    .from("leagues")
    .select("id, name, slug, status, created_by, default_stake_inr")
    .eq("slug", slug)
    .maybeSingle();
  fail(leagueQuery.error, "manage-access-league");
  if (!leagueQuery.data) return { status: "missing" };

  const league = leagueQuery.data as ManageLeague;
  if (league.created_by === userId) return { status: "allowed", league };

  const profileQuery = await admin
    .from("profiles")
    .select("is_admin")
    .eq("id", userId)
    .maybeSingle();
  fail(profileQuery.error, "manage-access-profile");
  return profileQuery.data?.is_admin
    ? { status: "allowed", league }
    : { status: "forbidden" };
}
