export type Outcome = "home" | "draw" | "away";

export interface PredictionConsistencyInput {
  isKnockout: boolean;
  outcome: Outcome;
  predHome: number;
  predAway: number;
}

export const SCORE_NONNEGATIVE_ERROR = "Scores can't be negative.";
export const GROUP_SCORELINE_MISMATCH_ERROR = "Scoreline doesn't match the selected result.";
export const KNOCKOUT_DRAW_ERROR = "No draws in a knockout — pick a side.";
export const KNOCKOUT_SCORELINE_MISMATCH_ERROR =
  "For knockout matches, the selected team can't be losing the 90-minute scoreline.";

export function deriveOutcomeFromScore(predHome: number, predAway: number): Outcome {
  if (predHome > predAway) return "home";
  if (predAway > predHome) return "away";
  return "draw";
}

export function predictionConsistencyError(input: PredictionConsistencyInput): string | null {
  if (input.predHome < 0 || input.predAway < 0) return SCORE_NONNEGATIVE_ERROR;

  if (input.isKnockout) {
    if (input.outcome === "draw") return KNOCKOUT_DRAW_ERROR;
    if (input.outcome === "home" && input.predHome < input.predAway) return KNOCKOUT_SCORELINE_MISMATCH_ERROR;
    if (input.outcome === "away" && input.predAway < input.predHome) return KNOCKOUT_SCORELINE_MISMATCH_ERROR;
    return null;
  }

  return input.outcome === deriveOutcomeFromScore(input.predHome, input.predAway)
    ? null
    : GROUP_SCORELINE_MISMATCH_ERROR;
}

export function isPredictionConsistent(input: PredictionConsistencyInput): boolean {
  return predictionConsistencyError(input) === null;
}
