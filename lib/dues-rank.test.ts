import { describe, expect, it } from "vitest";
import { rankDues } from "./dues-rank";

describe("rankDues", () => {
  it("assigns shared competition ranks to equal net dues", () => {
    expect(
      rankDues({ ananth: 200, rishi: -100, vishwa: -100 }),
    ).toEqual({ ananth: 1, rishi: 2, vishwa: 2 });
  });

  it("keeps every zero-net member at rank one", () => {
    expect(rankDues({ ananth: 0, rishi: 0, vishwa: 0 })).toEqual({
      ananth: 1,
      rishi: 1,
      vishwa: 1,
    });
  });

  it("uses net dues rather than user id order", () => {
    expect(rankDues({ "alpha-low": -100, "zeta-high": 200 })).toEqual({
      "alpha-low": 2,
      "zeta-high": 1,
    });
  });

  it("returns no rank while the dues ledger is suppressed", () => {
    expect(rankDues("suppressed")).toBeNull();
  });
});
