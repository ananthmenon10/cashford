import { describe, expect, it } from "vitest";
import { transitionState, type TransitionState } from "../../lib/transition";

const state = (competitionStatus: string, hasParticipation: boolean, isCaptain: boolean, otherActiveCompetition = false): TransitionState =>
  transitionState({ competitionStatus, hasParticipation, isCaptain, otherActiveCompetition });

describe("transitionState — §8 transition matrix", () => {
  it("T-U36: covers preparing, captain, member, adopted, blocked, and archived states", () => {
    // §8.4 exact matrix:
    // PL preparing suppresses adoption for everyone; active/no participation splits captain/member;
    // active participation wins; another active competition blocks; archived has no CTA.
    expect(state("preparing", false, true)).toBe("preparing");
    expect(state("preparing", false, false)).toBe("preparing");
    expect(state("active", false, true)).toBe("captain_adopt");
    expect(state("active", false, false)).toBe("member_waiting");
    expect(state("active", true, false)).toBe("adopted");
    expect(state("active", true, true, true)).toBe("adopted");
    expect(state("active", false, true, true)).toBe("blocked");
    expect(state("archived", false, true)).toBe("archived");
  });

  it("T-U36: an already adopted league remains adopted on an idempotent reread", () => {
    // §8.2 steps 8–9 / §8.4: first adoption creates one active participation; a retry rereads
    // that same active participation, so the transition screen remains adopted rather than asking again.
    expect(state("active", true, true)).toBe("adopted");
    expect(state("active", true, true)).toBe("adopted");
  });
});
