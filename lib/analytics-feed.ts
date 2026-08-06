// Step 8 — pure aggregation/mapping for the Analytics feed (structure A / cross-comp B / my-form
// A). No I/O; lib/analytics-feed-load.ts builds the inputs from the DB and calls these. Reuses
// lib/analytics.ts's Entry/accuracy/netTotal primitives for the archived (cup-format) my-form
// computation — the live (gameweek-format) my-form comes from lib/gw-season.ts's SeasonMemberTotal
// instead, since that loader already tracks per-gameweek points/net without re-deriving Entry[].
import { accuracy, netTotal, type Entry } from "./analytics";
import { ANALYTICS_COPY } from "./analytics-copy";

export type AnalyticsLeagueOption = { id: string; slug: string; name: string };

export type AnalyticsLeagueLine = {
  leagueId: string;
  leagueName: string;
  net: number | "suppressed" | null;
};

export type AnalyticsSection = {
  competitionId: string;
  competitionName: string;
  kind: "live" | "archive";
  /** Latest gameweek reached across the league(s) in this competition — live sections only, since
   * gameweek numbering doesn't apply to a settled cup/WC competition. */
  throughGameweek: number | null;
  leagueLines: AnalyticsLeagueLine[];
};

/** One row per (league, competition) the viewer participates in — the raw input this module
 * groups into sections. `format` drives the live/archive kind (cross-comp B: gameweek-era
 * competitions are "live", cup/WC competitions are "archive" — the only format the app archives
 * today). `net`/`settledRounds` are already viewer-scoped and fix-round item 2 null-safe: `net`
 * is null when the viewer has no entries in that competition (never a fabricated ₹0). */
export type AnalyticsParticipationRow = {
  leagueId: string;
  leagueName: string;
  competitionId: string;
  competitionName: string;
  format: "gameweek" | "cup";
  net: number | "suppressed" | null;
  settledRounds: number;
  throughGameweek?: number | null;
};

export type AnalyticsMyForm = {
  leagueId: string;
  leagueName: string;
  competitionName: string;
  kind: "live" | "archive";
  net: number | "suppressed" | null;
  record: string | null;
  entered: number;
  sampleNote: string;
};

export type AnalyticsAllTimeStrip = {
  net: number | "suppressed" | null;
  leagueCount: number;
  competitionCount: number;
  settledRounds: number;
};

export function buildLeagueOptions(
  leagues: readonly { id: string; name: string; slug: string }[],
): AnalyticsLeagueOption[] {
  return leagues
    .map((l) => ({ id: l.id, slug: l.slug, name: l.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Groups participation rows into per-competition sections (cross-comp B), live sections first,
 * each ordered by first appearance; league lines within a section sorted by name so the same
 * league always lands in the same place across renders. */
export function buildAnalyticsSections(
  rows: readonly AnalyticsParticipationRow[],
): AnalyticsSection[] {
  const order: string[] = [];
  const byCompetition = new Map<string, AnalyticsSection>();
  for (const row of rows) {
    let section = byCompetition.get(row.competitionId);
    if (!section) {
      section = {
        competitionId: row.competitionId,
        competitionName: row.competitionName,
        kind: row.format === "cup" ? "archive" : "live",
        throughGameweek: row.throughGameweek ?? null,
        leagueLines: [],
      };
      byCompetition.set(row.competitionId, section);
      order.push(row.competitionId);
    } else if (section.throughGameweek == null && row.throughGameweek != null) {
      section.throughGameweek = row.throughGameweek;
    }
    if (!section.leagueLines.some((line) => line.leagueId === row.leagueId)) {
      section.leagueLines.push({ leagueId: row.leagueId, leagueName: row.leagueName, net: row.net });
    }
  }
  const sections = order.map((id) => byCompetition.get(id)!);
  for (const section of sections) {
    section.leagueLines.sort((a, b) => a.leagueName.localeCompare(b.leagueName));
  }
  return [...sections.filter((s) => s.kind === "live"), ...sections.filter((s) => s.kind === "archive")];
}

/** All-time strip (cross-comp B's anchor line): net + league/competition/settled-round counts
 * summed straight from the participation rows already loaded — no extra query. Null-safe: if
 * nothing anywhere is settled yet, `net` is null rather than a fabricated ₹0. */
export function buildAllTimeStrip(rows: readonly AnalyticsParticipationRow[]): AnalyticsAllTimeStrip | null {
  if (rows.length === 0) return null;
  const leagueIds = new Set(rows.map((r) => r.leagueId));
  const competitionIds = new Set(rows.map((r) => r.competitionId));
  let settledRounds = 0;
  let net = 0;
  let anySuppressed = false;
  let anySettled = false;
  for (const row of rows) {
    settledRounds += row.settledRounds;
    if (row.settledRounds > 0) anySettled = true;
    if (row.net === "suppressed") anySuppressed = true;
    else if (typeof row.net === "number") net += row.net;
  }
  return {
    net: !anySettled ? null : anySuppressed ? "suppressed" : net,
    leagueCount: leagueIds.size,
    competitionCount: competitionIds.size,
    settledRounds,
  };
}

/** My-form for a league on the LIVE (gameweek) side — built straight from the viewer's
 * SeasonMemberTotal row, no Entry[] needed. */
export function buildLiveMyForm(
  leagueId: string,
  leagueName: string,
  competitionName: string,
  viewerTotal: {
    netInr: number | "suppressed";
    gameweeksEntered: number;
    points: number | "suppressed";
    hasEntries: boolean;
  } | null,
): AnalyticsMyForm | null {
  // hasEntries alone isn't enough: a viewer can have an un-settled "entered" row with zero
  // settled gameweeks, which would otherwise render a fabricated "₹0 · 0 settled gameweeks" card.
  // Section LINES still use hasEntries alone (unchanged) — this extra guard is my-form only.
  if (!viewerTotal || !viewerTotal.hasEntries || viewerTotal.gameweeksEntered === 0) return null;
  return {
    leagueId,
    leagueName,
    competitionName,
    kind: "live",
    net: viewerTotal.netInr,
    record: null,
    entered: viewerTotal.gameweeksEntered,
    sampleNote: ANALYTICS_COPY.gameweekNote(viewerTotal.gameweeksEntered),
  };
}

/** My-form for a league on the ARCHIVE (cup/WC) side — derived from the viewer's own graded
 * Entry[] via the shared analytics engine (accuracy/netTotal), so the correct/incorrect/void
 * record matches the same grading rules the rest of the app uses. */
export function buildArchiveMyForm(
  leagueId: string,
  leagueName: string,
  competitionName: string,
  entries: readonly Entry[],
): AnalyticsMyForm | null {
  if (entries.length === 0) return null;
  const stats = accuracy(entries as Entry[]);
  const incorrect = stats.graded - stats.correct;
  return {
    leagueId,
    leagueName,
    competitionName,
    kind: "archive",
    net: netTotal(entries as Entry[]),
    record: ANALYTICS_COPY.recordLine(stats.correct, incorrect, 0),
    entered: stats.graded,
    sampleNote: ANALYTICS_COPY.sampleNote(stats.graded),
  };
}
