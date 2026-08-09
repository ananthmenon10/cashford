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
