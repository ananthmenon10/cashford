import { describe, it, expect } from "vitest";
import { mapStatus, isReal, numScore, ymd, classifyEvent, advancerTeamId, type FixtureRow } from "./espn";

describe("mapStatus", () => {
  it("maps explicit terminal names regardless of state", () => {
    expect(mapStatus("STATUS_POSTPONED", "pre")).toBe("postponed");
    expect(mapStatus("STATUS_CANCELED")).toBe("cancelled");
    expect(mapStatus("STATUS_CANCELLED")).toBe("cancelled");
    expect(mapStatus("STATUS_ABANDONED")).toBe("abandoned");
    expect(mapStatus("STATUS_FORFEIT")).toBe("abandoned");
  });

  it("falls back to ESPN state for normal flow", () => {
    expect(mapStatus("STATUS_FULL_TIME", "post")).toBe("finished");
    expect(mapStatus("STATUS_FIRST_HALF", "in")).toBe("live");
    expect(mapStatus("STATUS_SCHEDULED", "pre")).toBe("scheduled");
    expect(mapStatus()).toBe("scheduled"); // no args → defaults
  });
});

describe("isReal — distinguishes a resolved country from a bracket placeholder", () => {
  const team = (over: any) => ({ team: { id: "7", abbreviation: "GER", displayName: "Germany", ...over } });

  it("accepts a real team", () => expect(isReal(team({}))).toBe(true));
  it("rejects when there is no team id", () => expect(isReal({ team: { abbreviation: "GER", displayName: "Germany" } })).toBe(false));
  it("rejects numeric-leading abbreviations (seed slots like '1A')", () => expect(isReal(team({ abbreviation: "1A" }))).toBe(false));
  it("rejects placeholder display names", () => {
    for (const name of ["Winner Group A", "Runner-up B", "Loser SF1", "Group C", "1st Place", "TBD"]) {
      expect(isReal(team({ displayName: name }))).toBe(false);
    }
  });
  it("is null-safe", () => expect(isReal(null)).toBe(false));
});

describe("numScore", () => {
  it("parses numeric strings and passes through ints", () => {
    expect(numScore("3")).toBe(3);
    expect(numScore(0)).toBe(0);
  });
  it("treats empty/nullish as null (not 0)", () => {
    expect(numScore("")).toBeNull();
    expect(numScore(null)).toBeNull();
    expect(numScore(undefined)).toBeNull();
  });
});

describe("ymd", () => {
  it("formats a UTC date as YYYYMMDD for the ESPN window param", () => {
    expect(ymd(new Date("2026-06-22T18:30:00.000Z"))).toBe("20260622");
  });
});

describe("advancerTeamId", () => {
  it("returns the winning side's id when known", () => {
    expect(advancerTeamId({ winner: true }, { winner: false }, "h", "a")).toBe("h");
    expect(advancerTeamId({ winner: false }, { winner: true }, "h", "a")).toBe("a");
  });
  it("returns null when the winner's id is unknown or nobody won", () => {
    expect(advancerTeamId({ winner: true }, {}, null, "a")).toBeNull();
    expect(advancerTeamId({ winner: false }, { winner: false }, "h", "a")).toBeNull();
  });
});

describe("classifyEvent — the per-event skip/decision core", () => {
  const fx: FixtureRow = { status: "scheduled", is_knockout: false, home_team_id: "h", away_team_id: "a" };
  const ev = (over: any) => ({
    competitions: [{ competitors: [
      { homeAway: "home", team: { id: "1", abbreviation: "GER", displayName: "Germany" }, ...over?.home },
      { homeAway: "away", team: { id: "2", abbreviation: "FRA", displayName: "France" }, ...over?.away },
    ] }],
    status: { type: { state: over?.state ?? "pre", name: over?.name ?? "STATUS_SCHEDULED" } },
  });

  it("orients home/away by homeAway flag", () => {
    const c = classifyEvent(ev({}), fx);
    expect(c.home.team.displayName).toBe("Germany");
    expect(c.away.team.displayName).toBe("France");
  });

  it("skips a scheduled-future game already recorded as scheduled", () => {
    expect(classifyEvent(ev({}), fx).skip).toBe(true);
  });

  it("does NOT skip a live game", () => {
    const c = classifyEvent(ev({ state: "in", name: "STATUS_FIRST_HALF" }), fx);
    expect(c.isLive).toBe(true);
    expect(c.skip).toBe(false);
  });

  it("terminalChange only when the terminal status differs from what we stored", () => {
    const toFinished = ev({ state: "post", name: "STATUS_FULL_TIME" });
    expect(classifyEvent(toFinished, fx).terminalChange).toBe(true); // scheduled → finished
    expect(classifyEvent(toFinished, { ...fx, status: "finished" }).terminalChange).toBe(false); // already finished
    expect(classifyEvent(toFinished, { ...fx, status: "finished" }).skip).toBe(true);
  });

  it("needsResolve when both sides are real but our row still has a missing team id", () => {
    const unresolved: FixtureRow = { ...fx, home_team_id: null };
    const c = classifyEvent(ev({}), unresolved);
    expect(c.needsResolve).toBe(true);
    expect(c.skip).toBe(false); // resolution overrides the scheduled-skip
  });

  it("no resolve when sides are still placeholders", () => {
    const placeholder = ev({ home: { team: { id: "1", abbreviation: "1A", displayName: "Winner Group A" } } });
    expect(classifyEvent(placeholder, { ...fx, home_team_id: null }).needsResolve).toBe(false);
  });
});
