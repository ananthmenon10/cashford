import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { simplifyDebts } from "@/lib/settlement";
import { Avatar, inr } from "@/components/ui";
import { LeagueShell } from "@/components/gw/LeagueShell";
import { loadGameweekView, loadLeagueIdentity } from "@/lib/gw-view";
import {
  GW_UI_COPY,
  owedByPersonCopy,
  owesPersonCopy,
} from "@/lib/gw-copy";

export default async function DuesPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) notFound();

  const identity = await loadLeagueIdentity(supabase, slug);
  if (!identity) notFound();
  if (
    identity.participation.status === "none" ||
    identity.participation.format !== "gameweek"
  ) {
    redirect(`/leagues/${slug}`);
  }

  const admin = createServiceRoleClient();
  const [view, membersQuery, resultsQuery] = await Promise.all([
    loadGameweekView(
      supabase,
      admin,
      identity,
      user.id,
      undefined,
      new Date(),
      false,
    ),
    supabase
      .from("league_members")
      .select("user_id")
      .eq("league_id", identity.league.id),
    supabase
      .from("contest_results")
      .select("user_id, net_inr, contests!inner(league_id)")
      .eq("contests.league_id", identity.league.id),
  ]);
  if (membersQuery.error) {
    throw new Error(`wc-dues-members: ${membersQuery.error.message}`);
  }
  if (resultsQuery.error) {
    throw new Error(`wc-dues-results: ${resultsQuery.error.message}`);
  }

  const netByUser = new Map<string, number>();
  for (const member of membersQuery.data ?? []) {
    netByUser.set(member.user_id, 0);
  }
  for (const result of resultsQuery.data ?? []) {
    netByUser.set(
      result.user_id,
      (netByUser.get(result.user_id) ?? 0) + (result.net_inr ?? 0),
    );
  }
  const profileIds = [...netByUser.keys()];
  const profilesQuery = profileIds.length
    ? await admin
        .from("profiles")
        .select("id, display_name, username")
        .in("id", profileIds)
    : { data: [], error: null };
  if (profilesQuery.error) {
    throw new Error(`wc-dues-profiles: ${profilesQuery.error.message}`);
  }
  const names = new Map(
    (profilesQuery.data ?? []).map((profile) => [
      profile.id,
      profile.display_name ?? profile.username,
    ]),
  );
  const leaderboard = [...netByUser.entries()]
    .map(([id, net]) => ({
      id,
      net,
      name: names.get(id) ?? GW_UI_COPY.player,
    }))
    .sort((a, b) => b.net - a.net);
  const plan = simplifyDebts(Object.fromEntries(netByUser));
  const viewerTransfers = plan
    .filter((transfer) => transfer.from === user.id || transfer.to === user.id)
    .map((transfer) =>
      transfer.from === user.id
        ? {
            id: transfer.to,
            name: names.get(transfer.to) ?? GW_UI_COPY.player,
            amount: -transfer.amount,
          }
        : {
            id: transfer.from,
            name: names.get(transfer.from) ?? GW_UI_COPY.player,
            amount: transfer.amount,
          },
    );
  const viewerName =
    (user.user_metadata?.username as string | undefined) ??
    user.email?.split("@")[0] ??
    "";

  return (
    <LeagueShell view={view} active="dues" viewerName={viewerName}>
      <div className="mt-5 flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          {leaderboard.map((member, index) => (
            <div
              key={member.id}
              className="flex items-center gap-3 rounded-card border border-border bg-surface px-4 py-2.5"
            >
              <span className="w-4 font-mono text-[13px] text-muted">{index + 1}</span>
              <Avatar label={member.name} size={26} />
              <span className="text-[14px] font-semibold">
                {member.name}
                {member.id === user.id ? ` (${GW_UI_COPY.you})` : null}
              </span>
              <span
                className={`ml-auto font-mono text-[14px] font-bold tabular ${
                  member.net > 0
                    ? "text-win"
                    : member.net < 0
                      ? "text-loss"
                      : "text-muted"
                }`}
              >
                {inr(member.net)}
              </span>
            </div>
          ))}
        </div>

        {viewerTransfers.length ? (
          <div className="flex flex-col gap-2">
            <h2 className="text-[12px] font-semibold uppercase tracking-wide text-muted">
              {GW_UI_COPY.settleUp}
            </h2>
            {viewerTransfers.map((transfer) => (
              <div
                key={transfer.id}
                className={`flex items-center justify-between rounded-card px-4 py-3 ${
                  transfer.amount < 0
                    ? "bg-[#FEF2F2] dark:bg-[#ef44441f]"
                    : "bg-[#F0FDF4] dark:bg-[#16a34a1a]"
                }`}
              >
                <span className="text-[13px] font-semibold">
                  {transfer.amount < 0
                    ? owesPersonCopy(transfer.name)
                    : owedByPersonCopy(transfer.name)}
                </span>
                <span
                  className={`font-mono text-[14px] font-bold tabular ${
                    transfer.amount < 0 ? "text-loss" : "text-win"
                  }`}
                >
                  ₹{Math.abs(transfer.amount).toLocaleString("en-IN")}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-center text-[12px] text-muted">
            {GW_UI_COPY.duesEmpty}
          </p>
        )}
      </div>
    </LeagueShell>
  );
}
