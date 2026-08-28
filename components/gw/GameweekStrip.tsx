"use client";

import Link from "next/link";
import { LocalTime } from "@/components/LocalTime";
import { GW_UI_COPY, LEAGUE_SCREEN_COPY } from "@/lib/gw-copy";
import { useBottomSheet } from "@/lib/use-bottom-sheet";
import type { GameweekAccessTarget } from "@/lib/gw-resolve-app";
import type { GameweekViewDTO } from "@/lib/gw-view";

type GameweekRow = GameweekViewDTO["adjacentGameweeks"][number];

function stateLabel(row: GameweekRow): string {
  if (row.lifecycle) {
    const state = GW_UI_COPY.gameweekAccessState(row.lifecycle);
    return row.lifecycle === "CL5" && row.matchCount
      ? LEAGUE_SCREEN_COPY.statusWithMatches(state, row.matchCount)
      : state;
  }
  if (row.outcome === "void" || row.status === "void") return LEAGUE_SCREEN_COPY.void;
  if (row.outcome === "settled" || row.status === "settled" || row.status === "completed") {
    return row.matchCount ? LEAGUE_SCREEN_COPY.statusWithMatches(LEAGUE_SCREEN_COPY.settled, row.matchCount) : LEAGUE_SCREEN_COPY.settled;
  }
  if (row.status === "open") return row.matchCount ? LEAGUE_SCREEN_COPY.statusWithMatches(LEAGUE_SCREEN_COPY.open, row.matchCount) : LEAGUE_SCREEN_COPY.open;
  if (row.status === "locked" || row.status === "settling") return LEAGUE_SCREEN_COPY.locked;
  return LEAGUE_SCREEN_COPY.upcoming;
}

function sheetState(row: GameweekRow, selected: boolean): string {
  if (selected) return LEAGUE_SCREEN_COPY.selected;
  if (row.lifecycle === "CL7" || row.outcome === "void" || row.status === "void") {
    return LEAGUE_SCREEN_COPY.void.toLowerCase();
  }
  if (row.status === "open") return LEAGUE_SCREEN_COPY.sheetOpen;
  if (row.outcome === "settled" || row.status === "settled" || row.status === "completed") {
    return LEAGUE_SCREEN_COPY.settled.toLowerCase();
  }
  return LEAGUE_SCREEN_COPY.sheetSoon;
}

function rowMeta(row: GameweekRow): React.ReactNode {
  if (row.lifecycle && row.lifecycle !== "CL1" && row.lifecycle !== "CL5") {
    return stateLabel(row);
  }
  if (row.status === "open" && row.deadlineAt) {
    return <>{LEAGUE_SCREEN_COPY.deadline} <LocalTime iso={row.deadlineAt} relative={false} includeYear={false} /></>;
  }
  if (row.outcome === "settled" || row.status === "settled" || row.status === "completed") {
    return row.winnerName && row.matchCount
      ? LEAGUE_SCREEN_COPY.winnerMatches(row.winnerName, row.matchCount)
      : LEAGUE_SCREEN_COPY.settledResult;
  }
  if (row.status === "locked" || row.status === "settling") return LEAGUE_SCREEN_COPY.locked;
  return row.deadlineAt ? <>{LEAGUE_SCREEN_COPY.upcomingDeadline} <LocalTime iso={row.deadlineAt} relative={false} includeYear={false} /></> : LEAGUE_SCREEN_COPY.upcoming;
}

function accessLabel(target: GameweekAccessTarget | null, emptyCopy: string): string {
  return target
    ? GW_UI_COPY.gameweekSegment(target.number, GW_UI_COPY.gameweekAccessState(target.lifecycle))
    : emptyCopy;
}

function AccessSegment({
  target,
  emptyCopy,
  selected,
  href,
}: {
  target: GameweekAccessTarget | null;
  emptyCopy: string;
  selected: boolean;
  href: string | null;
}) {
  const label = accessLabel(target, emptyCopy);
  const className = `min-w-0 flex-1 rounded-cs2-sm px-2 py-2 text-center text-[11px] font-extrabold ${
    target && selected
      ? "bg-cs2-green-soft text-cs2-green"
      : target
        ? "text-cs2-ink-2 hover:bg-cs2-canvas"
        : "text-cs2-ink-3"
  }`;
  if (!target || !href) {
    return (
      <button type="button" disabled aria-disabled="true" aria-label={label} className={className}>
        {label}
      </button>
    );
  }
  return (
    <Link href={href} prefetch aria-label={label} aria-current={selected ? "page" : undefined} className={className}>
      {label}
    </Link>
  );
}

