import { describe, expect, it } from "vitest";
import { combinedBalanceParts, countSettledFixtures, wcNetLabel, wcNetLine } from "./wc-archive";

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
