import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchUnderstatCandidates,
  parseUnderstatCandidates,
  parseUnderstatMatch,
  understatSeason,
} from "../../lib/understat";
import match from "../fixtures/understat/match.json";
import league from "../fixtures/understat/league.json";

describe("Understat adapter", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("A-10a…A-10d: converts only valid Cashford season labels", () => {
    expect(understatSeason("2026-27")).toBe("2026");
    expect(understatSeason("2099-00")).toBe("2099"); // century rollover
    expect(() => understatSeason("2026")).toThrow();
    expect(() => understatSeason("2026-28")).toThrow();
  });

  it("A-10e: the discovery URL built for a seeded pl-2026-27 row ends /EPL/2026/", async () => {
    const fetchSpy = vi.fn<typeof fetch>(() =>
      Promise.resolve(new Response(JSON.stringify([]), { status: 200 })),
    );
    vi.stubGlobal("fetch", fetchSpy);
    await fetchUnderstatCandidates("2026-27");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const url = String(fetchSpy.mock.calls[0][0]);
    expect(url.endsWith("/EPL/2026/")).toBe(true);
  });

  it("A-11: parses candidate discovery rows from a league page", () => {
    expect(parseUnderstatCandidates(league)).toHaveLength(2);
    expect(parseUnderstatCandidates(league)![0]).toEqual({
      id: "27653",
      date: "2026-02-03 15:00:00",
      homeName: "Arsenal",
      awayName: "Chelsea",
    });
  });

  it("A-11: also accepts the { dates: [...] } wrapper shape", () => {
    expect(parseUnderstatCandidates({ dates: league })).toHaveLength(2);
  });

  it("A-11: non-array/null/malformed input never throws and yields no candidates", () => {
    expect(() => parseUnderstatCandidates(null)).not.toThrow();
    expect(() => parseUnderstatCandidates(undefined)).not.toThrow();
    expect(() => parseUnderstatCandidates("not json")).not.toThrow();
    expect(() => parseUnderstatCandidates({})).not.toThrow();
    expect(parseUnderstatCandidates(null)).toBeNull();
    expect(parseUnderstatCandidates({})).toBeNull();
  });

  it("A-11: an empty league page yields no candidates rather than throwing", () => {
    expect(parseUnderstatCandidates([])).toBeNull();
  });

  it("A-10: coerces string-typed shot values and derives the xG pair from a match page", () => {
    const parsed = parseUnderstatMatch(match);
    expect(parsed?.shots).toHaveLength(3);
    expect(parsed?.shots[0]).toMatchObject({ team: "home", minute: 34, result: "goal" });
    expect(parsed?.xg.home).toBeCloseTo(1.83291); // 0.63291 + 1.20000, coerced from strings
    expect(parsed?.xg.away).toBeCloseTo(0.94021);
    expect(parsed?.xg.model).toBe("understat-2026");
  });

  it("A-10: match parse never throws on empty/malformed input", () => {
    expect(() => parseUnderstatMatch({})).not.toThrow();
    expect(() => parseUnderstatMatch(null)).not.toThrow();
    expect(parseUnderstatMatch({})).toBeNull();
    expect(parseUnderstatMatch(null)).toBeNull();
  });

  it("A-12: every request sends X-Requested-With: XMLHttpRequest", async () => {
    const fetchSpy = vi.fn<typeof fetch>(() =>
      Promise.resolve(new Response(JSON.stringify([]), { status: 200 })),
    );
    vi.stubGlobal("fetch", fetchSpy);
    await fetchUnderstatCandidates("2026-27");
    const init = fetchSpy.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>)["X-Requested-With"]).toBe(
      "XMLHttpRequest",
    );
  });
});
