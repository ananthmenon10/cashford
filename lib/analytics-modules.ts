import type { AnalyticsHabits } from "./analytics-habits";
import type { AnalyticsRivalry } from "./analytics-rivalry";
import type { AnalyticsYouVsRoom } from "./analytics-room";

export type AnalyticsModulesView = {
  leagueId: string;
  competitionId: string;
  modules: {
    youVsRoom: AnalyticsYouVsRoom | null;
    rivalry: AnalyticsRivalry | null;
    habits: AnalyticsHabits | null;
    weeklyLabels: null;
    clubReads: null;
    receipts: null;
  };
};
