import { runPhase4Poller } from "./phase4-poll-runtime";

type Admin = ReturnType<typeof import("./supabase/service").createServiceRoleClient>;

export const SCORE_STAMPS = [
  "key_events_fetched_at",
  "scorers_fetched_at",
  "team_stats_fetched_at",
  "player_stats_fetched_at",
  "commentary_fetched_at",
] as const;

// Only the columns the loop below reads. `select("*")` pulled the lineups,
// player_stats, commentary and key_events JSON for every cached fixture on
// every tick (~2 MB raw, ~300 KB on the wire) and was the largest single
// source of Supabase egress in Sept 2026.
// Written as a literal, not joined from SCORE_STAMPS: supabase-js parses the
// select string at the type level, and a joined `string` loses row typing.
// The tail must stay in step with SCORE_STAMPS above.
export const RECONCILE_CACHE_COLUMNS =
  "fixture_id, source_kickoff_at, frozen_at, key_events_fetched_at, scorers_fetched_at, team_stats_fetched_at, player_stats_fetched_at, commentary_fetched_at";

function latestScoreStamp(row: Record<string, any>): number {
  return Math.max(
    0,
    ...SCORE_STAMPS.map((column) =>
      row[column] ? new Date(row[column]).getTime() : 0,
    ),
  );
}

export async function reconcileMatchCache(admin: Admin) {
  return runPhase4Poller(
    admin,
    "espn_reconcile",
    { nextDueMs: 60_000 },
    async (counter) => {
      const { data: cached, error } = await admin
        .from("fixture_match_data")
        .select(RECONCILE_CACHE_COLUMNS);
      if (error) throw new Error(`reconcile cache read: ${error.message}`);
      if (!cached?.length) return;
      const ids = cached.map((row: any) => row.fixture_id);
      const [{ data: fixtures }, { data: revisions }] = await Promise.all([
        admin
          .from("fixtures")
          .select("id, kickoff_at, ft_home, ft_away")
          .in("id", ids),
        admin
          .from("result_revisions")
          .select("fixture_id, observed_at")
          .in("fixture_id", ids),
      ]);
      const fixtureById = new Map(
        (fixtures ?? []).map((fixture: any) => [fixture.id, fixture]),
      );
      const revisionById = new Map<string, any[]>();
      for (const revision of revisions ?? []) {
        const rows = revisionById.get(revision.fixture_id) ?? [];
        rows.push(revision);
        revisionById.set(revision.fixture_id, rows);
      }

      for (const row of cached) {
        const fixture: any = fixtureById.get(row.fixture_id);
        if (!fixture) continue;
        const sourceKickoff = row.source_kickoff_at
          ? new Date(row.source_kickoff_at).getTime()
          : null;
        const currentKickoff = fixture.kickoff_at
          ? new Date(fixture.kickoff_at).getTime()
          : null;
        const kickoffChanged = sourceKickoff !== currentKickoff;
        const cutoff = row.frozen_at
          ? new Date(row.frozen_at).getTime()
          : latestScoreStamp(row);
        const newerRevision = (revisionById.get(row.fixture_id) ?? []).some(
          (revision) => new Date(revision.observed_at).getTime() > cutoff,
        );
        if (!kickoffChanged && !newerRevision) continue;
        const revisionCount = (revisionById.get(row.fixture_id) ?? []).length;
        const patch: Record<string, unknown> = {
          key_events_ok: false,
          scorers_ok: false,
          team_stats_ok: false,
          player_stats_ok: false,
          commentary_ok: false,
          frozen_at: null,
          freeze_reason: null,
          result_fingerprint: `${fixture.ft_home ?? "null"}-${fixture.ft_away ?? "null"}@${revisionCount}`,
        };
        if (kickoffChanged) {
          patch.source_kickoff_at = fixture.kickoff_at;
        }
        await counter.renew();
        const { error: writeError } = await admin
          .from("fixture_match_data")
          .update(patch)
          .eq("fixture_id", row.fixture_id);
        if (writeError) {
          throw new Error(`reconcile cache write: ${writeError.message}`);
        }
        counter.wrote();
      }
    },
  );
}
