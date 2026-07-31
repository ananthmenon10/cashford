import { describe, expect, it } from "vitest";
import { buildAnalyticsTabView } from "../../lib/analytics-view";

const base = {
  competition: {
    id: "pl",
    slug: "pl-2026-27",
    name: "Premier League",
    archived: false,
  },
  currentFocusGw: {
    id: "gw3",
    number: 3,
    state: "settled" as const,
  },
  latestSettledGw: { id: "gw3", number: 3 },
  strip: { kind: "settled_entered" as const, gw: 3 },
  lens: { league: null, options: [] },
  myForm: { picks: 10 },
  vsRoom: { rank: 1 },
  receipts: [{ id: "r1" }],
  weeklyLabels: [],
  rivalry: {},
  clubReads: [],
  habits: {},
};

describe("analytics view gates", () => {
  it("dirty history suppresses cumulative cards and the lead card", () => {
    const view = buildAnalyticsTabView({
      base,
      leadCard: {
        gwNumber: 3,
        perLeague: [],
        exacts: 0,
        biggestGain: null,
        biggestMiss: null,
        acknowledged: false,
      },
      dirtyOlder: true,
    });
    expect(view.suppressed).toEqual({
      cumulative: true,
      leadCard: true,
      reasons: ["dirty_older"],
    });
    expect(view).not.toHaveProperty("myForm");
    expect(view).not.toHaveProperty("leadCard");
  });

  it("settling suppresses the lead card only, cumulative cards stay", () => {
    const view = buildAnalyticsTabView({
      base,
      leadCard: {
        gwNumber: 3,
        perLeague: [],
        exacts: 0,
        biggestGain: null,
        biggestMiss: null,
        acknowledged: false,
      },
      settling: true,
    });
    expect(view.suppressed).toEqual({
      cumulative: false,
      leadCard: true,
      reasons: ["settling"],
    });
    expect(view.myForm).toEqual({ picks: 10 });
    expect(view).not.toHaveProperty("leadCard");
  });

  it("an all-clean season shows everything, with suppressed null", () => {
    const view = buildAnalyticsTabView({
      base,
      leadCard: {
        gwNumber: 3,
        perLeague: [],
        exacts: 0,
        biggestGain: null,
        biggestMiss: null,
        acknowledged: false,
      },
    });
    expect(view.suppressed).toBeNull();
    expect(view.myForm).toEqual({ picks: 10 });
    expect(view.leadCard).toBeDefined();
  });

  it("overlap suppresses only the lead card", () => {
    const view = buildAnalyticsTabView({ base, overlap: true });
    expect(view.suppressed).toMatchObject({
      cumulative: false,
      leadCard: true,
    });
    expect(view.myForm).toEqual({ picks: 10 });
  });
});
