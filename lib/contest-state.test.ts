import { describe, it, expect } from "vitest";
import {
  deriveCardState,
  tabForState,
  liveLabel,
  ROUND_LABEL,
  type CardInput,
  type CardState,
} from "./contest-state";

// Sensible "open, well before lock, group stage, picked" baseline; each test overrides.
const base: CardInput = {
  contestStatus: "open",
  fixtureStatus: "scheduled",
  lockAtMs: 1_000,
  nowMs: 0,
  isKnockout: false,
  homeKnown: true,
  awayKnown: true,
  hasMyPrediction: true,
  myResult: null,
};
const at = (o: Partial<CardInput>): CardState => deriveCardState({ ...base, ...o });

describe("deriveCardState — terminal contest statuses win first", () => {
  it("cancelled/void short-circuit regardless of fixture/result", () => {
    expect(at({ contestStatus: "cancelled", fixtureStatus: "live" })).toBe("cancelled");
    expect(at({ contestStatus: "void", fixtureStatus: "finished", myResult: "win" })).toBe("void");
  });

  it("settled maps myResult → won/lost/notentered, defaulting to push", () => {
    expect(at({ contestStatus: "settled", myResult: "win" })).toBe("won");
    expect(at({ contestStatus: "settled", myResult: "loss" })).toBe("lost");
    expect(at({ contestStatus: "settled", myResult: "not_entered" })).toBe("notentered");
    expect(at({ contestStatus: "settled", myResult: "push" })).toBe("push");
    expect(at({ contestStatus: "settled", myResult: null })).toBe("push"); // default branch
    expect(at({ contestStatus: "settled", myResult: "void" })).toBe("push");
  });
});

describe("deriveCardState — not yet settled: fixture phase precedence", () => {
  it("finished fixture but contest not settled → settling (S5b, cron pending)", () => {
    expect(at({ contestStatus: "locked", fixtureStatus: "finished" })).toBe("settling");
  });

  it("live fixture → live", () => {
    expect(at({ contestStatus: "locked", fixtureStatus: "live" })).toBe("live");
  });

  it("finished takes precedence over a stale 'open' contest status", () => {
    expect(at({ contestStatus: "open", fixtureStatus: "finished" })).toBe("settling");
  });
});

describe("deriveCardState — lock handling (§17.9 cron lag)", () => {
  it("contest already flipped to locked → locked", () => {
    expect(at({ contestStatus: "locked" })).toBe("locked");
  });

  it("still 'open' but lock_at has passed → locked (cron lags)", () => {
    expect(at({ contestStatus: "open", lockAtMs: 100, nowMs: 100 })).toBe("locked"); // <= boundary
    expect(at({ contestStatus: "open", lockAtMs: 100, nowMs: 200 })).toBe("locked");
  });

  it("open and strictly before lock → not locked", () => {
    expect(at({ contestStatus: "open", lockAtMs: 100, nowMs: 99 })).not.toBe("locked");
  });
});

describe("deriveCardState — open & before lock", () => {
  it("knockout with an unknown side → tbd", () => {
    expect(at({ isKnockout: true, homeKnown: false })).toBe("tbd");
    expect(at({ isKnockout: true, awayKnown: false })).toBe("tbd");
  });

  it("knockout with both sides known follows the pick", () => {
    expect(at({ isKnockout: true, hasMyPrediction: true })).toBe("open_picked");
    expect(at({ isKnockout: true, hasMyPrediction: false })).toBe("open_nopick");
  });

  it("group stage open → picked vs nopick", () => {
    expect(at({ hasMyPrediction: true })).toBe("open_picked");
    expect(at({ hasMyPrediction: false })).toBe("open_nopick");
  });

  it("tbd only applies before lock — a passed lock on an unknown KO side is locked", () => {
    expect(at({ isKnockout: true, homeKnown: false, lockAtMs: 0, nowMs: 1 })).toBe("locked");
  });
});

describe("tabForState — every state lands in exactly one tab", () => {
  const expected: Record<CardState, "upcoming" | "live" | "done"> = {
    open_nopick: "upcoming",
    open_picked: "upcoming",
    tbd: "upcoming",
    locked: "upcoming",
    live: "live",
    settling: "live",
    won: "done",
    lost: "done",
    push: "done",
    notentered: "done",
    void: "done",
    cancelled: "done",
  };
  for (const [state, tab] of Object.entries(expected)) {
    it(`${state} → ${tab}`, () => expect(tabForState(state as CardState)).toBe(tab));
  }
});

describe("liveLabel", () => {
  it("maps known status details to short labels", () => {
    expect(liveLabel("STATUS_HALFTIME")).toBe("HT");
    expect(liveLabel("STATUS_END_OF_REGULATION")).toBe("Break");
    expect(liveLabel("STATUS_END_OF_EXTRATIME")).toBe("Break");
    expect(liveLabel("STATUS_SHOOTOUT")).toBe("Pens");
    expect(liveLabel("STATUS_PENALTIES")).toBe("Pens");
  });

  it("extra-time shows the minute when present, else a generic label", () => {
    expect(liveLabel("STATUS_OVERTIME", 97)).toBe("ET 97'");
    expect(liveLabel("STATUS_FIRST_EXTRA")).toBe("Extra time");
    expect(liveLabel("STATUS_SECOND_EXTRA", 0)).toBe("Extra time"); // 0 is falsy → generic
  });

  it("defaults to the minute, then to 'Live'", () => {
    expect(liveLabel(undefined, 63)).toBe("63'");
    expect(liveLabel(null, null)).toBe("Live");
    expect(liveLabel("STATUS_IN_PROGRESS", 12)).toBe("12'");
  });
});

describe("ROUND_LABEL", () => {
  it("covers every round key used by the bracket", () => {
    expect(ROUND_LABEL.group).toBe("Group");
    expect(ROUND_LABEL.r16).toBe("Round of 16");
    expect(ROUND_LABEL.final).toBe("Final");
    expect(Object.keys(ROUND_LABEL)).toEqual(["group", "r32", "r16", "qf", "sf", "third", "final"]);
  });
});
