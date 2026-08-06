import {
  resolveRender,
  type ContestLifecycle,
  type ViewerParticipation,
} from "./gw-state";
import { calendarDateKey } from "./datetime";
import { toEspnClubName } from "./club-name-alias";

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
  scheduled: boolean;
  kickoffAt: string | null;
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

export type FixtureDay = {
  dayKey: string;
  dateAt: string | null;
  fixtures: FixtureRowView[];
};

export function groupFixturesByLocalDay(
  rows: readonly FixtureRowView[],
  timeZone: string,
): FixtureDay[] {
  const groups = new Map<
    string,
    FixtureDay & { firstKickoffMs: number }
  >();
  for (const row of rows) {
    const dayKey = row.kickoffAt
      ? calendarDateKey(row.kickoffAt, timeZone)
      : "date-tbc";
    const kickoffMs = row.kickoffAt
      ? new Date(row.kickoffAt).getTime()
      : Number.POSITIVE_INFINITY;
    const group = groups.get(dayKey);
    if (group) {
      group.fixtures.push(row);
      if (kickoffMs < group.firstKickoffMs) {
        group.firstKickoffMs = kickoffMs;
        group.dateAt = row.kickoffAt;
      }
    } else {
      groups.set(dayKey, {
        dayKey,
        dateAt: row.kickoffAt,
        fixtures: [row],
        firstKickoffMs: kickoffMs,
      });
    }
  }
  return [...groups.values()]
    .sort((a, b) => a.firstKickoffMs - b.firstKickoffMs)
    .map(({ firstKickoffMs: _firstKickoffMs, ...day }) => day);
}

// One chip per competition the viewer currently has a live (non-archived) link into — dedupe and
// ordering come from lib/gw-home.ts's homeCompetitionScopes, the same helper the home hub uses.
export type MatchesTabScope = { slug: string; name: string };

export type MatchesTabView = {
  competition: {
    id: string;
    slug: string;
    name: string;
    archived: boolean;
  };
  // Every competition the viewer has an active link into (first-seen order); the chip row above
  // the segment control only renders when there's more than one. selectedScope is this view's
  // competition.slug, repeated here so the client can mark the active chip without re-deriving it.
  scopes: MatchesTabScope[];
  selectedScope: string;
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
  fixtures: FixtureRowView[];
};

// A live fixture's `state` label is built by matches-tab-load.ts's fixtureLabel() as
// `${minute ?? ""}' · LIVE` — the only state string that ever contains "LIVE" (finished/void/
// postponed/scheduled labels never do), so a substring check is a safe, loader-shape-preserving
// way to ask "is this fixture live right now" without adding a second boolean field.
export function isLiveFixtureState(state: string): boolean {
  return state.includes("LIVE");
}

// Pulls the leading minute off a live state label ("63′ · LIVE" -> 63). Returns null when the
// minute is unknown (fixture.minute was null) — callers render a minute-less "LIVE" badge then.
// Accepts either the ASCII apostrophe or the canonical U+2032 prime so pure-helper callers that
// build state strings by hand (tests) keep working alongside the loader's real output.
export function liveMinuteFromState(state: string): number | null {
  const match = /^(\d+)['′]/.exec(state);
  return match ? Number(match[1]) : null;
}

// Club name -> current live minute (null if live but the minute is unknown), for every club
// playing in `fixtures`. Fed by the SAME fixture list the fixture list/table already load for the
// gameweek, so the competition table's "live row" highlight needs no extra query — it's the same
// gameweek's fixtures the table's clubs are drawn from. Keyed by ESPN displayName (via
// toEspnClubName) since the table this feeds is joined against ESPN-sourced standings rows, not
// the FPL-sourced fixture names.
export function liveClubMinutes(
  fixtures: readonly FixtureRowView[],
): Map<string, number | null> {
  const minutes = new Map<string, number | null>();
  for (const fixture of fixtures) {
    if (!isLiveFixtureState(fixture.state)) continue;
    const minute = liveMinuteFromState(fixture.state);
    minutes.set(toEspnClubName(fixture.home.name), minute);
    minutes.set(toEspnClubName(fixture.away.name), minute);
  }
  return minutes;
}

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
