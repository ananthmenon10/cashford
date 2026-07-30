import Link from "next/link";
import {
  GW_UI_COPY,
} from "@/lib/gw-copy";
import type { GameweekViewDTO } from "@/lib/gw-view";

export function GameweekStrip({
  slug,
  gameweek,
  adjacent,
}: {
  slug: string;
  gameweek: GameweekViewDTO["gameweek"];
  adjacent: GameweekViewDTO["adjacentGameweeks"];
}) {
  if (!gameweek) return null;
  const index = adjacent.findIndex((row) => row.number === gameweek.number);
  const previous = [...adjacent.slice(0, index)].reverse().find((row) => row.hasContest);
  const next = adjacent.slice(index + 1).find((row) => row.hasContest);
  return (
    <div className="flex items-center justify-between py-4">
      {previous ? (
        <Link
          href={`/leagues/${slug}?gw=${previous.number}`}
          aria-label={GW_UI_COPY.previousGameweek}
          className="grid h-8 w-8 place-items-center rounded-full border border-cs2-line bg-cs2-paper text-cs2-ink-2"
        >
          ‹
        </Link>
      ) : (
        <span className="h-8 w-8" />
      )}
      <div className="text-center">
        <div className="font-mono text-[15px] font-bold tabular">{gameweek.name}</div>
        <div className="mt-1 text-[10px] font-bold uppercase tracking-[.1em] text-cs2-ink-3">
          {gameweek.status}
        </div>
      </div>
      {next ? (
        <Link
          href={`/leagues/${slug}?gw=${next.number}`}
          aria-label={GW_UI_COPY.nextGameweek}
          className="grid h-8 w-8 place-items-center rounded-full border border-cs2-line bg-cs2-paper text-cs2-ink-2"
        >
          ›
        </Link>
      ) : (
        <span className="h-8 w-8" />
      )}
    </div>
  );
}
