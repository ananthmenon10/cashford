// Phase 3 — U3 `resolveGameweekView` (lib/gw-view.ts) and the PR3a dirty-DTO contract (T-U2c).
// Written blind from the plan's §1 (U3) and §2.2 (R2 (h), (h) drop rule) and §13.1.
//
// NAMING CAVEAT (flagged in the delegation report): the plan names `resolveGameweekView` and
// states its five-branch resolution order (§1 U3) but gives no parameter signature, and names no
// separate DTO-building export for the PR3a "no snapshot points field" assertion (T-U2c) beyond
// "the DTO builder drops it" (§2.2 (h)). This file assumes:
//   resolveGameweekView(candidates: ContestCandidate[], gwParam: string | number | undefined | null, now: string): ContestCandidate | null
//   buildGameweekViewDTO(input): GameweekViewDTO   — the (h)-drop assertion target
// Both are guesses at names/shapes the plan does not give verbatim; a wrong guess should fail on
// import or call signature, which is the intended signal, not a workaround target.
import { describe, expect, it } from "vitest";
import { resolveGameweekView, buildGameweekViewDTO } from "../../lib/gw-view";

type Candidate = {
  gwNumber: number;
  gameweekContestId: string;
  status: "open" | "locked" | "settling" | "settled" | "void";
  deadlineAt: string;
};

const BEFORE = "2026-02-01T00:00:00.000Z";
const AFTER = "2026-02-10T00:00:00.000Z";

const openFuture: Candidate = { gwNumber: 24, gameweekContestId: "c-open", status: "open", deadlineAt: "2026-02-15T00:00:00.000Z" };
const cronLagOpen: Candidate = { gwNumber: 23, gameweekContestId: "c-lag", status: "open", deadlineAt: "2026-02-08T00:00:00.000Z" };
const terminalLocked: Candidate = { gwNumber: 22, gameweekContestId: "c-term", status: "settled", deadlineAt: "2026-02-01T00:00:00.000Z" };
const terminalVoid: Candidate = { gwNumber: 21, gameweekContestId: "c-void", status: "void", deadlineAt: "2026-01-25T00:00:00.000Z" };

describe("resolveGameweekView — U3 five-branch resolution order", () => {
  it("step 1: a valid ?gw= resolving to a contest in this league wins outright", () => {
    const chosen = resolveGameweekView([openFuture, terminalLocked], 22, AFTER);
    expect(chosen?.gameweekContestId).toBe("c-term");
  });

  it("step 1 rejection (non-integer ?gw=) falls through to step 2, never a 500", () => {
    expect(() => resolveGameweekView([openFuture], "not-a-number" as unknown as number, BEFORE)).not.toThrow();
  });

  it("step 1 rejection (?gw= with no matching contest in this league) falls through to step 2", () => {
    const chosen = resolveGameweekView([openFuture], 999, BEFORE);
    expect(chosen?.gameweekContestId).toBe("c-open");
  });

  it("step 2: the open contest whose deadline is still future wins when no ?gw= given", () => {
    const chosen = resolveGameweekView([openFuture, terminalLocked], undefined, BEFORE);
    expect(chosen?.gameweekContestId).toBe("c-open");
  });

  it("step 3: cron-lag — stored open but deadline has passed renders via this branch, not as open", () => {
    const chosen = resolveGameweekView([cronLagOpen, terminalLocked], undefined, AFTER);
    // The cron-lag contest is chosen over the older terminal one, but callers must treat it as
    // closed (PR1) — this test only proves it's the one selected, not the render outcome.
    expect(chosen?.gameweekContestId).toBe("c-lag");
  });

  it("step 4: with no open/cron-lag candidate, the latest terminal contest wins, including void", () => {
    const chosen = resolveGameweekView([terminalLocked, terminalVoid], undefined, AFTER);
    expect(chosen?.gameweekContestId).toBe("c-term"); // later deadline_at than terminalVoid
  });

  it("step 4: a void terminal contest is eligible to win when it is the latest", () => {
    const chosen = resolveGameweekView([terminalVoid], undefined, AFTER);
    expect(chosen?.gameweekContestId).toBe("c-void");
  });

  it("step 5: no contest at all → null (pre-season/blank, CL0)", () => {
    const chosen = resolveGameweekView([], undefined, BEFORE);
    expect(chosen).toBeNull();
  });
});

// T-U2c — §2.2 (h): when the contest is dirty (CL6/CL8), R2 (h)'s entry-results read is dropped
// from the DTO entirely rather than surfaced stale. This is the DTO-shape half of PR3a; the
// points-source half (live input wins) is exercised in gw-live.test.ts against the pure engine
// directly, per the plan's own framing of T-U2c/T-U10.
describe("buildGameweekViewDTO — T-U2c dirty DTO carries no snapshot points field", () => {
  it("a dirty contest's DTO has no snapshotPoints / entryResults key at all, not merely an empty one", () => {
    const dto = buildGameweekViewDTO({
      cl: "CL6",
      snapshotEntryResults: [{ userId: "u1", points: 9 }], // what R2(h) fetched, must be dropped
      liveInput: { entries: [], results: [], stakeInr: 100 },
    } as never);
    expect(Object.prototype.hasOwnProperty.call(dto, "snapshotPoints")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(dto, "entryResults")).toBe(false);
  });
});
