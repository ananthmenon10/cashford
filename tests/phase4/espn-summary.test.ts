import { describe, expect, it } from "vitest";
import {
  buildMatchDataPatch,
  parseCommentary,
  parseKeyEvents,
  parseLineups,
  parsePlayerStats,
  parseScorers,
  parseSummaryScore,
  parseTeamStats,
  validateSummary,
} from "../../lib/espn-summary";
import ft from "../fixtures/espn-summary/ft.json";
import live from "../fixtures/espn-summary/live.json";
import pre from "../fixtures/espn-summary/pre.json";

describe("ESPN summary adapter against the recorded Liverpool–Brentford payload", () => {
  it("validates the recorded event and final score", () => {
    expect(validateSummary(ft, "740975")).toBe(true);
    expect(validateSummary(ft, "other")).toBe(false);
    expect(parseSummaryScore(ft)).toEqual({ home: 1, away: 1 });
  });

  it("reads real key-event participants and groups the two scorers", () => {
    const events = parseKeyEvents(ft);
    expect(events).not.toBeNull();
    expect(events?.find((event) => event.player === "Curtis Jones")).toEqual(
      expect.objectContaining({ type: "goal", assist: "Mohamed Salah" }),
    );
    expect(events?.find((event) => event.player === "Kevin Schade")).toEqual(
      expect.objectContaining({ type: "goal", assist: null }),
    );
    expect(events?.find((event) => event.player === "Ibrahima Konaté")).toEqual(
      expect.objectContaining({ type: "yellow", assist: null }),
    );

    expect(parseKeyEvents(ft)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          minute: 58,
          clock: "58'",
          type: "goal",
          team: "home",
          player: "Curtis Jones",
          detail: expect.stringContaining("Assisted by Mohamed Salah"),
        }),
        expect.objectContaining({
          minute: 64,
          clock: "64'",
          type: "goal",
          team: "away",
          player: "Kevin Schade",
        }),
      ]),
    );

    expect(parseScorers(ft)).toEqual(
      expect.arrayContaining([
        { team: "home", player: "Curtis Jones", minutes: [58] },
        { team: "away", player: "Kevin Schade", minutes: [64] },
      ]),
    );
  });

  it("keeps the real pre-match shape free of player stats and key events", () => {
    expect(validateSummary(pre, "401879301")).toBe(true);
    expect(pre.header.competitions[0].status.type.state).toBe("pre");
    expect(pre.rosters.map((roster) => roster.homeAway)).toEqual(["home", "away"]);
    expect(pre.odds.map((row) => row.provider.name)).toEqual(["DraftKings", "Bet 365"]);
    expect(parseSummaryScore(pre)).toBeNull();
    expect(parseLineups(pre)).toBeNull();
    expect(parsePlayerStats(pre)).toBeNull();
    expect(parseKeyEvents(pre)).toBeNull();
  });

  it("parses the derived live fixture's partial score", () => {
    expect(validateSummary(live, "740975")).toBe(true);
    expect(live.header.competitions[0].status.type.state).toBe("in");
    expect(parseSummaryScore(live)).toEqual({ home: 0, away: 0 });
    expect(live.keyEvents.map((event) => event.id)).toEqual([
      "47763606",
      "47764458",
    ]);
  });

  it("reads real team stats from boxscore.teams[].statistics[]", () => {
    expect(parseTeamStats(ft)).toEqual({
      shots: { h: 24, a: 11 },
      onTarget: { h: 8, a: 2 },
      corners: { h: 14, a: 2 },
      possession: { h: 60.2, a: 39.8 },
    });
  });

  it("reads roster-entry stats, keeps ESPN ratings null, and reads the trimmed XI", () => {
    const stats = parsePlayerStats(ft);
    expect(stats).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          player: "Curtis Jones",
          team: "home",
          rating: null,
          goals: 1,
          assists: 0,
          totalShots: 1,
          shotsOnTarget: 1,
        }),
        expect.objectContaining({
          player: "Mohamed Salah",
          team: "home",
          rating: null,
          goals: 0,
          assists: 1,
          totalShots: 4,
          shotsOnTarget: 2,
        }),
        expect.objectContaining({
          player: "Kevin Schade",
          team: "away",
          rating: null,
          goals: 1,
          totalShots: 4,
          shotsOnTarget: 2,
        }),
      ]),
    );

    expect(parseLineups(ft)).toEqual({
      home: {
        formation: "4-2-3-1",
        players: [
          { name: "Alisson Becker", shirt: "1" },
          { name: "Ibrahima Konaté", shirt: "5" },
          { name: "Curtis Jones", shirt: "17" },
          { name: "Mohamed Salah", shirt: "11" },
        ],
      },
      away: {
        formation: "4-2-3-1",
        players: [
          { name: "Caoimhín Kelleher", shirt: "1" },
          { name: "Nathan Collins", shirt: "22" },
          { name: "Keane Lewis-Potter", shirt: "23" },
          { name: "Kevin Schade", shirt: "7" },
        ],
      },
    });
  });

  it("reads real commentary lines", () => {
    expect(parseCommentary(ft)).toEqual([
      { minute: "", text: "Lineups are announced and players are warming up." },
      { minute: "", text: "First Half begins." },
      { minute: "1'", text: "Corner, Liverpool. Conceded by Michael Kayode." },
      {
        minute: "2'",
        text: "Attempt blocked. Alexis Mac Allister (Liverpool) right footed shot from outside the box is blocked. Assisted by Rio Ngumoha.",
      },
      { minute: "4'", text: "Corner, Liverpool. Conceded by Keane Lewis-Potter." },
    ]);

  });

  it("builds a partial player-stats patch from the recorded roster block", () => {
    const patch = buildMatchDataPatch("fx-1", ft, ["player_stats"], "2026-07-31T00:00:00.000Z");
    expect(patch).toHaveProperty("player_stats_ok", true);
    expect(patch).toHaveProperty("player_stats_fetched_at", "2026-07-31T00:00:00.000Z");
    expect(patch).not.toHaveProperty("team_stats");
  });
});
