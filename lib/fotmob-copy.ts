import type { FotMobFactKey } from "./fotmob";

export const FACT_COPY: Record<
  FotMobFactKey,
  (args: number[]) => string
> = {
  shots_on_target: ([home = 0, away = 0]) =>
    `${home}–${away} shots on target`,
  possession_pct: ([home = 0, away = 0]) =>
    `${home}%–${away}% possession`,
  big_chances: ([home = 0, away = 0]) =>
    `${home}–${away} big chances`,
  corners: ([home = 0, away = 0]) => `${home}–${away} corners`,
  saves: ([home = 0, away = 0]) => `${home}–${away} saves`,
  fouls: ([home = 0, away = 0]) => `${home}–${away} fouls`,
  offsides: ([home = 0, away = 0]) => `${home}–${away} offsides`,
  passes_completed_pct: ([home = 0, away = 0]) =>
    `${home}%–${away}% passes completed`,
};
