import {
  resolveRender,
  type ContestLifecycle,
  type ViewerParticipation,
} from "./gw-state";

export type LeagueRef = { id: string; slug: string; name: string };
export type Cta = { label: string; href: string };

export type LeagueRowView =
  | { kind: "open-not-entered"; league: LeagueRef; cta: Cta; raceHref: string }
  | { kind: "open-entered"; league: LeagueRef; cta: Cta; raceHref: string }
  | { kind: "open-locked-in"; league: LeagueRef; raceHref: string }
  | { kind: "open-needs-update"; league: LeagueRef; cta: Cta; raceHref: string }
  | { kind: "locked-awaiting"; league: LeagueRef; raceHref: string }
  | { kind: "closed-not-entered"; league: LeagueRef; raceHref: string }
  | { kind: "ineligible"; league: LeagueRef; raceHref: string }
  | { kind: "invalid"; league: LeagueRef; reason: string; raceHref: string }
  | {
      kind: "provisional";
      league: LeagueRef;
      ordinal: string | null;
      fieldSize: number;
      points: number;
      netInr: number | null;
      raceHref: string;
    }
  | {
      kind: "recalculating";
      league: LeagueRef;
      points: number | null;
      raceHref: string;
    }
  | {
      kind: "settled";
      league: LeagueRef;
      ordinal: string;
      fieldSize: number;
      points: number;
      netInr: number;
      raceHref: string;
    }
  | { kind: "void"; league: LeagueRef; voidReason: string; raceHref: string }
  | {
      kind: "all-called-off";
      league: LeagueRef;
      raceHref: string;
      waiting: true;
    }
  | { kind: "sync-issue"; league: LeagueRef; raceHref: string };

export type RowCtx = {
  league: LeagueRef;
  raceHref: string;
  cta?: Cta;
  reason?: string;
  ordinal?: string | null;
  fieldSize?: number;
  points?: number | null;
  netInr?: number | null;
  voidReason?: string;
};

export function buildLeagueRow(
  cl: ContestLifecycle,
  vp: ViewerParticipation,
  ctx: RowCtx,
): LeagueRowView | null {
  const render = resolveRender(cl, vp);
  if (render.state === "blank") return null;
  if (render.state === "sync_issue") {
    return { kind: "sync-issue", league: ctx.league, raceHref: ctx.raceHref };
  }
  if (render.participation === "VP0") {
    return { kind: "ineligible", league: ctx.league, raceHref: ctx.raceHref };
  }
  if (render.participation === "VP5") {
    return {
      kind: "invalid",
      league: ctx.league,
      reason: ctx.reason ?? "Entry incomplete at the deadline",
      raceHref: ctx.raceHref,
    };
  }
  if (render.state === "open") {
    if (render.participation === "VP1") {
      return {
        kind: "open-not-entered",
        league: ctx.league,
        cta: requiredCta(ctx),
        raceHref: ctx.raceHref,
      };
    }
    if (render.participation === "VP2") {
      return {
        kind: "open-entered",
        league: ctx.league,
        cta: requiredCta(ctx),
        raceHref: ctx.raceHref,
      };
    }
    if (render.participation === "VP3") {
      return {
        kind: "open-needs-update",
        league: ctx.league,
        cta: requiredCta(ctx),
        raceHref: ctx.raceHref,
      };
    }
    return {
      kind: "open-locked-in",
      league: ctx.league,
      raceHref: ctx.raceHref,
    };
  }
  if (render.participation === "VP1") {
    return {
      kind: "closed-not-entered",
      league: ctx.league,
      raceHref: ctx.raceHref,
    };
  }
  if (render.state === "closed") {
    return {
      kind: "locked-awaiting",
      league: ctx.league,
      raceHref: ctx.raceHref,
    };
  }
  if (render.state === "live") {
    return {
      kind: "provisional",
      league: ctx.league,
      ordinal: ctx.ordinal ?? null,
      fieldSize: ctx.fieldSize ?? 0,
      points: ctx.points ?? 0,
      netInr: ctx.netInr ?? null,
      raceHref: ctx.raceHref,
    };
  }
  if (render.state === "recalculating") {
    return {
      kind: "recalculating",
      league: ctx.league,
      points: ctx.points ?? null,
      raceHref: ctx.raceHref,
    };
  }
  if (render.state === "settled") {
    return {
      kind: "settled",
      league: ctx.league,
      ordinal: ctx.ordinal ?? "—",
      fieldSize: ctx.fieldSize ?? 0,
      points: ctx.points ?? 0,
      netInr: ctx.netInr ?? 0,
      raceHref: ctx.raceHref,
    };
  }
  if (render.state === "void") {
    return {
      kind: "void",
      league: ctx.league,
      voidReason: ctx.voidReason ?? "Gameweek void",
      raceHref: ctx.raceHref,
    };
  }
  if (render.state === "all_void") {
    return {
      kind: "all-called-off",
      league: ctx.league,
      raceHref: ctx.raceHref,
      waiting: true,
    };
  }
  return assertNever(render.state as never);
}

