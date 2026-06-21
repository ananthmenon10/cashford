// Cross-league match feed grouping (PRD docs/prds/2026-06-21-home-matches-tab-prd.md §4-§7).
//
// Every league predicts the SAME 104 World Cup fixtures, so one match exists as a separate
// contest in each of the viewer's leagues (contests.fixture_id, unique per league+fixture).
// The home "Matches" tab shows ONE card per fixture, deduped across the viewer's leagues, with a
// roll-up summary (pick consistency, stake, net) and an expandable per-league breakdown.
//
// This module is the pure, deterministic core of that dedup/roll-up — no I/O, fully unit-testable.
// The caller derives each contest's CardState (via lib/contest-state.deriveCardState, already
// tested) and feeds entries in; we group, roll up, and sort. Shared fixture facts (score, kickoff,
// live minute) are identical across a fixture's sibling contests, so they live on FeedFixture.

import { type CardState, tabForState } from "./contest-state";

export type PickShape = { outcome: "home" | "draw" | "away"; predHome: number; predAway: number };

// One league's instance of a fixture that the viewer participates in.
export interface FeedEntry {
  fixtureId: string;
  contestId: string;
  leagueId: string;
  leagueName: string;
  leagueSlug: string;
  state: CardState;        // the viewer's per-contest card state (deriveCardState)
  stake: number;           // this league's stake for the fixture
  pick: PickShape | null;  // the viewer's pick in THIS league (null = not predicted here)
  net: number | null;      // the viewer's settled net here (null until settled)
  joined: number;          // entrants in this league's contest (count only — never the picks)
  members: number;         // league size
}

// Shared fixture facts — identical across a fixture's sibling contests.
export interface FeedFixture {
  fixtureId: string;
  round: string;
  isKnockout: boolean;
  homeLabel: string;
  awayLabel: string;
  homeShort: string | null;
  awayShort: string | null;
  kickoffIso: string;
  kickoffMs: number;
  ftHome: number | null;
  ftAway: number | null;
  minute: number | null;
  statusDetail: string | null;
  advancerSide: "home" | "away" | null;
}

// How the viewer's picks for one fixture relate across their leagues:
//   none        — predicted in zero leagues
//   uniform     — every pick made is the identical scoreline (one distinct pick)
//   sameOutcome — picks agree on the winner (H/D/A) but differ on the scoreline
//   mixed       — picks disagree on the outcome itself
export type PickConsistency = "none" | "uniform" | "sameOutcome" | "mixed";

// Which section the card sorts into. Derived from the sibling states; since the fixture timeline
// is shared, siblings agree except for settle lag (settling vs settled) and per-league void/
// not-entered, which all read as "past". Precedence live > upcoming > past.
export type GroupPhase = "upcoming" | "live" | "past";

export interface MatchGroup {
  fixtureId: string;
  fixture: FeedFixture;
  leagues: FeedEntry[];   // per-league rows, sorted by league name for stable display
  leagueCount: number;
  phase: GroupPhase;

  // pick roll-up
  pickConsistency: PickConsistency;
  representativePick: PickShape | null; // set iff pickConsistency === "uniform"
  predictedLeagues: number;             // how many of the viewer's leagues they've picked in
  allPredicted: boolean;                // predicted in every league this fixture is in
  needsPick: boolean;                   // ≥1 league is still open & unpicked (open_nopick)

  // money roll-up
  sumStake: number;        // Σ stake across all the viewer's leagues for this fixture
  sumStakePicked: number;  // Σ stake only where the viewer has a pick (what's actually at risk)
  settledNet: number | null; // Σ net across settled leagues; null if none settled yet
  hasMixedResults: boolean;  // settled leagues include BOTH a win and a loss for this fixture
}

const pickKey = (p: PickShape) => `${p.outcome}-${p.predHome}-${p.predAway}`;

function rollUpPicks(entries: FeedEntry[]): Pick<
  MatchGroup,
  "pickConsistency" | "representativePick" | "predictedLeagues" | "allPredicted"
> {
  const picks = entries.map((e) => e.pick).filter((p): p is PickShape => p != null);
  const predictedLeagues = picks.length;
  const allPredicted = predictedLeagues === entries.length;

  if (predictedLeagues === 0) {
    return { pickConsistency: "none", representativePick: null, predictedLeagues, allPredicted };
  }
  const distinct = new Set(picks.map(pickKey));
  if (distinct.size === 1) {
    return { pickConsistency: "uniform", representativePick: picks[0], predictedLeagues, allPredicted };
  }
  const outcomes = new Set(picks.map((p) => p.outcome));
  return {
    pickConsistency: outcomes.size === 1 ? "sameOutcome" : "mixed",
    representativePick: null,
    predictedLeagues,
    allPredicted,
  };
}

