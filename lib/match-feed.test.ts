import { describe, it, expect } from "vitest";
import {
  groupMatches,
  splitByPhase,
  type FeedEntry,
  type FeedFixture,
  type PickShape,
} from "./match-feed";
import type { CardState } from "./contest-state";

const HOME_2_1: PickShape = { outcome: "home", predHome: 2, predAway: 1 };
const HOME_1_0: PickShape = { outcome: "home", predHome: 1, predAway: 0 };
const AWAY_0_1: PickShape = { outcome: "away", predHome: 0, predAway: 1 };

// Minimal fixture factory; kickoff drives sort + (with state) the phase.
function fixture(id: string, kickoffMs: number, over: Partial<FeedFixture> = {}): FeedFixture {
  return {
    fixtureId: id,
    round: "group",
    isKnockout: false,
    homeLabel: "Brazil",
    awayLabel: "Serbia",
    homeShort: "BRA",
    awayShort: "SRB",
    kickoffIso: new Date(kickoffMs).toISOString(),
    kickoffMs,
    ftHome: null,
    ftAway: null,
    minute: null,
    statusDetail: null,
    advancerSide: null,
    ...over,
  };
}

function entry(
  fixtureId: string,
  leagueName: string,
  state: CardState,
  over: Partial<FeedEntry> = {},
): FeedEntry {
  return {
    fixtureId,
    contestId: `${fixtureId}-${leagueName}`,
    leagueId: leagueName.toLowerCase(),
    leagueName,
    leagueSlug: leagueName.toLowerCase(),
    state,
    stake: 100,
    pick: null,
    net: null,
    provisional: null,
    joined: 1,
    members: 4,
    ...over,
  };
}

const fxMap = (...fs: FeedFixture[]) => new Map(fs.map((f) => [f.fixtureId, f]));

describe("groupMatches — single league", () => {
  it("one predicted contest → uniform, leagueCount 1, no needsPick", () => {
    const g = groupMatches([entry("f1", "KK", "open_picked", { pick: HOME_2_1 })], fxMap(fixture("f1", 1000)));
    expect(g).toHaveLength(1);
    expect(g[0].leagueCount).toBe(1);
    expect(g[0].pickConsistency).toBe("uniform");
    expect(g[0].representativePick).toEqual(HOME_2_1);
    expect(g[0].predictedLeagues).toBe(1);
    expect(g[0].allPredicted).toBe(true);
    expect(g[0].needsPick).toBe(false);
    expect(g[0].sumStake).toBe(100);
    expect(g[0].sumStakePicked).toBe(100);
    expect(g[0].phase).toBe("upcoming");
  });

  it("open & unpicked → needsPick true, consistency none, nothing at risk yet", () => {
    const g = groupMatches([entry("f1", "KK", "open_nopick")], fxMap(fixture("f1", 1000)));
    expect(g[0].needsPick).toBe(true);
    expect(g[0].pickConsistency).toBe("none");
    expect(g[0].representativePick).toBeNull();
    expect(g[0].predictedLeagues).toBe(0);
    expect(g[0].sumStakePicked).toBe(0);
  });
});

describe("groupMatches — cross-league pick roll-up", () => {
  it("same exact pick in two leagues → uniform, allPredicted, stakes summed", () => {
    const g = groupMatches(
      [
        entry("f1", "KK", "open_picked", { pick: HOME_2_1, stake: 100 }),
        entry("f1", "PES", "open_picked", { pick: { ...HOME_2_1 }, stake: 50 }),
      ],
      fxMap(fixture("f1", 1000)),
    );
    expect(g).toHaveLength(1);
    expect(g[0].leagueCount).toBe(2);
    expect(g[0].pickConsistency).toBe("uniform");
    expect(g[0].representativePick).toEqual(HOME_2_1);
    expect(g[0].allPredicted).toBe(true);
    expect(g[0].sumStake).toBe(150);
    expect(g[0].sumStakePicked).toBe(150);
  });

  it("same winner, different scoreline → sameOutcome, no representative pick", () => {
    const g = groupMatches(
      [
        entry("f1", "KK", "open_picked", { pick: HOME_2_1 }),
        entry("f1", "PES", "open_picked", { pick: HOME_1_0 }),
      ],
      fxMap(fixture("f1", 1000)),
    );
    expect(g[0].pickConsistency).toBe("sameOutcome");
    expect(g[0].representativePick).toBeNull();
  });

  it("different outcomes → mixed", () => {
    const g = groupMatches(
      [
        entry("f1", "KK", "open_picked", { pick: HOME_2_1 }),
        entry("f1", "PES", "open_picked", { pick: AWAY_0_1 }),
      ],
      fxMap(fixture("f1", 1000)),
    );
    expect(g[0].pickConsistency).toBe("mixed");
    expect(g[0].representativePick).toBeNull();
  });

  it("predicted in one league, open & unpicked in another → partial (uniform but not allPredicted) + needsPick", () => {
    const g = groupMatches(
      [
        entry("f1", "KK", "open_picked", { pick: HOME_2_1 }),
        entry("f1", "PES", "open_nopick"),
      ],
      fxMap(fixture("f1", 1000)),
    );
    expect(g[0].pickConsistency).toBe("uniform"); // describes the one pick that exists
    expect(g[0].predictedLeagues).toBe(1);
    expect(g[0].allPredicted).toBe(false);
    expect(g[0].needsPick).toBe(true);
    expect(g[0].sumStake).toBe(200);
    expect(g[0].sumStakePicked).toBe(100); // only the predicted league is at risk
  });
});

