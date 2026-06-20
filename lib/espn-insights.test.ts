import { describe, it, expect } from "vitest";
import { parseOdds, parseForm, parseH2H, parseStandings, buildInsightsRow, mapInsightsView } from "./espn-insights";

// Minimal payload mirroring the live ESPN summary shape probed 2026-06-20 (event 760448).
// Current fixture: home = Germany (481), away = Ivory Coast (4789).
const SUMMARY = {
  hasOdds: true,
  header: {
    competitions: [
      { competitors: [{ homeAway: "home", team: { id: "481" } }, { homeAway: "away", team: { id: "4789" } }] },
    ],
  },
  pickcenter: [
    {
      provider: { name: "DraftKings" },
      moneyline: {
        home: { close: { odds: "-195" } },
        draw: { close: { odds: "+370" } },
        away: { close: { odds: "+500" } },
      },
      total: {
        over: { close: { line: "o2.5", odds: "-170" } },
        under: { close: { line: "u2.5", odds: "+140" } },
      },
    },
  ],
  odds: [{}],
  lastFiveGames: [
    { team: { id: "481", displayName: "Germany" }, events: [{ gameResult: "W", score: "2-0", opponent: { displayName: "France" }, gameDate: "2026-03-27T19:45Z" }] },
    { team: { id: "4789", displayName: "Ivory Coast" }, events: [{ gameResult: "L", score: "0-1", opponent: { displayName: "Spain" }, gameDate: "2026-03-25T19:45Z" }] },
  ],
  // Two meetings: one where Germany(481) was home & won, one where Germany was the AWAY side & lost.
  headToHeadGames: [
    {
      team: { id: "481", displayName: "Germany" },
      events: [
        { homeTeamId: "481", awayTeamId: "4789", homeTeamScore: "2", awayTeamScore: "1", leagueName: "Friendly", gameDate: "2024-03-23T19:45Z" },
        { homeTeamId: "4789", awayTeamId: "481", homeTeamScore: "1", awayTeamScore: "0", leagueName: "Friendly", gameDate: "2021-06-10T19:45Z" },
      ],
    },
  ],
  standings: {
    groups: [
      {
        standings: {
          entries: [
            // intentionally out of rank order to test the sort
            { team: "Ivory Coast", id: "4789", stats: [{ type: "gamesplayed", value: 2 }, { type: "wins", value: 1 }, { type: "ties", value: 0 }, { type: "losses", value: 1 }, { type: "pointdifferential", value: -1, displayValue: "-1" }, { type: "points", value: 3 }, { type: "rank", value: 3 }] },
            { team: "Germany", id: "481", stats: [{ type: "gamesplayed", value: 2 }, { type: "wins", value: 2 }, { type: "ties", value: 0 }, { type: "losses", value: 0 }, { type: "pointdifferential", value: 4, displayValue: "+4" }, { type: "points", value: 6 }, { type: "rank", value: 1 }] },
          ],
        },
      },
    ],
  },
};

describe("parseOdds", () => {
  it("reads the pickcenter 3-way + totals (strings → numbers)", () => {
    const o = parseOdds(SUMMARY)!;
    expect(o).not.toBeNull();
    expect(o.mlHome).toBe(-195);
    expect(o.mlDraw).toBe(370);
    expect(o.mlAway).toBe(500);
    expect(o.totalLine).toBe(2.5);
    expect(o.overOdds).toBe(-170);
    expect(o.underOdds).toBe(140);
    expect(o.provider).toBe("DraftKings");
  });

  it("returns null when no complete market exists", () => {
    expect(parseOdds({ pickcenter: [], odds: [] })).toBeNull();
  });
});

describe("parseForm", () => {
  it("maps form to home/away by team id", () => {
    const { home, away } = parseForm(SUMMARY);
    expect(home[0]).toMatchObject({ result: "W", score: "2-0", opponent: "France" });
    expect(away[0]).toMatchObject({ result: "L", score: "0-1", opponent: "Spain" });
  });
  it("does not throw when the home id can't be resolved (header missing)", () => {
    const { home, away } = parseForm({ ...SUMMARY, header: undefined });
    expect(Array.isArray(home)).toBe(true);
    expect(Array.isArray(away)).toBe(true);
  });
});

