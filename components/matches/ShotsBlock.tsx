"use client";

import { useState } from "react";
import { MATCH_COPY } from "@/lib/match-copy";
import type { Club, MatchDetailView } from "@/lib/match-detail";
import { xgRace } from "@/lib/match-blocks";
import type { MatchShot, MatchShotResult, MatchSide } from "@/lib/match-types";

// Coordinate assumption for C1: source x/y are normalized 0–1 locations in each team’s own
// attacking left-to-right frame, so both teams naturally have x values near 1. For one physical
// pitch, home shots keep x and away shots are mirrored with x' = 1 - x; y is kept unchanged
// because the source does not define a team-relative vertical flip.

const card =
  "rounded-card border border-border bg-surface p-4 shadow-[0_2px_8px_rgba(15,23,42,.04)]";

function Source({ block }: { block: { source: string; age: string } }) {
  return (
    <div className="mt-3 border-t border-border pt-2 text-[11px] text-muted">
      {block.source} · {block.age}
    </div>
  );
}

const outcomeOrder: MatchShotResult[] = [
  "goal",
  "saved",
  "blocked",
  "off_target",
  "other",
];

function resultLabel(result: MatchShotResult): string {
  switch (result) {
    case "goal":
      return MATCH_COPY.shotGoal;
    case "saved":
      return MATCH_COPY.shotSaved;
    case "blocked":
      return MATCH_COPY.shotBlocked;
    case "off_target":
      return MATCH_COPY.shotOffTarget;
    case "other":
      return MATCH_COPY.shotOther;
  }
}

function resultColor(result: MatchShotResult): string {
  switch (result) {
    case "goal":
      return "var(--color-primary)";
    case "saved":
      return "var(--color-amber-fg)";
    case "blocked":
      return "var(--color-muted)";
    case "off_target":
      return "var(--color-loss)";
    case "other":
      return "var(--color-label)";
  }
}

function teamName(side: MatchSide, home: Club, away: Club): string {
  return side === "home" ? home.name : away.name;
}

function selectOnKey(
  event: React.KeyboardEvent<HTMLButtonElement>,
  select: () => void,
) {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    select();
  }
}

function ShotDots({
  shots,
  home,
  away,
  selectedIndex,
  onSelect,
}: {
  shots: readonly MatchShot[];
  home: Club;
  away: Club;
  selectedIndex: number | null;
  onSelect: (index: number) => void;
}) {
  return (
    <>
      {shots.map((shot, index) => {
        const mappedX = shot.team === "away" ? 1 - shot.x : shot.x;
        const cx = 18 + mappedX * 384;
        const cy = 18 + shot.y * 214;
        const radius = 4 + shot.xg * 28;
        const diameter = radius * 2;
        const selected = selectedIndex === index;
        const label = MATCH_COPY.shotDotAriaLabel(
          shot.player,
          teamName(shot.team, home, away),
          shot.minute,
          resultLabel(shot.result),
          shot.xg,
        );
        return (
          <foreignObject
            key={`${shot.team}-${shot.minute}-${shot.player}-${index}`}
            x={cx - radius}
            y={cy - radius}
            width={diameter}
            height={diameter}
            overflow="visible"
          >
            <button
              type="button"
              data-testid="shot-dot"
              tabIndex={0}
              aria-label={label}
              aria-pressed={selected}
              onClick={() => onSelect(index)}
              onKeyDown={(event) => selectOnKey(event, () => onSelect(index))}
              className="block h-full w-full rounded-full border-2 border-solid p-0 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-primary)]"
              style={{
                boxSizing: "border-box",
                backgroundColor: resultColor(shot.result),
                borderColor: "var(--color-surface)",
                boxShadow: selected
                  ? "0 0 0 2px var(--color-primary)"
                  : undefined,
                opacity: 0.86,
              }}
            />
          </foreignObject>
        );
      })}
    </>
  );
}

