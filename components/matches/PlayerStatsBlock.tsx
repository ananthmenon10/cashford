import { MATCH_COPY } from "@/lib/match-copy";
import type {
  Club,
  MatchDetailView,
} from "@/lib/match-detail";
import {
  eventLedger,
  keeperNames,
  spotlights,
  type LedgerCategory,
  type LedgerEntry,
  type SpotlightCard,
} from "@/lib/match-blocks";
import type { MatchSide } from "@/lib/match-types";

const card =
  "rounded-card border border-border bg-surface p-4 shadow-[0_2px_8px_rgba(15,23,42,.04)]";

function Source({ block }: { block: { source: string; age: string } }) {
  return (
    <div className="mt-3 border-t border-border pt-2 text-[11px] text-muted">
      {block.source} · {block.age}
    </div>
  );
}

function teamFor(side: MatchSide, home: Club, away: Club): Club {
  return side === "home" ? home : away;
}

function teamSideLabel(side: MatchSide): string {
  return side === "home" ? MATCH_COPY.home : MATCH_COPY.lineupAway;
}

function SpotlightCard({
  spotlight,
  home,
  away,
}: {
  spotlight: SpotlightCard;
  home: Club;
  away: Club;
}) {
  if (spotlight.kind === "xg") {
    return (
      <article className="min-w-0 rounded-card border border-border bg-mint p-2.5">
        <p className="text-[8px] font-extrabold uppercase tracking-[.1em] text-primary-press">
          {MATCH_COPY.highestXg}
        </p>
        <strong className="mt-4 block truncate font-mono text-[16px] font-bold text-primary-press">
          {MATCH_COPY.xgEntry(spotlight.xg)}
        </strong>
        <span className="mt-1 block truncate text-[10px] font-extrabold">
          {spotlight.player}
        </span>
        <span className="mt-1 block text-[8px] font-bold text-muted">
          {teamFor(spotlight.team, home, away).name}
        </span>
        <span className="block text-[8px] font-bold text-muted">
          {MATCH_COPY.dangerLeader}
        </span>
      </article>
    );
  }

  if (spotlight.kind === "scorers") {
    return (
      <article className="min-w-0 rounded-card border border-border bg-subtle p-2.5">
        <p className="text-[8px] font-extrabold uppercase tracking-[.1em] text-muted">
          {MATCH_COPY.scorerSpotlight}
        </p>
        <strong className="mt-4 block font-mono text-[21px] font-bold">
          {spotlight.goals}
        </strong>
        <span className="block text-[8px] font-bold text-muted">
          {MATCH_COPY.goalsFrom}
        </span>
        <div className="mt-3 flex flex-col gap-1">
          {spotlight.players.map((player) => (
            <span
              key={`${player.team}-${player.player}`}
              className="flex min-w-0 items-baseline justify-between gap-1 text-[9px] font-extrabold"
            >
              <span className="truncate">{player.player}</span>
              <b className="shrink-0 font-mono text-primary-press">
                {MATCH_COPY.goalCount(player.goals)}
              </b>
            </span>
          ))}
        </div>
      </article>
    );
  }

  if (spotlight.kind === "creators") {
    return (
      <article className="min-w-0 rounded-card border border-border bg-subtle p-2.5">
        <p className="text-[8px] font-extrabold uppercase tracking-[.1em] text-muted">
          {MATCH_COPY.creatorSpotlight}
        </p>
        <strong className="mt-4 block font-mono text-[21px] font-bold">
          {spotlight.assists}
        </strong>
        <span className="block text-[8px] font-bold text-muted">
          {MATCH_COPY.assistsFrom}
        </span>
        <div className="mt-3 flex flex-col gap-1">
          {spotlight.players.map((player) => (
            <span
              key={`${player.team}-${player.player}`}
              className="flex min-w-0 items-baseline justify-between gap-1 text-[9px] font-extrabold"
            >
              <span className="truncate">{player.player}</span>
              <b className="shrink-0 font-mono text-primary-press">
                {MATCH_COPY.assistCount(player.assists)}
              </b>
            </span>
          ))}
        </div>
      </article>
    );
  }

  return (
    <article className="min-w-0 rounded-card border border-border bg-subtle p-2.5">
      <p className="text-[8px] font-extrabold uppercase tracking-[.1em] text-muted">
        {MATCH_COPY.keeperSpotlight}
      </p>
      <strong className="mt-4 block truncate font-mono text-[16px] font-bold">
        {MATCH_COPY.saveCount(spotlight.saves)}
      </strong>
      <span className="mt-1 block truncate text-[10px] font-extrabold">
        {spotlight.player}
      </span>
      <span className="mt-1 block text-[8px] font-bold text-muted">
        {teamFor(spotlight.team, home, away).name}
      </span>
      <span className="block text-[8px] font-bold text-muted">
        {teamSideLabel(spotlight.team)}
      </span>
    </article>
  );
}

const categoryCopy: Record<
  LedgerCategory["key"],
  { label: string; meta: string }
> = {
  goals: { label: MATCH_COPY.goalsCategory, meta: MATCH_COPY.goalsMeta },
  assists: { label: MATCH_COPY.assistsCategory, meta: MATCH_COPY.assistsMeta },
  cards: { label: MATCH_COPY.cardsCategory, meta: MATCH_COPY.cardsMeta },
  keeper: { label: MATCH_COPY.keeperCategory, meta: MATCH_COPY.keeperMeta },
  danger: { label: MATCH_COPY.dangerCategory, meta: MATCH_COPY.dangerMeta },
};

