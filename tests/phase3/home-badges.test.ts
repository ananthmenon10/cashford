// Phase 3 — §8 U28: LeagueCard's eight badge states, and T-U25a's lifecycle × participation
// cross-product. Blind from §8. NAMING CAVEAT: no export name is given for the home-badge
// mapping; guessed `homeBadgeState(cl, vp)` colocated with the other CL/VP functions in
// lib/gw-state.ts (resolveContestLifecycle / resolveViewerParticipation / resolveRender already
// live there per gw-state.test.ts). A wrong guess fails on import, which is the intended signal.
import { describe, expect, it } from "vitest";
import { homeBadgeState } from "../../lib/gw-state";

const ALL_CL = ["CL0", "CL1", "CL2", "CL3", "CL4", "CL5", "CL6", "CL7", "CL8", "CL9", "CL10"];
const ALL_VP = ["VP0", "VP1", "VP2", "VP3", "VP4", "VP5"];

describe("homeBadgeState — U28 eight badge states", () => {
  it("CL1 + VP1 -> OPEN", () => expect(homeBadgeState("CL1", "VP1")).toBe("OPEN"));
  it("CL1 + VP2 -> ENTERED", () => expect(homeBadgeState("CL1", "VP2")).toBe("ENTERED"));
  it("CL1 + VP3 -> ACTION NEEDED", () => expect(homeBadgeState("CL1", "VP3")).toBe("ACTION NEEDED"));
  it("CL2 -> LOCKED (any VP)", () => expect(homeBadgeState("CL2", "VP1")).toBe("LOCKED"));
  it("CL3 -> LIVE", () => expect(homeBadgeState("CL3", "VP2")).toBe("LIVE"));
  it("CL4 -> LIVE", () => expect(homeBadgeState("CL4", "VP2")).toBe("LIVE"));
  it("CL5 -> SETTLED", () => expect(homeBadgeState("CL5", "VP2")).toBe("SETTLED"));
  it("CL6 -> RECALCULATING", () => expect(homeBadgeState("CL6", "VP2")).toBe("RECALCULATING"));
  it("CL7 -> VOID", () => expect(homeBadgeState("CL7", "VP2")).toBe("VOID"));
  it("CL8 -> RECALCULATING", () => expect(homeBadgeState("CL8", "VP2")).toBe("RECALCULATING"));
});

describe("T-U25a — full CL × VP cross-product: ACTION NEEDED only at CL1+VP3, lifecycle wins after deadline", () => {
  it("ACTION NEEDED never appears outside CL1", () => {
    for (const cl of ALL_CL) {
      if (cl === "CL1") continue;
      for (const vp of ALL_VP) {
        expect(homeBadgeState(cl, vp)).not.toBe("ACTION NEEDED");
      }
    }
  });

  it("within CL1, ACTION NEEDED appears only for VP3", () => {
    for (const vp of ALL_VP) {
      const badge = homeBadgeState("CL1", vp);
      if (vp === "VP3") expect(badge).toBe("ACTION NEEDED");
      else expect(badge).not.toBe("ACTION NEEDED");
    }
  });

  it("every VP under CL2 yields LOCKED, including VP3 (the cron-lag case, E27)", () => {
    for (const vp of ALL_VP) expect(homeBadgeState("CL2", vp)).toBe("LOCKED");
  });

  it("every VP under CL3 yields LIVE", () => {
    for (const vp of ALL_VP) expect(homeBadgeState("CL3", vp)).toBe("LIVE");
  });

  it("every VP under CL4 yields LIVE", () => {
    for (const vp of ALL_VP) expect(homeBadgeState("CL4", vp)).toBe("LIVE");
  });

  it("every VP under CL5 yields SETTLED", () => {
    for (const vp of ALL_VP) expect(homeBadgeState("CL5", vp)).toBe("SETTLED");
  });

  it("every VP under CL6 yields RECALCULATING", () => {
    for (const vp of ALL_VP) expect(homeBadgeState("CL6", vp)).toBe("RECALCULATING");
  });

  it("every VP under CL7 yields VOID", () => {
    for (const vp of ALL_VP) expect(homeBadgeState("CL7", vp)).toBe("VOID");
  });

  it("every VP under CL8 yields RECALCULATING", () => {
    for (const vp of ALL_VP) expect(homeBadgeState("CL8", vp)).toBe("RECALCULATING");
  });

  it("the mapping never returns undefined/throws for any CL x VP pair (exhaustiveness)", () => {
    for (const cl of ALL_CL) {
      for (const vp of ALL_VP) {
        expect(() => homeBadgeState(cl, vp)).not.toThrow();
        expect(homeBadgeState(cl, vp)).toBeTruthy();
      }
    }
  });
});
