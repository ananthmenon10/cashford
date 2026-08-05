"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { LocalTime } from "@/components/LocalTime";
import { GW_UI_COPY, LEAGUE_SCREEN_COPY } from "@/lib/gw-copy";
import type { GameweekViewDTO } from "@/lib/gw-view";

type GameweekRow = GameweekViewDTO["adjacentGameweeks"][number];

function stateLabel(row: GameweekRow): string {
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
  if (row.status === "open") return LEAGUE_SCREEN_COPY.sheetOpen;
  if (row.outcome === "settled" || row.status === "settled" || row.status === "completed") {
    return LEAGUE_SCREEN_COPY.settled.toLowerCase();
  }
  return LEAGUE_SCREEN_COPY.sheetSoon;
}

function rowMeta(row: GameweekRow): React.ReactNode {
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

export function GameweekStrip({
  slug,
  gameweek,
  adjacent,
}: {
  slug: string;
  gameweek: GameweekViewDTO["gameweek"];
  adjacent: GameweekViewDTO["adjacentGameweeks"];
}) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const dialogRef = useRef<HTMLElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeSheet = useCallback(() => setSheetOpen(false), []);

  useEffect(() => {
    if (!sheetOpen) return;
    const previousActive = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const dialog = dialogRef.current;
    const focusable = dialog
      ? Array.from(dialog.querySelectorAll<HTMLElement>("a[href], button:not([disabled]), [tabindex]:not([tabindex='-1'])"))
      : [];
    const initialFocus = dialog?.querySelector<HTMLElement>("button") ?? focusable[0];
    const frame = window.requestAnimationFrame(() => (initialFocus ?? dialog)?.focus());
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeSheet();
        return;
      }
      if (event.key !== "Tab" || !dialog) return;
      const controls = Array.from(dialog.querySelectorAll<HTMLElement>("a[href], button:not([disabled]), [tabindex]:not([tabindex='-1'])"));
      if (!controls.length) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      if (previousActive && document.contains(previousActive)) previousActive.focus();
      else triggerRef.current?.focus();
    };
  }, [closeSheet, sheetOpen]);

  if (!gameweek) return null;

  const index = adjacent.findIndex((row) => row.number === gameweek.number);
  const currentRow = adjacent[index] ?? {
    number: gameweek.number,
    name: gameweek.name,
    hasContest: true,
    status: gameweek.status,
    contestStatus: gameweek.status as GameweekRow["contestStatus"],
    outcome: null,
    deadlineAt: gameweek.deadlineAt,
    winnerName: null,
    matchCount: 0,
    homeFact: null,
  };
  const previous = [...adjacent.slice(0, index)].reverse().find((row) => row.hasContest);
  const next = adjacent.slice(index + 1).find((row) => row.hasContest);
  const hrefFor = (number: number) => `/leagues/${slug}?gw=${number}#league-gw-${number}-matches`;

  return (
    <>
      <section className="mt-4 rounded-cs2-lg border border-cs2-line bg-cs2-paper p-4" aria-label={GW_UI_COPY.gameweekNavigation}>
        <div className="flex items-center justify-between gap-3">
          {previous ? (
            <Link
              prefetch
              href={hrefFor(previous.number)}
              aria-label={GW_UI_COPY.previousGameweek}
              className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-cs2-line bg-cs2-paper text-xl leading-none text-cs2-ink-2 hover:bg-cs2-line-2"
            >
              ‹
            </Link>
          ) : <span className="h-9 w-9 shrink-0" />}
          <div className="min-w-0 text-center">
            <h1 className="truncate font-mono text-[17px] font-bold tabular">{gameweek.name}</h1>
            <p className="mt-1 text-[11px] font-semibold text-cs2-ink-3">{stateLabel(currentRow)}</p>
          </div>
          {next ? (
            <Link
              prefetch
              href={hrefFor(next.number)}
              aria-label={GW_UI_COPY.nextGameweek}
              className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-cs2-line bg-cs2-paper text-xl leading-none text-cs2-ink-2 hover:bg-cs2-line-2"
            >
              ›
            </Link>
          ) : <span className="h-9 w-9 shrink-0" />}
        </div>
        <div className="mt-4 flex items-center justify-between border-t border-cs2-line-2 pt-3 text-[11px] font-semibold text-cs2-ink-3">
          <span>
            {previous ? `GW${previous.number} ←` : ""}
          </span>
          <button
            type="button"
            ref={triggerRef}
            onClick={() => setSheetOpen(true)}
            aria-expanded={sheetOpen}
            aria-controls="all-gameweeks-dialog"
            className="rounded-pill border border-cs2-line bg-cs2-canvas px-3 py-1.5 text-cs2-ink-2 hover:bg-cs2-line-2"
          >
            {GW_UI_COPY.allGameweeks} <span aria-hidden>⌄</span>
          </button>
          <span>
            {next ? `→ GW${next.number}` : ""}
          </span>
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
                const selected = row.number === gameweek.number;
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
