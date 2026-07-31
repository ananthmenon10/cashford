import {
  buildInsightsRow,
  parseForm,
  parseH2H,
  parseOdds,
  parseStandings,
} from "./espn-insights";
import { modelFromOdds } from "./odds-model";
import {
  contextDueAt,
  oddsDueAt,
} from "./poll-due";
import {
  runPhase4Poller,
  runPhase4PollerWithClaim,
} from "./phase4-poll-runtime";
import type { PollCounter } from "./phase4-poll-runtime";
import type { SummaryFetcher } from "./espn-summary-fetch";
import { validateSummary } from "./espn-summary";

type Admin = ReturnType<typeof import("./supabase/service").createServiceRoleClient>;

const HOUR = 3_600_000;

function related<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

export async function pollInsightsLeased(
  admin: Admin,
  fetcher: SummaryFetcher,
  now = new Date(),
  claimedToken?: string,
) {
  const work = async (counter: PollCounter) => {
      const until = new Date(now.getTime() + 5 * 24 * HOUR).toISOString();
      const { data: fixtures, error } = await admin
        .from("fixtures")
        .select(
          "id, external_id, kickoff_at, status, competitions!inner(espn_slug)",
        )
        .eq("status", "scheduled")
        .not("external_id", "is", null)
        .not("home_team_id", "is", null)
        .not("away_team_id", "is", null)
        .gt("kickoff_at", now.toISOString())
        .lte("kickoff_at", until);
      if (error) throw new Error(`pollInsights fixtures: ${error.message}`);
      const rows = fixtures ?? [];
      if (!rows.length) return;
      const { data: cached, error: cacheError } = await admin
        .from("fixture_insights")
        .select(
          "fixture_id, odds_fetched_at, form_fetched_at, h2h_fetched_at, table_fetched_at",
        )
        .in("fixture_id", rows.map((row: any) => row.id));
      if (cacheError) {
        throw new Error(`pollInsights cache: ${cacheError.message}`);
      }
      const byId = new Map((cached ?? []).map((row: any) => [row.fixture_id, row]));

      for (const fixture of rows) {
        const kickoffAt = new Date(fixture.kickoff_at);
        const old: any = byId.get(fixture.id);
        const timing = { kickoffAt, status: fixture.status };
        const oddsDue = oddsDueAt(
          timing,
          old?.odds_fetched_at ? new Date(old.odds_fetched_at) : null,
          now,
        );
        const formDue = contextDueAt(
          timing,
          old?.form_fetched_at ? new Date(old.form_fetched_at) : null,
          now,
        );
        const h2hDue = contextDueAt(
          timing,
          old?.h2h_fetched_at ? new Date(old.h2h_fetched_at) : null,
          now,
        );
        const tableDue = contextDueAt(
          timing,
          old?.table_fetched_at ? new Date(old.table_fetched_at) : null,
          now,
        );
        if (!oddsDue && !formDue && !h2hDue && !tableDue) continue;

        const summary = await fetcher.get({
          id: fixture.id,
          external_id: Number(fixture.external_id),
          espn_slug: related(fixture.competitions)?.espn_slug ?? null,
        });
        counter.fetched();
        const stamp = now.toISOString();
        const patch: Record<string, unknown> = {
          fixture_id: fixture.id,
        };

        if (oddsDue) {
          patch.odds_fetched_at = stamp;
          patch.model_fetched_at = stamp;
          patch.odds_ok = false;
          patch.model_ok = false;
        }
        if (formDue) {
          patch.form_fetched_at = stamp;
          patch.form_ok = false;
        }
        if (h2hDue) {
          patch.h2h_fetched_at = stamp;
          patch.h2h_ok = false;
        }
        if (tableDue) {
          patch.table_fetched_at = stamp;
          patch.table_ok = false;
        }

        if (!validateSummary(summary, fixture.external_id)) {
          await counter.renew();
          const { error: attemptError } = await admin
            .from("fixture_insights")
            .upsert(patch, { onConflict: "fixture_id" });
          if (attemptError) {
            throw new Error(`pollInsights attempt write: ${attemptError.message}`);
          }
          counter.wrote();
          continue;
        }
        patch.fetched_at = stamp;

        if (oddsDue) {
          const odds = parseOdds(summary);
          const model = odds ? modelFromOdds(odds) : null;
          patch.odds_ok = odds !== null;
          patch.model_ok = model !== null;
          if (odds) {
            const full = buildInsightsRow(fixture.id, summary);
            Object.assign(patch, {
              ml_home: full.ml_home,
              ml_draw: full.ml_draw,
              ml_away: full.ml_away,
              total_line: full.total_line,
              provider: full.provider,
            });
          }
          if (model) {
            const full = buildInsightsRow(fixture.id, summary);
            Object.assign(patch, {
              p_home: full.p_home,
              p_draw: full.p_draw,
              p_away: full.p_away,
              lambda_home: full.lambda_home,
              lambda_away: full.lambda_away,
              top_scores: full.top_scores,
              p_btts: full.p_btts,
              p_cs_home: full.p_cs_home,
              p_cs_away: full.p_cs_away,
              p_over: full.p_over,
              odds_available: true,
              model_source_kickoff_at: fixture.kickoff_at,
            });
          } else {
            patch.odds_available = false;
          }
        }

        if (formDue) {
          const form = parseForm(summary);
          const valid = form.home.length > 0 || form.away.length > 0;
          patch.form_ok = valid;
          if (valid) {
            patch.form_home = form.home;
            patch.form_away = form.away;
          }
        }
        if (h2hDue) {
          const h2h = parseH2H(summary);
          patch.h2h_ok = h2h.games.length > 0;
          if (h2h.games.length) {
            patch.h2h = h2h;
          }
        }
        if (tableDue) {
          const table = parseStandings(summary);
          patch.table_ok = table !== null;
          if (table) {
            patch.standings = table;
          }
        }

        await counter.renew();
        const { error: writeError } = await admin
          .from("fixture_insights")
          .upsert(patch, { onConflict: "fixture_id" });
        if (writeError) {
          throw new Error(`pollInsights write: ${writeError.message}`);
        }
        counter.wrote();
      }
  };
  return claimedToken
    ? runPhase4PollerWithClaim(
        admin,
        "espn_insights",
        { nextDueMs: 10 * 60_000 },
        work,
        claimedToken,
      )
    : runPhase4Poller(
        admin,
        "espn_insights",
        { nextDueMs: 10 * 60_000 },
        work,
      );
}
