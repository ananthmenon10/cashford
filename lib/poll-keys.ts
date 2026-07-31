export const PHASE4_SYNC_KEYS = [
  "espn_insights",
  "espn_match_data",
  "espn_commentary",
  "espn_standings",
  "derived_standings",
  "espn_reconcile",
  "team_news",
  "understat_xg",
  "fotmob_slow",
] as const;

export type Phase4SyncKey = (typeof PHASE4_SYNC_KEYS)[number];

const PHASE4_SYNC_KEY_SET = new Set<string>(PHASE4_SYNC_KEYS);

export function isPhase4SyncKey(value: string): value is Phase4SyncKey {
  return PHASE4_SYNC_KEY_SET.has(value);
}

export const PHASE4_LAUNCH_KEYS = PHASE4_SYNC_KEYS.filter(
  (key) => key !== "fotmob_slow",
);
