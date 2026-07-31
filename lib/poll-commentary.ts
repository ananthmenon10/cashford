import {
  buildMatchDataPatch,
  parseSummaryScore,
  validateSummary,
} from "./espn-summary";
import type { SummaryFetcher } from "./espn-summary-fetch";
import { commentaryDueAt } from "./poll-due";
import { runPhase4Poller } from "./phase4-poll-runtime";

type Admin = ReturnType<typeof import("./supabase/service").createServiceRoleClient>;

function related<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

export async function pollCommentary(
  admin: Admin,
  fetcher: SummaryFetcher,
  now = new Date(),
) {
  return runPhase4Poller(
    admin,
    "espn_commentary",
    { nextDueMs: 10 * 60_000 },
    async (counter) => {
      const { data: fixtures, error } = await admin
        .from("fixtures")
        .select(
          "id, external_id, kickoff_at, status, ft_home, ft_away, finished_at, competitions!inner(espn_slug)",
        )
        .eq("status", "finished")
        .not("external_id", "is", null);
      if (error) throw new Error(`pollCommentary fixtures: ${error.message}`);
      const rows = fixtures ?? [];
      if (!rows.length) return;
      const ids = rows.map((fixture: any) => fixture.id);
      const [{ data: cache }, { data: revisionRows }] = await Promise.all([
        admin
          .from("fixture_match_data")
          .select(
            "fixture_id, commentary_fetched_at, source_version, stale_retry_at, frozen_at",
          )
          .in("fixture_id", ids),
        admin.from("result_revisions").select("fixture_id").in("fixture_id", ids),
      ]);
      const byId = new Map((cache ?? []).map((row: any) => [row.fixture_id, row]));
      const revisions = new Map<string, number>();
      for (const row of revisionRows ?? []) {
        revisions.set(row.fixture_id, (revisions.get(row.fixture_id) ?? 0) + 1);
      }

      for (const fixture of rows) {
        const old: any = byId.get(fixture.id);
        if (old?.frozen_at) continue;
        if (old?.stale_retry_at && new Date(old.stale_retry_at) > now) continue;
        const due = commentaryDueAt(
          {
            kickoffAt: fixture.kickoff_at
              ? new Date(fixture.kickoff_at)
              : null,
            status: fixture.status,
            finishedAt: fixture.finished_at
              ? new Date(fixture.finished_at)
              : null,
          },
          old?.commentary_fetched_at
            ? new Date(old.commentary_fetched_at)
            : null,
          now,
        );
        if (!due) continue;
        const summary = await fetcher.get({
          id: fixture.id,
          external_id: Number(fixture.external_id),
          espn_slug: related(fixture.competitions)?.espn_slug ?? null,
        });
        counter.fetched();
        if (!validateSummary(summary, fixture.external_id)) continue;
        const score = parseSummaryScore(summary);
        if (
          !score ||
          score.home !== fixture.ft_home ||
          score.away !== fixture.ft_away
        ) {
          const retryAt = new Date(now.getTime() + 30 * 60_000).toISOString();
          await counter.renew();
          const staleWrite = old
            ? admin
                .from("fixture_match_data")
                .update({ stale_retry_at: retryAt })
                .eq("fixture_id", fixture.id)
            : admin.from("fixture_match_data").insert({
                fixture_id: fixture.id,
                result_fingerprint: `${fixture.ft_home ?? "null"}-${fixture.ft_away ?? "null"}@${revisions.get(fixture.id) ?? 0}`,
                stale_result_reads: 1,
                stale_retry_at: retryAt,
                source_kickoff_at: fixture.kickoff_at,
              });
          const { error: staleError } = await staleWrite;
          if (staleError) {
            throw new Error(`pollCommentary stale count: ${staleError.message}`);
          }
          counter.wrote();
          continue;
        }
        const patch = buildMatchDataPatch(
          fixture.id,
          summary,
          ["commentary"],
          now.toISOString(),
        );
        Object.assign(patch, {
          source_kickoff_at: fixture.kickoff_at,
          source_version: (old?.source_version ?? 0) + 1,
          result_fingerprint: `${score.home}-${score.away}@${revisions.get(fixture.id) ?? 0}`,
          stale_result_reads: 0,
          stale_retry_at: null,
        });
        await counter.renew();
        const { error: writeError } = await admin
          .from("fixture_match_data")
          .upsert(patch, { onConflict: "fixture_id" });
        if (writeError) {
          throw new Error(`pollCommentary write: ${writeError.message}`);
        }
        counter.wrote();
      }
    },
  );
}
