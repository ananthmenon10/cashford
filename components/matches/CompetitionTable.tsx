import { TableStandard, type TableStandardColumn, type TableStandardRow } from "@/components/TableStandard";
import type { StandingsView } from "@/lib/standings-view";
import { ARCHIVE_COPY } from "@/lib/payment-copy";
import { GW_BADGE_COPY, LEAGUE_SCREEN_COPY } from "@/lib/gw-copy";
import { MATCH_COPY } from "@/lib/match-copy";
import { toEspnClubName } from "@/lib/club-name-alias";

const MATCHES_COLUMNS: TableStandardColumn[] = [
  { key: "club", label: LEAGUE_SCREEN_COPY.club, basis: 178, grow: 1 },
  { key: "played", label: LEAGUE_SCREEN_COPY.played, basis: 44, align: "center", numeric: true },
  { key: "gd", label: LEAGUE_SCREEN_COPY.goalDifference, basis: 48, align: "center", numeric: true },
  { key: "points", label: LEAGUE_SCREEN_COPY.pointsShort, basis: 48, align: "center", numeric: true },
];

const LEAGUE_COLUMNS: TableStandardColumn[] = [
  { key: "club", label: LEAGUE_SCREEN_COPY.club, basis: 178, grow: 1 },
  { key: "played", label: LEAGUE_SCREEN_COPY.played, basis: 38, align: "center", numeric: true },
  { key: "record", label: LEAGUE_SCREEN_COPY.record, basis: 68, align: "center", numeric: true },
  { key: "gd", label: LEAGUE_SCREEN_COPY.goalDifference, basis: 48, align: "center", numeric: true },
  { key: "points", label: LEAGUE_SCREEN_COPY.pointsShort, basis: 48, align: "center", numeric: true },
];

export function CompetitionTable({
  view,
  liveClubs = [],
  liveMinutes,
  variant = "league",
  competitionName,
  playedMeta,
}: {
  view: StandingsView | null;
  /** League-screen (default) variant: club is "live" tone with a fixed "LIVE" label. */
  liveClubs?: readonly string[];
  /** Matches-tab variant: club is "live" tone with a minute-specific "LIVE 63′" label. Takes
   * precedence over liveClubs when provided. */
  liveMinutes?: ReadonlyMap<string, number | null>;
  /** "league" (default) keeps the existing club standings card used on the league screen.
   * "matches" drops the Record column and swaps the head for the matches-tab table-card-head
   * (competition name / played-count / FULL TABLE) — same TableStandard, same sticky-club-column
   * and live-badge behaviour, different column set and head copy. */
  variant?: "league" | "matches";
  competitionName?: string;
  playedMeta?: string;
}) {
  if (!view) {
    return (
      <div className="rounded-cs2-lg border border-cs2-line bg-cs2-paper p-5 text-center">
        <h2 className="font-extrabold">{ARCHIVE_COPY.tableUnavailable}</h2>
        <p className="mt-1 text-[12px] text-cs2-ink-3">{ARCHIVE_COPY.tableUnavailableBody}</p>
      </div>
    );
  }

  // Both live sources are FPL-shaped club names; the table's own club names are ESPN-shaped —
  // alias before joining so all 20 clubs (not just the 12 that already match verbatim) highlight.
  const live = liveMinutes
    ? new Set(liveMinutes.keys())
    : new Set(liveClubs.map(toEspnClubName));
  const rows: TableStandardRow[] = view.rows.map((club) => {
    const isLive = live.has(club.club);
    const liveLabel = !isLive
      ? undefined
      : liveMinutes
        ? MATCH_COPY.liveMinute(liveMinutes.get(club.club) ?? null)
        : GW_BADGE_COPY.live;
    const gdCell = club.gd > 0 ? `+${club.gd}` : club.gd < 0 ? `−${Math.abs(club.gd)}` : club.gd;
    const clubCell = (
      <span key="club" className="flex min-w-0 items-center gap-2">
        <span className="w-5 shrink-0 font-mono text-[11px] text-cs2-ink-3 tabular">{club.rank}</span>
        <span className="truncate font-bold">{club.club}</span>
      </span>
    );
    const pointsCell = <span key="points" className="font-bold">{club.points}</span>;
    return {
      key: club.club_id,
      tone: isLive ? "live" : "default",
      liveLabel,
      cells:
        variant === "matches"
          ? [clubCell, club.played, gdCell, pointsCell]
          : [clubCell, club.played, `${club.won}–${club.drawn}–${club.lost}`, gdCell, pointsCell],
    };
  });

  if (variant === "matches") {
    return (
      <section>
        <div className="mb-2 flex items-center justify-between gap-3 rounded-cs2-sm border border-cs2-line-2 bg-cs2-canvas px-3 py-2">
          <div className="min-w-0">
            <p className="truncate text-[11px] font-extrabold text-cs2-green">{competitionName}</p>
            <p className="mt-0.5 text-[10px] text-cs2-ink-3">{playedMeta}</p>
          </div>
          <span className="shrink-0 text-[10px] font-bold uppercase tracking-[.08em] text-cs2-ink-3">{MATCH_COPY.fullTableBadge}</span>
        </div>
        <TableStandard ariaLabel={MATCH_COPY.fullTable} columns={MATCHES_COLUMNS} rows={rows} />
        {view.note ? <p className="mt-3 text-[11px] text-cs2-ink-3">{view.note}</p> : null}
      </section>
    );
  }

  return (
    <section>
      <div className="mb-3 flex items-end justify-between gap-3">
        <div>
          <p className="text-[10px] font-extrabold uppercase tracking-[.1em] text-cs2-green">{LEAGUE_SCREEN_COPY.clubTableTitle}</p>
          <p className="mt-1 text-[12px] text-cs2-ink-3">{LEAGUE_SCREEN_COPY.clubTableSource(rows.length)}</p>
        </div>
        <span className="shrink-0 text-[10px] font-bold uppercase tracking-[.08em] text-cs2-ink-3">{LEAGUE_SCREEN_COPY.clubs(rows.length)}</span>
      </div>
      <div className="mb-2 rounded-cs2-sm border border-cs2-line-2 bg-cs2-canvas px-3 py-2 text-[11px] font-semibold text-cs2-ink-3">⌖ {LEAGUE_SCREEN_COPY.clubStickyHint}</div>
      <TableStandard
        ariaLabel={LEAGUE_SCREEN_COPY.clubTableAria}
        columns={LEAGUE_COLUMNS}
        rows={rows}
      />
      <p className="mt-2 text-[10px] font-semibold text-cs2-ink-3">{LEAGUE_SCREEN_COPY.clubTableFoot(rows.length)}</p>
      {view.note ? <p className="mt-3 text-[11px] text-cs2-ink-3">{view.note}</p> : null}
    </section>
  );
}
