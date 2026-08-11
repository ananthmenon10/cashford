// Step 8 — pure aggregation/mapping for the Analytics feed (structure A / cross-comp B /
// my-form A). lib/analytics-feed.ts has no I/O; these tests cover the grouping and my-form
// builders directly, in the style of lib/settlement.ts's golden tests.
import { describe, expect, it } from "vitest";
import {
  buildAnalyticsSections,
  buildAllTimeStrip,
  buildLeagueOptions,
  buildLiveMyForm,
  buildArchiveMyForm,
  type AnalyticsParticipationRow,
} from "../../lib/analytics-feed";
import type { Entry } from "../../lib/analytics";

type LiveTotal = {
  netInr: number | "suppressed";
  gameweeksEntered: number;
  points: number | "suppressed";
  hasEntries: boolean;
  correctPicks: number | null | "suppressed";
  incorrectPicks: number | null | "suppressed";
  voidPicks: number | null | "suppressed";
  countedFixtures: number | null | "suppressed";
};

function liveTotal(overrides: Partial<LiveTotal> = {}): LiveTotal {
  return {
    netInr: 0,
    gameweeksEntered: 0,
    points: 0,
    hasEntries: false,
    correctPicks: null,
    incorrectPicks: null,
    voidPicks: null,
    countedFixtures: null,
    ...overrides,
  };
}

describe("buildLeagueOptions", () => {
  it("sorts by name regardless of input order", () => {
    const options = buildLeagueOptions([
      { id: "2", name: "PES Bois", slug: "pes-bois" },
      { id: "1", name: "KK Bois", slug: "kk-bois" },
    ]);
    expect(options.map((o) => o.name)).toEqual(["KK Bois", "PES Bois"]);
  });
});

describe("buildAnalyticsSections — cross-comp B", () => {
  const rows: AnalyticsParticipationRow[] = [
    { leagueId: "l1", leagueName: "KK Bois", competitionId: "wc26", competitionName: "World Cup 2026", format: "cup", net: 2860, settledRounds: 8 },
    { leagueId: "l2", leagueName: "PES Bois", competitionId: "pl2627", competitionName: "Premier League 2026-27", format: "gameweek", net: 860, settledRounds: 6, throughGameweek: 6 },
    { leagueId: "l1", leagueName: "KK Bois", competitionId: "pl2627", competitionName: "Premier League 2026-27", format: "gameweek", net: -380, settledRounds: 6, throughGameweek: 6 },
  ];

  it("never blends the two competitions into one section (the bug leagueNetByUser has today)", () => {
    const sections = buildAnalyticsSections(rows);
    expect(sections).toHaveLength(2);
    expect(sections.map((s) => s.competitionId).sort()).toEqual(["pl2627", "wc26"]);
  });

  it("orders live sections before archive sections regardless of input order", () => {
    const sections = buildAnalyticsSections(rows);
    expect(sections.map((s) => s.kind)).toEqual(["live", "archive"]);
  });

  it("groups every league line under its own competition, sorted by league name", () => {
    const sections = buildAnalyticsSections(rows);
    const live = sections.find((s) => s.competitionId === "pl2627")!;
    expect(live.leagueLines.map((l) => l.leagueName)).toEqual(["KK Bois", "PES Bois"]);
    expect(live.leagueLines.find((l) => l.leagueName === "KK Bois")?.net).toBe(-380);
  });

  it("dedupes a repeated (league, competition) pair instead of double-counting the line", () => {
    const sections = buildAnalyticsSections([...rows, rows[0]]);
    const archive = sections.find((s) => s.competitionId === "wc26")!;
    expect(archive.leagueLines).toHaveLength(1);
  });
});

