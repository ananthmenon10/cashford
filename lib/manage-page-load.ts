import type { SupabaseClient } from "@supabase/supabase-js";

type CashfordClient = SupabaseClient<any, "cashford", any>;

function fail(error: { message?: string } | null, context: string) {
  if (error) throw new Error(`${context}: ${error.message ?? "query-failed"}`);
}

export type ManagePageLoad = {
  invite: { token: string; short_code: string } | null;
  memberIds: string[];
  nameById: Map<string, string>;
};

/** The read-only data path used after requireCaptain in the manage page. */
export async function loadManagePage(
  admin: CashfordClient,
  leagueId: string,
): Promise<ManagePageLoad> {
  const inviteQuery = await admin
    .from("league_invites")
    .select("token, short_code")
    .eq("league_id", leagueId)
    .is("revoked_at", null)
    .maybeSingle();
  fail(inviteQuery.error, "manage-invite");

  const membersQuery = await admin
    .from("league_members")
    .select("user_id")
    .eq("league_id", leagueId)
    .is("left_at", null);
  fail(membersQuery.error, "manage-members");
  const memberIds = (membersQuery.data ?? []).map((m: any) => m.user_id as string);

  const profilesQuery = memberIds.length
    ? await admin
        .from("profiles")
        .select("id, display_name, username")
        .in("id", memberIds)
    : { data: [], error: null };
  fail(profilesQuery.error, "manage-profiles");
  const nameById = new Map(
    (profilesQuery.data ?? []).map((p: any) => [
      p.id as string,
      (p.display_name || p.username) as string,
    ]),
  );
  return {
    invite: inviteQuery.data,
    memberIds,
    nameById,
  };
}
