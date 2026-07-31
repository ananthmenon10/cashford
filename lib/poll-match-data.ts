import {
  buildMatchDataPatch,
  parseSummaryScore,
  validateSummary,
  type MatchDataBlock,
} from "./espn-summary";
import type { SummaryFetcher } from "./espn-summary-fetch";
import {
  eventsDueAt,
  lineupsDueAt,
  statsDueAt,
} from "./poll-due";
import { runPhase4Poller } from "./phase4-poll-runtime";

type Admin = ReturnType<typeof import("./supabase/service").createServiceRoleClient>;

function related<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

function fingerprint(
  home: number | null,
  away: number | null,
  revisions: number,
): string {
  return `${home ?? "null"}-${away ?? "null"}@${revisions}`;
}

export async function pollMatchData(
  admin: Admin,
  fetcher: SummaryFetcher,
  now = new Date(),
) {
  return runPhase4Poller(
    admin,
    "espn_match_data",
    { nextDueMs: 60_000 },
    async (counter) => {
      const { data: fixtures, error } = await admin
        .from("fixtures")
        .select(
          "id, external_id, kickoff_at, status, status_detail, ft_home, ft_away, finished_at, competitions!inner(espn_slug)",
        )
        .not("external_id", "is", null)
        .in("status", ["scheduled", "live", "finished", "postponed", "abandoned"]);
      if (error) throw new Error(`pollMatchData fixtures: ${error.message}`);
      const rows = (fixtures ?? []).filter((fixture: any) => fixture.kickoff_at);
      if (!rows.length) return;
      const ids = rows.map((fixture: any) => fixture.id);
      const [{ data: cache }, { data: revisionRows }] = await Promise.all([
        admin.from("fixture_match_data").select("*").in("fixture_id", ids),
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
        const timing = {
          kickoffAt: new Date(fixture.kickoff_at),
          status: fixture.status,
          finishedAt: fixture.finished_at
            ? new Date(fixture.finished_at)
            : null,
        };
        const blocks: MatchDataBlock[] = [];
        if (
          !(old?.lineups_ok && old?.lineups) &&
          lineupsDueAt(
            timing,
            old?.lineups_fetched_at ? new Date(old.lineups_fetched_at) : null,
            now,
          )
        ) {
          blocks.push("lineups");
        }
        if (
          eventsDueAt(
            timing,
            old?.key_events_fetched_at
              ? new Date(old.key_events_fetched_at)
              : null,
            now,
          )
        ) {
          blocks.push("key_events", "scorers");
        }
        if (
          statsDueAt(
            timing,
            old?.team_stats_fetched_at
              ? new Date(old.team_stats_fetched_at)
              : null,
            now,
          )
        ) {
          blocks.push("team_stats", "player_stats");
        }
        const requested = [...new Set(blocks)];
        if (!requested.length) continue;

        const summary = await fetcher.get({
          id: fixture.id,
          external_id: Number(fixture.external_id),
          espn_slug: related(fixture.competitions)?.espn_slug ?? null,
        });
        counter.fetched();
        if (!validateSummary(summary, fixture.external_id)) continue;

        const revisionCount = revisions.get(fixture.id) ?? 0;
        const currentFingerprint = fingerprint(
          fixture.ft_home,
          fixture.ft_away,
          revisionCount,
        );
        const score = parseSummaryScore(summary);
        const fetchedFingerprint = score
          ? fingerprint(score.home, score.away, revisionCount)
          : null;
        const scoreSensitive = requested.filter((block) => block !== "lineups");
        if (
          scoreSensitive.length &&
          fetchedFingerprint !== currentFingerprint &&
          fixture.ft_home != null &&
          fixture.ft_away != null
        ) {
          await counter.renew();
          const retryAt = new Date(now.getTime() + 30 * 60_000).toISOString();
          if (old) {
            const { error: staleError } = await admin
              .from("fixture_match_data")
              .update({ stale_retry_at: retryAt })
              .eq("fixture_id", fixture.id);
            if (staleError) {
              throw new Error(`pollMatchData stale count: ${staleError.message}`);
            }
          } else {
            const { error: staleError } = await admin
              .from("fixture_match_data")
              .insert({
                fixture_id: fixture.id,
                result_fingerprint: currentFingerprint,
                stale_result_reads: 1,
                stale_retry_at: retryAt,
                source_kickoff_at: fixture.kickoff_at,
              });
            if (staleError) {
              throw new Error(`pollMatchData stale insert: ${staleError.message}`);
            }
          }
          counter.wrote();
          continue;
        }

        const patch = buildMatchDataPatch(
          fixture.id,
          summary,
          requested,
          now.toISOString(),
        );
        if (requested.includes("lineups") && patch.lineups_ok === false) {
          patch.lineups_fetched_at = now.toISOString();
        }
        Object.assign(patch, {
          source_status: fixture.status_detail ?? fixture.status,
          source_version: (old?.source_version ?? 0) + 1,
          source_kickoff_at: fixture.kickoff_at,
          result_fingerprint: currentFingerprint,
          stale_result_reads: 0,
          stale_retry_at: null,
        });
        if (
          fixture.status === "finished" &&
          fixture.finished_at &&
          now.getTime() - new Date(fixture.finished_at).getTime() >= 30 * 60_000
        ) {
          Object.assign(patch, {
            frozen_at: now.toISOString(),
            freeze_reason: "final",
          });
        } else if (
          fixture.status === "postponed" ||
          fixture.status === "abandoned"
        ) {
          Object.assign(patch, {
            frozen_at: now.toISOString(),
            freeze_reason: fixture.status,
          });
        }
        await counter.renew();
        const { error: writeError } = await admin
          .from("fixture_match_data")
          .upsert(patch, { onConflict: "fixture_id" });
        if (writeError) {
          throw new Error(`pollMatchData write: ${writeError.message}`);
        }
        counter.wrote();
      }
    },
  );
}
