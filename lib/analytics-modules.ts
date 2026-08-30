import type { AnalyticsHabits } from "./analytics-habits";
import type { AnalyticsWeeklyLabels } from "./analytics-labels";
import type { AnalyticsRivalry } from "./analytics-rivalry";
import type { AnalyticsYouVsRoom } from "./analytics-room";

export type AnalyticsModulesView = {
  leagueId: string;
  competitionId: string;
  modules: {
    youVsRoom: AnalyticsYouVsRoom | null;
    rivalry: AnalyticsRivalry | null;
    habits: AnalyticsHabits | null;
    weeklyLabels: AnalyticsWeeklyLabels | null;
    clubReads: null;
    receipts: null;
  };
};
