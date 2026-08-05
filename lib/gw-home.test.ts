import { describe, expect, it } from "vitest";
import { analyticsViewHasHistory, analyticsVisibleForHomeCards } from "./gw-home";

describe("analyticsVisibleForHomeCards", () => {
  it("shows for any card with settled history, regardless of competition format", () => {
    expect(
      analyticsVisibleForHomeCards([
        { hasSettledHistory: false },
        { hasSettledHistory: false },
      ]),
    ).toBe(false);
    expect(
      analyticsVisibleForHomeCards([
        { hasSettledHistory: true },
      ]),
    ).toBe(true);
  });

  it("recognizes archived history from the existing analytics view", () => {
    expect(
      analyticsViewHasHistory({
        global: { acc: { graded: 0 }, pot: { entered: 0 } },
      } as never),
    ).toBe(false);
    expect(
      analyticsViewHasHistory({
        global: { acc: { graded: 1 }, pot: { entered: 0 } },
      } as never),
    ).toBe(false);
    expect(
      analyticsViewHasHistory({
        global: { acc: { graded: 0 }, pot: { entered: 1 } },
      } as never),
    ).toBe(true);
  });
});
