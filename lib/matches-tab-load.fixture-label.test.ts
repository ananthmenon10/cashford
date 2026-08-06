import { describe, expect, it } from "vitest";
import { fixtureLabel } from "./matches-tab-load";
import { isLiveFixtureState } from "./matches-tab";

// Pins the live-predicate producer to its consumer: whatever shape fixtureLabel emits for a live
// fixture must be exactly what isLiveFixtureState recognizes as live. If either side's label shape
// drifts (glyph, wording, ordering) without the other, live fixtures silently stop badging.
describe("fixtureLabel ↔ isLiveFixtureState", () => {
  it("produces a label that isLiveFixtureState accepts as live", () => {
    const { label, scheduled } = fixtureLabel({ status: "live", minute: 63 }, false);
    expect(isLiveFixtureState(label)).toBe(true);
    expect(scheduled).toBe(false);
  });

  it("still recognizes a minute-unknown live fixture as live", () => {
    const { label } = fixtureLabel({ status: "live", minute: null }, false);
    expect(isLiveFixtureState(label)).toBe(true);
  });

  it("never marks a non-live label as live", () => {
    expect(isLiveFixtureState(fixtureLabel({ status: "finished" }, false).label)).toBe(false);
    expect(isLiveFixtureState(fixtureLabel({ status: "scheduled" }, false).label)).toBe(false);
  });
});