function PitchMap({
  shots,
  home,
  away,
  selectedIndex,
  onSelect,
}: {
  shots: readonly MatchShot[];
  home: Club;
  away: Club;
  selectedIndex: number | null;
  onSelect: (index: number) => void;
}) {
  return (
    <div className="mt-3 overflow-hidden rounded-card border border-border bg-bg">
      <svg
        viewBox="0 0 420 250"
        role="img"
        aria-label={MATCH_COPY.shotMapAriaLabel(shots.length, home.name, away.name)}
        className="block h-auto w-full"
      >
        <rect
          x="18"
          y="18"
          width="384"
          height="214"
          rx="10"
          fill="var(--color-mint)"
          stroke="var(--color-primary)"
          strokeWidth="1.3"
        />
        <path
          d="M210 18V232M18 71.5H92V178.5H18M402 71.5H328V178.5H402M92 107H72V143H92M328 107H348V143H328"
          fill="none"
          stroke="var(--color-primary)"
          strokeOpacity=".38"
          strokeWidth="1"
        />
        <circle
          cx="210"
          cy="125"
          r="34"
          fill="none"
          stroke="var(--color-primary)"
          strokeOpacity=".38"
          strokeWidth="1"
        />
        <circle cx="210" cy="125" r="2.5" fill="var(--color-primary)" />
        <path
          d="M18 114V136M402 114V136"
          stroke="var(--color-primary)"
          strokeOpacity=".65"
          strokeWidth="2"
        />
        <ShotDots
          shots={shots}
          home={home}
          away={away}
          selectedIndex={selectedIndex}
          onSelect={onSelect}
        />
      </svg>
    </div>
  );
}

function RaceGraph({
  shots,
  home,
  away,
}: {
  shots: readonly MatchShot[];
  home: Club;
  away: Club;
}) {
  const race = xgRace(shots);
  const maxXg = Math.max(race.total.home, race.total.away, 1);
  const point = (minute: number, xg: number): string => {
    const x = Math.min(91, Math.max(0, minute)) / 91 * 360;
    const y = 158 - (xg / maxXg) * 142;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  };
  const points = (series: readonly { minute: number; xg: number }[]) =>
    series.map((entry) => point(entry.minute, entry.xg)).join(" ");

  return (
    <div className="mt-4 border-t border-border pt-3">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="font-extrabold">{MATCH_COPY.expectedGoals}</h3>
        <span className="text-[10px] font-bold text-muted">
          {MATCH_COPY.combinedXg(shots.length)}
        </span>
      </div>
      <div className="mt-3 flex items-baseline justify-between gap-2 border-b border-border pb-3">
        <strong className="font-mono text-[28px] font-bold tracking-[-.08em] text-primary-press">
          {MATCH_COPY.xgValue(race.total.combined)}
        </strong>
        <span className="text-[10px] font-bold text-muted">
          {MATCH_COPY.statXg}
        </span>
      </div>
      <svg
        viewBox="0 0 360 165"
        role="img"
        aria-label={MATCH_COPY.xgRaceAriaLabel(home.name, away.name)}
        className="mt-3 block h-[165px] w-full overflow-visible"
      >
        <line
          x1="0"
          y1="16"
          x2="360"
          y2="16"
          stroke="var(--color-subtle)"
        />
        <line
          x1="0"
          y1="87"
          x2="360"
          y2="87"
          stroke="var(--color-subtle)"
        />
        <line
          x1="0"
          y1="158"
          x2="360"
          y2="158"
          stroke="var(--color-border)"
        />
        <polyline
          data-testid="xg-race-home"
          points={points(race.home)}
          fill="none"
          stroke="var(--color-primary)"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2.5"
        />
        <polyline
          data-testid="xg-race-away"
          points={points(race.away)}
          fill="none"
          stroke="var(--color-away)"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2.5"
        />
        {(["home", "away"] as const).map((side) => {
          const series = side === "home" ? race.home : race.away;
          return series.slice(1).map((entry, index) => (
            <circle
              key={`${side}-${index}`}
              cx={Math.min(91, Math.max(0, entry.minute)) / 91 * 360}
              cy={158 - (entry.xg / maxXg) * 142}
              r="3.5"
              fill={side === "home" ? "var(--color-primary)" : "var(--color-away)"}
              stroke="var(--color-surface)"
              strokeWidth="1.5"
            />
          ));
        })}
        <text x="0" y="164" fill="var(--color-muted)" fontSize="8">
          {MATCH_COPY.minute(0)}
        </text>
        <text x="174" y="164" fill="var(--color-muted)" fontSize="8">
          {MATCH_COPY.minute(45)}
        </text>
        <text x="343" y="164" fill="var(--color-muted)" fontSize="8">
          {MATCH_COPY.minute(91)}
        </text>
        <text x="323" y="14" fill="var(--color-muted)" fontSize="8">
          {MATCH_COPY.xgValue(maxXg)}
        </text>
      </svg>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[9px] font-extrabold">
        <span className="inline-flex items-center gap-1" style={{ color: "var(--color-primary)" }}>
          <i
            aria-hidden="true"
            className="h-2 w-2 rounded-full"
            style={{ backgroundColor: "var(--color-primary)" }}
          />
          {home.name} {MATCH_COPY.xgValue(race.total.home)} {MATCH_COPY.statXg}
        </span>
        <span className="inline-flex items-center gap-1" style={{ color: "var(--color-away)" }}>
          <i
            aria-hidden="true"
            className="h-2 w-2 rounded-full"
            style={{ backgroundColor: "var(--color-away)" }}
          />
          {away.name} {MATCH_COPY.xgValue(race.total.away)} {MATCH_COPY.statXg}
        </span>
      </div>
    </div>
  );
}

