import { TableStandard, type TableStandardRow } from "@/components/TableStandard";
import type { StandingsView } from "@/lib/standings-view";
import { ARCHIVE_COPY } from "@/lib/payment-copy";
import { GW_BADGE_COPY, LEAGUE_SCREEN_COPY } from "@/lib/gw-copy";

export function CompetitionTable({
  view,
  liveClubs = [],
}: {
  view: StandingsView | null;
  liveClubs?: readonly string[];
}) {
  if (!view) {
    return (
      <div className="rounded-cs2-lg border border-cs2-line bg-cs2-paper p-5 text-center">
        <h2 className="font-extrabold">{ARCHIVE_COPY.tableUnavailable}</h2>
        <p className="mt-1 text-[12px] text-cs2-ink-3">{ARCHIVE_COPY.tableUnavailableBody}</p>
      </div>
    );
  }

  const live = new Set(liveClubs);
  const rows: TableStandardRow[] = view.rows.map((club) => {
    const isLive = live.has(club.club);
    return {
      key: club.club_id,
      tone: isLive ? "live" : "default",
      liveLabel: isLive ? GW_BADGE_COPY.live : undefined,
      cells: [
        <span key="club" className="flex min-w-0 items-center gap-2">
          <span className="w-5 shrink-0 font-mono text-[11px] text-cs2-ink-3 tabular">{club.rank}</span>
          <span className="truncate font-bold">{club.club}</span>
        </span>,
        club.played,
        `${club.won}–${club.drawn}–${club.lost}`,
        club.gd > 0 ? `+${club.gd}` : club.gd < 0 ? `−${Math.abs(club.gd)}` : club.gd,
        <span key="points" className="font-bold">{club.points}</span>,
      ],
    };
  });

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
        columns={[
          { key: "club", label: LEAGUE_SCREEN_COPY.club, basis: 178, grow: 1 },
          { key: "played", label: LEAGUE_SCREEN_COPY.played, basis: 38, align: "center", numeric: true },
          { key: "record", label: LEAGUE_SCREEN_COPY.record, basis: 68, align: "center", numeric: true },
          { key: "gd", label: LEAGUE_SCREEN_COPY.goalDifference, basis: 48, align: "center", numeric: true },
          { key: "points", label: LEAGUE_SCREEN_COPY.pointsShort, basis: 48, align: "center", numeric: true },
        ]}
        rows={rows}
      />
      <p className="mt-2 text-[10px] font-semibold text-cs2-ink-3">{LEAGUE_SCREEN_COPY.clubTableFoot(rows.length)}</p>
      {view.note ? <p className="mt-3 text-[11px] text-cs2-ink-3">{view.note}</p> : null}
    </section>
  );
}
