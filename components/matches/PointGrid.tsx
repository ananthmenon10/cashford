"use client";

import { useEffect, useRef, useState } from "react";
import { LocalTime } from "@/components/LocalTime";
import { MATCH_COPY } from "@/lib/match-copy";
import type { PointGridCell, PointGridView } from "@/lib/point-grid";

const verdictClass: Record<NonNullable<PointGridCell["verdict"]>, string> = {
  exact: "border-cs2-green-line text-cs2-green",
  result: "border-cs2-amber-line text-cs2-amber",
  miss: "border-cs2-red-line text-cs2-red",
  void: "border-cs2-line text-cs2-ink-3",
};

const verdictBackgroundClass: Record<NonNullable<PointGridCell["verdict"]>, string> = {
  exact: "bg-cs2-green-soft",
  result: "bg-cs2-amber-soft",
  miss: "bg-cs2-red-soft",
  void: "bg-cs2-canvas",
};

const pinnedVerdictBackgroundClass: Record<NonNullable<PointGridCell["verdict"]>, string> = {
  exact: "before:bg-cs2-green-soft",
  result: "before:bg-cs2-amber-soft",
  miss: "before:bg-cs2-red-soft",
  void: "before:bg-cs2-canvas",
};

function fixtureTime({
  kickoffAt,
  status,
  minute,
}: PointGridView["rows"][number]["fixture"]) {
  if (status === "live") return MATCH_COPY.liveMinute(minute);
  if (kickoffAt) {
    return <LocalTime iso={kickoffAt} variant="time" relative={false} />;
  }
  return null;
}

export function PointGrid({ grid }: { grid: PointGridView }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [expandedEntrant, setExpandedEntrant] = useState<string | null>(null);
  const scrollable = grid.entrants.length >= 5;
  const [showEdgeCue, setShowEdgeCue] = useState(scrollable);
  const viewerIndex = grid.entrants.findIndex((entrant) => entrant.isViewer);
  const columns = scrollable
    // Keep the 4.75rem entrant tracks in sync with the cue's right-[4.75rem] offset below.
    ? `minmax(9.5rem, 1.5fr) repeat(${grid.entrants.length}, 4.75rem)`
    : `minmax(9.5rem, 1.5fr) repeat(${grid.entrants.length}, minmax(0, 1fr))`;

  const updateEdgeCue = () => {
    const scroll = scrollRef.current;
    if (!scroll || !scrollable) {
      setShowEdgeCue(false);
      return;
    }
    if (scroll.clientWidth === 0 || scroll.scrollWidth === 0) return;
    if (scroll.scrollWidth <= scroll.clientWidth) {
      setShowEdgeCue(false);
      return;
    }
    setShowEdgeCue(scroll.scrollLeft + scroll.clientWidth < scroll.scrollWidth - 1);
  };

  useEffect(() => {
    setShowEdgeCue(scrollable);
    updateEdgeCue();
  }, [scrollable]);

  if (grid.entrants.length === 0) {
    return (
      <section data-testid="point-grid" className="rounded-cs2-lg border border-dashed border-cs2-line p-5 text-center text-[12px] font-semibold text-cs2-ink-3">
        {MATCH_COPY.pointGridNoEntrants}
      </section>
    );
  }

  return (
    <section data-testid="point-grid" aria-label={MATCH_COPY.pointGridLabel} className="relative overflow-hidden rounded-cs2-lg border border-cs2-line bg-cs2-paper">
      <div
        ref={scrollRef}
        data-testid="point-grid-scroll"
        data-scrollable={scrollable ? "true" : "false"}
        onScroll={updateEdgeCue}
        className={scrollable ? "overflow-x-auto" : "overflow-x-hidden"}
      >
        <div
          className={`grid ${scrollable ? "min-w-[34rem]" : "w-full"}`}
          style={{ gridTemplateColumns: columns }}
        >
          <div
            data-testid="point-grid-fixture-header"
            className="sticky left-0 z-20 border-b border-cs2-line bg-cs2-paper px-3 py-3 text-[10px] font-extrabold uppercase tracking-[.08em] text-cs2-ink-3"
          >
            {MATCH_COPY.pointGridLabel}
          </div>
          {grid.entrants.map((entrant, index) => {
            const expanded = expandedEntrant === entrant.entryId;
            const isViewer = index === viewerIndex && scrollable;
            return (
              <button
                key={entrant.entryId}
                type="button"
                data-testid={isViewer ? "point-grid-viewer-header" : undefined}
                aria-label={expanded ? MATCH_COPY.pointGridHideName(entrant.name) : MATCH_COPY.pointGridShowName(entrant.name)}
                onClick={() => setExpandedEntrant(expanded ? null : entrant.entryId)}
                className={`min-w-0 border-b border-l border-cs2-line bg-cs2-paper px-2 py-2 text-center ${isViewer ? "sticky right-0 z-20" : ""}`}
              >
                <span className={expanded
                  ? "block whitespace-normal break-words font-sans text-[10px] font-extrabold leading-tight text-cs2-ink"
                  : "block truncate font-sans text-[11px] font-extrabold text-cs2-ink"}
                >
                  {expanded ? entrant.name : entrant.initials}
                </span>
                <span className="mt-0.5 block font-mono text-[10px] font-bold tabular text-cs2-ink-3">
                  {entrant.totalPoints == null ? "—" : MATCH_COPY.pointGridPoints(entrant.totalPoints)}
                </span>
              </button>
            );
          })}
          {grid.rows.map((row) => (
            <GridRow
              key={row.fixture.fixtureId}
              row={row}
              viewerIndex={viewerIndex}
              scrollable={scrollable}
            />
          ))}
        </div>
      </div>
      {showEdgeCue ? (
        <div data-testid="point-grid-edge-cue" aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-[4.75rem] z-30 w-2 border-l border-cs2-green-line bg-cs2-paper" />
      ) : null}
      {scrollable ? <p className="border-t border-cs2-line px-3 py-2 text-[10px] font-semibold text-cs2-ink-3">{MATCH_COPY.pointGridScrollMore}</p> : null}
    </section>
  );
}

