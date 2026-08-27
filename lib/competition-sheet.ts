import type { SupabaseClient } from "@supabase/supabase-js";

export type CompetitionSheetItem = {
  competitionId: string;
  slug: string;
  name: string;
  format: "league" | "cup" | "gameweek";
  participationStatus: "active" | "archived";
  joinedAt: string;
  href?: string;
};

export type CompetitionSheetDTO = { leagueSlug: string; items: CompetitionSheetItem[] };

export function buildCompetitionSheet(
  leagueSlug: string,
  rows: readonly Omit<CompetitionSheetItem, "href">[],
): CompetitionSheetDTO {
  const items = [...rows].sort((a, b) =>
    (a.participationStatus === b.participationStatus
      ? 0
      : a.participationStatus === "archived"
        ? 1
        : -1) ||
    new Date(b.joinedAt).getTime() - new Date(a.joinedAt).getTime() ||
    a.slug.localeCompare(b.slug),
  ).map((item) => ({
    ...item,
    href: item.participationStatus === "active"
      ? `/leagues/${leagueSlug}`
      : item.slug === "wc2026"
        ? `/leagues/${leagueSlug}/archive/wc2026`
        : undefined,
  }));
  return { leagueSlug, items };
}

export async function loadCompetitionSheet(
  client: SupabaseClient<any, "cashford", any>,
  leagueId: string,
  leagueSlug: string,
): Promise<CompetitionSheetDTO> {
  const query = await client.from("league_competitions").select(
    "competition_id, status, joined_at, competitions!inner(slug, name, format)",
  ).eq("league_id", leagueId);
  if (query.error) throw new Error(`competition-sheet: ${query.error.message}`);
  return buildCompetitionSheet(leagueSlug, (query.data ?? []).map((row: any) => {
    const competition = Array.isArray(row.competitions) ? row.competitions[0] : row.competitions;
    return {
      competitionId: row.competition_id,
      slug: competition.slug,
      name: competition.name,
      format: competition.format,
      participationStatus: row.status,
      joinedAt: row.joined_at,
    };
  }));
}
