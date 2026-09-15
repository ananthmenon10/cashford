import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

vi.mock("@/lib/phase4-poll-runtime", () => ({
  runPhase4Poller: vi.fn(
    async (_admin: unknown, _key: string, _schedule: unknown, work: (counter: unknown) => Promise<void>) => {
      await work({
        fetched() {}, wrote() {}, async renew() {}, disarm() {}, nextDueIn() {},
      });
      return { lease: "claimed", fetches: 0, writes: 0 };
    },
  ),
}));

import { reconcileMatchCache, RECONCILE_CACHE_COLUMNS } from "@/lib/reconcile-match-cache";

type Call = { table: string; columns: string };

function fakeAdmin(rows: { cached: unknown[]; fixtures: unknown[]; revisions: unknown[] }) {
  const selects: Call[] = [];
  const updates: Array<{ patch: Record<string, unknown>; fixtureId: string }> = [];
  const admin = {
    from(table: string) {
      return {
        select(columns: string) {
          selects.push({ table, columns });
          const data =
            table === "fixture_match_data" ? rows.cached
            : table === "fixtures" ? rows.fixtures
            : rows.revisions;
          const result = Promise.resolve({ data, error: null });
          return Object.assign(result, {
            in: () => Promise.resolve({ data, error: null }),
          });
        },
        update(patch: Record<string, unknown>) {
          return {
            eq: (_col: string, fixtureId: string) => {
              updates.push({ patch, fixtureId });
              return Promise.resolve({ error: null });
            },
          };
        },
      };
    },
  };
  return { admin, selects, updates };
}

describe("reconcileMatchCache column discipline", () => {
  it("never selects * from fixture_match_data", async () => {
    const { admin, selects } = fakeAdmin({ cached: [], fixtures: [], revisions: [] });
    await reconcileMatchCache(admin as never);
    const cacheRead = selects.find((call) => call.table === "fixture_match_data");
    expect(cacheRead).toBeDefined();
    expect(cacheRead!.columns).toBe(RECONCILE_CACHE_COLUMNS);
    expect(cacheRead!.columns).not.toContain("*");
    for (const heavy of ["lineups", "player_stats", "commentary", "key_events", "scorers", "team_stats"]) {
      // Stamps like key_events_fetched_at are fine; the JSON blobs are not.
      expect(cacheRead!.columns.split(",").map((c) => c.trim())).not.toContain(heavy);
    }
  });

  it("the selected columns cover every row field the module reads", () => {
    const source = readFileSync("lib/reconcile-match-cache.ts", "utf8");
    const referenced = new Set(
      [...source.matchAll(/\brow\.([a-z_]+)/g)].map((m) => m[1]),
    );
    // SCORE_STAMPS are read via row[column]; list them explicitly.
    for (const stamp of [
      "key_events_fetched_at", "scorers_fetched_at", "team_stats_fetched_at",
      "player_stats_fetched_at", "commentary_fetched_at",
    ]) referenced.add(stamp);
    const selected = new Set(RECONCILE_CACHE_COLUMNS.split(",").map((c) => c.trim()));
    for (const field of referenced) expect(selected, `missing ${field}`).toContain(field);
  });

  it("still resets a row whose kickoff moved, using only the named columns", async () => {
    const { admin, updates } = fakeAdmin({
      cached: [{
        fixture_id: "fx-1",
        source_kickoff_at: "2026-09-19T14:00:00.000Z",
        frozen_at: "2026-09-19T17:00:00.000Z",
        key_events_fetched_at: null, scorers_fetched_at: null, team_stats_fetched_at: null,
        player_stats_fetched_at: null, commentary_fetched_at: null,
      }],
      fixtures: [{ id: "fx-1", kickoff_at: "2026-09-19T16:30:00.000Z", ft_home: 2, ft_away: 1 }],
      revisions: [],
    });
    await reconcileMatchCache(admin as never);
    expect(updates).toHaveLength(1);
    expect(updates[0].fixtureId).toBe("fx-1");
    expect(updates[0].patch).toMatchObject({
      frozen_at: null,
      source_kickoff_at: "2026-09-19T16:30:00.000Z",
      result_fingerprint: "2-1@0",
    });
  });

  it("leaves an unchanged frozen row alone", async () => {
    const { admin, updates } = fakeAdmin({
      cached: [{
        fixture_id: "fx-1",
        source_kickoff_at: "2026-09-19T14:00:00.000Z",
        frozen_at: "2026-09-19T17:00:00.000Z",
        key_events_fetched_at: null, scorers_fetched_at: null, team_stats_fetched_at: null,
        player_stats_fetched_at: null, commentary_fetched_at: null,
      }],
      fixtures: [{ id: "fx-1", kickoff_at: "2026-09-19T14:00:00.000Z", ft_home: 2, ft_away: 1 }],
      revisions: [{ fixture_id: "fx-1", observed_at: "2026-09-19T16:00:00.000Z" }],
    });
    await reconcileMatchCache(admin as never);
    expect(updates).toHaveLength(0);
  });
});
