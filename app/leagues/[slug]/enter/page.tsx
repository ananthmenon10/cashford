import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import {
  loadGameweekView,
  loadLeagueIdentity,
  loadMirrorTargets,
} from "@/lib/gw-view";
import { C2Prefix, GW_UI_COPY } from "@/lib/gw-copy";
import { LocalTime } from "@/components/LocalTime";
import { EntrySheet } from "@/components/gw/EntrySheet";
import { Countdown } from "@/components/gw/Countdown";

export default async function EnterGameweekPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ gw?: string }>;
}) {
  const { slug } = await params;
  const query = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) notFound();
  const identity = await loadLeagueIdentity(supabase, slug);
  if (
    !identity ||
    identity.participation.status === "none" ||
    identity.participation.format !== "gameweek"
  ) {
    notFound();
  }
  const view = await loadGameweekView(
    supabase,
    createServiceRoleClient(),
    identity,
    user.id,
    query.gw,
    new Date(),
    false,
  );
  if (!view.gameweek || !view.contest) redirect(`/leagues/${slug}`);
  const canEdit =
    view.lifecycle === "CL1" &&
    (view.viewerParticipation === "VP1" ||
      view.viewerParticipation === "VP2" ||
      view.viewerParticipation === "VP3");
  if (!canEdit) redirect(`/leagues/${slug}?gw=${view.gameweek.number}`);
  const mirrorTargets =
    view.viewerParticipation === "VP1"
      ? await loadMirrorTargets(supabase, view, user.id)
      : [];

  return (
    <main className="min-h-screen bg-cs2-canvas px-4 py-6 text-cs2-ink">
      <div className="mx-auto max-w-[560px]">
        <div className="mb-3 flex items-center justify-between rounded-cs2-md border border-cs2-line bg-cs2-paper px-4 py-3">
          <span className="font-mono text-[12px] font-bold tabular">
            {C2Prefix} <LocalTime iso={view.contest.deadlineAt} relative={false} />
          </span>
          <Countdown deadlineAt={view.contest.deadlineAt} />
        </div>
        <noscript>
          <p className="mb-3 rounded-cs2-md border border-cs2-amber-line bg-cs2-amber-soft px-4 py-3 text-[12px] font-semibold text-cs2-amber">
            {GW_UI_COPY.entryRequiresJs}
          </p>
        </noscript>
        <EntrySheet
          key={view.gameweek.id}
          view={view}
          viewerId={user.id}
          mirrorTargets={mirrorTargets}
        />
      </div>
    </main>
  );
}