describe("groupMatches — money roll-up across settled leagues", () => {
  it("won in one league, lost in another → net summed + hasMixedResults", () => {
    const g = groupMatches(
      [
        entry("f1", "KK", "won", { pick: HOME_2_1, net: 100 }),
        entry("f1", "PES", "lost", { pick: HOME_2_1, net: -40 }),
      ],
      fxMap(fixture("f1", 1000, { ftHome: 2, ftAway: 1 })),
    );
    expect(g[0].settledNet).toBe(60);
    expect(g[0].hasMixedResults).toBe(true);
    expect(g[0].phase).toBe("past");
  });

  it("unsettled everywhere → settledNet null, no mixed flag", () => {
    const g = groupMatches([entry("f1", "KK", "open_picked", { pick: HOME_2_1 })], fxMap(fixture("f1", 1000)));
    expect(g[0].settledNet).toBeNull();
    expect(g[0].hasMixedResults).toBe(false);
  });

  it("push (net 0) counts as settled, not mixed", () => {
    const g = groupMatches(
      [entry("f1", "KK", "push", { pick: HOME_2_1, net: 0 })],
      fxMap(fixture("f1", 1000, { ftHome: 1, ftAway: 1 })),
    );
    expect(g[0].settledNet).toBe(0);
    expect(g[0].hasMixedResults).toBe(false);
  });
});

describe("groupMatches — phase precedence (live > upcoming > past)", () => {
  it("any live sibling → live", () => {
    const g = groupMatches(
      [entry("f1", "KK", "live", { pick: HOME_2_1 }), entry("f1", "PES", "settling", { pick: HOME_2_1 })],
      fxMap(fixture("f1", 1000)),
    );
    expect(g[0].phase).toBe("live");
  });
  it("open + locked siblings → upcoming", () => {
    const g = groupMatches(
      [entry("f1", "KK", "open_picked", { pick: HOME_2_1 }), entry("f1", "PES", "locked", { pick: HOME_2_1 })],
      fxMap(fixture("f1", 1000)),
    );
    expect(g[0].phase).toBe("upcoming");
  });
  it("all settled/void → past", () => {
    const g = groupMatches(
      [entry("f1", "KK", "won", { net: 100 }), entry("f1", "PES", "void", { net: 0 })],
      fxMap(fixture("f1", 1000)),
    );
    expect(g[0].phase).toBe("past");
  });
});

describe("groupMatches — grouping, sorting, defaults", () => {
  it("dedupes across leagues and sorts by kickoff ascending", () => {
    const g = groupMatches(
      [
        entry("late", "KK", "open_nopick"),
        entry("early", "KK", "open_nopick"),
        entry("early", "PES", "open_nopick"), // same fixture, other league
      ],
      fxMap(fixture("early", 1000), fixture("late", 5000)),
    );
    expect(g.map((x) => x.fixtureId)).toEqual(["early", "late"]);
    expect(g[0].leagueCount).toBe(2); // "early" deduped to one card spanning two leagues
    expect(g[1].leagueCount).toBe(1);
  });

  it("equal kickoff → deterministic fixtureId tiebreak", () => {
    const g = groupMatches(
      [entry("bbb", "KK", "open_nopick"), entry("aaa", "KK", "open_nopick")],
      fxMap(fixture("aaa", 2000), fixture("bbb", 2000)),
    );
    expect(g.map((x) => x.fixtureId)).toEqual(["aaa", "bbb"]);
  });

  it("per-league rows are sorted by league name", () => {
    const g = groupMatches(
      [entry("f1", "Zeta", "open_nopick"), entry("f1", "Alpha", "open_nopick")],
      fxMap(fixture("f1", 1000)),
    );
    expect(g[0].leagues.map((l) => l.leagueName)).toEqual(["Alpha", "Zeta"]);
  });

  it("entry with no fixture facts is skipped (defensive)", () => {
    const g = groupMatches([entry("ghost", "KK", "open_nopick")], fxMap(fixture("real", 1000)));
    expect(g).toHaveLength(0);
  });
});

describe("splitByPhase", () => {
  it("partitions into live / upcoming / past, preserving order", () => {
    const groups = groupMatches(
      [
        entry("a", "KK", "open_nopick"), // upcoming, ko 1000
        entry("b", "KK", "live", { pick: HOME_2_1 }), // live, ko 2000
        entry("c", "KK", "won", { net: 10 }), // past, ko 3000
        entry("d", "KK", "locked", { pick: HOME_2_1 }), // upcoming, ko 4000
      ],
      fxMap(fixture("a", 1000), fixture("b", 2000), fixture("c", 3000), fixture("d", 4000)),
    );
    const { live, upcoming, past } = splitByPhase(groups);
    expect(live.map((g) => g.fixtureId)).toEqual(["b"]);
    expect(upcoming.map((g) => g.fixtureId)).toEqual(["a", "d"]); // ascending order preserved
    expect(past.map((g) => g.fixtureId)).toEqual(["c"]);
  });
});
