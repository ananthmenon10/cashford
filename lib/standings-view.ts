import type { CompetitionStanding } from "./espn-standings";
import { ageLabel } from "./view-format";

export type StandingsViewRow =
  | { kind: "club"; value: CompetitionStanding }
  | { kind: "gap"; label: string };

export type StandingsView = {
  sourceLine: string;
  rows: StandingsViewRow[];
  championsLeagueAfterRank: number;
  relegationFromRank: number;
  note: string | null;
};

export type StandingsCacheRow = {
  source: "espn" | "derived";
  rows: CompetitionStanding[];
  note: string | null;
  fetched_at: string;
};

export function selectStandingsRow(
  rows: readonly StandingsCacheRow[],
  now: Date,
  hasLiveFixture: boolean,
): StandingsCacheRow | null {
  const espn = rows.find((row) => row.source === "espn");
  const derived = rows.find((row) => row.source === "derived");
  const espnWindow = hasLiveFixture ? 10 * 60_000 : 60 * 60_000;
  const espnFresh =
    espn &&
    Number.isFinite(new Date(espn.fetched_at).getTime()) &&
    now.getTime() - new Date(espn.fetched_at).getTime() <= espnWindow;
  return espnFresh ? espn : (derived ?? espn ?? null);
}

export function buildStandingsView(input: {
  rows: readonly CompetitionStanding[];
  source: "espn" | "derived";
  fetchedAt: string;
  note: string | null;
}, now = new Date()): StandingsView {
  const ordered = [...input.rows].sort((a, b) => a.rank - b.rank);
  let rows: StandingsViewRow[];
  if (ordered.length <= 12) {
    rows = ordered.map((value) => ({ kind: "club", value }));
  } else {
    const top = ordered.slice(0, 8);
    const bottom = ordered.slice(-4);
    const gap = ordered.length - top.length - bottom.length;
    rows = [
      ...top.map((value): StandingsViewRow => ({ kind: "club", value })),
      { kind: "gap", label: `${gap} clubs between them` },
      ...bottom.map((value): StandingsViewRow => ({ kind: "club", value })),
    ];
  }
  return {
    sourceLine:
      input.source === "espn"
        ? `ESPN · updated ${ageLabel(input.fetchedAt, now)}`
        : `Cashford, from results · ${ageLabel(input.fetchedAt, now)}`,
    rows,
    championsLeagueAfterRank: 4,
    relegationFromRank: Math.max(1, ordered.length - 2),
    note: input.note,
  };
}
