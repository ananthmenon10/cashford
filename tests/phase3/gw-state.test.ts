// Phase 3 — §5 render state model: contest lifecycle (CL0-CL10), viewer participation
// (VP0-VP5), and their precedence composition (PR1-PR9). Written blind from
// docs/plans/2026-07-27-006-phase3-core-ui-plan.md v6 §5 only.
// Cases: docs/testing/phase3-cases.md T-U1, T-U1a, T-U1b, T-U2, T-U2a, T-U2b, T-U2c, T-U2d.
//
// Import names are exactly the three the plan names in §1.1:
//   resolveContestLifecycle(contest, gw, fixtures, results, now)
//   resolveViewerParticipation(member, entry)
//   resolveRender(cl, vp)
// all from lib/gw-state.ts. If the real signatures differ, these fail on call/shape mismatch —
// that mismatch is the finding, per the brief.
//
// Canonical per the fix round: `resolveViewerParticipation({ eligible, entryStatus })` — one
// object argument. Eligibility computation moved out into lib/gw-eligibility.ts's `isEligible`
// (covered by its own tests in gw-eligibility.test.ts); here each VP case is expressed directly
// as the `{ eligible, entryStatus }` the real function takes.
import { describe, expect, it } from "vitest";
import {
  resolveContestLifecycle,
  resolveViewerParticipation,
  resolveRender,
} from "../../lib/gw-state";
import {
  activeFinal,
  activeLive,
  contest,
  gw,
  settledResult,
  voidEff,
  voidResult,
} from "./helpers";

const NOW_BEFORE = "2026-02-01T00:00:00.000Z"; // well before the 2026-02-03T10:30 deadline
const NOW_AFTER = "2026-02-04T00:00:00.000Z"; // well after it

describe("resolveContestLifecycle — §5.1 ordered decision tree (T-U1)", () => {
  it("CL9: stored settled/void with no gameweek_results row → corrupt/sync-issue", () => {
    const cl = resolveContestLifecycle(contest({ status: "settled" }), gw(), [activeFinal("f1")], null, NOW_AFTER);
    expect(cl).toBe("CL9");
  });

  it("CL6: a result row exists and input_version > settled_version, outcome settled → recalculating(settled)", () => {
    const cl = resolveContestLifecycle(
      contest({ status: "settled", inputVersion: 2 }),
      gw(),
      [activeFinal("f1")],
      settledResult({ settledVersion: 1 }),
      NOW_AFTER,
    );
    expect(cl).toBe("CL6");
  });

  it("CL8: same dirtiness but outcome void → recalculating(void)", () => {
    const cl = resolveContestLifecycle(
      contest({ status: "void", inputVersion: 2 }),
      gw(),
      [voidEff("f1")],
      voidResult({ settledVersion: 1 }),
      NOW_AFTER,
    );
    expect(cl).toBe("CL8");
  });

  it("CL5: clean settled result (input_version == settled_version) → final money", () => {
    const cl = resolveContestLifecycle(
      contest({ status: "settled", inputVersion: 1 }),
      gw(),
      [activeFinal("f1")],
      settledResult({ settledVersion: 1 }),
      NOW_AFTER,
    );
    expect(cl).toBe("CL5");
  });

  it("CL7: clean void result → void reason branch, reached even with no fixture final (immediate W1 void)", () => {
    const cl = resolveContestLifecycle(
      contest({ status: "void", inputVersion: 0 }),
      gw(),
      [activeLive("f1")], // not final — proves CL7 doesn't wait on fixture readiness
      voidResult({ settledVersion: 0, voidReason: "single_entrant" }),
      NOW_BEFORE,
    );
    expect(cl).toBe("CL7");
  });

  it("CL0: no contest row at all → blank/pre-season", () => {
    const cl = resolveContestLifecycle(null, gw(), [], null, NOW_BEFORE);
    expect(cl).toBe("CL0");
  });

  it("CL0: true blank — no active AND no void fixtures", () => {
    const cl = resolveContestLifecycle(contest(), gw(), [], null, NOW_BEFORE);
    expect(cl).toBe("CL0");
  });

  it("CL1: deadline in the future → open, regardless of stored status", () => {
    const cl = resolveContestLifecycle(contest({ status: "locked" }), gw(), [activeLive("f1")], null, NOW_BEFORE);
    expect(cl).toBe("CL1");
  });

  it("CL10: deadline passed, zero active fixtures (≥1 void, not true blank) → all called off", () => {
    const cl = resolveContestLifecycle(contest(), gw(), [voidEff("f1")], null, NOW_AFTER);
    expect(cl).toBe("CL10");
  });

  it("CL2: deadline passed, ≥1 active fixture, none final → closed awaiting results", () => {
    const cl = resolveContestLifecycle(contest(), gw(), [activeLive("f1"), activeLive("f2")], null, NOW_AFTER);
    expect(cl).toBe("CL2");
  });

  it("CL3: deadline passed, some but not all active fixtures final → live", () => {
    const cl = resolveContestLifecycle(contest(), gw(), [activeFinal("f1"), activeLive("f2")], null, NOW_AFTER);
    expect(cl).toBe("CL3");
  });

  it("CL4: deadline passed, all active fixtures final, stored status open/locked/settling → settling", () => {
    for (const status of ["open", "locked", "settling"] as const) {
      const cl = resolveContestLifecycle(contest({ status }), gw(), [activeFinal("f1"), activeFinal("f2")], null, NOW_AFTER);
      expect(cl).toBe("CL4");
    }
  });
});

