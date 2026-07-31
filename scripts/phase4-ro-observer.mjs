import pg from "pg";
import {
  isPhase4SyncKey,
  PHASE4_SYNC_KEYS,
} from "../lib/poll-keys.ts";

const LABELS = {
  espn_insights: "insights",
  espn_match_data: "matchData",
  espn_commentary: "commentary",
  espn_standings: "standings",
  derived_standings: "derivedStandings",
  espn_reconcile: "reconcile",
  team_news: "teamNews",
  understat_xg: "understat",
  fotmob_slow: "fotmob",
};
const ROUTE_ORDER = [
  "espn_insights",
  "espn_reconcile",
  "espn_match_data",
  "espn_commentary",
  "espn_standings",
  "derived_standings",
  "team_news",
  "understat_xg",
  "fotmob_slow",
];
const ALLOWED_TABLES = [
  "fixture_insights",
  "competition_standings",
  "fixture_match_data",
  "fixture_provider_data",
  "fixture_provider_ids",
  "provider_samples",
  "sync_issues",
];
const TABLE_KEYS = {
  fixture_insights: ["fixture_id"],
  competition_standings: ["competition_id", "source"],
  fixture_match_data: ["fixture_id"],
  fixture_provider_data: ["fixture_id", "provider"],
  fixture_provider_ids: ["fixture_id", "provider"],
  provider_samples: ["id"],
  sync_issues: ["id"],
};
const SYNC_COLUMNS = [
  "last_run_at",
  "next_due_at",
  "lease_until",
  "lease_token",
];
const INSIGHTS_COLUMNS = [
  "ml_home",
  "ml_draw",
  "ml_away",
  "total_line",
  "provider",
  "p_home",
  "p_draw",
  "p_away",
  "lambda_home",
  "lambda_away",
  "top_scores",
  "p_btts",
  "p_cs_home",
  "p_cs_away",
  "p_over",
  "form_home",
  "form_away",
  "h2h",
  "standings",
  "odds_available",
  "fetched_at",
  "odds_fetched_at",
  "odds_ok",
  "model_fetched_at",
  "model_ok",
  "model_source_kickoff_at",
  "form_fetched_at",
  "form_ok",
  "h2h_fetched_at",
  "h2h_ok",
  "table_fetched_at",
  "table_ok",
];
const TEAM_NEWS_COLUMNS = [
  "team_news",
  "team_news_fetched_at",
  "team_news_source",
  "team_news_ok",
];
const MATCH_DATA_COLUMNS = [
  "key_events",
  "scorers",
  "team_stats",
  "player_stats",
  "commentary",
  "lineups",
  "key_events_fetched_at",
  "key_events_ok",
  "scorers_fetched_at",
  "scorers_ok",
  "team_stats_fetched_at",
  "team_stats_ok",
  "player_stats_fetched_at",
  "player_stats_ok",
  "commentary_fetched_at",
  "commentary_ok",
  "lineups_fetched_at",
  "lineups_ok",
  "stale_result_reads",
  "stale_retry_at",
  "freeze_reason",
  "frozen_at",
  "source_status",
  "source_version",
  "source_kickoff_at",
  "result_fingerprint",
];
const STANDINGS_COLUMNS = ["rows", "note", "fetched_at"];
const PROVIDER_DATA_COLUMNS = [
  "xg_home",
  "xg_away",
  "xg_model",
  "xg_detail",
  "shots",
  "ratings",
  "ratings_provider",
  "potm",
  "momentum",
  "momentum_provider",
  "insight_facts",
  "predicted_xi",
  "xg_fetched_at",
  "xg_ok",
  "shots_fetched_at",
  "shots_ok",
  "ratings_fetched_at",
  "ratings_ok",
  "momentum_fetched_at",
  "momentum_ok",
  "facts_fetched_at",
  "facts_ok",
  "predicted_xi_fetched_at",
  "predicted_xi_ok",
  "fetched_at",
  "attempts",
  "last_error",
  "last_status",
  "tried_at",
];
const PROVIDER_ID_COLUMNS = ["external_id", "confidence", "matched_on", "created_at"];
const PROVIDER_SAMPLE_ENDPOINTS = {
  understat_xg: ["leagueData", "match"],
  fotmob_slow: ["matches", "matchDetails"],
};
const PHASE4_WRITE_COLUMNS = {
  espn_insights: { fixture_insights: INSIGHTS_COLUMNS },
  espn_match_data: { fixture_match_data: MATCH_DATA_COLUMNS },
  espn_commentary: { fixture_match_data: MATCH_DATA_COLUMNS },
  espn_standings: { competition_standings: STANDINGS_COLUMNS },
  derived_standings: { competition_standings: STANDINGS_COLUMNS },
  espn_reconcile: {
    fixture_match_data: [
      "key_events_ok",
      "scorers_ok",
      "team_stats_ok",
      "player_stats_ok",
      "commentary_ok",
      "frozen_at",
      "freeze_reason",
      "result_fingerprint",
      "source_kickoff_at",
    ],
  },
  team_news: { fixture_insights: TEAM_NEWS_COLUMNS },
  understat_xg: {
    fixture_provider_ids: PROVIDER_ID_COLUMNS,
    fixture_provider_data: PROVIDER_DATA_COLUMNS,
    provider_samples: ["provider", "endpoint", "ref", "status", "bytes", "body", "fetched_at"],
    sync_issues: ["source", "kind", "ref", "detail", "created_at", "resolved_at"],
  },
  fotmob_slow: {
    fixture_provider_ids: PROVIDER_ID_COLUMNS,
    fixture_provider_data: PROVIDER_DATA_COLUMNS,
    provider_samples: ["provider", "endpoint", "ref", "status", "bytes", "body", "fetched_at"],
    sync_issues: ["source", "kind", "ref", "detail", "created_at", "resolved_at"],
  },
};
const LEGACY_INSIGHTS_COLUMNS = [
  ...INSIGHTS_COLUMNS,
  ...TEAM_NEWS_COLUMNS,
];
const DETAIL_WRITES_PER_FIXTURE = 3;
const DISCOVERY_WRITES_PER_CALL = 2;
const REMAP_WRITES_PER_FIXTURE = 2;
const MAX_PROVIDER_CALLS = 12;
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

