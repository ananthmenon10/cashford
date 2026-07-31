import Link from "next/link";
import { Avatar } from "@/components/ui";
import { BackLink } from "@/components/BackLink";
import { GW_TABS } from "@/lib/gw-copy";
import type { GameweekViewDTO } from "@/lib/gw-view";
import { GameweekStrip } from "./GameweekStrip";

const TABS = [
  { key: "gameweek", label: GW_TABS.gameweek, suffix: "" },
  { key: "season", label: GW_TABS.season, suffix: "/season" },
  { key: "dues", label: GW_TABS.dues, suffix: "/dues" },
] as const;

export function LeagueShell({
  view,
  active,
  viewerName,
  children,
}: {
  view: Pick<GameweekViewDTO, "league" | "participation" | "gameweek" | "adjacentGameweeks">;
  active: (typeof TABS)[number]["key"];
  viewerName: string;
  children: React.ReactNode;
}) {
  return (
    <main className="min-h-screen bg-cs2-canvas text-cs2-ink">
      <header className="border-b border-cs2-line-2 bg-cs2-paper">
        <div className="mx-auto flex max-w-[520px] items-center gap-3 px-4 py-3">
          <BackLink href="/" />
          <div className="min-w-0">
            <div className="truncate text-[17px] font-extrabold">{view.league.name}</div>
            <div className="mt-0.5 truncate text-[11px] font-semibold text-cs2-ink-3">
              {view.participation.status !== "none"
                ? view.participation.competitionName
                : null}
            </div>
          </div>
          <span className="ml-auto">
            <Avatar label={viewerName} size={30} />
          </span>
        </div>
        <nav className="mx-auto grid max-w-[520px] grid-cols-4 px-4" aria-label={view.league.name}>
          {TABS.map((tab) => (
            <Link
              key={tab.key}
              href={`/leagues/${view.league.slug}${tab.suffix}`}
              aria-current={active === tab.key ? "page" : undefined}
              className={`border-b-2 px-1 pb-2.5 pt-1 text-center text-[13px] font-bold ${
                active === tab.key
                  ? "border-cs2-green text-cs2-ink"
                  : "border-transparent text-cs2-ink-3"
              }`}
            >
              {tab.label}
            </Link>
          ))}
          <span aria-hidden className="border-b-2 border-transparent" />
        </nav>
      </header>

      <div className="mx-auto max-w-[520px] px-4 pb-10">
        <GameweekStrip
          slug={view.league.slug}
          gameweek={view.gameweek}
          adjacent={view.adjacentGameweeks}
        />
        {children}
      </div>
    </main>
  );
}