function requiredCta(ctx: RowCtx): Cta {
  if (!ctx.cta) throw new Error("Open row needs a named-league CTA");
  return ctx.cta;
}

function assertNever(value: never): never {
  throw new Error(`Unhandled league row: ${String(value)}`);
}

export type WinnersRecapView =
  | {
      kind: "settled";
      league: LeagueRef;
      potInr: number;
      winners: Array<{ name: string; points: number }>;
      tiebreakUsed: "none" | "exacts" | "goalError" | "split";
      href: string;
    }
  | { kind: "void"; league: LeagueRef; voidReason: string; href: string }
  | { kind: "recalculating"; league: LeagueRef; href: string };

export type FixtureRowView = {
  id: string;
  state: string;
  home: { name: string; crest?: string | null };
  away: { name: string; crest?: string | null };
  score: [number, number] | null;
  matchHref: string;
  insightsMark: boolean;
  yourCall:
    | { kind: "none" }
    | {
        kind: "same";
        score: [number, number];
        leagues: LeagueRef[];
        points: number;
        verdict?: "exact" | "result" | "miss";
      }
    | {
        kind: "varies";
        calls: Array<{
          score: [number, number];
          league: LeagueRef;
          points: number;
          verdict?: "exact" | "result" | "miss";
        }>;
      };
};

export type MatchesTabView = {
  competition: {
    id: string;
    slug: string;
    name: string;
    archived: boolean;
  };
  gw: {
    id: string;
    number: number;
    label: string;
    state: "pre" | "live" | "settled";
    deadlineAt: string;
    isCurrent: boolean;
  };
  picker: {
    prev?: number;
    next?: number;
    range: number[];
    futureCaveat: boolean;
  };
  yourGw: {
    enteredCount: number;
    leagueCount: number;
    toGo: number | null;
    headerPoints: number | null;
    rows: LeagueRowView[];
    provisional: boolean;
    recap?: { gwNumber: number; href: string };
  } | null;
  winnersRecap: WinnersRecapView[] | null;
  days: Array<{ label: string; fixtures: FixtureRowView[] }>;
  overflow: { count: number; label: string } | null;
};

export function sharedHeaderPoints(rows: readonly LeagueRowView[]): number | null {
  const pointRows = rows.filter(
    (
      row,
    ): row is Extract<LeagueRowView, { kind: "settled" | "provisional" }> =>
      row.kind === "settled" || row.kind === "provisional",
  );
  if (pointRows.length !== rows.length || !pointRows.length) return null;
  if (!pointRows.every((row) => row.kind === pointRows[0].kind)) return null;
  const first = pointRows[0].points;
  return pointRows.every((row) => row.points === first) ? first : null;
}