function argument(name) {
  const index = process.argv.indexOf(name);
  return index < 0 ? null : process.argv[index + 1] ?? null;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function stable(value) {
  return JSON.stringify(value);
}

function isInfinity(value) {
  return value === "infinity" || value === Infinity;
}

function timestamp(value) {
  return value == null ? NaN : new Date(value).getTime();
}

function age(value, now) {
  return value ? now.getTime() - timestamp(value) : Infinity;
}

function syncByKey(snapshot) {
  return new Map(snapshot.syncState.map((row) => [row.key, row]));
}

function rowKey(table, row) {
  return stable(TABLE_KEYS[table].map((column) => row?.[column] ?? null));
}

function rowsByKey(table, rows) {
  return new Map(rows.map((row) => [rowKey(table, row), row]));
}

function changedColumns(before, after) {
  return [...new Set([
    ...Object.keys(before ?? {}),
    ...Object.keys(after ?? {}),
  ])].filter((column) => stable(before?.[column]) !== stable(after?.[column]));
}

function allChangedColumns(before, after) {
  return changedColumns(before, after);
}

function ladderInterval(kickoffAt, now) {
  const remaining = kickoffAt.getTime() - now.getTime();
  if (remaining <= 2 * 3_600_000) return 10 * 60_000;
  if (remaining <= 24 * 3_600_000) return 3_600_000;
  return 6 * 3_600_000;
}

// Keep these predicates byte-for-byte aligned with lib/poll-due.ts. This script runs
// directly under node, while that TypeScript module has an extensionless internal import.
function until(fixture, now) {
  return fixture.kickoffAt
    ? fixture.kickoffAt.getTime() - now.getTime()
    : null;
}

function eventsDueAt(fixture, lastFetchedAt, now) {
  const remaining = until(fixture, now);
  if (remaining == null || remaining > 5 * MINUTE) return false;
  if (fixture.status === "finished") {
    if (!fixture.finishedAt) return false;
    const sinceFinish = now.getTime() - fixture.finishedAt.getTime();
    if (sinceFinish < 5 * MINUTE) return false;
    const passAt =
      sinceFinish >= 30 * MINUTE
        ? fixture.finishedAt.getTime() + 30 * MINUTE
        : fixture.finishedAt.getTime() + 5 * MINUTE;
    return lastFetchedAt == null || lastFetchedAt.getTime() < passAt;
  }
  return fixture.status === "live" && age(lastFetchedAt, now) >= MINUTE;
}

function lineupsDueAt(fixture, lastFetchedAt, now) {
  const remaining = until(fixture, now);
  if (remaining == null || remaining > 90 * MINUTE || remaining <= 0) return false;
  return age(lastFetchedAt, now) >= 5 * MINUTE;
}

function statsDueAt(fixture, lastFetchedAt, now) {
  if (fixture.status === "live") return age(lastFetchedAt, now) >= 2 * MINUTE;
  return eventsDueAt(fixture, lastFetchedAt, now);
}

function fixtureMap(snapshot) {
  return new Map(snapshot.fixtureRows.map((row) => [row.id, row]));
}

function competitionMap(snapshot) {
  return new Map(snapshot.competitionRows.map((row) => [row.id, row]));
}

function fixtureInsightsDue(snapshot, now, legacy = false) {
  const cache = new Map(
    snapshot.allowedState.fixture_insights.map((row) => [row.fixture_id, row]),
  );
  const until = now.getTime() + 5 * 24 * 3_600_000;
  return new Set(snapshot.fixtureRows.filter((fixture) => {
    const kickoff = timestamp(fixture.kickoff_at);
    if (
      fixture.status !== "scheduled" ||
      fixture.external_id == null ||
      fixture.home_team_id == null ||
      fixture.away_team_id == null ||
      !Number.isFinite(kickoff) ||
      kickoff <= now.getTime() - (legacy ? 30 * 60_000 : 0) ||
      kickoff > until
    ) return false;
    const row = cache.get(fixture.id);
    if (legacy) return !row?.fetched_at || age(row.fetched_at, now) >= 3 * 3_600_000;
    return (
      age(row?.odds_fetched_at, now) >= ladderInterval(new Date(kickoff), now) ||
      age(row?.form_fetched_at, now) >= 3_600_000 ||
      age(row?.h2h_fetched_at, now) >= 3_600_000 ||
      age(row?.table_fetched_at, now) >= 3_600_000
    );
  }).map((fixture) => fixture.id));
}

function teamNewsDue(snapshot, now) {
  const cache = new Map(
    snapshot.allowedState.fixture_insights.map((row) => [row.fixture_id, row]),
  );
  return new Set(snapshot.fixtureRows.filter((fixture) => {
    const remaining = timestamp(fixture.kickoff_at) - now.getTime();
    if (
      fixture.status !== "scheduled" ||
      !Number.isFinite(remaining) ||
      remaining <= 0 ||
      remaining > 48 * 3_600_000
    ) return false;
    const cadence = remaining <= 3 * 3_600_000 ? 10 * 60_000 : 30 * 60_000;
    return age(cache.get(fixture.id)?.team_news_fetched_at, now) >= cadence;
  }).map((fixture) => fixture.id));
}

function matchDataDue(snapshot, now) {
  const cache = new Map(
    snapshot.allowedState.fixture_match_data.map((row) => [row.fixture_id, row]),
  );
  const competitions = competitionMap(snapshot);
  return new Set(snapshot.fixtureRows.filter((fixture) => {
    if (
      fixture.external_id == null ||
      !["scheduled", "live", "finished", "postponed", "abandoned"].includes(fixture.status) ||
      !fixture.kickoff_at ||
      !competitions.has(fixture.competition_id)
    ) return false;
    const row = cache.get(fixture.id);
    if (row?.frozen_at || (row?.stale_retry_at && timestamp(row.stale_retry_at) > now.getTime())) {
      return false;
    }
    const timing = {
      kickoffAt: new Date(fixture.kickoff_at),
      status: fixture.status,
      finishedAt: fixture.finished_at ? new Date(fixture.finished_at) : null,
    };
    return (
      (!(row?.lineups_ok && row?.lineups) && lineupsDueAt(
        timing,
        row?.lineups_fetched_at ? new Date(row.lineups_fetched_at) : null,
        now,
      )) ||
      eventsDueAt(
        timing,
        row?.key_events_fetched_at ? new Date(row.key_events_fetched_at) : null,
        now,
      ) ||
      statsDueAt(
        timing,
        row?.team_stats_fetched_at ? new Date(row.team_stats_fetched_at) : null,
        now,
      )
    );
  }).map((fixture) => fixture.id));
}

function commentaryDue(snapshot, now) {
  const cache = new Map(
    snapshot.allowedState.fixture_match_data.map((row) => [row.fixture_id, row]),
  );
  return new Set(snapshot.fixtureRows.filter((fixture) => {
    const row = cache.get(fixture.id);
    return fixture.status === "finished" &&
      fixture.external_id != null &&
      Number.isFinite(timestamp(fixture.finished_at)) &&
      now.getTime() - timestamp(fixture.finished_at) >= 10 * 60_000 &&
      !row?.frozen_at &&
      !(row?.stale_retry_at && timestamp(row.stale_retry_at) > now.getTime()) &&
      !row?.commentary_fetched_at;
  }).map((fixture) => fixture.id));
}

function reconcileDue(snapshot, now) {
  const fixtures = fixtureMap(snapshot);
  const newestRevision = new Map();
  for (const row of snapshot.revisionRows) {
    const current = newestRevision.get(row.fixture_id);
    if (!current || timestamp(row.observed_at) > timestamp(current)) {
      newestRevision.set(row.fixture_id, row.observed_at);
    }
  }
  return new Set(snapshot.allowedState.fixture_match_data.filter((row) => {
    const fixture = fixtures.get(row.fixture_id);
    if (!fixture) return false;
    const sourceKickoff = row.source_kickoff_at ? timestamp(row.source_kickoff_at) : null;
    const currentKickoff = fixture.kickoff_at ? timestamp(fixture.kickoff_at) : null;
    const cutoff = row.frozen_at
      ? timestamp(row.frozen_at)
      : Math.max(0, ...[
        "key_events_fetched_at",
        "scorers_fetched_at",
        "team_stats_fetched_at",
        "player_stats_fetched_at",
        "commentary_fetched_at",
      ].map((column) => timestamp(row[column])));
    return sourceKickoff !== currentKickoff ||
      (newestRevision.has(row.fixture_id) && timestamp(newestRevision.get(row.fixture_id)) > cutoff) ||
      false && now;
  }).map((row) => row.fixture_id));
}

function providerDue(snapshot, key, now) {
  const provider = key === "understat_xg" ? "understat" : "fotmob";
  const competitions = competitionMap(snapshot);
  const ids = new Map(
    snapshot.allowedState.fixture_provider_ids
      .filter((row) => row.provider === provider)
      .map((row) => [row.fixture_id, row]),
  );
  const data = new Map(
    snapshot.allowedState.fixture_provider_data
      .filter((row) => row.provider === provider)
      .map((row) => [row.fixture_id, row]),
  );
  const due = new Set();
  const discoveryGroups = new Map();
  for (const fixture of snapshot.fixtureRows) {
    const old = data.get(fixture.id);
    let isDue = false;
    if (key === "understat_xg") {
      const competition = competitions.get(fixture.competition_id);
      isDue = competition?.slug === "pl-2026-27" &&
        fixture.status === "finished" &&
        Number.isFinite(timestamp(fixture.finished_at)) &&
        timestamp(fixture.finished_at) <= now.getTime() - 2 * 3_600_000;
      if (isDue && (!ids.get(fixture.id) || ids.get(fixture.id)?.matched_on?.date !== fixture.kickoff_at?.slice(0, 10))) {
        discoveryGroups.set("understat", (discoveryGroups.get("understat") ?? 0) + 1);
      }
    } else {
      const open = fixture.status === "scheduled" &&
        timestamp(fixture.kickoff_at) > now.getTime() &&
        timestamp(fixture.kickoff_at) <= now.getTime() + 24 * 3_600_000 &&
        !old?.tried_at;
      const post = fixture.status === "finished" &&
        Number.isFinite(timestamp(fixture.finished_at)) &&
        timestamp(fixture.finished_at) <= now.getTime() &&
        !(old?.last_error == null && old?.fetched_at && timestamp(old.fetched_at) >= timestamp(fixture.kickoff_at)) &&
        (!old?.tried_at || timestamp(old.tried_at) <= now.getTime());
      isDue = open || post;
      if (isDue && (!ids.get(fixture.id) || ids.get(fixture.id)?.matched_on?.date !== fixture.kickoff_at?.slice(0, 10))) {
        const date = fixture.kickoff_at?.slice(0, 10).replaceAll("-", "") ?? "unknown";
        discoveryGroups.set(date, (discoveryGroups.get(date) ?? 0) + 1);
      }
    }
    if (isDue) due.add(fixture.id);
  }
  const discoveryCalls = Math.min(MAX_PROVIDER_CALLS, discoveryGroups.size);
  const remapCandidates = [...discoveryGroups.values()].reduce((sum, count) => sum + count, 0);
  const detailCalls = Math.min(due.size, Math.max(0, MAX_PROVIDER_CALLS - discoveryCalls));
  return {
    provider,
    due,
    discoveryCalls,
    remapCandidates,
    detailCalls,
    discoveryGroups,
  };
}

function providerWriteBound(snapshot, plan) {
  const sampleCounts = new Map();
  for (const row of snapshot.allowedState.provider_samples) {
    if (row.provider !== plan.provider) continue;
    sampleCounts.set(row.endpoint, (sampleCounts.get(row.endpoint) ?? 0) + 1);
  }
  const discoveryEndpoint = plan.provider === "understat" ? "leagueData" : "matches";
  const detailEndpoint = plan.provider === "understat" ? "match" : "matchDetails";
  const potentialSamples = new Map([
    [discoveryEndpoint, plan.discoveryCalls],
    [detailEndpoint, plan.detailCalls],
  ]);
  const retentionDeletes = [...potentialSamples.entries()].reduce((sum, [endpoint, count]) =>
    sum + Math.max(0, (sampleCounts.get(endpoint) ?? 0) + count - 5), 0);
  const breakerWrites = plan.due.size ? 1 : 0;
  return {
    fetches: MAX_PROVIDER_CALLS,
    writes:
      plan.due.size * DETAIL_WRITES_PER_FIXTURE +
      plan.discoveryCalls * DISCOVERY_WRITES_PER_CALL +
      plan.remapCandidates * REMAP_WRITES_PER_FIXTURE +
      retentionDeletes +
      breakerWrites,
    formula: {
      dueFixtures: plan.due.size,
      writesPerFixture: DETAIL_WRITES_PER_FIXTURE,
      discoveryCalls: plan.discoveryCalls,
      discoveryWritesPerCall: DISCOVERY_WRITES_PER_CALL,
      remapCandidates: plan.remapCandidates,
      remapDeletesPlusInsertsPerFixture: REMAP_WRITES_PER_FIXTURE,
      retentionDeletes,
      breakerWrites,
    },
  };
}

function pollPlan(key, before, clock) {
  const now = new Date(clock);
  const fixtures = Number(before.tableCounts.fixtures ?? 0);
  const competitions = Number(before.tableCounts.competitions ?? 0);
  const plan = { fixtureIds: new Set(), provider: null, slow: null };
  if (key === "espn_insights") plan.fixtureIds = fixtureInsightsDue(before, now);
  if (key === "team_news") plan.fixtureIds = teamNewsDue(before, now);
  if (key === "espn_match_data") plan.fixtureIds = matchDataDue(before, now);
  if (key === "espn_commentary") plan.fixtureIds = commentaryDue(before, now);
  if (key === "espn_reconcile") plan.fixtureIds = reconcileDue(before, now);
  if (key === "understat_xg" || key === "fotmob_slow") {
    plan.slow = providerDue(before, key, now);
    plan.provider = plan.slow.provider;
    plan.fixtureIds = plan.slow.due;
  }
  let bounds = { fetches: fixtures, writes: fixtures };
  if (key === "espn_standings") bounds = { fetches: competitions, writes: competitions };
  if (key === "derived_standings") bounds = { fetches: 0, writes: competitions };
  if (key === "team_news") bounds = { fetches: 1, writes: plan.fixtureIds.size };
  if (key === "espn_reconcile") bounds = { fetches: 0, writes: plan.fixtureIds.size };
  if (key === "espn_match_data" || key === "espn_commentary") {
    bounds = { fetches: fixtures, writes: fixtures * 2 };
  }
  if (plan.slow) bounds = providerWriteBound(before, plan.slow);
  return { ...plan, bounds };
}

function owner(table, columns, allows, label) {
  return { table, columns: new Set(columns), allows, label };
}

function providerForKey(key) {
  return key === "understat_xg"
    ? "understat"
    : key === "fotmob_slow"
      ? "fotmob"
      : null;
}

function providerRemapRowKeys(before, after, claimed, beforeClock) {
  const providers = new Set(claimed.map(providerForKey).filter(Boolean));
  const dueByProvider = new Map(
    claimed
      .filter((key) => providerForKey(key))
      .map((key) => {
        const provider = providerForKey(key);
        return [provider, providerDue(before, key, new Date(beforeClock)).due];
      }),
  );
  const beforeRows = rowsByKey(
    "fixture_provider_ids",
    before.allowedState.fixture_provider_ids,
  );
  const afterRows = rowsByKey(
    "fixture_provider_ids",
    after.allowedState.fixture_provider_ids,
  );
  const deleted = new Map();
  const inserted = new Map();
  for (const [key, row] of beforeRows) {
    if (!afterRows.has(key) && providers.has(row.provider) && row.external_id != null) {
      const group = `${row.provider}\u0000${String(row.external_id)}`;
      const rows = deleted.get(group) ?? [];
      rows.push([key, row]);
      deleted.set(group, rows);
    }
  }
  for (const [key, row] of afterRows) {
    if (!beforeRows.has(key) && providers.has(row.provider) && row.external_id != null) {
      const group = `${row.provider}\u0000${String(row.external_id)}`;
      const rows = inserted.get(group) ?? [];
      rows.push([key, row]);
      inserted.set(group, rows);
    }
  }
  const remapKeys = new Set();
  for (const [group, oldRows] of deleted) {
    const newRows = inserted.get(group) ?? [];
    const pairs = Math.min(oldRows.length, newRows.length);
    for (let index = 0; index < pairs; index += 1) {
      const [oldKey, oldRow] = oldRows[index];
      const [newKey, newRow] = newRows[index];
      if (oldRow.fixture_id === newRow.fixture_id) continue;
      if (!dueByProvider.get(newRow.provider)?.has(newRow.fixture_id)) continue;
      remapKeys.add(oldKey);
      remapKeys.add(newKey);
    }
  }
  return remapKeys;
}

function addFixtureOwner(owners, key, table, ids, columns) {
  owners.push(owner(
    table,
    columns,
    (before, after) => ids.has((before ?? after)?.fixture_id),
    key,
  ));
}

function ownership(before, beforeClock, claimed, targetKey) {
  const owners = [];
  for (const key of claimed) {
    const plan = pollPlan(key, before, beforeClock);
    for (const [table, columns] of Object.entries(PHASE4_WRITE_COLUMNS[key])) {
      if (table === "fixture_insights" || table === "fixture_match_data" ||
          table === "fixture_provider_data" || table === "fixture_provider_ids") {
        addFixtureOwner(owners, key, table, plan.fixtureIds, columns);
      } else if (table === "competition_standings") {
        const source = key === "espn_standings" ? "espn" : "derived";
        const competition = before.competitionRows.find((row) => row.slug === "pl-2026-27" && row.status !== "archived");
        const ids = new Set(competition ? [competition.id] : []);
        owners.push(owner(table, columns, (old, next) => {
          const row = old ?? next;
          return ids.has(row?.competition_id) && row?.source === source;
        }, key));
      } else if (table === "provider_samples") {
        const endpoints = new Set(PROVIDER_SAMPLE_ENDPOINTS[key]);
        owners.push(owner(table, columns, (old, next) => {
          const row = old ?? next;
          return row?.provider === (key === "understat_xg" ? "understat" : "fotmob") && endpoints.has(row?.endpoint);
        }, key));
      } else if (table === "sync_issues") {
        const source = key === "understat_xg" ? "understat" : key === "fotmob_slow" ? "fotmob" : "espn";
        const providerIssue = key === "understat_xg" || key === "fotmob_slow";
        owners.push(owner(table, columns, (old, next) => {
          const row = old ?? next;
          if (row?.source !== source) return false;
          if (providerIssue) return ["provider_shape", "provider-breaker"].includes(row?.kind);
          return row?.kind === "provider_stale_result" && plan.fixtureIds.has(row?.ref);
        }, key));
      }
    }
    if (key === "understat_xg" || key === "fotmob_slow") {
      const provider = key === "understat_xg" ? "understat" : "fotmob";
      const endpoints = new Set(PROVIDER_SAMPLE_ENDPOINTS[key]);
      owners.push(owner(
        "provider_samples",
        ["provider", "endpoint", "ref", "status", "bytes", "body", "fetched_at"],
        (old, next) => {
          const row = old ?? next;
          return row?.provider === provider && endpoints.has(row?.endpoint);
        },
        `${key}:provider-samples`,
      ));
    }
  }
  const insightsBefore = syncByKey(before).get("espn_insights");
  if (insightsBefore && isInfinity(insightsBefore.next_due_at) && targetKey !== "espn_insights") {
    const legacyIds = fixtureInsightsDue(before, new Date(beforeClock), true);
    owners.push(owner("fixture_insights", LEGACY_INSIGHTS_COLUMNS,
      (old, next) => legacyIds.has((old ?? next)?.fixture_id), "legacy_insights"));
  }
  return owners;
}

async function snapshot(client) {
  const tables = await client.query(
    `select table_name
       from information_schema.tables
      where table_schema = 'cashford' and table_type = 'BASE TABLE'
      order by table_name`,
  );
  const tableNames = tables.rows.map((row) => row.table_name);
  const protectedTables = tableNames.filter(
    (table) => !ALLOWED_TABLES.includes(table) && table !== "sync_state",
  );
  const protectedState = {};
  for (const table of protectedTables) {
    assert(/^[a-z_][a-z0-9_]*$/.test(table), `unsafe table name ${table}`);
    const result = await client.query(
      `select count(*)::int as count,
              md5(coalesce(string_agg(row_json, '' order by row_json), '')) as checksum
         from (
           select row_to_json(t)::text as row_json
             from cashford.${table} t
         ) rows`,
    );
    protectedState[table] = result.rows[0];
  }
  const allowedState = {};
  for (const table of ALLOWED_TABLES) {
    const result = await client.query(
      `select row_to_json(t)::text as row_json
         from cashford.${table} t`,
    );
    const rows = result.rows.map((row) => JSON.parse(row.row_json));
    allowedState[table] = rows.sort((a, b) => rowKey(table, a).localeCompare(rowKey(table, b)));
  }
  const [sync, fixtures, competitions, revisions] = await Promise.all([
    client.query("select * from cashford.sync_state order by key"),
    client.query("select * from cashford.fixtures order by id"),
    client.query("select * from cashford.competitions order by id"),
    client.query("select fixture_id, observed_at from cashford.result_revisions order by id"),
  ]);
  return {
    tableCounts: Object.fromEntries(
      Object.entries(protectedState).map(([table, row]) => [table, row.count]),
    ),
    protectedState,
    allowedState,
    syncState: sync.rows,
    fixtureRows: fixtures.rows,
    competitionRows: competitions.rows,
    revisionRows: revisions.rows,
  };
}

async function atomicSnapshot(client) {
  await client.query("begin isolation level repeatable read read only");
  try {
    const clock = await client.query(
      "select clock_timestamp()::text as clock, current_setting('transaction_read_only') as read_only",
    );
    assert(clock.rows[0].read_only === "on", "observer database session is not read-only");
    const state = await snapshot(client);
    await client.query("commit");
    return { clock: clock.rows[0].clock, state };
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  }
}

function assertPollerFields(body, before, targetKey, beforeClock) {
  const beforeSync = syncByKey(before);
  const claimed = [];
  const windows = [];
  let previousFinish = 0;
  for (const key of ROUTE_ORDER) {
    const label = LABELS[key];
    const field = body.phase4?.[label];
    assert(field, `${key}: missing result`);
    if (field.error && /no sync_state row for espn_insights/.test(field.error)) {
      throw new Error(`${key}: missing espn_insights handoff row; abort and restore it before retrying`);
    }
    assert(!field.error, `${key}: ${field.error ?? "result error"}`);
    assert(["claimed", "not_due", "leased"].includes(field.lease), `${key}: invalid lease outcome`);
    assert(Number.isInteger(field.fetches) && field.fetches >= 0, `${key}: invalid fetch count`);
    assert(Number.isInteger(field.writes) && field.writes >= 0, `${key}: invalid write count`);
    const start = Date.parse(field.startedAt);
    const finish = Date.parse(field.finishedAt);
    assert(Number.isFinite(start) && Number.isFinite(finish) && finish >= start, `${key}: invalid per-poller window`);
    assert(start >= previousFinish, `${key}: poller windows overlap or reorder`);
    previousFinish = finish;
    windows.push({ key, startedAt: field.startedAt, finishedAt: field.finishedAt });

    const beforeRow = beforeSync.get(key);
    assert(beforeRow, `${key}: missing before sync row`);
    const armed = !isInfinity(beforeRow.next_due_at);
    if (!armed) {
      assert(field.lease === "not_due" && field.fetches === 0 && field.writes === 0, `${key}: dark peer did work`);
    } else if (field.lease === "not_due" || field.lease === "leased") {
      assert(field.fetches === 0 && field.writes === 0, `${key}: skipped armed peer reported work`);
    } else {
      const plan = pollPlan(key, before, beforeClock);
      assert(field.fetches <= plan.bounds.fetches, `${key}: fetch bound exceeded`);
      assert(field.writes <= plan.bounds.writes, `${key}: write bound exceeded`);
      if (key === "fotmob_slow" && plan.fixtureIds.size > 0) {
        assert(field.fetches > 0, "fotmob_slow: due work had zero provider requests");
      }
      claimed.push(key);
    }
  }
  assert(body.phase4[LABELS[targetKey]]?.lease === "claimed", `${targetKey}: target did not claim`);
  return { claimed, windows };
}

function assertQuietLegacy(body, targetKey) {
  assert(body.fpl?.ran === false, "fpl writer was not quiet");
  assert(stable(body.poll) === stable({ fetched: 0, updated: 0, resolved: 0, skipped: true }), "score poller was not quiet");
  assert(body.ko?.skipped === "throttled", "knockout poller was not quiet");
  for (const [label, fields] of [
    ["locks", ["processed", "locked", "voided"]],
    ["settles", ["candidates", "settled"]],
  ]) {
    for (const field of fields) assert(body[label]?.[field] === 0, `${label}.${field} was not zero`);
  }
  const maintenanceFields = [
    "completed", "locked", "pots_provisioned", "pots_locked", "entries_locked_in",
    "entries_invalid", "w1_voids", "w1_voids_refreshed", "completeness_updated",
  ];
  for (const competition of Object.values(body.gameweeks ?? {})) {
    for (const field of maintenanceFields) assert(competition[field] === 0, `gameweeks.${field} was not zero`);
  }
  for (const field of ["scanned", "settled", "voided", "retried", "aborted", "skipped"]) {
    assert(body.gwSettles?.[field] === 0, `gwSettles.${field} was not zero`);
  }
  assert(Array.isArray(body.gwSettles?.detail) && body.gwSettles.detail.length === 0, "gwSettles.detail was not empty");
  if (targetKey === "espn_insights") {
    assert(body.insights?.checked === 0 && body.insights?.updated === 0, "legacy insights caller was not removed for the armed key");
  } else {
    assert(Number.isInteger(body.insights?.checked) && body.insights.checked >= 0, "legacy insights result missing");
    assert(Number.isInteger(body.insights?.updated) && body.insights.updated >= 0, "legacy insights result missing");
  }
}

function assertTableOwnership(before, after, claimed, targetKey, beforeClock) {
  const owners = ownership(before, beforeClock, claimed, targetKey);
  const providerRemapKeys = providerRemapRowKeys(before, after, claimed, beforeClock);
  const failures = [];
  for (const table of ALLOWED_TABLES) {
    const beforeRows = rowsByKey(table, before.allowedState[table]);
    const afterRows = rowsByKey(table, after.allowedState[table]);
    const keys = new Set([...beforeRows.keys(), ...afterRows.keys()]);
    for (const key of keys) {
      const old = beforeRows.get(key);
      const next = afterRows.get(key);
      if (stable(old) === stable(next)) continue;
      const tableOwners = owners.filter((candidate) => candidate.table === table && candidate.allows(old, next));
      const changed = allChangedColumns(old, next);
      let permittedColumns = new Set(tableOwners.flatMap((candidate) => [...candidate.columns]));
      const keyColumns = new Set(TABLE_KEYS[table]);
      let unexpectedColumns = changed.filter((column) => !keyColumns.has(column) && !permittedColumns.has(column));
      const providerRemap = table === "fixture_provider_ids" && providerRemapKeys.has(key);
      if (providerRemap) {
        permittedColumns = new Set(PROVIDER_ID_COLUMNS);
        unexpectedColumns = changed.filter((column) => !keyColumns.has(column) && !permittedColumns.has(column));
      }
      if ((!tableOwners.length && !providerRemap) || unexpectedColumns.length) {
        failures.push({
          table,
          key,
          owners: tableOwners.map((candidate) => candidate.label),
          changed,
          unexpectedColumns,
          providerRemap,
        });
      }
    }
  }
  assert(failures.length === 0, `unowned row/column changes: ${JSON.stringify(failures)}`);
  return { owners: owners.map((candidate) => ({ table: candidate.table, label: candidate.label })), failures };
}

function assertSyncDiffs(before, after, claimed, targetKey, afterClock) {
  const beforeSync = syncByKey(before);
  const afterSync = syncByKey(after);
  const changed = PHASE4_SYNC_KEYS.filter((key) => stable(beforeSync.get(key)) !== stable(afterSync.get(key)));
  const legacyDark = beforeSync.get("espn_insights") && isInfinity(beforeSync.get("espn_insights").next_due_at) && targetKey !== "espn_insights";
  for (const key of changed) {
    const isLegacy = key === "espn_insights" && legacyDark;
    assert(isLegacy || claimed.includes(key), `sync row changed without an owner: ${key}`);
    const old = beforeSync.get(key);
    const next = afterSync.get(key);
    const changedFields = changedColumns(old, next);
    assert(changedFields.every((field) => SYNC_COLUMNS.includes(field)), `${key}: unapproved sync_state column changed`);
    if (isLegacy) {
      assert(isInfinity(next.next_due_at) && next.lease_until == null && next.lease_token == null, "espn_insights dark legacy lease did not release to infinity");
      continue;
    }
    assert(timestamp(old.last_run_at) !== timestamp(next.last_run_at), `${key}: claimed lease did not advance last_run_at`);
    assert(next.lease_token == null && next.lease_until == null, `${key}: claimed lease was not released`);
    assert(isInfinity(next.next_due_at) || timestamp(next.next_due_at) > timestamp(afterClock), `${key}: next_due_at did not move beyond observation`);
  }
  for (const key of PHASE4_SYNC_KEYS.filter((item) => !changed.includes(item))) {
    if (claimed.includes(key)) throw new Error(`${key}: claimed lease row did not change`);
  }
  const nonPhase4Before = before.syncState.filter((row) => !PHASE4_SYNC_KEYS.includes(row.key));
  const nonPhase4After = after.syncState.filter((row) => !PHASE4_SYNC_KEYS.includes(row.key));
  assert(stable(nonPhase4Before) === stable(nonPhase4After), "non-Phase-4 sync state changed");
  return { changed };
}

function assertBaselinePair(before, after) {
  assert(stable(before.protectedState) === stable(after.protectedState), "baseline changed a protected table");
  for (const table of ALLOWED_TABLES) {
    assert(stable(before.allowedState[table]) === stable(after.allowedState[table]), `baseline changed ${table}`);
  }
  assert(stable(before.fixtureRows) === stable(after.fixtureRows), "baseline changed fixtures");
  assert(stable(before.competitionRows) === stable(after.competitionRows), "baseline changed competitions");
  assert(stable(before.revisionRows) === stable(after.revisionRows), "baseline changed result revisions");
  const beforeSync = syncByKey(before);
  const afterSync = syncByKey(after);
  const keys = new Set([...beforeSync.keys(), ...afterSync.keys()]);
  for (const key of keys) {
    const old = beforeSync.get(key);
    const next = afterSync.get(key);
    if (key !== "espn_insights") {
      assert(stable(old) === stable(next), `baseline changed sync_state row ${key}`);
      continue;
    }
    const changed = changedColumns(old, next);
    assert(changed.every((field) => SYNC_COLUMNS.includes(field)), "baseline changed an unapproved espn_insights column");
  }
}

function assertBaselineResponse(body) {
  for (const key of ROUTE_ORDER) {
    const field = body.phase4?.[LABELS[key]];
    assert(field && !field.error, `${key}: baseline tick failed`);
    assert(field.lease === "not_due" && field.fetches === 0 && field.writes === 0, `${key}: baseline tick was not dark`);
  }
}

function assertLegacyOnlySnapshot(state, label) {
  const sync = syncByKey(state);
  for (const key of PHASE4_SYNC_KEYS) {
    const row = sync.get(key);
    assert(row, `${label}: missing Phase 4 sync row ${key}`);
    assert(isInfinity(row.next_due_at), `${label}: ${key} was armed during baseline`);
    assert(row.lease_until == null && row.lease_token == null, `${label}: ${key} had an active lease during baseline`);
  }
}

const key = argument("--key");
const baseline = process.argv.includes("--baseline");
const observerArgs = process.argv.slice(2);
assert(key && isPhase4SyncKey(key), `use --key <Phase 4 key>; valid keys: ${PHASE4_SYNC_KEYS.join(", ")}`);
assert(process.argv.includes("--confirm-production"), "--confirm-production is required");
if (baseline) {
  assert(stable(observerArgs) === stable(["--key", key, "--baseline", "--confirm-production"]), "baseline mode accepts only --key <key> --baseline --confirm-production");
}
const databaseUrl = process.env.PHASE4_RO_DATABASE_URL;
const tickUrl = process.env.PHASE4_TICK_URL;
const cronSecret = process.env.CRON_SECRET;
const expectedDbHost = process.env.PHASE4_RO_EXPECTED_DB_HOST;
const expectedTickHost = process.env.PHASE4_RO_EXPECTED_TICK_HOST;
assert(databaseUrl && expectedDbHost && tickUrl && cronSecret && expectedTickHost, "PHASE4_RO_DATABASE_URL, PHASE4_RO_EXPECTED_DB_HOST, PHASE4_TICK_URL, CRON_SECRET and PHASE4_RO_EXPECTED_TICK_HOST are required");
assert(new URL(databaseUrl).hostname === expectedDbHost, "database host does not match the reviewed record");
assert(new URL(tickUrl).hostname === expectedTickHost, "tick host does not match the reviewed record");

const client = new pg.Client({
  connectionString: databaseUrl,
  options: "-c default_transaction_read_only=on",
});
await client.connect();
try {
  const beforeObservation = await atomicSnapshot(client);
  const response = await fetch(tickUrl, {
    method: "POST",
    headers: { authorization: `Bearer ${cronSecret}` },
  });
  const body = await response.json();
  assert(response.ok && body.ok === true, `tick failed with ${response.status}`);
  if (key === "fotmob_slow" || body.phase4?.fotmob?.lease === "claimed") {
    assert(body.fotmobEnabled === true, "deployed tick did not report FOTMOB_ENABLED=true");
  }
  const afterObservation = await atomicSnapshot(client);
  const { clock, state } = beforeObservation;
  const { clock: afterClock, state: after } = afterObservation;
  if (baseline) {
    assertLegacyOnlySnapshot(state, "before snapshot");
    assertLegacyOnlySnapshot(after, "after snapshot");
    assertBaselineResponse(body);
    assertQuietLegacy(body, key);
    assertBaselinePair(state, after);
    console.log(JSON.stringify({ mode: "baseline", key, beforeClock: clock, afterClock, before: state, after, tick: body }, null, 2));
  } else {
    assertQuietLegacy(body, key);
    const pollers = assertPollerFields(body, state, key, clock);
    const outerStart = Date.parse(clock);
    const outerFinish = Date.parse(afterClock);
    for (const window of pollers.windows) {
      const start = Date.parse(window.startedAt);
      const finish = Date.parse(window.finishedAt);
      assert(start >= outerStart - 5_000 && finish <= outerFinish + 5_000, `${window.key}: per-poller window falls outside database observation`);
    }
    const tableDiffs = assertTableOwnership(state, after, pollers.claimed, key, clock);
    const syncDiffs = assertSyncDiffs(state, after, pollers.claimed, key, afterClock);
    console.log(JSON.stringify({ key, beforeClock: clock, afterClock, windows: pollers.windows, claimed: pollers.claimed, tableDiffs, syncDiffs, tick: body }, null, 2));
  }
} finally {
  await client.end();
}