function CardMarks({ entry }: { entry: LedgerEntry }) {
  return (
    <span className="ml-1 inline-flex shrink-0 gap-0.5">
      {entry.yellowCards > 0 ? (
        <span
          aria-label={MATCH_COPY.yellowCard}
          className="rounded-pill bg-subtle px-1 font-mono text-[8px] text-muted"
        >
          {MATCH_COPY.yellowCardMark(entry.yellowCards)}
        </span>
      ) : null}
      {entry.redCards > 0 ? (
        <span
          aria-label={MATCH_COPY.redCard}
          className="rounded-pill bg-subtle px-1 font-mono text-[8px] text-muted"
        >
          {MATCH_COPY.redCardMark(entry.redCards)}
        </span>
      ) : null}
    </span>
  );
}

function EntryValue({ category, entry }: { category: LedgerCategory["key"]; entry: LedgerEntry }) {
  switch (category) {
    case "goals":
      return MATCH_COPY.goalCount(entry.count);
    case "assists":
      return MATCH_COPY.assistCount(entry.count);
    case "cards":
      return MATCH_COPY.cardCount(entry.count);
    case "keeper":
      return entry.count > 0
        ? MATCH_COPY.saveCount(entry.count)
        : entry.goalsConceded == null
          ? MATCH_COPY.missingValue
          : MATCH_COPY.concededCount(entry.goalsConceded);
    case "danger":
      return entry.xg == null
        ? MATCH_COPY.missingValue
        : MATCH_COPY.xgEntry(entry.xg);
  }
}

function LedgerSide({
  side,
  club,
  entries,
  category,
}: {
  side: MatchSide;
  club: Club;
  entries: LedgerEntry[];
  category: LedgerCategory["key"];
}) {
  return (
    <div
      className="min-w-0 rounded-card border border-border bg-bg p-2"
      style={{
        borderTopColor:
          side === "home" ? "var(--color-primary)" : "var(--color-away)",
        borderTopWidth: 2,
      }}
    >
      <div className="flex items-center gap-1.5 border-b border-border pb-1.5">
        <span
          aria-hidden="true"
          className="h-1.5 w-1.5 shrink-0 rounded-full"
          style={{
            backgroundColor:
              side === "home" ? "var(--color-primary)" : "var(--color-away)",
          }}
        />
        <strong className="truncate text-[10px] font-extrabold">
          {club.name}
        </strong>
        <span className="ml-auto font-mono text-[9px] font-bold text-muted">
          {entries.length}
        </span>
      </div>
      <div className="mt-2 flex flex-col gap-2">
        {entries.length ? (
          entries.map((entry) => (
            <div
              key={entry.player}
              className="flex items-baseline justify-between gap-2 text-[10px]"
            >
              <span className="flex min-w-0 items-baseline font-bold">
                <span className="truncate">{entry.player}</span>
                <CardMarks entry={entry} />
              </span>
              <span
                className={`shrink-0 font-mono text-[9px] font-bold ${category === "danger" ? "text-primary-press" : ""}`}
              >
                {EntryValue({ category, entry })}
              </span>
            </div>
          ))
        ) : (
          <p className="m-0 text-[10px] font-semibold text-muted">
            {MATCH_COPY.none}
          </p>
        )}
      </div>
    </div>
  );
}

function LedgerCategoryView({
  category,
  home,
  away,
}: {
  category: LedgerCategory;
  home: Club;
  away: Club;
}) {
  const copy = categoryCopy[category.key];
  return (
    <section className="pt-3 first:pt-0">
      <div className="flex items-baseline justify-between gap-2">
        <h4 className="m-0 text-[12px] font-extrabold">{copy.label}</h4>
        <span className="font-mono text-[9px] font-bold text-muted">
          {copy.meta}
        </span>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <LedgerSide
          side="home"
          club={home}
          entries={category.home}
          category={category.key}
        />
        <LedgerSide
          side="away"
          club={away}
          entries={category.away}
          category={category.key}
        />
      </div>
    </section>
  );
}

export function PlayerStatsBlock({
  playerStats,
  shotMap,
  lineups,
  home,
  away,
}: {
  playerStats?: MatchDetailView["playerStats"];
  shotMap?: MatchDetailView["shotMap"];
  lineups?: MatchDetailView["lineups"];
  home: Club;
  away: Club;
}) {
  if (!playerStats) return null;

  const rows = playerStats.rows;
  const shots = shotMap?.shots ?? [];
  const keepers = keeperNames(lineups, rows);
  const spotlightCards = spotlights(rows, shots, keepers);
  const ledger = eventLedger(rows, shots, keepers);

  return (
    <section className={card}>
      <h2 className="font-extrabold">{MATCH_COPY.topPerformers}</h2>
      <p className="mt-1 text-[10px] font-bold uppercase tracking-[.12em] text-primary-press">
        {MATCH_COPY.spotlights}
      </p>
      <div className="mt-3 grid grid-cols-3 gap-2">
        {spotlightCards.map((spotlight, index) => (
          <SpotlightCard
            key={`${spotlight.kind}-${index}`}
            spotlight={spotlight}
            home={home}
            away={away}
          />
        ))}
      </div>
      <div className="mt-4 border-t border-border pt-3">
        <h3 className="font-extrabold">{MATCH_COPY.playerEvents}</h3>
        <p className="mt-1 text-[10px] font-bold uppercase tracking-[.12em] text-primary-press">
          {MATCH_COPY.playerEventsKicker}
        </p>
        <div className="mt-3 divide-y divide-border">
          {ledger.map((category) => (
            <LedgerCategoryView
              key={category.key}
              category={category}
              home={home}
              away={away}
            />
          ))}
        </div>
      </div>
      <Source block={playerStats} />
    </section>
  );
}
