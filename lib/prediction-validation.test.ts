import { describe, expect, it } from "vitest";
import {
  deriveOutcomeFromScore,
  GROUP_SCORELINE_MISMATCH_ERROR,
  isPredictionConsistent,
  KNOCKOUT_DRAW_ERROR,
  KNOCKOUT_SCORELINE_MISMATCH_ERROR,
  predictionConsistencyError,
  type Outcome,
} from "./prediction-validation";

const pred = (isKnockout: boolean, outcome: Outcome, predHome: number, predAway: number) => ({
  isKnockout,
  outcome,
  predHome,
  predAway,
});

describe("deriveOutcomeFromScore", () => {
  it("derives the regulation result from the scoreline", () => {
    expect(deriveOutcomeFromScore(2, 1)).toBe("home");
    expect(deriveOutcomeFromScore(1, 1)).toBe("draw");
    expect(deriveOutcomeFromScore(0, 1)).toBe("away");
  });
});

describe("predictionConsistencyError", () => {
  it("allows non-knockout outcomes that match the scoreline sign", () => {
    expect(isPredictionConsistent(pred(false, "home", 2, 1))).toBe(true);
    expect(isPredictionConsistent(pred(false, "draw", 1, 1))).toBe(true);
    expect(isPredictionConsistent(pred(false, "away", 1, 2))).toBe(true);
  });

  it("rejects non-knockout outcomes that contradict the scoreline", () => {
    expect(predictionConsistencyError(pred(false, "home", 1, 1))).toBe(GROUP_SCORELINE_MISMATCH_ERROR);
    expect(predictionConsistencyError(pred(false, "draw", 2, 1))).toBe(GROUP_SCORELINE_MISMATCH_ERROR);
    expect(predictionConsistencyError(pred(false, "away", 2, 1))).toBe(GROUP_SCORELINE_MISMATCH_ERROR);
  });

  it("rejects draw as a knockout outcome", () => {
    expect(predictionConsistencyError(pred(true, "draw", 1, 1))).toBe(KNOCKOUT_DRAW_ERROR);
  });

  it("allows a level 90-minute knockout scoreline with either advancer", () => {
    expect(isPredictionConsistent(pred(true, "home", 1, 1))).toBe(true);
    expect(isPredictionConsistent(pred(true, "away", 1, 1))).toBe(true);
  });

  it("rejects a knockout advancer that is losing the predicted 90-minute scoreline", () => {
    expect(predictionConsistencyError(pred(true, "home", 0, 1))).toBe(KNOCKOUT_SCORELINE_MISMATCH_ERROR);
    expect(predictionConsistencyError(pred(true, "away", 1, 0))).toBe(KNOCKOUT_SCORELINE_MISMATCH_ERROR);
  });
});
