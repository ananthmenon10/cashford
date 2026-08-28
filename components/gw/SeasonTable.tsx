import Link from "next/link";
import { LocalTime } from "@/components/LocalTime";
import {
  C26,
  C29,
  C60,
  GW_BADGE_COPY,
  GW_UI_COPY,
  LEAGUE_SCREEN_COPY,
  moneyCopy,
  voidReasonCopy,
} from "@/lib/gw-copy";
import type { SeasonRow, SeasonView } from "@/lib/gw-season";
import { EmptyState } from "./EmptyState";

function stateLabel(row: SeasonRow): string {
  if (row.isVoid || row.outcome === "void" || row.status === "void") return LEAGUE_SCREEN_COPY.void;
  if (row.outcome === "settled" || row.status === "settled" || row.status === "completed") return LEAGUE_SCREEN_COPY.settled;
  if (row.status === "open" && row.hasContest) return LEAGUE_SCREEN_COPY.open;
  if (row.status === "locked" || row.status === "settling") return LEAGUE_SCREEN_COPY.live;
  return LEAGUE_SCREEN_COPY.upcoming;
}

function historySubline(row: SeasonRow): React.ReactNode {
  if (row.isVoid || row.outcome === "void" || row.status === "void") {
    return row.voidReason === "single_entrant"
      ? voidReasonCopy("single_entrant")
      : row.voidReason === "no_entrants"
        ? voidReasonCopy("no_entrants")
        : C26(row.gwNumber);
  }
  if (row.outcome === "settled" || row.status === "settled" || row.status === "completed") {
    const winner = row.winnerName ? LEAGUE_SCREEN_COPY.historyWinner(row.winnerName) : LEAGUE_SCREEN_COPY.settledResult;
    const result = row.rank == null ? "" : LEAGUE_SCREEN_COPY.historyResult(row.rank);
    return `${winner}${result}`;
  }
  if (row.status === "open" && row.deadlineAt) {
    return <>{LEAGUE_SCREEN_COPY.openDeadline} <LocalTime iso={row.deadlineAt} relative={false} includeYear={false} /></>;
  }
  if (row.entryStatus == null && row.hasContest) return LEAGUE_SCREEN_COPY.notEntered;
  if (row.deadlineAt) {
    return <>{LEAGUE_SCREEN_COPY.upcomingDeadline} <LocalTime iso={row.deadlineAt} relative={false} includeYear={false} /></>;
  }
  return LEAGUE_SCREEN_COPY.upcoming;
}

function recalculatingBadge(): React.ReactNode {
  return (
    <span
      className="rounded-pill border border-cs2-amber-line bg-cs2-amber-soft px-1.5 py-0.5 text-[9px] font-extrabold tracking-[.04em] text-cs2-amber"
      title={C60}
    >
      {GW_BADGE_COPY.recalculating}
    </span>
  );
}

function historyValue(row: SeasonRow): { text: React.ReactNode; positive: boolean } {
  if (row.isVoid || row.outcome === "void" || row.status === "void") return { text: "—", positive: false };
  if (row.displayNetInr === "suppressed") return { text: recalculatingBadge(), positive: false };
  if (row.outcome !== "settled" || row.entryStatus == null) return { text: "—", positive: false };
  return { text: moneyCopy(row.displayNetInr), positive: row.displayNetInr > 0 };
}

