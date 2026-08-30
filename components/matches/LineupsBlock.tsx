import { MATCH_COPY } from "@/lib/match-copy";
import type {
  Club,
  MatchDetailView,
} from "@/lib/match-detail";
import type { MatchLineupPlayer, MatchLineupSide, MatchSide } from "@/lib/match-types";

const card =
  "rounded-card border border-border bg-surface p-4 shadow-[0_2px_8px_rgba(15,23,42,.04)]";

function Source({ block }: { block: { source: string; age: string } }) {
  return (
    <div className="mt-3 border-t border-border pt-2 text-[11px] text-muted">
      {block.source} · {block.age}
    </div>
  );
}

type FormationRow = {
  count: number;
  players: MatchLineupPlayer[];
};

function parsedFormation(
  formation: string,
  playerCount: number,
): number[] | null {
  const parts = formation.split("-").map((part) => part.trim());
  if (
    !parts.length ||
    parts.some((part) => !/^[1-9]\d*$/.test(part)) ||
    parts.reduce((total, part) => total + Number(part), 0) + 1 !== playerCount
  ) {
    return null;
  }
  return parts.map(Number);
}

function fallbackCounts(playerCount: number): number[] {
  const outfieldCount = Math.max(0, playerCount - 1);
  if (outfieldCount === 0) return [];
  const rowCount = Math.min(4, outfieldCount);
  const base = Math.floor(outfieldCount / rowCount);
  const extra = outfieldCount % rowCount;
  return Array.from({ length: rowCount }, (_, index) =>
    base + (index < extra ? 1 : 0),
  );
}

function rowsFromFormation(side: MatchLineupSide): FormationRow[] {
  const counts =
    parsedFormation(side.formation, side.players.length) ??
    fallbackCounts(side.players.length);
  const rows: FormationRow[] = [
    { count: 1, players: side.players.slice(0, 1) },
  ];
  let index = 1;
  for (const count of counts) {
    rows.push({
      count,
      players: side.players.slice(index, index + count),
    });
    index += count;
  }
  if (index < side.players.length) {
    rows.push({
      count: side.players.length - index,
      players: side.players.slice(index),
    });
  }
  return rows;
}

function surname(name: string): string {
  const vanIndex = name.indexOf(" van ");
  if (vanIndex >= 0) return name.slice(vanIndex + 1);
  return name.trim().split(/\s+/).slice(-1)[0] ?? name;
}

function sideLabel(side: MatchSide): string {
  return side === "home" ? MATCH_COPY.home : MATCH_COPY.lineupAway;
}

function Pitch({
  side,
  club,
  lineup,
}: {
  side: MatchSide;
  club: Club;
  lineup: MatchLineupSide;
}) {
  const rows = rowsFromFormation(lineup);
  return (
    <div className="min-w-0">
      <div className="mb-2 flex items-baseline justify-between gap-1 text-[9px] font-extrabold uppercase tracking-[.1em]">
        <span className="truncate text-primary-press">{club.name}</span>
        <span className="shrink-0 text-muted">{sideLabel(side)}</span>
      </div>
      <div className="relative min-h-[270px] overflow-hidden rounded-card border border-border bg-mint">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 left-1/4 w-1/2 border-x border-border opacity-60"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute left-0 right-0 top-1/2 border-t border-border opacity-60"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute left-1/2 top-1/2 h-16 w-16 -translate-x-1/2 -translate-y-1/2 rounded-full border border-border opacity-60"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute left-0 top-[35%] h-[30%] w-[18%] border-y border-r border-border opacity-50"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute right-0 top-[35%] h-[30%] w-[18%] border-y border-l border-border opacity-50"
        />
        <div className="relative z-10 flex min-h-[270px] flex-col justify-around gap-1 p-3">
          {rows.map((row, rowIndex) => (
            <div
              key={`${side}-${rowIndex}`}
              data-testid={`lineup-${side}-row-${rowIndex}`}
              className="grid items-start gap-1"
              style={{
                gridTemplateColumns: `repeat(${Math.max(row.players.length, 1)}, minmax(0, 1fr))`,
              }}
            >
              {row.players.map((player, playerIndex) => (
                <div
                  key={`${player.name}-${playerIndex}`}
                  data-testid={`lineup-pin-${side}`}
                  className="min-w-0 text-center"
                >
                  <span className="mx-auto mb-1 grid h-7 w-7 place-items-center rounded-full border-2 border-border bg-surface font-mono text-[9px] font-bold text-primary-press">
                    {player.shirt == null
                      ? MATCH_COPY.missingValue
                      : player.shirt}
                  </span>
                  <span className="block truncate text-[8px] font-bold leading-tight">
                    {surname(player.name)}
                  </span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
      <div className="mt-2 flex items-center justify-between gap-2 text-[10px] font-bold text-muted">
        <span className="font-mono">{lineup.formation}</span>
        <span>{MATCH_COPY.lineupStarterCount(lineup.players.length)}</span>
      </div>
    </div>
  );
}

export function LineupsBlock({
  lineups,
  home,
  away,
}: {
  lineups?: MatchDetailView["lineups"];
  home: Club;
  away: Club;
}) {
  if (!lineups) return null;

  return (
    <section className={card}>
      <h2 className="font-extrabold">{MATCH_COPY.lineups}</h2>
      <p className="mt-1 text-[10px] font-bold uppercase tracking-[.12em] text-primary-press">
        {MATCH_COPY.lineupsKicker}
      </p>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <Pitch side="home" club={home} lineup={lineups.home} />
        <Pitch side="away" club={away} lineup={lineups.away} />
      </div>
      <Source block={lineups} />
    </section>
  );
}