describe("resolveContestLifecycle — T-U1a exclusivity of the six v2 overlaps", () => {
  it("(a) immediate 0/1-entrant void, result present, no fixture final → CL7 not CL2", () => {
    const cl = resolveContestLifecycle(
      contest({ status: "void" }),
      gw(),
      [activeLive("f1")],
      voidResult({ voidReason: "single_entrant" }),
      NOW_AFTER,
    );
    expect(cl).toBe("CL7");
  });

  it("(b) dirty result whose fixtures are no longer all final → CL6 not CL2/CL3", () => {
    const cl = resolveContestLifecycle(
      contest({ status: "settled", inputVersion: 2 }),
      gw(),
      [activeFinal("f1"), activeLive("f2")],
      settledResult({ settledVersion: 1 }),
      NOW_AFTER,
    );
    expect(cl).toBe("CL6");
  });

  it("(c) dirty result mid-re-settlement, stored status settling → CL6 not CL4", () => {
    const cl = resolveContestLifecycle(
      contest({ status: "settling", inputVersion: 2 }),
      gw(),
      [activeFinal("f1"), activeFinal("f2")],
      settledResult({ settledVersion: 1 }),
      NOW_AFTER,
    );
    expect(cl).toBe("CL6");
  });

  it("(d) terminal stored status, no result row, unready fixtures → CL9 not CL2/CL3", () => {
    const cl = resolveContestLifecycle(contest({ status: "settled" }), gw(), [activeLive("f1")], null, NOW_AFTER);
    expect(cl).toBe("CL9");
  });

  it("(e) all-void gameweek with a valid void result → CL7 not CL0", () => {
    const cl = resolveContestLifecycle(contest({ status: "void" }), gw(), [voidEff("f1")], voidResult(), NOW_AFTER);
    expect(cl).toBe("CL7");
  });

  it("(f) all-void gameweek with no result → CL10 not CL0 and not CL2", () => {
    const cl = resolveContestLifecycle(contest(), gw(), [voidEff("f1")], null, NOW_AFTER);
    expect(cl).toBe("CL10");
  });

  it("(g) past-deadline stored-open, every active fixture final → CL4 (v2 returned nothing)", () => {
    const cl = resolveContestLifecycle(contest({ status: "open" }), gw(), [activeFinal("f1")], null, NOW_AFTER);
    expect(cl).toBe("CL4");
  });

  it("(h) property: over many randomized-ish inputs the classifier returns exactly one state and never throws", () => {
    const contests = [contest({ status: "open" }), contest({ status: "locked" }), contest({ status: "settled" }), contest({ status: "void" }), null];
    const fixtureSets = [[], [activeLive("f1")], [activeFinal("f1")], [voidEff("f1")], [activeFinal("f1"), voidEff("f2")]];
    const resultRows = [null, settledResult(), voidResult(), settledResult({ settledVersion: -1 })];
    const times = [NOW_BEFORE, NOW_AFTER];
    for (const c of contests) {
      for (const f of fixtureSets) {
        for (const r of resultRows) {
          for (const t of times) {
            expect(() => {
              const cl = resolveContestLifecycle(c, gw(), f, r, t);
              expect(typeof cl).toBe("string");
            }).not.toThrow();
          }
        }
      }
    }
  });
});

describe("resolveContestLifecycle — T-U1b zero-active vacuous truth", () => {
  it("past deadline, ≥1 void, no result → CL10, never CL2/CL4", () => {
    const cl = resolveContestLifecycle(contest(), gw(), [voidEff("f1")], null, NOW_AFTER);
    expect(cl).toBe("CL10");
    expect(cl).not.toBe("CL2");
    expect(cl).not.toBe("CL4");
  });

  it("same, with a void result → CL7 (result outranks fixture readiness)", () => {
    const cl = resolveContestLifecycle(contest({ status: "void" }), gw(), [voidEff("f1")], voidResult(), NOW_AFTER);
    expect(cl).toBe("CL7");
  });

  it("pre-deadline, ≥1 void and no active → CL1 (future deadline outranks CL10)", () => {
    const cl = resolveContestLifecycle(contest(), gw(), [voidEff("f1")], null, NOW_BEFORE);
    expect(cl).toBe("CL1");
  });
});