export function SeasonTable({
  slug,
  view,
  viewerId,
  competitionName,
}: {
  slug: string;
  view: SeasonView;
  viewerId: string;
  competitionName: string;
}) {
  if (!view.rows.length && !view.totals.length) return <EmptyState copy={C29} />;

  const viewerTotal = view.totals.find((row) => row.userId === viewerId);
  const rank = viewerTotal?.rank ?? null;
  const points = viewerTotal?.points ?? view.rows.reduce((sum, row) => sum + (row.points ?? 0), 0);
  const exacts = viewerTotal?.exacts ?? view.rows.reduce((sum, row) => sum + (row.exacts ?? 0), 0);
  const entries = viewerTotal?.gameweeksEntered ?? view.rows.filter((row) => row.entryStatus === "locked_in").length;
  const net = viewerTotal?.netInr ?? view.rows.reduce((sum, row) => sum + (row.displayNetInr === "suppressed" ? 0 : row.displayNetInr), 0);
  const netAmount = net === "suppressed" ? 0 : net;
  const recalculating = points === "suppressed" || net === "suppressed";

  return (
    <section className="mt-4">
      <div className="rounded-cs2-lg border border-cs2-line bg-cs2-paper p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] font-extrabold uppercase tracking-[.1em] text-cs2-ink-3">{LEAGUE_SCREEN_COPY.seasonKicker(competitionName)}</p>
          <h1 className="mt-1 truncate text-[20px] font-extrabold">{LEAGUE_SCREEN_COPY.seasonTitle(view.viewerName)}</h1>
          </div>
          <span className="shrink-0 rounded-pill bg-cs2-green-soft px-2.5 py-1 text-[11px] font-bold text-cs2-green">
            {LEAGUE_SCREEN_COPY.rankOf(rank, view.totals.length)}
          </span>
        </div>
        <div className="mt-5 border-t border-cs2-line-2 pt-3">
          <p className="text-[10px] font-extrabold uppercase tracking-[.1em] text-cs2-ink-3">{LEAGUE_SCREEN_COPY.seasonNet}</p>
          {net === "suppressed" ? recalculatingBadge() : (
            <p className={`mt-1 font-mono text-[25px] font-extrabold tabular ${netAmount > 0 ? "text-cs2-green" : netAmount < 0 ? "text-cs2-red" : "text-cs2-ink"}`}>
              {moneyCopy(net)}
            </p>
          )}
        </div>
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] font-semibold text-cs2-ink-3">
          <span>{points === "suppressed" ? recalculatingBadge() : LEAGUE_SCREEN_COPY.points(points)}</span>
          <span>{LEAGUE_SCREEN_COPY.exacts(exacts)}</span>
          <span>{LEAGUE_SCREEN_COPY.entries(entries)}</span>
        </div>
        {recalculating ? <p className="mt-3 rounded-cs2-md border border-cs2-amber-line bg-cs2-amber-soft px-3 py-2 text-[11px] font-semibold text-cs2-amber">{C60}</p> : null}
      </div>

      <div className="mb-2 mt-6 flex items-center justify-between">
        <h2 className="text-[12px] font-extrabold uppercase tracking-[.1em] text-cs2-ink-3">{GW_UI_COPY.seasonHistory}</h2>
        <span className="text-[10px] font-semibold text-cs2-ink-3">{LEAGUE_SCREEN_COPY.historyCount(view.rows.length)}</span>
      </div>
      <div className="space-y-2">
        {view.rows.map((row) => {
          const value = historyValue(row);
          return (
            <Link
              key={row.gwNumber}
              href={`/leagues/${slug}?gw=${row.gwNumber}#league-gw-${row.gwNumber}-matches`}
              className="flex items-center gap-3 rounded-cs2-md border border-cs2-line bg-cs2-paper px-4 py-3 hover:border-cs2-green-line hover:bg-cs2-canvas"
            >
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-bold">{LEAGUE_SCREEN_COPY.gameweek(row.gwNumber, stateLabel(row))}</div>
                <div className="mt-0.5 truncate text-[11px] font-semibold text-cs2-ink-3">{historySubline(row)}</div>
              </div>
              <span className={`shrink-0 text-right font-mono text-[12px] font-bold tabular ${value.positive ? "text-cs2-green" : "text-cs2-ink-2"}`}>{value.text}</span>
              <span aria-hidden className="text-lg leading-none text-cs2-ink-3">›</span>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
