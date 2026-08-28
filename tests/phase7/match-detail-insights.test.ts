// Step 9 (#16) — buildMatchDetailView's insight-block mapping. Locks in the switch from raw
// moneyline dumps to de-vigged 1X2 probabilities (already stored on fixture_insights as
// p_home/p_draw/p_away — see lib/espn-insights.ts buildInsightsRow), and the graceful-absent
// behaviour every module in components/matches/MatchInsightModules.tsx depends on.
import { describe, expect, it } from "vitest";
import { buildMatchDetailView, type MatchDetailInput } from "../../lib/match-detail";
import { MATCH_COPY } from "../../lib/match-copy";

const NOW = new Date("2026-08-10T12:00:00.000Z");
const KICKOFF = "2026-08-15T14:00:00.000Z";

function baseInput(overrides: Partial<MatchDetailInput> = {}): MatchDetailInput {
  return {
    now: NOW,
    state: "pre",
    fixture: {
      id: "fx1",
      home: { id: "h1", name: "Arsenal" },
      away: { id: "a1", name: "Chelsea" },
      score: null,
      status: "Fri 15 Aug",
      kickoffAt: KICKOFF,
    },
    selectedRoom: null,
    yourCalls: [],
    insights: null,
    standings: null,
    matchData: null,
    providerRows: [],
    slowRows: [],
    ...overrides,
  };
}

describe("buildMatchDetailView — odds module", () => {
  it("surfaces de-vigged 1X2 probabilities and the model line, not raw moneylines", () => {
    const view = buildMatchDetailView(
      baseInput({
        insights: {
          ml_home: -195,
          ml_draw: 260,
          ml_away: 370,
          p_home: 0.62,
          p_draw: 0.24,
          p_away: 0.14,
          provider: "ESPN BET",
          odds_ok: true,
          odds_fetched_at: "2026-08-10T10:00:00.000Z",
          top_scores: [{ h: 2, a: 1, p: 0.18 }],
          p_btts: 0.55,
          p_cs_home: 0.3,
          p_cs_away: 0.2,
          p_over: 0.6,
          total_line: 2.5,
          model_ok: true,
          model_fetched_at: "2026-08-10T10:00:00.000Z",
          model_source_kickoff_at: KICKOFF,
        },
      }),
    );
    expect(view.odds).toBeDefined();
    expect(view.odds!.pHome).toBeCloseTo(0.62);
    expect(view.odds!.pDraw).toBeCloseTo(0.24);
    expect(view.odds!.pAway).toBeCloseTo(0.14);
    expect(view.odds!.mlHome).toBe(-195);
    expect(view.odds!.book).toBe("ESPN BET");

    expect(view.model).toBeDefined();
    expect(view.model!.topScores[0]).toEqual({ h: 2, a: 1, p: 0.18 });
    expect(view.model!.totalLine).toBe(2.5);
    expect(view.model!.pOver).toBeCloseTo(0.6);
  });

  it("hides the odds block when the probabilities are missing even if moneylines are present", () => {
    const view = buildMatchDetailView(
      baseInput({
        insights: {
          ml_home: -195,
          ml_draw: 260,
          ml_away: 370,
          p_home: null,
          p_draw: null,
          p_away: null,
          provider: "ESPN BET",
          odds_ok: true,
          odds_fetched_at: "2026-08-10T10:00:00.000Z",
        },
      }),
    );
    expect(view.odds).toBeUndefined();
  });

  it("hides odds/model/form/h2h/table entirely when there is no insights row", () => {
    const view = buildMatchDetailView(baseInput({ insights: null }));
    expect(view.odds).toBeUndefined();
    expect(view.model).toBeUndefined();
    expect(view.form).toBeUndefined();
    expect(view.h2h).toBeUndefined();
    expect(view.table).toBeUndefined();
  });

  it("model totalLine falls back to null (not NaN/undefined-on-screen) when absent", () => {
    const view = buildMatchDetailView(
      baseInput({
        insights: {
          top_scores: [{ h: 1, a: 0, p: 0.2 }],
          p_btts: 0.4,
          p_cs_home: 0.3,
          p_cs_away: 0.25,
          p_over: 0.5,
          total_line: null,
          model_ok: true,
          model_fetched_at: "2026-08-10T10:00:00.000Z",
          model_source_kickoff_at: KICKOFF,
        },
      }),
    );
    expect(view.model).toBeDefined();
    expect(view.model!.totalLine).toBeNull();
  });
});