function OutcomeLegend() {
  return (
    <div className="mt-3 flex flex-wrap gap-x-3 gap-y-2 text-[10px] font-bold">
      {outcomeOrder.map((result) => (
        <span key={result} className="inline-flex items-center gap-1">
          <i
            aria-hidden="true"
            className="h-2 w-2 rounded-full"
            style={{ backgroundColor: resultColor(result) }}
          />
          {resultLabel(result)}
        </span>
      ))}
    </div>
  );
}

function OutcomeLedger({
  shots,
  home,
  away,
  selectedIndex,
  onSelect,
}: {
  shots: readonly MatchShot[];
  home: Club;
  away: Club;
  selectedIndex: number | null;
  onSelect: (index: number) => void;
}) {
  return (
    <div className="mt-4 border-t border-border pt-3">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="font-extrabold">{MATCH_COPY.shotMap}</h3>
        <span className="text-[10px] font-bold text-muted">
          {MATCH_COPY.shotMapAttempts(shots.length)}
        </span>
      </div>
      <div className="mt-3 grid grid-cols-5 gap-1">
        {outcomeOrder.map((result) => {
          const count = shots.filter((shot) => shot.result === result).length;
          return (
            <div
              key={result}
              data-testid={`outcome-count-${result}`}
              className="min-w-0 bg-bg px-1 py-2 text-center"
              style={{ borderTop: `3px solid ${resultColor(result)}` }}
            >
              <b
                className="block font-mono text-[15px]"
                style={{ color: resultColor(result) }}
              >
                {count}
              </b>
              <span className="mt-1 block truncate text-[8px] font-extrabold text-muted">
                {resultLabel(result)}
              </span>
            </div>
          );
        })}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        {outcomeOrder.map((result) => {
          const group = shots.flatMap((shot, index) =>
            shot.result === result ? [{ shot, index }] : [],
          );
          return (
            <section
              key={result}
              className="min-w-0 rounded-card border border-border bg-bg p-2"
              style={{ borderTopColor: resultColor(result), borderTopWidth: 3 }}
            >
              <h4
                className="m-0 text-[10px] font-extrabold uppercase tracking-[.08em]"
                style={{ color: resultColor(result) }}
              >
                {resultLabel(result)}
              </h4>
              <span className="mt-0.5 block font-mono text-[9px] font-bold text-muted">
                {MATCH_COPY.shotMapAttempts(group.length)}
              </span>
              <div className="mt-2 flex flex-col gap-2">
                {group.length ? (
                  group.map(({ shot, index }) => {
                    const selected = selectedIndex === index;
                    return (
                      <button
                        key={`${shot.team}-${shot.minute}-${shot.player}-${index}`}
                        type="button"
                        data-testid="shot-outcome"
                        aria-label={MATCH_COPY.shotDotAriaLabel(
                          shot.player,
                          teamName(shot.team, home, away),
                          shot.minute,
                          resultLabel(shot.result),
                          shot.xg,
                        )}
                        aria-pressed={selected}
                        onClick={() => onSelect(index)}
                        onKeyDown={(event) =>
                          selectOnKey(event, () => onSelect(index))
                        }
                        className="w-full border-0 border-t border-border bg-bg p-0 pt-2 text-left first:border-t-0 first:pt-0 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-primary)]"
                        style={
                          selected
                            ? { boxShadow: "0 0 0 2px var(--color-primary)" }
                            : undefined
                        }
                      >
                        <span className="block truncate text-[11px] font-extrabold">
                          {shot.player}
                        </span>
                        <span className="mt-1 block text-[9px] font-bold text-muted">
                          {teamName(shot.team, home, away)}
                        </span>
                        <span className="mt-1 block font-mono text-[9px] font-bold text-muted">
                          {MATCH_COPY.minute(shot.minute)} {MATCH_COPY.xgEntry(shot.xg)}
                        </span>
                      </button>
                    );
                  })
                ) : (
                  <p className="m-0 text-[10px] font-semibold text-muted">
                    {MATCH_COPY.none}
                  </p>
                )}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function ShotDetail({
  shot,
  home,
  away,
}: {
  shot: MatchShot;
  home: Club;
  away: Club;
}) {
  const fields = [
    [MATCH_COPY.shotDetailMinute, MATCH_COPY.minute(shot.minute)],
    [MATCH_COPY.shotDetailPlayer, shot.player],
    [MATCH_COPY.shotDetailTeam, teamName(shot.team, home, away)],
    [MATCH_COPY.shotDetailResult, resultLabel(shot.result)],
    [MATCH_COPY.shotDetailXg, MATCH_COPY.xgValue(shot.xg)],
  ] as const;
  return (
    <div
      data-testid="shot-detail"
      aria-live="polite"
      className="mt-3 rounded-card border border-border bg-mint p-3"
    >
      <h4 className="m-0 text-[11px] font-extrabold">{MATCH_COPY.shotDetail}</h4>
      <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-2">
        {fields.map(([label, value]) => (
          <div key={label} className="min-w-0">
            <dt className="text-[9px] font-bold uppercase tracking-[.08em] text-muted">
              {label}
            </dt>
            <dd className="mt-0.5 truncate text-[11px] font-extrabold">
              {value}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export function ShotsBlock({
  shotMap,
  home,
  away,
}: {
  shotMap?: MatchDetailView["shotMap"];
  home: Club;
  away: Club;
}) {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);

  if (!shotMap) return null;

  const selectedShot =
    selectedIndex == null ? undefined : shotMap.shots[selectedIndex];

  return (
    <section className={card}>
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="font-extrabold">{MATCH_COPY.shotMap}</h2>
        <span className="font-mono text-[10px] font-bold text-muted">
          {MATCH_COPY.shotMapAttempts(shotMap.shots.length)}
        </span>
      </div>
      <p className="mt-1 text-[10px] font-bold uppercase tracking-[.12em] text-primary-press">
        {MATCH_COPY.shotMapKicker}
      </p>
      <PitchMap
        shots={shotMap.shots}
        home={home}
        away={away}
        selectedIndex={selectedIndex}
        onSelect={setSelectedIndex}
      />
      <div className="mt-2 flex justify-between gap-2 text-[9px] font-bold text-muted">
        <span>{MATCH_COPY.pitchAwayGoal(away.name)}</span>
        <span className="text-primary-press">{MATCH_COPY.pitchCentre}</span>
        <span>{MATCH_COPY.pitchHomeGoal(home.name)}</span>
      </div>
      <OutcomeLegend />
      <div className="mt-3 grid grid-cols-2 gap-2">
        {(["home", "away"] as const).map((side) => {
          const teamShots = shotMap.shots.filter((shot) => shot.team === side);
          const total = teamShots.reduce((sum, shot) => sum + shot.xg, 0);
          return (
            <div key={side} className="rounded-card bg-mint p-2.5">
              <strong className="block font-mono text-[17px] text-primary-press">
                {teamShots.length}
              </strong>
              <span className="mt-1 block text-[9px] font-bold">
                {teamName(side, home, away)}
              </span>
              <span className="mt-0.5 block text-[9px] font-bold text-muted">
                {MATCH_COPY.xgEntry(total)}
              </span>
            </div>
          );
        })}
      </div>
      <RaceGraph shots={shotMap.shots} home={home} away={away} />
      <OutcomeLedger
        shots={shotMap.shots}
        home={home}
        away={away}
        selectedIndex={selectedIndex}
        onSelect={setSelectedIndex}
      />
      {selectedShot ? (
        <ShotDetail shot={selectedShot} home={home} away={away} />
      ) : null}
      <Source block={shotMap} />
    </section>
  );
}
