// Phase 3 — D5 eligibility join (both boundaries, by gameweek number) and D5a numerator/pot
// rules (lib/gw-eligibility.ts). Blind from §2.3.
// Cases: T-U5, T-U5a, T-U5b.
//
// NAMING CAVEAT: no export name is given; guessed `isEligible` (per-member boolean over the two
// resolved gameweek-number boundaries D5 defines) and `resolveEntryCounts` (D5a numerator/pot).
// A wrong guess fails on import, which is the intended signal.
//
// Canonical per the fix round: `resolveEntryCounts`'s options object now requires `stakeInr`
// (it computes potInr as stake × accepted entrants, rather than reading a per-entry stake off
// each row) — every call below passes it explicitly.
import { describe, expect, it } from "vitest";
import { isEligible, resolveEntryCounts, type EntryStatus } from "../../lib/gw-eligibility";

const G = 8; // target gameweek number

describe("isEligible — D5, both boundaries required, by number", () => {
  it("member-eligible and league-eligible (both <= G) → eligible", () => {
    expect(isEligible({ leagueEligibleFromNumber: 1, memberEligibleFromNumber: 5, leftAt: null }, G)).toBe(true);
  });

  it("member-eligible but the league boundary is a LATER gameweek → ineligible", () => {
    expect(isEligible({ leagueEligibleFromNumber: 9, memberEligibleFromNumber: 1, leftAt: null }, G)).toBe(false);
  });

  it("league boundary null → ineligible for every member, regardless of member boundary", () => {
    expect(isEligible({ leagueEligibleFromNumber: null, memberEligibleFromNumber: 1, leftAt: null }, G)).toBe(false);
  });

  it("member boundary null → ineligible even when the league boundary is satisfied", () => {
    expect(isEligible({ leagueEligibleFromNumber: 1, memberEligibleFromNumber: null, leftAt: null }, G)).toBe(false);
  });

  it("league boundary equal to the target gameweek → eligible", () => {
    expect(isEligible({ leagueEligibleFromNumber: G, memberEligibleFromNumber: 1, leftAt: null }, G)).toBe(true);
  });

  it("league boundary earlier but member boundary later than G → ineligible", () => {
    expect(isEligible({ leagueEligibleFromNumber: 1, memberEligibleFromNumber: G + 1, leftAt: null }, G)).toBe(false);
  });

  it("T-U5a: left_at set (departed) → ineligible even with both boundaries satisfied", () => {
    expect(
      isEligible({ leagueEligibleFromNumber: 1, memberEligibleFromNumber: 1, leftAt: "2026-01-01T00:00:00.000Z" }, G),
    ).toBe(false);
  });

  it("a league that joined at gameweek 8 makes gameweek 1-7 ineligible for every member, however early their own boundary", () => {
    expect(isEligible({ leagueEligibleFromNumber: 8, memberEligibleFromNumber: 1, leftAt: null }, 7)).toBe(false);
  });
});

describe("resolveEntryCounts — T-U5b numerator/pot pre- vs post-deadline, invalid excluded always", () => {
  const entries: { userId: string; status: EntryStatus; stakeInr: number }[] = [
    { userId: "u1", status: "entered", stakeInr: 100 },
    { userId: "u2", status: "needs_update", stakeInr: 100 },
    { userId: "u3", status: "locked_in", stakeInr: 100 },
    { userId: "u4", status: "invalid", stakeInr: 100 },
  ];
  const eligibleMemberCount = 6; // D5 denominator, independent of entries present

  it("pre-deadline: entered + needs_update both count toward numerator and pot", () => {
    const r = resolveEntryCounts(entries, eligibleMemberCount, { preDeadline: true, stakeInr: 100 });
    expect(r.numerator).toBe(2); // u1 entered, u2 needs_update
    expect(r.potInr).toBe(200);
    expect(r.denominator).toBe(6);
  });

  it("post-deadline: only locked_in counts toward numerator and pot", () => {
    const r = resolveEntryCounts(entries, eligibleMemberCount, { preDeadline: false, stakeInr: 100 });
    expect(r.numerator).toBe(1); // u3 only
    expect(r.potInr).toBe(100);
  });

  it("invalid entries never contribute stake or count in the numerator, pre- or post-deadline", () => {
    const pre = resolveEntryCounts(entries, eligibleMemberCount, { preDeadline: true, stakeInr: 100 });
    const post = resolveEntryCounts(entries, eligibleMemberCount, { preDeadline: false, stakeInr: 100 });
    // u4's stake never appears in either pot figure above (200 and 100 respectively already
    // exclude it); this case pins that explicitly by checking a stake-inflated scenario.
    expect(pre.potInr).not.toBe(300);
    expect(post.potInr).not.toBe(200);
  });

  it("the denominator is always the eligible-member count, independent of how many entries exist", () => {
    const r = resolveEntryCounts([], eligibleMemberCount, { preDeadline: true, stakeInr: 100 });
    expect(r.denominator).toBe(6);
    expect(r.numerator).toBe(0);
  });
});