describe("MATCH_COPY.h2hSummary", () => {
  it("pins the exact wording buildMatchDetailView wires into view.h2h.summary", () => {
    // Pin the function's own output, not a hand-written string — if h2hSummary's wording
    // changes, this test (and the wiring test below) must change together.
    expect(MATCH_COPY.h2hSummary("Arsenal", 2, 1, "Chelsea", 1)).toBe(
      "Arsenal 2 wins · 1 draw · 1 Chelsea win",
    );

    const view = buildMatchDetailView(
      baseInput({
        insights: {
          h2h: {
            games: [
              { date: "2026-01-10T15:00:00.000Z", competition: "Premier League", homeScore: 2, awayScore: 1 },
            ],
            tally: { w: 2, d: 1, l: 1 },
          },
          h2h_ok: true,
          h2h_fetched_at: "2026-08-10T10:00:00.000Z",
        },
      }),
    );
    expect(view.h2h!.summary).toBe(MATCH_COPY.h2hSummary("Arsenal", 2, 1, "Chelsea", 1));
  });
});

describe("buildMatchDetailView — form/h2h/table modules", () => {
  it("passes through form and h2h only when ok+fetched, hides on ok:false", () => {
    const withForm = buildMatchDetailView(
      baseInput({
        insights: {
          form_home: [{ result: "W", score: "2-1", opponent: "Fulham", date: "2026-08-01" }],
          form_away: [],
          form_ok: true,
          form_fetched_at: "2026-08-10T10:00:00.000Z",
        },
      }),
    );
    expect(withForm.form).toBeDefined();
    expect(withForm.form!.home).toHaveLength(1);

    const formNotOk = buildMatchDetailView(
      baseInput({
        insights: {
          form_home: [{ result: "W", score: "2-1", opponent: "Fulham", date: "2026-08-01" }],
          form_away: [],
          form_ok: false,
          form_fetched_at: "2026-08-10T10:00:00.000Z",
        },
      }),
    );
    expect(formNotOk.form).toBeUndefined();
  });

  it("hides the table module when the standings cache has no rows", () => {
    const view = buildMatchDetailView(baseInput({ standings: { source: "espn", rows: [], note: null, fetched_at: "2026-08-10T10:00:00.000Z" } }));
    expect(view.table).toBeUndefined();
  });

  it("surfaces the table module with source/note/age when rows exist", () => {
    const view = buildMatchDetailView(
      baseInput({
        standings: {
          source: "espn",
          rows: [
            { rank: 1, club: "Arsenal", club_id: "h1", played: 1, won: 1, drawn: 0, lost: 0, gd: 2, points: 3, form: ["W"] },
          ],
          note: null,
          fetched_at: "2026-08-10T10:00:00.000Z",
        },
      }),
    );
    expect(view.table).toBeDefined();
    expect(view.table!.window).toHaveLength(1);
    expect(view.table!.source).toBe("espn");
  });
});