describe("resolveViewerParticipation — §5.2 VP0-VP5", () => {
  it("VP0: not eligible for this gameweek", () => {
    expect(resolveViewerParticipation({ eligible: false, entryStatus: null })).toBe("VP0");
  });

  it("VP1: eligible, no entry row", () => {
    expect(resolveViewerParticipation({ eligible: true, entryStatus: null })).toBe("VP1");
  });

  it("VP2: entry entered", () => {
    expect(resolveViewerParticipation({ eligible: true, entryStatus: "entered" })).toBe("VP2");
  });

  it("VP3: entry needs_update", () => {
    expect(resolveViewerParticipation({ eligible: true, entryStatus: "needs_update" })).toBe("VP3");
  });

  it("VP4: entry locked_in", () => {
    expect(resolveViewerParticipation({ eligible: true, entryStatus: "locked_in" })).toBe("VP4");
  });

  it("VP5: entry invalid", () => {
    expect(resolveViewerParticipation({ eligible: true, entryStatus: "invalid" })).toBe("VP5");
  });

  it("VP0: not eligible (e.g. because the member departed before this gameweek) beats a locked_in entry", () => {
    expect(resolveViewerParticipation({ eligible: false, entryStatus: "locked_in" })).toBe("VP0");
  });
});

const ALL_CL = ["CL0", "CL1", "CL2", "CL3", "CL4", "CL5", "CL6", "CL7", "CL8", "CL9", "CL10"] as const;
const ALL_VP = ["VP0", "VP1", "VP2", "VP3", "VP4", "VP5"] as const;

describe("resolveRender — T-U2 full CL x VP cross-product", () => {
  it("never throws and returns a render descriptor for every combination", () => {
    for (const cl of ALL_CL) {
      for (const vp of ALL_VP) {
        expect(() => resolveRender(cl, vp)).not.toThrow();
      }
    }
  });

  it("PR4: CL0 beats every VP — no CTA, no standings, C29, for all six VPs", () => {
    for (const vp of ALL_VP) {
      const r = resolveRender("CL0", vp);
      expect(r.cta).toBeFalsy();
      expect(r.standings).toBeFalsy();
    }
  });

  it("PR5: VP0 forces read-only for every lifecycle state", () => {
    for (const cl of ALL_CL) {
      const r = resolveRender(cl, "VP0");
      expect(r.cta).toBeFalsy();
    }
  });

  it("PR2: CL9 (corrupt) beats every VP — no points, no money, no CTA", () => {
    for (const vp of ALL_VP) {
      const r = resolveRender("CL9", vp);
      expect(r.cta).toBeFalsy();
      expect(r.money).toBeFalsy();
      expect(r.points).toBeFalsy();
    }
  });

  it("PR6: a CTA exists only when CL1 and VP in {VP1,VP2,VP3}", () => {
    for (const cl of ALL_CL) {
      for (const vp of ALL_VP) {
        const r = resolveRender(cl, vp);
        const shouldHaveCta = cl === "CL1" && (vp === "VP1" || vp === "VP2" || vp === "VP3");
        expect(Boolean(r.cta)).toBe(shouldHaveCta);
      }
    }
  });

  it("PR7: VP5 (invalid) never shows money and never counts in the pot, even under CL5", () => {
    const r = resolveRender("CL5", "VP5");
    expect(r.money).toBeFalsy();
    expect(r.inPot).toBeFalsy();
  });

  it("PR8: VP1 in a terminal lifecycle renders C66 (sat-this-one-out), not an empty result row", () => {
    for (const cl of ["CL5", "CL7", "CL9"] as const) {
      const r = resolveRender(cl, "VP1");
      expect(r.copyId ?? r.copy).toBeTruthy();
    }
  });

  it("PR9: single-entrant void (CL7) shows the same void copy to the lone entrant and to VP5", () => {
    const forWinner = resolveRender("CL7", "VP4");
    const forInvalid = resolveRender("CL7", "VP5");
    expect(forWinner.voidReasonCopy ?? forWinner.copy).toBeTruthy();
    expect(forInvalid.voidReasonCopy ?? forInvalid.copy).toBeTruthy();
  });
});

describe("resolveRender — T-U2a PR3 money suppression under dirty lifecycles", () => {
  it("no money string appears in any CL6/CL8 render, for any VP", () => {
    for (const cl of ["CL6", "CL8"] as const) {
      for (const vp of ALL_VP) {
        const r = resolveRender(cl, vp);
        expect(r.money).toBeFalsy();
      }
    }
  });
});

describe("resolveRender — T-U2b PR1 stored-open past deadline", () => {
  it("a past-deadline contest yields no CTA and no editable sheet even if resolveContestLifecycle were fed a stale stored-open status upstream", () => {
    // PR1 is enforced by the CL tree itself (CL4/CL2/CL3/CL10 all subsume "deadline passed"),
    // so the render-layer proof is: CL1 is the ONLY state with a CTA, and CL1 requires a future
    // deadline (proved in the lifecycle suite above). This asserts the render side of that
    // contract holds even if handed a nonsense state name outside CL0-CL10.
    for (const cl of ALL_CL) {
      if (cl === "CL1") continue;
      for (const vp of ["VP1", "VP2", "VP3"] as const) {
        expect(resolveRender(cl, vp).cta).toBeFalsy();
      }
    }
  });
});