function GridRow({
  row,
  viewerIndex,
  scrollable,
}: {
  row: PointGridView["rows"][number];
  viewerIndex: number;
  scrollable: boolean;
}) {
  const score = (row.fixture.status === "live" || row.fixture.status === "finished") &&
      row.fixture.homeScore != null && row.fixture.awayScore != null
    ? `${row.fixture.homeScore}–${row.fixture.awayScore}`
    : "—";
  return (
    <>
      <div className="sticky left-0 z-10 border-t border-cs2-line bg-cs2-paper px-3 py-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-[12px] font-bold text-cs2-ink">{row.fixture.homeName}</p>
            <p className="truncate text-[12px] font-bold text-cs2-ink">{row.fixture.awayName}</p>
          </div>
          <span className="shrink-0 font-mono text-[13px] font-extrabold tabular text-cs2-ink">{score}</span>
        </div>
        <div className="mt-1 text-[10px] font-semibold text-cs2-ink-3">
          {fixtureTime(row.fixture)}
        </div>
      </div>
      {row.cells.map((cell, index) => {
        const isViewer = scrollable && index === viewerIndex;
        const tone = cell.verdict ? verdictClass[cell.verdict] : "border-cs2-line text-cs2-ink-2";
        const background = cell.verdict
          ? isViewer
            ? `before:pointer-events-none before:absolute before:inset-0 before:z-0 ${pinnedVerdictBackgroundClass[cell.verdict]}`
            : verdictBackgroundClass[cell.verdict]
          : "";
        return (
          <div
            key={`${row.fixture.fixtureId}-${index}`}
            data-testid={cell.verdict ? `point-grid-cell-${cell.verdict}` : undefined}
            className={`flex min-h-[5.25rem] flex-col items-center justify-center border-l border-t px-1.5 text-center ${isViewer ? "sticky right-0 z-10 bg-cs2-paper" : ""} ${background} ${tone}`}
          >
            <span
              data-testid={isViewer ? "point-grid-viewer-cell" : undefined}
              className={isViewer ? "relative z-10" : undefined}
            >
              <span className="font-mono text-[14px] font-extrabold tabular">
                {cell.pick ? `${cell.pick[0]}–${cell.pick[1]}` : "—"}
              </span>
              {cell.points != null ? (
                <span className="mt-1 block font-mono text-[10px] font-bold tabular">+{cell.points}</span>
              ) : null}
            </span>
          </div>
        );
      })}
    </>
  );
}