describe("buildMatchDetailView — visible match-detail DTO rows", () => {
  it("projects realistic scorer and team-news rows into typed sourced blocks", () => {
    const scorerAndNews = buildMatchDetailView(
      baseInput({
        insights: {
          team_news: {
            home: [
              { player: "Odegaard", reason: "Being assessed", status: "d" },
              { player: "", reason: "Bad row", status: "i" },
              { player: "Saka", reason: "Bad status", status: "a" },
              { player: "Missing reason", status: "i" },
            ],
            away: [
              { player: "Jackson", reason: "Ankle injury", status: "i" },
              { player: "Bad row", reason: "Missing status" },
            ],
          },
          team_news_ok: true,
          team_news_source: "FPL",
          team_news_fetched_at: "2026-08-10T10:00:00.000Z",
        },
        matchData: {
          scorers: [
            { team: "home", player: "Curtis Jones", minutes: [58] },
            { team: "away", player: "Kevin Schade", minutes: [64] },
            { team: "home", player: "", minutes: [70] },
            { team: "home", player: "Missing minutes" },
            null,
          ],
          scorers_ok: true,
          scorers_fetched_at: "2026-08-10T10:00:00.000Z",
        },
      }),
    );

    expect(scorerAndNews.header.scorers?.lines).toEqual([
      { team: "home", player: "Curtis Jones", minutes: [58] },
      { team: "away", player: "Kevin Schade", minutes: [64] },
    ]);
    expect(scorerAndNews.teamNews?.home).toEqual([
      { player: "Odegaard", reason: "Being assessed", status: "d" },
    ]);
    expect(scorerAndNews.teamNews?.away).toEqual([
      { player: "Jackson", reason: "Ankle injury", status: "i" },
    ]);
  });

  it("drops malformed event rows while keeping every supported ESPN event type", () => {
    const view = buildMatchDetailView(
      baseInput({
        state: "live",
        fixture: {
          ...baseInput().fixture,
          score: [1, 0],
        },
        matchData: {
          key_events: [
            { minute: 12, clock: "12'", type: "goal", team: "home", player: "Saka", assist: "Odegaard", detail: null },
            { minute: 33, clock: "33'", type: "own_goal", team: "away", player: "Saliba", assist: null, detail: "Own goal" },
            { minute: 44, clock: "44'", type: "pen", team: "home", player: "Havertz", assist: null, detail: null },
            { minute: 45, clock: "45'", type: "miss_pen", team: "away", player: "Jackson", assist: null, detail: null },
            { minute: 55, clock: "55'", type: "yellow", team: "home", player: "Rice", assist: null, detail: null },
            { minute: 66, clock: "66'", type: "red", team: "away", player: "Silva", assist: null, detail: null },
            { minute: 72, clock: "72'", type: "sub", team: "home", player: "Martinelli", assist: null, detail: null },
            { minute: 80, clock: "80'", type: "var", team: "away", player: "VAR", assist: null, detail: null },
            { minute: "not-a-minute", clock: "81'", type: "goal", team: "home", player: "Bad minute" },
            { minute: 82, clock: "82'", type: "unknown", team: "home", player: "Bad type" },
            { minute: 83, clock: "83'", type: "goal", team: "neutral", player: "Bad team" },
            { minute: 84, clock: "84'", type: "goal", team: "home" },
            null,
          ],
          key_events_ok: true,
          key_events_fetched_at: "2026-08-10T10:00:00.000Z",
        },
      }),
    );

    expect(view.keyEvents?.timeline).toHaveLength(8);
    expect(view.keyEvents?.timeline.map((event) => event.type)).toEqual([
      "goal",
      "own_goal",
      "pen",
      "miss_pen",
      "yellow",
      "red",
      "sub",
      "var",
    ]);
  });

  it("projects only valid canonical team-stat pairs and does not accept the old array shape", () => {
    const view = buildMatchDetailView(
      baseInput({
        state: "live",
        fixture: {
          ...baseInput().fixture,
          score: [0, 0],
        },
        matchData: {
          team_stats: {
            shots: { h: 24, a: 11 },
            onTarget: { h: "8", a: "2" },
            corners: { h: 14, a: "not-a-number" },
            possession: { h: 60.2, a: 39.8 },
            unknown: { h: 1, a: 2 },
          },
          team_stats_ok: true,
          team_stats_fetched_at: "2026-08-10T10:00:00.000Z",
        },
      }),
    );

    expect(view.teamStats?.rows).toEqual([
      { label: "shots", value: { h: 24, a: 11 } },
      { label: "onTarget", value: { h: 8, a: 2 } },
      { label: "possession", value: { h: 60.2, a: 39.8 } },
    ]);

    const arrayView = buildMatchDetailView(
      baseInput({
        state: "live",
        fixture: {
          ...baseInput().fixture,
          score: [0, 0],
        },
        matchData: {
          team_stats: [{ label: "shots", value: { h: 1, a: 2 } }],
          team_stats_ok: true,
          team_stats_fetched_at: "2026-08-10T10:00:00.000Z",
        },
      }),
    );
    expect(arrayView.teamStats).toBeUndefined();
  });

  it("drops commentary rows without text but keeps empty minutes from the ESPN feed", () => {
    const view = buildMatchDetailView(
      baseInput({
        state: "live",
        fixture: {
          ...baseInput().fixture,
          score: [0, 0],
        },
        matchData: {
          commentary: [
            { minute: "", text: "Lineups are announced." },
            { minute: "1'", text: "First Half begins." },
            { minute: "2'", text: "" },
            { minute: 3, text: "Bad minute" },
            { minute: "4'" },
            null,
          ],
          commentary_ok: true,
          commentary_fetched_at: "2026-08-10T10:00:00.000Z",
        },
      }),
    );

    expect(view.commentary?.lines).toEqual([
      { minute: "", text: "Lineups are announced." },
      { minute: "1'", text: "First Half begins." },
    ]);
  });

  it("projects realistic FotMob ratings, drops malformed rows, and stays absent without a valid PotM", () => {
    const view = buildMatchDetailView(
      baseInput({
        state: "post",
        fixture: {
          ...baseInput().fixture,
          score: [2, 1],
          finishedAt: "2026-08-15T16:00:00.000Z",
        },
        slowRows: [
          {
            provider: "fotmob",
            ratings: [
              { player: "Bukayo Saka", team: "home", rating: 8.4, goals: 1 },
              { player: "Martin Odegaard", team: "home", rating: 7.7 },
              { player: "Bad team", team: "neutral", rating: 7 },
              { player: "Bad rating", team: "away", rating: "unknown" },
              null,
            ],
            potm: { player: "Bukayo Saka", team: "home", rating: 8.4, goals: 1 },
            ratings_ok: true,
            ratings_fetched_at: "2026-08-15T17:00:00.000Z",
            ratings_provider: "FotMob",
          },
        ],
      }),
    );

    expect(view.ratings).toMatchObject({
      potm: { player: "Bukayo Saka", team: "home", rating: 8.4, goals: 1 },
      others: [{ player: "Martin Odegaard", team: "home", rating: 7.7 }],
      provider: "FotMob",
    });

    const absent = buildMatchDetailView(
      baseInput({
        state: "post",
        fixture: {
          ...baseInput().fixture,
          score: [2, 1],
        },
        slowRows: [
          {
            provider: "fotmob",
            ratings: [{ player: "Bad", team: "home", rating: "nope" }],
            potm: { player: "Bad", team: "home", rating: "nope" },
            ratings_ok: true,
            ratings_fetched_at: "2026-08-15T17:00:00.000Z",
          },
        ],
      }),
    );
    expect(absent.ratings).toBeUndefined();
  });

  it("keeps the hidden DTO projections available while their render paths stay out of the page", () => {
    const view = buildMatchDetailView(
      baseInput({
        state: "post",
        fixture: {
          ...baseInput().fixture,
          score: [1, 0],
          finishedAt: "2026-08-15T16:00:00.000Z",
        },
        insights: {
          top_scores: [{ h: 1, a: 0, p: 0.2 }],
          model_ok: true,
          model_fetched_at: "2026-08-10T10:00:00.000Z",
          model_source_kickoff_at: KICKOFF,
        },
        matchData: {
          player_stats: [{ player: "Player", team: "home" }],
          player_stats_ok: true,
          player_stats_fetched_at: "2026-08-15T17:00:00.000Z",
          lineups: { home: { formation: "4-3-3" }, away: { formation: "4-4-2" } },
          lineups_ok: true,
          lineups_fetched_at: "2026-08-15T17:00:00.000Z",
        },
        slowRows: [
          {
            provider: "fotmob",
            predicted_xi: { home: { formation: "4-3-3" }, away: { formation: "4-4-2" } },
            predicted_xi_ok: true,
            predicted_xi_fetched_at: "2026-08-10T10:00:00.000Z",
            shots: [{ team: "home", minute: 10 }],
            shots_ok: true,
            shots_fetched_at: "2026-08-15T17:00:00.000Z",
            momentum: [{ minute: 10, value: 1 }],
            momentum_ok: true,
            momentum_fetched_at: "2026-08-15T17:00:00.000Z",
          },
        ],
      }),
    );

    const preView = buildMatchDetailView(
      baseInput({
        state: "pre",
        slowRows: [
          {
            provider: "fotmob",
            predicted_xi: { home: { formation: "4-3-3" }, away: { formation: "4-4-2" } },
            predicted_xi_ok: true,
            predicted_xi_fetched_at: "2026-08-10T10:00:00.000Z",
          },
        ],
      }),
    );

    expect(view.playerStats).toBeDefined();
    expect(view.lineups).toBeDefined();
    expect(view.shotMap).toBeDefined();
    expect(view.momentum).toBeDefined();
    expect(preView.predictedXi).toBeDefined();
  });
});