function phaseOf(entries: FeedEntry[]): GroupPhase {
  const tabs = entries.map((e) => tabForState(e.state));
  if (tabs.includes("live")) return "live";
  if (tabs.includes("upcoming")) return "upcoming";
  return "past";
}

function buildGroup(fixture: FeedFixture, rawEntries: FeedEntry[]): MatchGroup {
  const leagues = [...rawEntries].sort((a, b) =>
    a.leagueName < b.leagueName ? -1 : a.leagueName > b.leagueName ? 1 : a.leagueId < b.leagueId ? -1 : 1,
  );

  const settled = leagues.filter((e) => e.net != null);
  const settledNet = settled.length ? settled.reduce((t, e) => t + (e.net ?? 0), 0) : null;
  const hasMixedResults = settled.some((e) => (e.net ?? 0) > 0) && settled.some((e) => (e.net ?? 0) < 0);

  return {
    fixtureId: fixture.fixtureId,
    fixture,
    leagues,
    leagueCount: leagues.length,
    phase: phaseOf(leagues),
    ...rollUpPicks(leagues),
    needsPick: leagues.some((e) => e.state === "open_nopick"),
    sumStake: leagues.reduce((t, e) => t + e.stake, 0),
    sumStakePicked: leagues.reduce((t, e) => t + (e.pick ? e.stake : 0), 0),
    settledNet,
    hasMixedResults,
  };
}

// Group the viewer's contests (across all their leagues) into one card per fixture, sorted by
// kickoff ascending (fixtureId tiebreak → deterministic). Entries whose fixture has no facts in
// `fixturesById` are skipped defensively (shouldn't happen — every contest has a fixture row).
export function groupMatches(entries: FeedEntry[], fixturesById: Map<string, FeedFixture>): MatchGroup[] {
  const byFixture = new Map<string, FeedEntry[]>();
  for (const e of entries) {
    const arr = byFixture.get(e.fixtureId) ?? [];
    arr.push(e);
    byFixture.set(e.fixtureId, arr);
  }
  const groups: MatchGroup[] = [];
  for (const [fixtureId, group] of byFixture) {
    const fixture = fixturesById.get(fixtureId);
    if (!fixture) continue;
    groups.push(buildGroup(fixture, group));
  }
  groups.sort((a, b) =>
    a.fixture.kickoffMs - b.fixture.kickoffMs || (a.fixtureId < b.fixtureId ? -1 : 1),
  );
  return groups;
}

// Partition a sorted group list for the tab's two zones: the Live/Today hub (live) and the feed
// (upcoming + past). Order is preserved; callers typically reverse `past` to read most-recent-first.
export function splitByPhase(groups: MatchGroup[]): {
  live: MatchGroup[];
  upcoming: MatchGroup[];
  past: MatchGroup[];
} {
  const live: MatchGroup[] = [];
  const upcoming: MatchGroup[] = [];
  const past: MatchGroup[] = [];
  for (const g of groups) (g.phase === "live" ? live : g.phase === "upcoming" ? upcoming : past).push(g);
  return { live, upcoming, past };
}

// The serializable view model the server hands to the client <MatchesTab/>. Plain data only
// (MatchGroup is serializable) so it crosses the RSC boundary. provisionalByFixture and picksDue
// are computed server-side (they need live entrants' picks + settle(), both server concerns).
export interface MatchesView {
  live: MatchGroup[];     // phase "live" — the hub
  upcoming: MatchGroup[]; // phase "upcoming" — Next-24h timeline, kickoff ascending
  past: MatchGroup[];     // phase "past" — Results timeline, most-recent FIRST
  // live fixtureId → the viewer's cross-league provisional net at the current score (null if
  // not computable, e.g. <2 entrants in every league this fixture is live in).
  provisionalByFixture: Record<string, number | null>;
  // hub nudge: how many fixtures the viewer can still predict (≥1 league open & unpicked) and
  // when the earliest of those locks. null when there's nothing left to predict.
  picksDue: { count: number; earliestLockIso: string | null } | null;
}