describe("parseH2H — orientation + tally from current home POV", () => {
  const h = parseH2H(SUMMARY);
  it("orients every game to the current home team (Germany) regardless of historical home/away", () => {
    // Game 1: Germany home, won 2-1 → home 2, away 1, W
    expect(h.games[0]).toMatchObject({ homeScore: 2, awayScore: 1, result: "W" });
    // Game 2: Germany was AWAY and lost 0-1 → oriented to home(Germany): 0-1, L
    expect(h.games[1]).toMatchObject({ homeScore: 0, awayScore: 1, result: "L" });
  });
  it("tallies from the current home POV", () => {
    expect(h.tally).toEqual({ w: 1, d: 0, l: 1 });
  });
  it("returns an empty tally + games for a first-ever meeting", () => {
    const empty = parseH2H({ ...SUMMARY, headToHeadGames: [] });
    expect(empty).toEqual({ tally: { w: 0, d: 0, l: 0 }, games: [] });
  });
});

describe("parseStandings — verified lowercase keys, sorted by rank", () => {
  const s = parseStandings(SUMMARY)!;
  it("parses the group rows with the correct ESPN keys and sorts by rank", () => {
    expect(s.rows[0]).toMatchObject({ team: "Germany", w: 2, d: 0, l: 0, gd: 4, pts: 6, rank: 1 });
    expect(s.rows[1]).toMatchObject({ team: "Ivory Coast", gd: -1, pts: 3, rank: 3 });
  });
});

describe("buildInsightsRow", () => {
  it("produces a complete row with derived model fields incl. p_over", () => {
    const row = buildInsightsRow("fx-1", SUMMARY);
    expect(row.fixture_id).toBe("fx-1");
    expect(row.odds_available).toBe(true);
    expect(row.ml_home).toBe(-195);
    expect((row.p_home ?? 0) + (row.p_draw ?? 0) + (row.p_away ?? 0)).toBeCloseTo(1, 6);
    expect(row.top_scores).toHaveLength(5);
    expect(row.p_over).not.toBeNull();
    expect(row.p_over!).toBeGreaterThan(0.5); // over -170 favoured
    expect(row.h2h.tally).toEqual({ w: 1, d: 0, l: 1 });
    expect(row.standings?.rows?.[0].team).toBe("Germany");
    expect(row.fetched_at).toBeTruthy();
  });

  it("keeps p_over finite when odds present but no totals line", () => {
    const noTotal = {
      ...SUMMARY,
      pickcenter: [{ provider: { name: "X" }, moneyline: { home: { close: { odds: "-195" } }, draw: { close: { odds: "+370" } }, away: { close: { odds: "+500" } } } }],
    };
    const row = buildInsightsRow("fx-3", noTotal);
    expect(row.total_line).toBeNull();
    expect(row.p_over).not.toBeNull();
    expect(Number.isFinite(row.p_over!)).toBe(true);
  });

  it("degrades to odds_available=false when odds are missing", () => {
    const row = buildInsightsRow("fx-2", { ...SUMMARY, pickcenter: [], odds: [] });
    expect(row.odds_available).toBe(false);
    expect(row.p_home).toBeNull();
    expect(row.p_over).toBeNull();
    expect(row.form_home.length).toBeGreaterThan(0); // form/context still parsed
  });
});

describe("mapInsightsView — coerces string numerics (Supabase numeric → number)", () => {
  it("turns a raw DB-shaped row (string numerics) into typed numbers", () => {
    const raw = {
      odds_available: true,
      provider: "DraftKings",
      ml_home: "-195", ml_draw: "370", ml_away: "500",
      p_home: "0.64", p_draw: "0.20", p_away: "0.16",
      total_line: "2.5", p_over: "0.60",
      top_scores: [{ h: 1, a: 0, p: 0.16 }],
      p_btts: "0.40", p_cs_home: "0.45", p_cs_away: "0.22",
      form_home: [], form_away: [],
      h2h: { tally: { w: 1, d: 0, l: 1 }, games: [] },
      standings: { rows: [] },
    };
    const v = mapInsightsView(raw)!;
    expect(v.oddsAvailable).toBe(true);
    expect(v.probs).toEqual({ home: 0.64, draw: 0.2, away: 0.16 });
    expect(typeof v.pOver).toBe("number");
    expect(v.pOver).toBeCloseTo(0.6, 5);
    expect(v.totalLine).toBe(2.5);
    expect(v.topScores).toHaveLength(1);
  });
  it("returns null for a null row", () => {
    expect(mapInsightsView(null)).toBeNull();
  });
});
