import type { SupabaseClient } from "@supabase/supabase-js";
import { activeCompetitions } from "./gw-invites";

type CashfordClient = SupabaseClient<any, "cashford", any>;

export type CreatableCompetition = {
  slug: string;
  name: string;
  format: string;
  nextGameweekNumber: number | null;
  nextDeadlineAt: string | null;
};

function fail(error: { message?: string } | null, context: string) {
  if (error) throw new Error(`${context}: ${error.message ?? "query-failed"}`);
}

/** The read path used by the slug availability check on the new-league page. */
export async function isLeagueSlugAvailable(
  admin: CashfordClient,
  slug: string,
): Promise<boolean> {
  const query = await admin
    .from("leagues")
    .select("id")
    .eq("slug", slug)
    .maybeSingle();
  fail(query.error, "check-slug");
  return query.data === null;
}

/** The read path used by app/leagues/new/page.tsx through its server action. */
export async function loadCreatableCompetitions(
  admin: CashfordClient,
): Promise<CreatableCompetition[]> {
  const competitionsQuery = await admin
    .from("competitions")
    .select("slug, name, format, status")
    .order("created_at", { ascending: false });
  fail(competitionsQuery.error, "list-creatable-competitions");

  const active = activeCompetitions(competitionsQuery.data ?? []);
  return Promise.all(
    active.map(async ({ slug, name, format }: any) => {
      const competition = await admin
        .from("competitions")
        .select("id")
        .eq("slug", slug)
        .single();
      fail(competition.error, "creatable-competition");
      if (!competition.data) throw new Error("creatable-competition: missing row");

      const next = await admin
        .from("gameweeks")
        .select("number, deadline_at")
        .eq("competition_id", competition.data.id)
        .eq("status", "open")
        .gt("deadline_at", new Date().toISOString())
        .order("number", { ascending: true })
        .limit(1)
        .maybeSingle();
      fail(next.error, "creatable-deadline");

      return {
        slug,
        name,
        format,
        nextGameweekNumber: next.data?.number ?? null,
        nextDeadlineAt: next.data?.deadline_at ?? null,
      };
    }),
  );
}
