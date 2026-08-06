import { describe, expect, it } from "vitest";
import {
  buildWcFinalStandings,
  combinedBalanceParts,
  countSettledFixtures,
  isLateMember,
  wcNetLabel,
  wcNetLine,
} from "./wc-archive";

describe("wcNetLabel", () => {
  it("uses the app-wide U+2212 minus sign for a negative net, not an ASCII hyphen", () => {
    expect(wcNetLabel(-100)).toBe("−₹100");
    expect(wcNetLabel(-100)).not.toBe("₹-100");
  });

  it("renders a positive net with a plain ₹ prefix", () => {
    expect(wcNetLabel(8914)).toBe("₹8,914");
  });

  it("renders — for a null net (no results yet)", () => {
    expect(wcNetLabel(null)).toBe("—");
  });

  it("renders ₹0 for an exact break-even", () => {
    expect(wcNetLabel(0)).toBe("₹0");
  });
});

describe("wcNetLine", () => {
  it("labels a negative net with the minus sign, not a hyphen", () => {
    expect(wcNetLine(-100)).toBe("Net −₹100");
  });

  it("labels a positive net", () => {
    expect(wcNetLine(8914)).toBe("Net ₹8,914");
  });
});

describe("combinedBalanceParts", () => {
  it("splits an owed balance into a prefix and a bare amount, no minus sign in the amount", () => {
    expect(combinedBalanceParts(8914)).toEqual({ prefix: "You’re owed ", amount: "₹8,914", sign: "positive" });
  });

  it("splits an owing balance", () => {
    expect(combinedBalanceParts(-500)).toEqual({ prefix: "You owe ", amount: "₹500", sign: "negative" });
  });

  it("has no amount when settled up", () => {
    expect(combinedBalanceParts(0)).toEqual({ prefix: "Settled up", amount: null, sign: "zero" });
  });
});

describe("countSettledFixtures", () => {
  it("counts distinct fixtures, not distinct rows — one row per member per fixture", () => {
    // Two members, two settled fixtures: 4 contest_results rows, 2 distinct fixtures.
    const ids = ["fixture-1", "fixture-1", "fixture-2", "fixture-2"];
    expect(countSettledFixtures(ids)).toBe(2);
  });

  it("regression: does not collapse to 1 when every row carries the same undefined key", () => {
    // This is the shape produced by keying on contests.id when that column was never selected —
    // every row's key is undefined, so a naive Set would report 1 (or 0) no matter how many
    // fixtures actually settled. Keying on fixture_id (always selected) must not reproduce that.
    const ids = [undefined, undefined, "fixture-3", "fixture-4", "fixture-5"];
    expect(countSettledFixtures(ids)).toBe(3);
  });

  it("returns 0 for no settled results", () => {
    expect(countSettledFixtures([])).toBe(0);
  });
});

describe("isLateMember", () => {
  it("is late when joined_at is after the freeze date and has no entries", () => {
    expect(isLateMember("2026-08-01T00:00:00.000Z", "2026-07-19T00:00:00.000Z", 0)).toBe(true);
  });

  it("is not late when joined_at is before the freeze date", () => {
    expect(isLateMember("2026-06-01T00:00:00.000Z", "2026-07-19T00:00:00.000Z", 0)).toBe(false);
  });

  it("is never late when nothing has settled yet (no freeze point to be late against)", () => {
    expect(isLateMember("2026-08-01T00:00:00.000Z", null, 0)).toBe(false);
  });

  it("is never late when joined_at is missing", () => {
    expect(isLateMember(undefined, "2026-07-19T00:00:00.000Z", 0)).toBe(false);
  });

  it("dual-review fix (R2 F6): joined after freeze but has entries stays ranked, not late", () => {
    expect(isLateMember("2026-08-01T00:00:00.000Z", "2026-07-19T00:00:00.000Z", 3)).toBe(false);
  });
});

describe("buildWcFinalStandings", () => {
  it("ranks by net descending, then correct, then exact, then userId as a tiebreak", () => {
    const rows = buildWcFinalStandings({
      members: [
        { userId: "b", name: "Bala" },
        { userId: "a", name: "Ananth" },
        { userId: "c", name: "Chandu" },
      ],
      entriesByUser: {},
      netByUser: { a: 500, b: 900, c: 900 },
    });
    // b and c tie on net (900) with 0 correct/exact each — userId breaks the tie (b < c).
    expect(rows.map((row) => row.userId)).toEqual(["b", "c", "a"]);
    expect(rows.map((row) => row.finish)).toEqual([1, 2, 3]);
  });

  it("carries isPastMember through untouched (departed members stay ranked)", () => {
    const rows = buildWcFinalStandings({
      members: [{ userId: "a", name: "Ananth", isPastMember: true }],
      entriesByUser: {},
      netByUser: { a: 100 },
    });
    expect(rows[0].isPastMember).toBe(true);
  });

  it("counts entries even when a member has zero settled results (partial-results scope)", () => {
    const rows = buildWcFinalStandings({
      members: [{ userId: "a", name: "Ananth" }],
      entriesByUser: {},
      netByUser: { a: null },
    });
    expect(rows[0].entriesCount).toBe(0);
    expect(rows[0].netInr).toBeNull();
  });
});
