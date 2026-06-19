import { describe, it, expect } from "vitest";
import { isEligible, samePick, defaultCheckedTargets, type OtherLeague, type PickShape } from "./cross-league";

const NOW = 1_700_000_000_000;
const MARGIN = 60_000;
const HOME_2_1: PickShape = { outcome: "home", predHome: 2, predAway: 1 };
const AWAY_0_1: PickShape = { outcome: "away", predHome: 0, predAway: 1 };

describe("isEligible", () => {
  it("open + lock comfortably ahead → eligible", () => {
    expect(isEligible("open", NOW + 2 * MARGIN, NOW, MARGIN)).toBe(true);
  });
  it("locked/void/cancelled status → not eligible even if lock is ahead", () => {
    for (const s of ["locked", "void", "cancelled", "settled", "settling"])
      expect(isEligible(s, NOW + 2 * MARGIN, NOW, MARGIN)).toBe(false);
  });
  it("open but lock within the margin → not eligible", () => {
    expect(isEligible("open", NOW + MARGIN - 1, NOW, MARGIN)).toBe(false);
    expect(isEligible("open", NOW + MARGIN, NOW, MARGIN)).toBe(false); // boundary is strict (>)
    expect(isEligible("open", NOW + MARGIN + 1, NOW, MARGIN)).toBe(true);
  });
});

describe("samePick", () => {
  it("identical picks match", () => expect(samePick(HOME_2_1, { ...HOME_2_1 })).toBe(true));
  it("different outcome or score does not match", () => {
    expect(samePick(HOME_2_1, AWAY_0_1)).toBe(false);
    expect(samePick(HOME_2_1, { outcome: "home", predHome: 3, predAway: 1 })).toBe(false);
  });
  it("null on either side is never a match", () => {
    expect(samePick(null, HOME_2_1)).toBe(false);
    expect(samePick(HOME_2_1, null)).toBe(false);
    expect(samePick(null, null)).toBe(false);
  });
});

describe("defaultCheckedTargets (opt-in overwrite)", () => {
  const mk = (id: string, eligible: boolean, existingPick: PickShape | null): OtherLeague =>
    ({ contestId: id, leagueName: id, eligible, existingPick });

  it("eligible + no existing pick → checked (auto-fill)", () => {
    expect(defaultCheckedTargets([mk("a", true, null)], HOME_2_1)).toEqual(["a"]);
  });
  it("eligible + existing pick equal to mine → checked (harmless no-op)", () => {
    expect(defaultCheckedTargets([mk("a", true, { ...HOME_2_1 })], HOME_2_1)).toEqual(["a"]);
  });
  it("eligible + DIFFERENT existing pick → unchecked (explicit opt-in)", () => {
    expect(defaultCheckedTargets([mk("a", true, AWAY_0_1)], HOME_2_1)).toEqual([]);
  });
  it("ineligible (locked) is never checked, even with no pick", () => {
    expect(defaultCheckedTargets([mk("a", false, null)], HOME_2_1)).toEqual([]);
  });
  it("no pick of my own yet (open_nopick): empty siblings checked, any existing pick is opt-in", () => {
    const others = [mk("empty", true, null), mk("hasPick", true, AWAY_0_1)];
    expect(defaultCheckedTargets(others, null)).toEqual(["empty"]);
  });
  it("mixes correctly across several leagues", () => {
    const others = [
      mk("fill", true, null),               // checked
      mk("match", true, { ...HOME_2_1 }),    // checked
      mk("differ", true, AWAY_0_1),          // unchecked
      mk("locked", false, null),             // unchecked
    ];
    expect(defaultCheckedTargets(others, HOME_2_1)).toEqual(["fill", "match"]);
  });
});
