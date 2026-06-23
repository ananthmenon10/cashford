import { describe, it, expect } from "vitest";
import { easeOutCubic, countUpFrame } from "./motion-math";

describe("easeOutCubic", () => {
  it("pins the endpoints", () => {
    expect(easeOutCubic(0)).toBe(0);
    expect(easeOutCubic(1)).toBe(1);
  });
  it("front-loads (ease-OUT): past halfway by the midpoint", () => {
    // Why it matters: the number should sprint then settle, not crawl then jump.
    expect(easeOutCubic(0.5)).toBeGreaterThan(0.5);
  });
  it("is monotonically increasing", () => {
    let prev = -1;
    for (let p = 0; p <= 1.0001; p += 0.1) {
      const v = easeOutCubic(p);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });
  it("clamps out-of-range progress so it never over/undershoots", () => {
    expect(easeOutCubic(-0.5)).toBe(0);
    expect(easeOutCubic(2)).toBe(1);
  });
});

describe("countUpFrame", () => {
  it("starts at `from` and ends at `to`", () => {
    expect(countUpFrame(0, 100, 0)).toBe(0);
    expect(countUpFrame(0, 100, 1)).toBe(100);
  });
  it("rolls toward a negative target (a falling net: 0 → −4608)", () => {
    expect(countUpFrame(0, -4608, 0)).toBe(0);
    expect(countUpFrame(0, -4608, 1)).toBe(-4608);
    expect(countUpFrame(0, -4608, 0.5)).toBeLessThan(0); // heading negative
  });
  it("respects the clamp at the boundaries", () => {
    expect(countUpFrame(10, 50, -1)).toBe(10);
    expect(countUpFrame(10, 50, 5)).toBe(50);
  });
});
