import type { LeagueRowView, MatchesTabView } from "./matches-tab";

export type MatchesHomeTabFreshness = "settled" | "pre" | "unresolved" | "empty";

export type MatchesHomeTabNextGameweek = {
  number: number;
  deadlineAt: string;
  leagues: Array<{
    leagueSlug: string;
    leagueName: string;
    status: "none" | "complete" | "needs_update" | "ineligible";
    enterHref: string;
  }>;
};

export type MatchesHomeTabReceipt = {
  gwNumber: number;
  summary: string;
  rows: LeagueRowView[];
  href: string;
};

export type MatchesHomeTabPayload =
  | {
      empty: true;
      requestedComp: string | null;
      requestedGw: number | null;
      selectedComp: string | null;
      freshness: "empty";
    }
  | {
      empty: false;
      requestedComp: string | null;
      requestedGw: number | null;
      selectedComp: string;
      view: MatchesTabView;
      freshness: Exclude<MatchesHomeTabFreshness, "empty">;
      nextGw: MatchesHomeTabNextGameweek | null;
      receipt: MatchesHomeTabReceipt | null;
    };