describe("buildLiveMyForm — my-form A (single league, never a blend)", () => {
  it("returns null when the viewer has no entries this league (no fabricated zero card)", () => {
    expect(buildLiveMyForm("l1", "c1", "KK Bois", "Premier League 2026-27", null, [])).toBeNull();
    expect(
      buildLiveMyForm(
        "l1",
        "c1",
        "KK Bois",
        "Premier League 2026-27",
        liveTotal(),
        [],
      ),
    ).toBeNull();
  });

  it("returns null when hasEntries is true but zero gameweeks are settled (no fabricated ₹0 · 0 card)", () => {
    expect(
      buildLiveMyForm(
        "l1",
        "c1",
        "KK Bois",
        "Premier League 2026-27",
        liveTotal({ hasEntries: true }),
        [],
      ),
    ).toBeNull();
  });

  it("carries the league's own net through untouched, including suppressed", () => {
    const form = buildLiveMyForm(
      "l1",
      "c1",
      "KK Bois",
      "Premier League 2026-27",
      liveTotal({
        netInr: "suppressed",
        gameweeksEntered: 3,
        points: 10,
        hasEntries: true,
      }),
      [],
    );
    expect(form?.net).toBe("suppressed");
    expect(form?.kind).toBe("live");
    expect(form?.competitionId).toBe("c1");
    expect(form?.entered).toBe(3);
    expect(form?.record).toBeNull();
  });

  it("sets the record from the settled snapshot totals", () => {
    const form = buildLiveMyForm(
      "l1",
      "c1",
      "KK Bois",
      "Premier League 2026-27",
      liveTotal({
        netInr: 1240,
        gameweeksEntered: 1,
        points: 13,
        hasEntries: true,
        correctPicks: 7,
        incorrectPicks: 2,
        voidPicks: 1,
        countedFixtures: 9,
      }),
      [],
    );
    expect(form?.record).toBe("7–2–1");
  });

  it("keeps a real zero void count in the live record", () => {
    const form = buildLiveMyForm(
      "l1",
      "c1",
      "KK Bois",
      "Premier League 2026-27",
      liveTotal({
        gameweeksEntered: 2,
        hasEntries: true,
        correctPicks: 14,
        incorrectPicks: 5,
        voidPicks: 0,
        countedFixtures: 19,
      }),
      [],
    );
    expect(form?.record).toBe("14–5–0");
  });

  it("does not render a record when all entered gameweeks have no usable snapshot", () => {
    const form = buildLiveMyForm(
      "l1",
      "c1",
      "KK Bois",
      "Premier League 2026-27",
      liveTotal({ gameweeksEntered: 1, hasEntries: true }),
      [],
    );
    expect(form).not.toBeNull();
    expect(form?.record).toBeNull();
  });

  it("suppresses the record along with net while any gameweek is dirty", () => {
    const form = buildLiveMyForm(
      "l1",
      "c1",
      "KK Bois",
      "Premier League 2026-27",
      liveTotal({
        netInr: "suppressed",
        gameweeksEntered: 2,
        hasEntries: true,
        correctPicks: "suppressed",
        incorrectPicks: "suppressed",
        voidPicks: "suppressed",
        countedFixtures: "suppressed",
      }),
      [],
    );
    expect(form?.net).toBe("suppressed");
    expect(form?.record).toBeNull();
  });
});

describe("buildAllTimeStrip — cross-comp B's anchor line", () => {
  it("returns null when there are no participation rows at all", () => {
    expect(buildAllTimeStrip([])).toBeNull();
  });

  it("returns a null net (not a fabricated zero) when nothing anywhere is settled", () => {
    const strip = buildAllTimeStrip([
      { leagueId: "l1", leagueName: "KK Bois", competitionId: "wc26", competitionName: "World Cup 2026", format: "cup", net: null, settledRounds: 0 },
    ]);
    expect(strip?.net).toBeNull();
    expect(strip?.leagueCount).toBe(1);
    expect(strip?.competitionCount).toBe(1);
    expect(strip?.settledRounds).toBe(0);
  });

  it("sums net and settled rounds across leagues and competitions", () => {
    const strip = buildAllTimeStrip([
      { leagueId: "l1", leagueName: "KK Bois", competitionId: "wc26", competitionName: "World Cup 2026", format: "cup", net: 2860, settledRounds: 8 },
      { leagueId: "l2", leagueName: "PES Bois", competitionId: "pl2627", competitionName: "Premier League 2026-27", format: "gameweek", net: 860, settledRounds: 6 },
      { leagueId: "l1", leagueName: "KK Bois", competitionId: "pl2627", competitionName: "Premier League 2026-27", format: "gameweek", net: -380, settledRounds: 6 },
    ]);
    expect(strip?.net).toBe(3340);
    expect(strip?.leagueCount).toBe(2);
    expect(strip?.competitionCount).toBe(2);
    expect(strip?.settledRounds).toBe(20);
  });

  it("propagates suppressed if any settled row is suppressed", () => {
    const strip = buildAllTimeStrip([
      { leagueId: "l1", leagueName: "KK Bois", competitionId: "wc26", competitionName: "World Cup 2026", format: "cup", net: 2860, settledRounds: 8 },
      { leagueId: "l2", leagueName: "PES Bois", competitionId: "pl2627", competitionName: "Premier League 2026-27", format: "gameweek", net: "suppressed", settledRounds: 6 },
    ]);
    expect(strip?.net).toBe("suppressed");
  });
});

describe("buildArchiveMyForm — accuracy engine reuse", () => {
  const entry = (overrides: Partial<Entry> = {}): Entry => ({
    outcome: "home",
    predHome: 2,
    predAway: 1,
    ftHome: 2,
    ftAway: 1,
    isKnockout: false,
    net: 500,
    kickoffMs: 1,
    homeLabel: "A",
    awayLabel: "B",
    ...overrides,
  });

  it("returns null on an empty sample rather than a fabricated zero record", () => {
    expect(buildArchiveMyForm("l1", "c1", "KK Bois", "World Cup 2026", [])).toBeNull();
  });

  it("derives correct/incorrect from the shared grading rules, not stored net", () => {
    const form = buildArchiveMyForm("l1", "c1", "KK Bois", "World Cup 2026", [
      entry({ net: 500 }),
      entry({ outcome: "away", net: -100 }),
    ]);
    expect(form?.record).toBe("1–1–0");
    expect(form?.net).toBe(400);
    expect(form?.kind).toBe("archive");
    expect(form?.competitionId).toBe("c1");
  });
});
