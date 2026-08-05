import type { ReactNode } from "react";
import Link from "next/link";
import type { LeagueIdentity } from "@/lib/gw-view";
import { Avatar } from "@/components/ui";
import { BackLink } from "@/components/BackLink";
import { GW_TABS } from "@/lib/gw-copy";
import { CompetitionSheet } from "./CompetitionSheet";
import { loadCompetitionSheet } from "@/lib/competition-sheet";
import { createClient } from "@/lib/supabase/server";

export type LeagueTabKey = keyof typeof GW_TABS;

const TABS: readonly { key: LeagueTabKey; label: string; suffix: string }[] = [
  { key: "gameweek", label: GW_TABS.gameweek, suffix: "" },
  { key: "season", label: GW_TABS.season, suffix: "/season" },
  { key: "dues", label: GW_TABS.dues, suffix: "/dues" },
  { key: "table", label: GW_TABS.table, suffix: "/table" },
];

export async function LeagueShell({
  identity,
  active,
  viewerName,
  showCompetitionSheet = true,
  selectedGameweek,
  children,
}: {
  identity: LeagueIdentity;
  active: LeagueTabKey;
  viewerName: string;
  showCompetitionSheet?: boolean;
  selectedGameweek?: string | number | null;
  children: ReactNode;
}) {
  const sheet = showCompetitionSheet
    ? await loadCompetitionSheet(await createClient(), identity.league.id, identity.league.slug)
    : null;
  const query = selectedGameweek == null ? "" : `?gw=${selectedGameweek}`;
  const tabHref = (suffix: string) => `/leagues/${identity.league.slug}${suffix}${query}`;
  return (
    <main className="min-h-screen bg-cs2-canvas text-cs2-ink">
      <header className="border-b border-cs2-line-2 bg-cs2-paper">
        <div className="mx-auto flex max-w-[520px] items-center gap-3 px-4 py-3">
          <BackLink href="/" />
          <div className="min-w-0">
            <div className="truncate text-[17px] font-extrabold">{identity.league.name}</div>
            <div className="mt-0.5 truncate text-[11px] font-semibold text-cs2-ink-3">{identity.participation.competitionName}</div>
          </div>
          {sheet ? <CompetitionSheet dto={sheet} /> : null}
          <Avatar label={viewerName} size={30} />
        </div>
        <nav className="mx-auto grid max-w-[520px] grid-cols-4 px-4" aria-label={identity.league.name}>
          {TABS.map((tab) => (
            <Link
              key={tab.key}
              href={tabHref(tab.suffix)}
              prefetch
              aria-current={active === tab.key ? "page" : undefined}
              className={`border-b-2 px-1 pb-2.5 pt-1 text-center text-[13px] font-bold ${
                active === tab.key ? "border-cs2-green text-cs2-ink" : "border-transparent text-cs2-ink-3"
              }`}
            >
              {tab.label}
            </Link>
          ))}
        </nav>
      </header>

      <div className="mx-auto max-w-[520px] px-4 pb-10">{children}</div>
    </main>
  );
}
