import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { loadDevFeedbackPage } from "@/lib/dev-feedback-load";
import { FEEDBACK_COPY } from "@/lib/gw-copy";
import { LocalTime } from "@/components/LocalTime";
import { resolveFeedback } from "./actions";

export const dynamic = "force-dynamic";

export default async function DevFeedbackPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { feedback, profiles, emails } = await loadDevFeedbackPage(createServiceRoleClient());

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
                  <td className="whitespace-nowrap px-3 py-3 font-mono">
                    <LocalTime iso={row.created_at} relative={false} />
                  </td>
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
