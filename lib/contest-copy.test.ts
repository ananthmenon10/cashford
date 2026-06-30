import { describe, it, expect } from "vitest";
import { voidPresentation } from "./contest-copy";

describe("voidPresentation", () => {
  it("no_separation → ALL SQUARE, shows the reveal", () => {
    const vp = voidPresentation("no_separation");
    expect(vp.badge).toBe("ALL SQUARE");
    expect(vp.showReveal).toBe(true);
    expect(vp.tone).toBe("neutral");
    // Must NOT claim "not enough players" — that was the bug.
    expect(vp.blurb.toLowerCase()).not.toContain("not enough");
  });

  it("insufficient_entries → VOID, no reveal, returns-stakes copy", () => {
    const vp = voidPresentation("insufficient_entries");
    expect(vp.badge).toBe("VOID");
    expect(vp.showReveal).toBe(false);
    expect(vp.blurb.toLowerCase()).toContain("not enough");
  });

  it("unknown / null reason falls back to the safe VOID branch", () => {
    for (const r of [null, undefined] as const) {
      const vp = voidPresentation(r);
      expect(vp.badge).toBe("VOID");
      expect(vp.showReveal).toBe(false);
    }
  });
});
