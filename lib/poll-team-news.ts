import {
  parseAvailability,
  teamNewsForFixture,
} from "./fpl-availability";
import { teamNewsDueAt } from "./poll-due";
import { runPhase4Poller } from "./phase4-poll-runtime";

type Admin = ReturnType<typeof import("./supabase/service").createServiceRoleClient>;

const BOOTSTRAP =
  "https://fantasy.premierleague.com/api/bootstrap-static/";

async function fetchBootstrap(): Promise<unknown | null> {
  try {
    const response = await fetch(BOOTSTRAP, {
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    return response.ok ? response.json() : null;
  } catch {
    return null;
  }
}

export async function pollTeamNews(admin: Admin, now = new Date()) {
  return runPhase4Poller(
    admin,
    "team_news",
    { nextDueMs: 10 * 60_000 },
    async (counter) => {
      const from = now.toISOString();
      const until = new Date(now.getTime() + 48 * 3_600_000).toISOString();
      const { data: fixtures, error } = await admin
        .from("fixtures")
        .select("id, kickoff_at, home_team_id, away_team_id")
        .eq("status", "scheduled")
        .gt("kickoff_at", from)
        .lte("kickoff_at", until);
      if (error) throw new Error(`pollTeamNews fixtures: ${error.message}`);
      if (!fixtures?.length) return;
      const { data: cached, error: cacheError } = await admin
        .from("fixture_insights")
        .select("fixture_id, team_news_fetched_at")
        .in("fixture_id", fixtures.map((fixture: any) => fixture.id));
      if (cacheError) {
        throw new Error(`pollTeamNews cache: ${cacheError.message}`);
      }
      const cachedById = new Map(
        (cached ?? []).map((row: any) => [row.fixture_id, row]),
      );
      const due = fixtures.filter((fixture: any) =>
        teamNewsDueAt(
          {
            kickoffAt: fixture.kickoff_at
              ? new Date(fixture.kickoff_at)
              : null,
          },
          cachedById.get(fixture.id)?.team_news_fetched_at
            ? new Date(cachedById.get(fixture.id).team_news_fetched_at)
            : null,
          now,
        ),
      );
      if (!due.length) return;

      const bootstrap = await fetchBootstrap();
      counter.fetched();
      const availability = parseAvailability(bootstrap);
      const { data: mappings, error: mappingError } = await admin
        .from("team_provider_ids")
        .select("team_id, provider_key")
        .eq("provider", "fpl")
        .eq("season", "2026-27");
      if (mappingError) {
        throw new Error(`pollTeamNews mappings: ${mappingError.message}`);
      }
      const fplByTeam = new Map(
        (mappings ?? []).map((row: any) => [
          row.team_id,
          Number(row.provider_key),
        ]),
      );
      const payloadMappingComplete =
        availability !== null &&
        [...new Set(availability.map((row) => row.fplTeamId))].every((id) =>
          (mappings ?? []).some(
            (row: any) => Number(row.provider_key) === id,
          ),
        );

      for (const fixture of due) {
        const homeFplId = fplByTeam.get(fixture.home_team_id);
        const awayFplId = fplByTeam.get(fixture.away_team_id);
        await counter.renew();
        if (
          !availability ||
          !payloadMappingComplete ||
          !homeFplId ||
          !awayFplId
        ) {
          const { error: failureError } = await admin
            .from("fixture_insights")
            .upsert(
              { fixture_id: fixture.id, team_news_ok: false },
              { onConflict: "fixture_id" },
            );
          if (failureError) {
            throw new Error(`pollTeamNews failure write: ${failureError.message}`);
          }
          counter.wrote();
          continue;
        }
        const news = teamNewsForFixture(
          availability,
          homeFplId,
          awayFplId,
        );
        const { error: writeError } = await admin
          .from("fixture_insights")
          .upsert(
            {
              fixture_id: fixture.id,
              team_news: news,
              team_news_ok: true,
              team_news_source: "FPL",
              team_news_fetched_at: now.toISOString(),
            },
            { onConflict: "fixture_id" },
          );
        if (writeError) {
          throw new Error(`pollTeamNews write: ${writeError.message}`);
        }
        counter.wrote();
      }
    },
  );
}
