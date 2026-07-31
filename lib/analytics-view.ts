import type { LeagueRef } from "./matches-tab";

export type AnalyticsStrip =
  | { kind: "pre_not_entered"; gw: number }
  | { kind: "pre_entered"; entered: number; of: number }
  | { kind: "live_not_entered"; gw: number }
  | { kind: "live_entered"; gw: number; raceHref: string }
  | { kind: "settled_not_entered"; gw: number }
  | { kind: "settled_entered"; gw: number }
  | { kind: "awaiting_void_not_entered"; gw: number }
  | { kind: "awaiting_void_entered"; gw: number };

export type AnalyticsTabView = {
  competition: {
    id: string;
    slug: string;
    name: string;
    archived: boolean;
  };
  currentFocusGw: {
    id: string;
    number: number;
    state: "pre" | "live" | "settled" | "awaiting_settlement";
  };
  latestSettledGw: { id: string; number: number } | null;
  strip: AnalyticsStrip;
  lens: { league: LeagueRef | null; options: LeagueRef[] };
  leadCard?: {
    gwNumber: number;
    perLeague: Array<{
      league: LeagueRef;
      points: number;
      potInr: number | null;
    }>;
    exacts: number;
    biggestGain: unknown;
    biggestMiss: unknown;
    acknowledged: boolean;
  };
  myForm?: unknown;
  vsRoom?: unknown;
  receipts?: unknown;
  weeklyLabels?: unknown;
  rivalry?: unknown;
  clubReads?: unknown;
  habits?: unknown;
  emptyState?: {
    kind: "pre_gw1" | "never_entered";
    cta: { label: string; href: string };
  };
  suppressed: {
    cumulative: boolean;
    leadCard: boolean;
    reasons: Array<"dirty" | "dirty_older" | "settling" | "overlap">;
  } | null;
};

export function buildAnalyticsTabView(input: {
  base: Omit<AnalyticsTabView, "suppressed" | "leadCard">;
  leadCard?: AnalyticsTabView["leadCard"];
  dirtyCurrent?: boolean;
  dirtyOlder?: boolean;
  settling?: boolean;
  overlap?: boolean;
}): AnalyticsTabView {
  const reasons: NonNullable<AnalyticsTabView["suppressed"]>["reasons"] = [];
  if (input.dirtyCurrent) reasons.push("dirty");
  if (input.dirtyOlder) reasons.push("dirty_older");
  if (input.settling) reasons.push("settling");
  if (input.overlap) reasons.push("overlap");
  const cumulative = !!input.dirtyCurrent || !!input.dirtyOlder;
  const leadCard = cumulative || !!input.settling || !!input.overlap;
  const view: AnalyticsTabView = {
    ...input.base,
    suppressed: reasons.length ? { cumulative, leadCard, reasons } : null,
  };
  if (!cumulative) {
    Object.assign(view, {
      myForm: input.base.myForm,
      vsRoom: input.base.vsRoom,
      receipts: input.base.receipts,
      rivalry: input.base.rivalry,
      clubReads: input.base.clubReads,
      habits: input.base.habits,
    });
  } else {
    delete view.myForm;
    delete view.vsRoom;
    delete view.receipts;
    delete view.rivalry;
    delete view.clubReads;
    delete view.habits;
  }
  if (!leadCard && input.leadCard) view.leadCard = input.leadCard;
  return view;
}
