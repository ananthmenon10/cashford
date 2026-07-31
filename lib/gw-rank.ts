export type RankableGameweekScore = {
  userId: string;
  points: number;
  exacts: number;
  goalError: number;
};

/**
 * Competition ranks over the settlement engine's W3-W6 tuple. Entrants tied
 * on every money tiebreak share a rank; the next rank skips their places.
 */
export function rankGameweekScores<T extends RankableGameweekScore>(
  scores: readonly T[],
): Map<string, number> {
  const ordered = [...scores].sort(
    (a, b) =>
      b.points - a.points ||
      b.exacts - a.exacts ||
      a.goalError - b.goalError,
  );
  const ranks = new Map<string, number>();
  let previous: T | null = null;
  let rank = 0;
  ordered.forEach((score, index) => {
    if (
      !previous ||
      score.points !== previous.points ||
      score.exacts !== previous.exacts ||
      score.goalError !== previous.goalError
    ) {
      rank = index + 1;
    }
    ranks.set(score.userId, rank);
    previous = score;
  });
  return ranks;
}
