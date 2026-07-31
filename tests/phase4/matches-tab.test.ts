import { describe, expect, it } from "vitest";
import {
  type ContestLifecycle,
  type ViewerParticipation,
} from "../../lib/gw-state";
import { buildLeagueRow, sharedHeaderPoints } from "../../lib/matches-tab";

const cls: ContestLifecycle[] = [
  "CL0", "CL1", "CL2", "CL3", "CL4", "CL5",
  "CL6", "CL7", "CL8", "CL9", "CL10",
];
const vps: ViewerParticipation[] = [
  "VP0", "VP1", "VP2", "VP3", "VP4", "VP5",
];
const ctx = {
  league: { id: "l1", slug: "friends", name: "Friends" },
  raceHref: "/leagues/friends",
  cta: { label: "Enter GW", href: "/leagues/friends/enter" },
  fieldSize: 4,
  points: 8,
  netInr: 200,
  ordinal: "1st",
};

const MONEY_KINDS = new Set(["provisional", "settled"]);

describe("matches row model", () => {
  it("U-2a: maps all 66 lifecycle/participation cells to exactly one arm, with no stray CTA or money", () => {
    for (const cl of cls) {
      for (const vp of vps) {
        expect(() => buildLeagueRow(cl, vp, ctx)).not.toThrow();
        const row = buildLeagueRow(cl, vp, ctx);
        if (cl === "CL0") {
          expect(row).toBeNull();
          continue;
        }
        expect(row).not.toBeNull();
        // no CTA outside CL1 with VP1/VP2/VP3 — CL1+VP4 is CTA-free (open-locked-in).
        const hasCta = "cta" in (row as object);
        const ctaExpected = cl === "CL1" && (vp === "VP1" || vp === "VP2" || vp === "VP3");
        expect(hasCta).toBe(ctaExpected);
        if (cl === "CL1" && vp === "VP4") {
          expect((row as { kind: string }).kind).toBe("open-locked-in");
        }
        // no money field outside provisional/settled arms.
        const hasMoney = "netInr" in (row as object);
        expect(hasMoney).toBe(MONEY_KINDS.has((row as { kind: string }).kind));
      }
    }
  });

  it("U-2c: the CL10 → CL7 transition flips kind, drops `waiting`, and carries no points/money", () => {
    const before = buildLeagueRow("CL10", "VP2", ctx)!;
    expect(before).toMatchObject({
      kind: "all-called-off",
      waiting: true,
      league: ctx.league,
      raceHref: ctx.raceHref,
    });
    expect("points" in before).toBe(false);
    expect("netInr" in before).toBe(false);

    const after = buildLeagueRow("CL7", "VP2", {
      ...ctx,
      voidReason: "all_fixtures_void",
    })!;
    expect(after.kind).toBe("void");
    expect("waiting" in after).toBe(false);
    expect((after as { voidReason: string }).voidReason).toBe("all_fixtures_void");
    expect(after.league).toEqual(ctx.league);
    expect(after.raceHref).toBe(ctx.raceHref);
    expect("points" in after).toBe(false);
    expect("netInr" in after).toBe(false);
  });

  it("names its CTA and hides money from invalid entries", () => {
    expect(buildLeagueRow("CL1", "VP1", ctx)).toMatchObject({
      kind: "open-not-entered",
      cta: { label: "Enter GW" },
    });
    expect(buildLeagueRow("CL5", "VP5", ctx)).toMatchObject({
      kind: "invalid",
    });
  });

  it("nulls the header only when league points differ", () => {
    const first = buildLeagueRow("CL5", "VP4", ctx)!;
    const second = buildLeagueRow("CL5", "VP4", ctx)!;
    const different = buildLeagueRow("CL5", "VP4", {
      ...ctx,
      points: 5,
    })!;
    expect(sharedHeaderPoints([first, second])).toBe(8);
    expect(sharedHeaderPoints([first, different])).toBeNull();
  });
});
