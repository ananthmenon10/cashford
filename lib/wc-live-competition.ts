import type { SupabaseClient } from "@supabase/supabase-js";
import { ARCHIVE_COPY } from "./payment-copy";
import { transitionState, type TransitionState } from "./transition";

// Split out of wc-archive-load.ts so gw-home.ts (whose pure helpers, e.g.
// homeCompetitionScopes, are imported by client components) can use these two
// functions without pulling in wc-archive-load.ts's other export,
// loadKnockoutView/loadKnockoutLeaderboards's "./knockout-data" import, which is
// guarded by "server-only" — that guard trips a build-time error the moment any
// client-reachable module chain touches it, even via a dynamic import().

export type WcLiveCompetition = { id: string; slug: string; name: string; href: string };

type CashfordClient = SupabaseClient<any, "cashford", any>;
type CurrentSeasonCompetition = { id: string; slug: string; name: string; status: string } | null;

function fail(error: { message?: string } | null, context: string) {
  if (error) throw new Error(`${context}: ${error.message ?? "query-failed"}`);
}

function one<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

// Postgres "column does not exist" — surfaces if this runs against the DB before the
// is_current_season migration below has been applied.
const MISSING_COLUMN_CODE = "42703";

/** Pure — the adopt-target rule pinned by the dual-review fix: with several active
 * league-format competitions, the one flagged `is_current_season` wins regardless of creation
 * order; with none flagged, nothing is offered. No "newest wins" fallback — that's exactly the
 * bug (a later-created QA mock would always beat the real competition). */
export function pickCurrentSeasonCompetition<T extends { is_current_season: boolean }>(
  candidates: readonly T[],
): T | null {
  return candidates.find((row) => row.is_current_season) ?? null;
}

/** Pure — QC fix: the banner's exit link is "one exit to the league's own live season",
 * whichever competition the league actively holds, not necessarily the flagged current-season
 * one. A league whose own participation in the current-season competition is archived, but who
 * is actively playing a different competition (e.g. a QA mock a captain adopted by mistake),
 * still has a live season to exit to. Own current-season participation wins when active (the
 * common post-adoption case for real leagues, where it is also the only active row); otherwise
 * fall back to whichever OTHER competition holds an active participation. This never affects
 * the ADOPT-target resolution (`pickCurrentSeasonCompetition`/`resolveCurrentSeasonCompetition`
 * above) — only where the exit link points. */
export function pickLiveCompetitionLink(
  leagueSlug: string,
  current: { id: string; slug: string; name: string } | null,
  hasOwnCurrentSeasonParticipation: boolean,
  otherActive: { id: string; slug: string; name: string } | null,
): WcLiveCompetition | null {
  if (hasOwnCurrentSeasonParticipation && current) {
    return { id: current.id, slug: current.slug, name: current.name ?? ARCHIVE_COPY.plReturn, href: `/leagues/${leagueSlug}` };
  }
  if (otherActive) {
    return { id: otherActive.id, slug: otherActive.slug, name: otherActive.name ?? ARCHIVE_COPY.plReturn, href: `/leagues/${leagueSlug}` };
  }
  return null;
}

/** Resolves the single competition eligible as an adopt TARGET league-wide. League-independent
 * — call once per request/page and pass the result into loadLiveCompetition for every league
 * (item 9's hoist), instead of re-querying per league in a loop.
 *
 * Degrades to null (no CTA, never a wrong CTA) if `is_current_season` doesn't exist yet — the
 * migration below is written but not applied; until it is, every league sees "nothing to
 * adopt" rather than falling back to the old, unsafe "newest active competition" ordering. */
export async function resolveCurrentSeasonCompetition(admin: CashfordClient): Promise<CurrentSeasonCompetition> {
  const result = await admin
    .from("competitions")
    .select("id, slug, name, status, is_current_season")
    .eq("format", "league")
    .eq("status", "active");
  if (result.error) {
    if ((result.error as { code?: string }).code === MISSING_COLUMN_CODE) return null;
    fail(result.error, "wc-live-current-season-competition");
  }
  return pickCurrentSeasonCompetition((result.data ?? []) as any[]);
}

