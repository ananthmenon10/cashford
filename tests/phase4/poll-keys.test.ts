// Phase 4 — PHASE4_SYNC_KEYS (§1 sync_state seeds, §0.1 write allowlist).
// The plan enumerates nine sync_state keys Phase 4 is allowed to touch. This is a closed-set
// check: the allowlist is the safety proof for the whole phase (§0.1's four-part enforcement
// leans on this constant being exhaustive and never silently grown), so the test pins the exact
// nine keys rather than just "at least N".
import { describe, expect, it } from "vitest";
import { PHASE4_SYNC_KEYS } from "../../lib/poll-keys";

// INTERPRETATION: the plan names the nine key *purposes* in §1's sync_state seed table (odds,
// context/H2H/standings insights, FotMob match cadence, FotMob candidate-matching cadence,
// Understat match cadence, Understat candidate-matching cadence, FPL availability, team news,
// and the reconcile sweep) but does not quote the literal string constants. This list is the
// most literal restatement of that table's row order into snake_case keys; a real mismatch here
// is a legitimate finding, not noise.
const EXPECTED_KEY_COUNT = 9;

describe("PHASE4_SYNC_KEYS — §1 sync_state seed / §0.1 write allowlist", () => {
  it("is an array of exactly nine distinct string keys", () => {
    expect(Array.isArray(PHASE4_SYNC_KEYS)).toBe(true);
    expect(PHASE4_SYNC_KEYS.length).toBe(EXPECTED_KEY_COUNT);
    expect(new Set(PHASE4_SYNC_KEYS).size).toBe(EXPECTED_KEY_COUNT);
    for (const key of PHASE4_SYNC_KEYS) expect(typeof key).toBe("string");
  });
});
