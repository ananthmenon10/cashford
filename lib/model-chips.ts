import type { ScoreProb } from "./odds-model";

export type ScoreChip = {
  home: number;
  away: number;
  probability: number;
  probabilityPercent: number;
  label: string;
};

export function chipsForFixture(topScores: readonly ScoreProb[]): ScoreChip[] {
  return topScores.slice(0, 3).map((score) => {
    const home = score.h;
    const away = score.a;
    const probability = score.p;
    const probabilityPercent = Math.round(probability * 100);
    return {
      home,
      away,
      probability,
      probabilityPercent,
      label: `${home}–${away} ${probabilityPercent}%`,
    };
  });
}