/** Shared across all three archive routes (analytics/matches/bracket) plus the manage page —
 * every route shows the same "Open <live competition> →" exit link when the league has an
 * active participation, and the same adoption/blocked/archived state otherwise.
 *
 * Dual-review fix (Blocker 1a + Blocker 2): resolution is league-scoped first. A league's own
 * `league_competitions` row for the current-season competition — active, archived, or absent —
 * decides `participationStatus` directly; it is never inferred from which competition happens
 * to be globally newest. `otherActiveCompetitionName` reports whichever *other* competition (if
 * any) currently holds an active participation for this league — e.g. a QA mock a captain
 * adopted by mistake — so blocked-state copy can name the thing actually blocking adoption,
 * not the target. */
export async function loadLiveCompetition(
  admin: CashfordClient,
  leagueId: string,
  slug: string,
  currentSeasonCompetition?: CurrentSeasonCompetition,
) {
  const current = currentSeasonCompetition === undefined
    ? await resolveCurrentSeasonCompetition(admin)
    : currentSeasonCompetition;

  const ownParticipation = current
    ? await admin
        .from("league_competitions")
        .select("status")
        .eq("league_id", leagueId)
        .eq("competition_id", current.id)
        .maybeSingle()
    : { data: null, error: null };
  fail(ownParticipation.error, "wc-live-own-participation");

  const otherActiveQ = await admin
    .from("league_competitions")
    .select("competition_id, competitions!inner(name, slug)")
    .eq("league_id", leagueId)
    .eq("status", "active");
  fail(otherActiveQ.error, "wc-live-other-active");
  const otherActiveRow = (otherActiveQ.data ?? []).find(
    (row: any) => !current || row.competition_id !== current.id,
  );
  const otherActiveCompetition = !!otherActiveRow;
  const otherActiveCompetitionName = otherActiveRow
    ? one<any>(otherActiveRow.competitions)?.name ?? null
    : null;

  const participationStatus: "active" | "archived" | "none" =
    ownParticipation.data?.status === "active"
      ? "active"
      : ownParticipation.data?.status === "archived"
        ? "archived"
        : "none";
  const hasParticipation = participationStatus === "active";

  const pl = { data: current, error: null };
  const plParticipation = { data: hasParticipation && current ? { competition_id: current.id } : null, error: null };
  const otherActiveCompetitionRef = otherActiveRow ? one<any>(otherActiveRow.competitions) : null;
  const liveCompetition = pickLiveCompetitionLink(
    slug,
    current,
    hasParticipation,
    otherActiveRow && otherActiveCompetitionRef
      ? { id: otherActiveRow.competition_id, slug: otherActiveCompetitionRef.slug, name: otherActiveCompetitionRef.name }
      : null,
  );

  return { pl, plParticipation, liveCompetition, otherActiveCompetition, otherActiveCompetitionName, participationStatus };
}

/** Item 2: drives the §8.4 transition matrix (preparing / captain_adopt / member_waiting /
 * adopted / blocked / archived) for a league's next-season competition, instead of the inline
 * `pl?.status === "active" && !plParticipation && isCaptain` check the archive page used to
 * reimplement.
 *
 * Dual-review fix (Blocker 2 / R2 F1): an archived participation for the current-season
 * competition always maps to "archived" — checked before the general matrix, so a league that
 * archived pl-2026-27 can never be read back as `captain_adopt` just because the competition
 * row itself is still globally active.
 *
 * Micro-round fix (D1): an archived LEAGUE (the whole league is read-only, not just its
 * participation in one competition) must also read as "archived" — checked first, before the
 * participation check, so a captain of an archived league is never shown the adopt CTA. */
export function resolveWcTransition(
  facts: {
    pl: { status: string } | null;
    participationStatus: "active" | "archived" | "none";
    otherActiveCompetition: boolean;
    leagueStatus: string;
  },
  isCaptain: boolean,
): TransitionState {
  if (facts.leagueStatus === "archived") return "archived";
  if (facts.participationStatus === "archived") return "archived";
  return transitionState({
    competitionStatus: facts.pl?.status ?? "preparing",
    hasParticipation: facts.participationStatus === "active",
    isCaptain,
    otherActiveCompetition: facts.otherActiveCompetition,
  });
}