export function GameweekStrip({
  slug,
  gameweek,
  adjacent,
  gameweekAccess,
}: {
  slug: string;
  gameweek: GameweekViewDTO["gameweek"];
  adjacent: GameweekViewDTO["adjacentGameweeks"];
  gameweekAccess: GameweekViewDTO["gameweekAccess"];
}) {
  const { open: sheetOpen, setOpen: setSheetOpen, close: closeSheet, dialogRef, triggerRef } = useBottomSheet();

  const hrefFor = (number: number) => `/leagues/${slug}?gw=${number}#league-gw-${number}-matches`;

  return (
    <>
      <section className="mt-4 rounded-cs2-lg border border-cs2-line bg-cs2-paper p-2" aria-label={GW_UI_COPY.gameweekNavigation}>
        <div className="flex items-stretch gap-1" role="group" aria-label={GW_UI_COPY.gameweekNavigation}>
          <AccessSegment
            target={gameweekAccess.now}
            emptyCopy={GW_UI_COPY.noCurrentWeek}
            selected={gameweekAccess.now?.number === gameweek?.number}
            href={gameweekAccess.now ? hrefFor(gameweekAccess.now.number) : null}
          />
          <AccessSegment
            target={gameweekAccess.last}
            emptyCopy={GW_UI_COPY.noSettledWeek}
            selected={gameweekAccess.last?.number === gameweek?.number}
            href={gameweekAccess.last ? hrefFor(gameweekAccess.last.number) : null}
          />
          <button
            type="button"
            ref={triggerRef}
            onClick={() => setSheetOpen(true)}
            aria-expanded={sheetOpen}
            aria-controls="all-gameweeks-dialog"
            className="min-w-0 flex-1 rounded-cs2-sm px-2 py-2 text-center text-[11px] font-extrabold text-cs2-ink-2 hover:bg-cs2-canvas"
          >
            {GW_UI_COPY.allWeeks}
          </button>
        </div>
      </section>

      {sheetOpen ? (
        <div className="fixed inset-0 z-30 flex items-end bg-black/30" role="presentation" onClick={closeSheet}>
          <section
            id="all-gameweeks-dialog"
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="all-gameweeks-title"
            tabIndex={-1}
            className="mx-auto max-h-[82vh] w-full max-w-[520px] overflow-y-auto rounded-t-cs2-lg bg-cs2-paper px-4 pb-6 pt-3 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mx-auto h-1 w-10 rounded-full bg-cs2-line" />
            <p className="mt-4 text-[10px] font-extrabold uppercase tracking-[.12em] text-cs2-green">{GW_UI_COPY.gameweekNavigation}</p>
            <div className="mt-1 flex items-end justify-between gap-3">
              <h2 id="all-gameweeks-title" className="text-[21px] font-extrabold">{GW_UI_COPY.allGameweeks}</h2>
              <button type="button" onClick={closeSheet} className="rounded-pill px-2 py-1 text-[12px] font-bold text-cs2-ink-3">{GW_UI_COPY.close}</button>
            </div>
            <p className="mt-1 text-[12px] text-cs2-ink-3">{GW_UI_COPY.chooseGameweek}</p>
            <div className="mt-4 divide-y divide-cs2-line-2 rounded-cs2-md border border-cs2-line">
              {adjacent.map((row) => {
                const selected = row.number === gameweek?.number;
                const content = (
                  <>
                    <span className="w-8 shrink-0 font-mono text-[11px] font-bold text-cs2-ink-3 tabular">{String(row.number).padStart(2, "0")}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] font-bold">{LEAGUE_SCREEN_COPY.gameweekName(row.number)}</span>
                      <span className="mt-0.5 block truncate text-[11px] text-cs2-ink-3">{rowMeta(row)}</span>
                    </span>
                    <span className={`shrink-0 text-[10px] font-bold ${selected ? "text-cs2-green" : row.status === "open" ? "text-cs2-green" : "text-cs2-ink-3"}`}>
                      <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-current align-middle" />
                      {sheetState(row, selected)}
                    </span>
                  </>
                );
                return row.hasContest ? (
                  <Link
                    prefetch
                    key={row.number}
                    href={hrefFor(row.number)}
                    aria-label={LEAGUE_SCREEN_COPY.openMatches(row.number)}
                    onClick={() => setSheetOpen(false)}
                    className={`flex items-center gap-3 px-3 py-3 ${selected ? "bg-cs2-green-soft" : "hover:bg-cs2-canvas"}`}
                  >
                    {content}
                  </Link>
                ) : (
                  <div key={row.number} className="flex items-center gap-3 px-3 py-3 text-cs2-ink-3">
                    {content}
                  </div>
                );
              })}
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}
