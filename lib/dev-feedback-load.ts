import type { SupabaseClient } from "@supabase/supabase-js";

type CashfordClient = SupabaseClient<any, "cashford", any>;

function fail(error: { message?: string } | null, context: string) {
  if (error) throw new Error(`${context}: ${error.message ?? "query-failed"}`);
}

export type DevFeedbackPageLoad = {
  feedback: any[];
  profiles: Map<string, any>;
  emails: Map<string, string>;
};

/** The read-only data path used by app/dev/feedback/page.tsx. */
export async function loadDevFeedbackPage(
  admin: CashfordClient,
): Promise<DevFeedbackPageLoad> {
  const feedbackQuery = await admin
    .from("feedback")
    .select("id, created_at, user_id, path, league_slug, message, app_version")
    .is("resolved_at", null)
    .order("created_at", { ascending: false });
  fail(feedbackQuery.error, "dev-feedback-list");
  const feedback = (feedbackQuery.data ?? []) as any[];
  const userIds = [...new Set(feedback.map((row) => row.user_id as string))];
  const [profilesQuery, usersQuery] = await Promise.all([
    userIds.length
      ? admin.from("profiles").select("id, display_name, username").in("id", userIds)
      : Promise.resolve({ data: [], error: null }),
    admin.auth.admin.listUsers({ perPage: 1000 }),
  ]);
  fail(profilesQuery.error, "dev-feedback-profiles");
  fail(usersQuery.error, "dev-feedback-users");
  return {
    feedback,
    profiles: new Map((profilesQuery.data ?? []).map((profile: any) => [profile.id, profile])),
    emails: new Map(usersQuery.data.users.map((user: any) => [user.id, user.email ?? "—"])),
  };
}
