import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { FEEDBACK_COPY } from "@/lib/gw-copy";
import { resolveFeedback } from "./actions";

export const dynamic = "force-dynamic";

const IST = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata",
  dateStyle: "medium",
  timeStyle: "short",
});

const ist = (iso: string) => IST.format(new Date(iso));

type FeedbackRow = {
  id: string;
  created_at: string;
  user_id: string;
  path: string;
  league_slug: string | null;
  message: string;
  app_version: number | null;
};

type ProfileRow = {
  id: string;
  display_name: string | null;
  username: string;
};

export default async function DevFeedbackPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createServiceRoleClient();
  const feedbackQuery = await admin
    .from("feedback")
    .select("id, created_at, user_id, path, league_slug, message, app_version")
    .is("resolved_at", null)
    .order("created_at", { ascending: false });
  if (feedbackQuery.error) {
    throw new Error(`dev-feedback-list: ${feedbackQuery.error.message}`);
  }

  const feedback = (feedbackQuery.data ?? []) as FeedbackRow[];
  const userIds = [...new Set(feedback.map((row) => row.user_id))];
  const [profilesQuery, usersQuery] = await Promise.all([
    userIds.length
      ? admin.from("profiles").select("id, display_name, username").in("id", userIds)
      : Promise.resolve({ data: [], error: null }),
    admin.auth.admin.listUsers({ perPage: 1000 }),
  ]);
  if (profilesQuery.error) {
    throw new Error(`dev-feedback-profiles: ${profilesQuery.error.message}`);
  }
  if (usersQuery.error) {
    throw new Error(`dev-feedback-users: ${usersQuery.error.message}`);
  }

  const profiles = new Map(
    (profilesQuery.data as ProfileRow[]).map((profile) => [profile.id, profile]),
  );
  const emails = new Map(
    usersQuery.data.users.map((authUser) => [authUser.id, authUser.email ?? "—"]),
  );

  return (
    <main className="mx-auto max-w-[1200px] px-5 py-8 text-sm">
      <h1 className="text-xl font-extrabold tracking-tight">{FEEDBACK_COPY.devTitle}</h1>
      <p className="mt-1 text-[12px] text-muted">{FEEDBACK_COPY.devSubtitle}</p>

      <div className="mt-6 overflow-x-auto rounded-card border border-border bg-surface">
        <table className="min-w-[980px] w-full text-left text-[12px]">
          <thead className="bg-subtle font-bold text-label">
            <tr>
              <th className="px-3 py-2">{FEEDBACK_COPY.created}</th>
              <th className="px-3 py-2">{FEEDBACK_COPY.user}</th>
              <th className="px-3 py-2">{FEEDBACK_COPY.path}</th>
              <th className="px-3 py-2">{FEEDBACK_COPY.league}</th>
              <th className="px-3 py-2">{FEEDBACK_COPY.message}</th>
              <th className="px-3 py-2">{FEEDBACK_COPY.version}</th>
              <th className="px-3 py-2">{FEEDBACK_COPY.action}</th>
            </tr>
          </thead>
          <tbody>
            {feedback.map((row) => {
              const profile = profiles.get(row.user_id);
              const email = emails.get(row.user_id) ?? "—";
              const name = profile?.display_name || profile?.username || email;
              return (
                <tr key={row.id} className="border-t border-border align-top">
                  <td className="whitespace-nowrap px-3 py-3 font-mono">{ist(row.created_at)}</td>
                  <td className="px-3 py-3">
                    <div className="font-bold">{name}</div>
                    <div className="mt-0.5 text-muted">{email}</div>
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 font-mono">{row.path}</td>
                  <td className="px-3 py-3">{row.league_slug ?? "—"}</td>
                  <td className="max-w-[360px] whitespace-pre-wrap px-3 py-3">{row.message}</td>
                  <td className="whitespace-nowrap px-3 py-3 font-mono">
                    {row.app_version == null ? "—" : `v${row.app_version}`}
                  </td>
                  <td className="px-3 py-3">
                    <form action={resolveFeedback}>
                      <input type="hidden" name="id" value={row.id} />
                      <button
                        type="submit"
                        className="rounded-control border border-border px-2.5 py-1.5 font-bold text-primary-press"
                      >
                        {FEEDBACK_COPY.resolve}
                      </button>
                    </form>
                  </td>
                </tr>
              );
            })}
            {feedback.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-muted">
                  {FEEDBACK_COPY.empty}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </main>
  );
}
