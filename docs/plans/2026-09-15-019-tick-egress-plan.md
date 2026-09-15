# Cashford tick egress cut — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cut the Supabase egress the every-minute pg_cron tick produces from ~0.5 GB/day to under 10 MB/day without changing what the game does for the ~10 weekly Premier League players.

**Architecture:** Three independent cuts, each behind its own test. (1) The two Phase 4 pollers that read `fixture_match_data` with `select("*")` read only the columns their loops use, which drops the per-tick read from ~300 KB compressed to ~10 KB. (2) The tick reads the nine `sync_state` rows once and skips a Phase 4 poller whose `next_due_at` is in the future, so eight lease RPCs per minute become one small read. (3) The tick gains a quiet mode: when no fixture is live, kicking off within 2 h, or finished within the last 3 h, the fixture pollers (`pollScores`, knockout resolution, the Phase 4 block) run only at minutes 0/10/20/30/40/50. FPL sync, contest locks, settlement, gameweek maintenance and gameweek settlement dispatch keep running every minute, so deadlines and payouts keep today's latency.

**Tech Stack:** Next.js 15 App Router route handler, supabase-js service-role client, Vitest, TypeScript.

**Spec:** This plan is the spec. Diagnosis: Supabase edge logs (2026-09-14/15) showed ~1,754 GETs/day on `fixture_match_data` from the tick, each ~2.0 MB raw / ~300 KB gzip (`select=*`), against ~60 KB raw / ~14 KB gzip for a named-column select measured on the same table.

## Global Constraints

- Repo rules (CLAUDE.md): conventional commits written with a HEREDOC; **no Co-Authored-By footer**; **never `git add .`** — add files by name; only commit when a task says so; run `node scripts/stamp-version.mjs` before the final prod commit.
- Never write-test against real leagues Solid Yenne Boys, KK Bois, PES Bois. This plan writes no test data to the shared DB at all.
- Don't touch settlement/scoring (`lib/settlement.ts`, `lib/settle-contest.ts`, `lib/gameweek-db.ts`). This plan does not modify them.
- Verify before "done": `npm run typecheck` · `npm test` · `npm run build` · `npm run safety:phase4`.
- Push to `main` auto-deploys https://cashford.vercel.app. The cron keeps hitting the deployed route every minute; every intermediate commit on `main` must be deployable on its own.
- Work on branch `main` in `/Users/am10/AI/projects/cashford` (currently `feature/cashford-2` == `main` @ `2bb787d`; check out `main` first).
- Egress is measured from Supabase's side. A "small" query still costs its response bytes; a skipped query costs nothing.

---

### Task 1: `reconcileMatchCache` reads named columns

**Files:**
- Modify: `lib/reconcile-match-cache.ts:28-30`
- Create: `tests/phase4/reconcile-match-cache.test.ts`

**Interfaces:**
- Consumes: `runPhase4Poller(admin, key, schedule, work)` from `lib/phase4-poll-runtime.ts` (unchanged).
- Produces: exported `RECONCILE_CACHE_COLUMNS` string constant so the test and the loop agree on the column list.

The loop at `lib/reconcile-match-cache.ts:54-94` reads exactly `row.fixture_id`, `row.source_kickoff_at`, `row.frozen_at`, and the five `SCORE_STAMPS` columns (`key_events_fetched_at`, `scorers_fetched_at`, `team_stats_fetched_at`, `player_stats_fetched_at`, `commentary_fetched_at`). It never reads `lineups`, `player_stats`, `commentary`, or `key_events` — the ~2 MB of JSON that `select("*")` drags in.

- [ ] **Step 1: Write the failing test**

```ts
// tests/phase4/reconcile-match-cache.test.ts
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/phase4/reconcile-match-cache.test.ts`
Expected: FAIL — `RECONCILE_CACHE_COLUMNS` is not exported (import is `undefined`), and the first test sees `columns === "*"`.

- [ ] **Step 3: Implement**

In `lib/reconcile-match-cache.ts`, add the export after `SCORE_STAMPS` and use it in the select:

```ts
// Only the columns the loop below reads. `select("*")` pulled the lineups,
// player_stats, commentary and key_events JSON for every cached fixture on
// every tick (~2 MB raw, ~300 KB on the wire) and was the largest single
// source of Supabase egress in Sept 2026.
export const RECONCILE_CACHE_COLUMNS = [
  "fixture_id",
  "source_kickoff_at",
  "frozen_at",
  ...SCORE_STAMPS,
].join(", ");
```

and change lines 28-30 to:

```ts
      const { data: cached, error } = await admin
        .from("fixture_match_data")
        .select(RECONCILE_CACHE_COLUMNS);
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/phase4/reconcile-match-cache.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Typecheck and full suite**

Run: `npm run typecheck && npm test`
Expected: both exit 0. If tsc complains about the fake admin shape, cast via `as never` where the test passes it in (already done) — do not loosen production types.

- [ ] **Step 6: Commit**

```bash
git add lib/reconcile-match-cache.ts tests/phase4/reconcile-match-cache.test.ts
git commit -m "$(cat <<'EOF'
perf(tick): read only the stamp columns in reconcileMatchCache

select("*") on fixture_match_data pulled ~2 MB of lineups, player stats
and commentary JSON every minute. The reconcile loop only reads
fixture_id, source_kickoff_at, frozen_at and the five *_fetched_at
stamps, so select those by name. Adds a test that fails if the loop
starts reading a column the select does not list.
EOF
)"
```

---

### Task 2: `pollMatchData` reads named columns

**Files:**
- Modify: `lib/poll-match-data.ts:50-53`
- Create: `tests/phase4/poll-match-data-columns.test.ts`

**Interfaces:**
- Produces: exported `MATCH_DATA_CACHE_COLUMNS` string constant.

The loop reads from the cached row (`old`): `frozen_at` (line 62), `stale_retry_at` (63), `lineups_ok` and `lineups` (73), `lineups_fetched_at` (76), `key_events_fetched_at` (85), `team_stats_fetched_at` (96), `source_version` (171), and the row's existence (`if (old)` at 134). `lineups` is the one JSON blob it needs (40 kB across the whole table); the ~1.9 MB of `player_stats`, `commentary`, `key_events`, `scorers`, `team_stats` is never read here.

- [ ] **Step 1: Write the failing test**

```ts
// tests/phase4/poll-match-data-columns.test.ts
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { MATCH_DATA_CACHE_COLUMNS } from "@/lib/poll-match-data";

describe("pollMatchData column discipline", () => {
  const selected = () => new Set(MATCH_DATA_CACHE_COLUMNS.split(",").map((c) => c.trim()));

  it("does not select * or the heavy JSON blobs it never reads", () => {
    expect(MATCH_DATA_CACHE_COLUMNS).not.toContain("*");
    for (const heavy of ["player_stats", "commentary", "key_events", "scorers", "team_stats"]) {
      expect(selected()).not.toContain(heavy);
    }
    // lineups IS read (the `lineups_ok && lineups` guard), so it must stay.
    expect(selected()).toContain("lineups");
  });

  it("covers every `old.<field>` the module reads", () => {
    const source = readFileSync("lib/poll-match-data.ts", "utf8");
    const referenced = [...source.matchAll(/\bold\??\.([a-z_]+)/g)].map((m) => m[1]);
    expect(referenced.length).toBeGreaterThan(0);
    for (const field of new Set(referenced)) {
      expect(selected(), `missing ${field}`).toContain(field);
    }
  });

  it("the source uses the constant in the fixture_match_data read", () => {
    const source = readFileSync("lib/poll-match-data.ts", "utf8");
    expect(source).toContain('.from("fixture_match_data").select(MATCH_DATA_CACHE_COLUMNS)');
    expect(source).not.toMatch(/from\("fixture_match_data"\)\s*\.select\("\*"\)/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/phase4/poll-match-data-columns.test.ts`
Expected: FAIL — `MATCH_DATA_CACHE_COLUMNS` is undefined.

- [ ] **Step 3: Implement**

In `lib/poll-match-data.ts`, add after the `fingerprint` helper (before `export async function pollMatchData`):

```ts
// Only the cached-row fields the loop below reads. `select("*")` shipped the
// player_stats/commentary/key_events JSON for every fixture on every tick;
// see docs/plans/2026-09-15-019-tick-egress-plan.md. `lineups` stays: the
// `lineups_ok && lineups` guard needs the value, not just a flag.
export const MATCH_DATA_CACHE_COLUMNS = [
  "fixture_id",
  "frozen_at",
  "stale_retry_at",
  "lineups_ok",
  "lineups",
  "lineups_fetched_at",
  "key_events_fetched_at",
  "team_stats_fetched_at",
  "source_version",
].join(", ");
```

Change line 51 to:

```ts
        admin.from("fixture_match_data").select(MATCH_DATA_CACHE_COLUMNS).in("fixture_id", ids),
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/phase4/poll-match-data-columns.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Typecheck, full suite, Phase 4 safety scan**

Run: `npm run typecheck && npm test && npm run safety:phase4`
Expected: all exit 0. The safety scan (`scripts/phase4-write-scan.mjs`) checks write paths, which this task does not touch; if it reports a change, stop and report rather than editing the scan.

- [ ] **Step 6: Commit**

```bash
git add lib/poll-match-data.ts tests/phase4/poll-match-data-columns.test.ts
git commit -m "$(cat <<'EOF'
perf(tick): read only the fields pollMatchData uses from the cache

The cached-row read pulled every JSON block for every season fixture
each minute. The loop reads eight scalar fields plus lineups, so name
them. A source-scanning test fails if a new `old.<field>` read appears
without a matching column.
EOF
)"
```

---

### Task 3: One `sync_state` read gates the Phase 4 pollers

**Files:**
- Create: `lib/phase4-due.ts`
- Modify: `app/api/cron/tick/route.ts:123-137`
- Create: `tests/phase4/phase4-due.test.ts`
- Modify: `tests/phase4/cron-tick-route.test.ts` (the fake `admin` gains `from()`)

**Interfaces:**
- Produces:
  ```ts
  export type Phase4DueSnapshot = { isDue(key: Phase4SyncKey): boolean; source: "sync_state" | "fallback" };
  export async function readPhase4Due(admin: Admin, now?: Date): Promise<Phase4DueSnapshot>;
  export function isDueAt(nextDueAt: string | null | undefined, now: Date): boolean;
  ```
- Consumes: `PHASE4_SYNC_KEYS`, `Phase4SyncKey` from `lib/poll-keys.ts`; `skippedPollOutcome` from `lib/poll-lease.ts`.

`claim_phase4_lease` (migration `20260728000001_match_data_v2.sql:314`) returns `not_due` when `next_due_at > now()`. Today the tick pays eight RPC round trips per minute to learn that. One `select key, next_due_at from sync_state where key in (...)` returns nine tiny rows. The RPC stays the single source of truth for the claim itself: the snapshot only skips pollers that cannot possibly claim. A `null` `next_due_at` counts as due (the SQL's `null > now` is false, so the claim proceeds). `'infinity'` (a disarmed poller) counts as not due. If the read fails, fall back to "everything due" so the tick behaves exactly as it did before this task.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/phase4/phase4-due.test.ts
import { describe, expect, it } from "vitest";
import { isDueAt, readPhase4Due } from "@/lib/phase4-due";
import { PHASE4_SYNC_KEYS } from "@/lib/poll-keys";

const NOW = new Date("2026-09-15T12:00:00.000Z");

describe("isDueAt", () => {
  it("treats null/undefined as due (matches the SQL null comparison)", () => {
    expect(isDueAt(null, NOW)).toBe(true);
    expect(isDueAt(undefined, NOW)).toBe(true);
  });
  it("treats a past or equal timestamp as due", () => {
    expect(isDueAt("2026-09-15T11:59:59.000Z", NOW)).toBe(true);
    expect(isDueAt("2026-09-15T12:00:00.000Z", NOW)).toBe(true);
  });
  it("treats a future timestamp as not due", () => {
    expect(isDueAt("2026-09-15T12:00:01.000Z", NOW)).toBe(false);
  });
  it("treats infinity (disarmed) as not due", () => {
    expect(isDueAt("infinity", NOW)).toBe(false);
  });
  it("treats an unparsable value as due so a bad row can never silently disarm a poller", () => {
    expect(isDueAt("garbage", NOW)).toBe(true);
  });
});

function adminReturning(result: { data: unknown; error: unknown }) {
  const calls: Array<{ table: string; columns: string; inKeys: readonly string[] }> = [];
  const admin = {
    from(table: string) {
      return {
        select(columns: string) {
          return {
            in(_col: string, inKeys: readonly string[]) {
              calls.push({ table, columns, inKeys });
              return Promise.resolve(result);
            },
          };
        },
      };
    },
  };
  return { admin, calls };
}

describe("readPhase4Due", () => {
  it("reads sync_state once for all nine keys and answers per key", async () => {
    const { admin, calls } = adminReturning({
      data: [
        { key: "espn_reconcile", next_due_at: "2026-09-15T12:00:30.000Z" },
        { key: "espn_match_data", next_due_at: "2026-09-15T11:59:00.000Z" },
        { key: "fotmob_slow", next_due_at: "infinity" },
      ],
      error: null,
    });
    const due = await readPhase4Due(admin as never, NOW);
    expect(calls).toHaveLength(1);
    expect(calls[0].table).toBe("sync_state");
    expect(calls[0].columns).toBe("key, next_due_at");
    expect([...calls[0].inKeys].sort()).toEqual([...PHASE4_SYNC_KEYS].sort());
    expect(due.source).toBe("sync_state");
    expect(due.isDue("espn_reconcile")).toBe(false);
    expect(due.isDue("espn_match_data")).toBe(true);
    expect(due.isDue("fotmob_slow")).toBe(false);
    // A key with no row must still be attempted — the RPC will raise if the row is really missing.
    expect(due.isDue("team_news")).toBe(true);
  });

  it("falls back to everything-due when the read errors", async () => {
    const { admin } = adminReturning({ data: null, error: { message: "boom" } });
    const due = await readPhase4Due(admin as never, NOW);
    expect(due.source).toBe("fallback");
    for (const key of PHASE4_SYNC_KEYS) expect(due.isDue(key)).toBe(true);
  });

  it("falls back to everything-due when the read throws", async () => {
    const admin = { from() { throw new Error("network"); } };
    const due = await readPhase4Due(admin as never, NOW);
    expect(due.source).toBe("fallback");
    expect(due.isDue("espn_reconcile")).toBe(true);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/phase4/phase4-due.test.ts`
Expected: FAIL — module `@/lib/phase4-due` not found.

- [ ] **Step 3: Implement `lib/phase4-due.ts`**

```ts
// lib/phase4-due.ts
// One read of sync_state tells the tick which Phase 4 pollers can possibly
// claim their lease this minute. Before this, every tick spent eight
// claim_phase4_lease RPCs to hear "not_due" seven or eight times. The RPC
// stays authoritative — this only skips pollers whose next_due_at is in
// the future. Any doubt (missing row, bad value, read failure) resolves to
// "due" so the worst case is the old behaviour, never a silently dark poller.
import { PHASE4_SYNC_KEYS, type Phase4SyncKey } from "./poll-keys";

type Admin = ReturnType<typeof import("./supabase/service").createServiceRoleClient>;

export type Phase4DueSnapshot = {
  isDue(key: Phase4SyncKey): boolean;
  source: "sync_state" | "fallback";
};

export function isDueAt(nextDueAt: string | null | undefined, now: Date): boolean {
  if (nextDueAt == null) return true;
  if (nextDueAt === "infinity") return false;
  const at = Date.parse(nextDueAt);
  if (!Number.isFinite(at)) return true;
  return at <= now.getTime();
}

const EVERYTHING_DUE: Phase4DueSnapshot = { isDue: () => true, source: "fallback" };

export async function readPhase4Due(admin: Admin, now = new Date()): Promise<Phase4DueSnapshot> {
  try {
    const { data, error } = await admin
      .from("sync_state")
      .select("key, next_due_at")
      .in("key", [...PHASE4_SYNC_KEYS]);
    if (error || !Array.isArray(data)) return EVERYTHING_DUE;
    const byKey = new Map<string, string | null>();
    for (const row of data as Array<{ key: string; next_due_at: string | null }>) {
      byKey.set(row.key, row.next_due_at);
    }
    return {
      source: "sync_state",
      isDue: (key) => (byKey.has(key) ? isDueAt(byKey.get(key), now) : true),
    };
  } catch {
    return EVERYTHING_DUE;
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/phase4/phase4-due.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Wire it into the tick route**

In `app/api/cron/tick/route.ts`:

Add imports:

```ts
import { readPhase4Due } from "@/lib/phase4-due";
import { skippedPollOutcome } from "@/lib/poll-lease";
```

Replace the `const phase4 = { ... }` block (lines 123-137) with:

```ts
  // One sync_state read replaces up to eight claim RPCs that would answer
  // "not_due". The claim inside each poller is still the lock.
  const due = await readPhase4Due(admin);
  const gated = <T>(key: Parameters<typeof due.isDue>[0], run: () => Promise<T>) =>
    phase4Step(async () => (due.isDue(key) ? run() : skippedPollOutcome("not_due")));
  const phase4 = {
    dueSource: due.source,
    insights: leasedInsights,
    reconcile: await gated("espn_reconcile", () => reconcileMatchCache(admin)),
    matchData: await gated("espn_match_data", () => pollMatchData(admin, summaryFetcher)),
    commentary: await gated("espn_commentary", () => pollCommentary(admin, summaryFetcher)),
    standings: await gated("espn_standings", () => pollStandings(admin)),
    derivedStandings: await gated("derived_standings", () => deriveStandings(admin)),
    teamNews: await gated("team_news", () => pollTeamNews(admin)),
    understat: await gated("understat_xg", () => pollUnderstat(admin)),
    fotmob: await gated("fotmob_slow", () => pollSlowProviders(admin)),
  };
```

Check `skippedPollOutcome` is exported from `lib/poll-lease.ts` (it is imported by `lib/phase4-poll-runtime.ts:4`, so it is). Check the key each poller uses by reading its `runPhase4Poller(admin, "<key>", …)` call: `lib/reconcile-match-cache.ts` → `espn_reconcile`; `lib/poll-match-data.ts` → `espn_match_data`; `lib/poll-commentary.ts` → `espn_commentary`; `lib/poll-standings.ts:10` → `espn_standings` and `:150` → `derived_standings`; `lib/poll-team-news.ts` → `team_news`; `lib/poll-understat.ts` → `understat_xg`; `lib/poll-slow-providers.ts` → `fotmob_slow`. If any differs from the list above, use the poller's own key — the poller is right, the plan is wrong.

- [ ] **Step 6: Update the route test's fake admin**

`tests/phase4/cron-tick-route.test.ts` builds `createServiceRoleClient` returning `{ rpc }` only. `readPhase4Due` now calls `admin.from(...)`; the fallback swallows the resulting TypeError, so the existing test still passes, but make the gate explicit. Add to the hoisted block and mock:

```ts
const { rpc, from } = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(() => ({
    select: () => ({
      in: async () => ({ data: [], error: null }), // no rows → every key due
    }),
  })),
}));

vi.mock("@/lib/supabase/service", () => ({
  createServiceRoleClient: vi.fn(() => ({ rpc, from })),
}));
```

Then add one test in the same file, after the existing `it(...)`:

```ts
  it("skips a Phase 4 poller whose sync_state row is not due, without calling it", async () => {
    from.mockImplementationOnce(() => ({
      select: () => ({
        in: async () => ({
          data: [{ key: "espn_reconcile", next_due_at: "2999-01-01T00:00:00.000Z" }],
          error: null,
        }),
      }),
    }));
    vi.mocked(reconcileMatchCache).mockResolvedValue({ lease: "claimed", fetches: 0, writes: 0 });
    const response = await GET(
      new NextRequest("http://localhost/api/cron/tick?secret=phase4-test-secret"),
    );
    const body = (await response.json()) as { phase4: Record<string, { lease?: string }> };
    expect(response.status).toBe(200);
    expect(vi.mocked(reconcileMatchCache)).not.toHaveBeenCalled();
    expect(body.phase4.reconcile.lease).toBe("not_due");
    // The other pollers had no row, so they were still attempted.
    expect(vi.mocked(pollMatchData)).toHaveBeenCalledTimes(1);
  });
```

- [ ] **Step 7: Run route tests, typecheck, suite, build**

Run: `npx vitest run tests/phase4/cron-tick-route.test.ts && npm run typecheck && npm test && npm run build`
Expected: all exit 0.

- [ ] **Step 8: Commit**

```bash
git add lib/phase4-due.ts tests/phase4/phase4-due.test.ts app/api/cron/tick/route.ts tests/phase4/cron-tick-route.test.ts
git commit -m "$(cat <<'EOF'
perf(tick): read sync_state once before claiming Phase 4 leases

Eight claim_phase4_lease RPCs per minute mostly answered not_due. One
select of key,next_due_at for the nine keys decides which pollers to
call; the RPC inside each poller remains the lock. A failed or odd
read falls back to running everything, so the worst case is the
previous behaviour.
EOF
)"
```

---

### Task 4: Quiet mode for the fixture pollers

**Files:**
- Create: `lib/tick-mode.ts`
- Modify: `app/api/cron/tick/route.ts` (`pollScores`, `resolveKnockoutBracket`, Phase 4 block)
- Create: `tests/phase4/tick-mode.test.ts`
- Modify: `tests/phase4/cron-tick-route.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type TickMode = { mode: "active" | "quiet"; reason: string };
  export const ACTIVE_BEFORE_KICKOFF_MS: number;   // 2 h
  export const ACTIVE_AFTER_KICKOFF_MS: number;    // 5 h (covers ~3 h after a normal finish)
  export const QUIET_RUN_EVERY_MINUTES: number;    // 10
  export async function resolveTickMode(admin: Admin, now?: Date): Promise<TickMode>;
  export function shouldRunFixturePollers(mode: TickMode, now: Date, manual: boolean): boolean;
  ```

What stays every minute (cheap, and latency matters for the players): `syncFpl`, `lockDueContests`, `settleFinishedContests`, `gameweekMaintenance`, `dispatchGameweekSettlements`, the insights writer claim. What goes quiet: `pollScores`, `resolveKnockoutBracket`, and the Phase 4 block. In quiet mode those run only when `now.getUTCMinutes() % 10 === 0`, or on a manual `?secret=` trigger.

"Active" means any fixture with an `external_id` is live, or is scheduled with `kickoff_at` between now−5 h and now+2 h, or is finished with `kickoff_at` ≥ now−5 h. One query, `select("id").limit(1)`. If the probe errors, mode is `active` (previous behaviour). During a Premier League weekend most Saturday/Sunday afternoons and midweek evenings are active; overnight and most weekdays are quiet. Data freshness in quiet mode (lineups, standings, team news, xG) lags by at most 10 minutes, all for fixtures no one is watching live.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/phase4/tick-mode.test.ts
import { describe, expect, it } from "vitest";
import {
  ACTIVE_AFTER_KICKOFF_MS,
  ACTIVE_BEFORE_KICKOFF_MS,
  QUIET_RUN_EVERY_MINUTES,
  resolveTickMode,
  shouldRunFixturePollers,
} from "@/lib/tick-mode";

const NOW = new Date("2026-09-15T12:07:00.000Z");

function probeAdmin(result: { data: unknown; error: unknown } | "throw") {
  const filters: string[] = [];
  const admin = {
    from(table: string) {
      filters.push(`from:${table}`);
      const builder = {
        select(cols: string) { filters.push(`select:${cols}`); return builder; },
        not(col: string, op: string, val: unknown) { filters.push(`not:${col}.${op}.${val}`); return builder; },
        or(expr: string) { filters.push(`or:${expr}`); return builder; },
        limit(n: number) {
          filters.push(`limit:${n}`);
          if (result === "throw") return Promise.reject(new Error("network"));
          return Promise.resolve(result);
        },
      };
      return builder;
    },
  };
  return { admin, filters };
}

describe("resolveTickMode", () => {
  it("is active when the probe returns a fixture", async () => {
    const { admin, filters } = probeAdmin({ data: [{ id: "fx-1" }], error: null });
    const mode = await resolveTickMode(admin as never, NOW);
    expect(mode.mode).toBe("active");
    expect(filters).toContain("from:fixtures");
    expect(filters).toContain("select:id");
    expect(filters).toContain("limit:1");
    expect(filters).toContain("not:external_id.is.null");
    const or = filters.find((f) => f.startsWith("or:"))!;
    expect(or).toContain("status.eq.live");
    expect(or).toContain(`kickoff_at.gte.${new Date(NOW.getTime() - ACTIVE_AFTER_KICKOFF_MS).toISOString()}`);
    expect(or).toContain(`kickoff_at.lte.${new Date(NOW.getTime() + ACTIVE_BEFORE_KICKOFF_MS).toISOString()}`);
  });

  it("is quiet when no fixture is near", async () => {
    const { admin } = probeAdmin({ data: [], error: null });
    const mode = await resolveTickMode(admin as never, NOW);
    expect(mode.mode).toBe("quiet");
  });

  it("fails open to active when the probe errors or throws", async () => {
    expect((await resolveTickMode(probeAdmin({ data: null, error: { message: "x" } }).admin as never, NOW)).mode).toBe("active");
    expect((await resolveTickMode(probeAdmin("throw").admin as never, NOW)).mode).toBe("active");
  });
});

describe("shouldRunFixturePollers", () => {
  const quiet = { mode: "quiet" as const, reason: "no fixture near" };
  const active = { mode: "active" as const, reason: "fixture near" };
  it("always runs when active", () => {
    expect(shouldRunFixturePollers(active, new Date("2026-09-15T12:07:00Z"), false)).toBe(true);
  });
  it("runs a quiet tick only on the 10-minute boundary", () => {
    expect(QUIET_RUN_EVERY_MINUTES).toBe(10);
    expect(shouldRunFixturePollers(quiet, new Date("2026-09-15T12:07:00Z"), false)).toBe(false);
    expect(shouldRunFixturePollers(quiet, new Date("2026-09-15T12:10:00Z"), false)).toBe(true);
    expect(shouldRunFixturePollers(quiet, new Date("2026-09-15T12:00:00Z"), false)).toBe(true);
  });
  it("always runs a manual trigger", () => {
    expect(shouldRunFixturePollers(quiet, new Date("2026-09-15T12:07:00Z"), true)).toBe(true);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/phase4/tick-mode.test.ts`
Expected: FAIL — module `@/lib/tick-mode` not found.

- [ ] **Step 3: Implement `lib/tick-mode.ts`**

```ts
// lib/tick-mode.ts
// The pg_cron tick fires every minute. Outside match windows nothing about
// fixtures changes minute to minute, yet the fixture pollers still ran nine
// leases and several table reads each tick. Quiet mode runs them every ten
// minutes instead. FPL sync, contest locks, settlement and gameweek
// maintenance are NOT gated by this — they stay on the one-minute cadence
// so deadlines and payouts keep their latency.
type Admin = ReturnType<typeof import("./supabase/service").createServiceRoleClient>;

export type TickMode = { mode: "active" | "quiet"; reason: string };

export const ACTIVE_BEFORE_KICKOFF_MS = 2 * 3600e3;
// Kick-off + 5 h covers a normal finish (+~2 h) plus the ~3 h of post-match
// polling (result corrections, stats freeze at +30 min, commentary).
export const ACTIVE_AFTER_KICKOFF_MS = 5 * 3600e3;
export const QUIET_RUN_EVERY_MINUTES = 10;

export async function resolveTickMode(admin: Admin, now = new Date()): Promise<TickMode> {
  const since = new Date(now.getTime() - ACTIVE_AFTER_KICKOFF_MS).toISOString();
  const until = new Date(now.getTime() + ACTIVE_BEFORE_KICKOFF_MS).toISOString();
  try {
    const { data, error } = await admin
      .from("fixtures")
      .select("id")
      .not("external_id", "is", null)
      .or(
        [
          "status.eq.live",
          `and(status.eq.scheduled,kickoff_at.gte.${since},kickoff_at.lte.${until})`,
          `and(status.eq.finished,kickoff_at.gte.${since})`,
        ].join(","),
      )
      .limit(1);
    if (error) return { mode: "active", reason: `probe error: ${error.message}` };
    if (Array.isArray(data) && data.length > 0) return { mode: "active", reason: "fixture near" };
    return { mode: "quiet", reason: "no fixture near" };
  } catch (err) {
    return { mode: "active", reason: `probe threw: ${err instanceof Error ? err.message : "unknown"}` };
  }
}

export function shouldRunFixturePollers(mode: TickMode, now: Date, manual: boolean): boolean {
  if (manual || mode.mode === "active") return true;
  return now.getUTCMinutes() % QUIET_RUN_EVERY_MINUTES === 0;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/phase4/tick-mode.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Wire into the route**

In `app/api/cron/tick/route.ts`:

Add import:

```ts
import { resolveTickMode, shouldRunFixturePollers } from "@/lib/tick-mode";
```

Inside `handle`, after `const admin = createServiceRoleClient();` add:

```ts
  const now = new Date();
  const manual = req.nextUrl.searchParams.get("secret") !== null;
  const tickMode = await resolveTickMode(admin, now);
  const runFixturePollers = shouldRunFixturePollers(tickMode, now, manual);
```

and delete the later `const manual = …` line (line 68) so it is declared once.

Change the `pollScores` line to:

```ts
  const poll = runFixturePollers
    ? await pollScores(admin)                    // ESPN: live scores + near-term KO team resolution
    : { skipped: "quiet" };
```

Change the knockout line to:

```ts
  const ko = manual || (runFixturePollers && now.getMinutes() % 15 === 0)
    ? await resolveKnockoutBracket(admin)
    : { skipped: "throttled" };
```

Wrap the Phase 4 block (the `const due = …` through `const phase4 = { … }` from Task 3) so that when `runFixturePollers` is false, `phase4` is:

```ts
  const phase4 = runFixturePollers
    ? await runPhase4Block()
    : { skipped: "quiet", insights: leasedInsights };
```

where `runPhase4Block` is a local `async function` (declared inside `handle`, after `leasedInsights` is computed) whose body is exactly the Task 3 block and which returns the `phase4` object. Keep `leasedInsights` (the insights writer) outside the gate: its claim is one RPC and it already schedules itself.

Add `tickMode` and `runFixturePollers` to the JSON response, next to `fotmobEnabled`:

```ts
    tickMode,
    fixturePollers: runFixturePollers ? "ran" : "quiet",
```

- [ ] **Step 6: Extend the route test**

In `tests/phase4/cron-tick-route.test.ts`, add a mock so the mode is controllable:

```ts
vi.mock("@/lib/tick-mode", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/tick-mode")>();
  return { ...actual, resolveTickMode: vi.fn(async () => ({ mode: "active", reason: "test" })) };
});
import { resolveTickMode } from "@/lib/tick-mode";
```

Keep the default `active` so every existing assertion holds (the existing test runs at whatever wall-clock minute the suite happens to hit; with `active` the minute does not matter). Add:

```ts
  it("in quiet mode off the 10-minute boundary, skips scores and Phase 4 but still runs FPL, locks, settlement and gameweeks", async () => {
    vi.mocked(resolveTickMode).mockResolvedValueOnce({ mode: "quiet", reason: "no fixture near" });
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-15T12:07:00.000Z"));
    try {
      const response = await GET(
        new NextRequest("http://localhost/api/cron/tick", {
          headers: { authorization: "Bearer phase4-test-secret" },
        }),
      );
      const body = (await response.json()) as {
        poll: { skipped?: string }; phase4: { skipped?: string }; fixturePollers: string;
      };
      expect(response.status).toBe(200);
      expect(body.fixturePollers).toBe("quiet");
      expect(body.poll).toEqual({ skipped: "quiet" });
      expect(body.phase4.skipped).toBe("quiet");
      expect(vi.mocked(pollScores)).not.toHaveBeenCalled();
      expect(vi.mocked(reconcileMatchCache)).not.toHaveBeenCalled();
      expect(vi.mocked(pollMatchData)).not.toHaveBeenCalled();
      expect(vi.mocked(syncFpl)).toHaveBeenCalledTimes(1);
      expect(vi.mocked(lockDueContests)).toHaveBeenCalledTimes(1);
      expect(vi.mocked(settleFinishedContests)).toHaveBeenCalledTimes(1);
      expect(vi.mocked(gameweekMaintenance)).toHaveBeenCalledTimes(1);
      expect(vi.mocked(dispatchGameweekSettlements)).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("in quiet mode on the 10-minute boundary, runs the fixture pollers", async () => {
    vi.mocked(resolveTickMode).mockResolvedValueOnce({ mode: "quiet", reason: "no fixture near" });
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-15T12:10:00.000Z"));
    try {
      const response = await GET(
        new NextRequest("http://localhost/api/cron/tick", {
          headers: { authorization: "Bearer phase4-test-secret" },
        }),
      );
      const body = (await response.json()) as { fixturePollers: string };
      expect(body.fixturePollers).toBe("ran");
      expect(vi.mocked(pollScores)).toHaveBeenCalledTimes(1);
      expect(vi.mocked(reconcileMatchCache)).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
```

Add the missing imports at the top of the test for `pollScores`, `syncFpl`, `gameweekMaintenance`, `lockDueContests`, `dispatchGameweekSettlements` (they are already mocked via `vi.mock`; import the named functions the same way the file imports `settleFinishedContests`). Note the manual test uses `?secret=` which bypasses quiet mode by design; these two new tests use the `Authorization` header the cron uses.

- [ ] **Step 7: Run everything**

Run: `npx vitest run tests/phase4 && npm run typecheck && npm test && npm run build && npm run safety:phase4`
Expected: all exit 0.

- [ ] **Step 8: Commit**

```bash
git add lib/tick-mode.ts tests/phase4/tick-mode.test.ts app/api/cron/tick/route.ts tests/phase4/cron-tick-route.test.ts
git commit -m "$(cat <<'EOF'
perf(tick): run fixture pollers every 10 min when no match is near

One fixtures probe decides whether any match is live, within 2 h of
kick-off, or within 5 h after it. When none is, pollScores, knockout
resolution and the Phase 4 block run only at :00/:10/.../:50. FPL
sync, contest locks, settlement and gameweek maintenance are not
gated and keep the one-minute cadence. A manual ?secret= call always
runs everything; a failed probe means active.
EOF
)"
```

---

### Task 5: Docs, version stamp, deploy, live verification

**Files:**
- Modify: `CLAUDE.md:65-67` (Cron bullet)
- Modify: `docs/plans/implementation-notes.md` (append entry)
- Modify: `lib/version.ts` (via `node scripts/stamp-version.mjs`)

- [ ] **Step 1: Update the CLAUDE.md Cron bullet**

Replace the three-line Cron bullet with:

```md
- **Cron:** `app/api/cron/tick/route.ts` (GET/POST, `CRON_SECRET` auth) is driven by **Supabase pg_cron**
  (`net.http_post`, every minute). Every tick: `syncFpl → lockDueContests → settleFinishedContests →
  gameweekMaintenance → dispatchGameweekSettlements → insights writer`. The fixture pollers
  (`pollScores`, knockout resolution, Phase 4 block) run every minute only while a fixture is live,
  within 2 h of kick-off, or within 5 h after it (`lib/tick-mode.ts`); otherwise every 10 minutes.
  Phase 4 pollers are pre-gated by one `sync_state` read (`lib/phase4-due.ts`). Reads of
  `fixture_match_data` must name their columns — `select("*")` there was the Sept 2026 egress
  overage. No Vercel cron config.
```

- [ ] **Step 2: Append to `docs/plans/implementation-notes.md`**

Read the file's existing format first and match it. Content:

```md
## 2026-09-15 — Tick egress cut (plan 019)

Supabase free-plan egress hit 12 GB against a 5.5 GB cap. ~0.5 GB/day came from the tick's
`fixture_match_data` `select("*")` reads (~300 KB gzip × ~1,750/day). Fixes: named columns in
`reconcileMatchCache` and `pollMatchData`; one `sync_state` read before the Phase 4 claims;
quiet mode (fixture pollers every 10 min when no match is within −5 h/+2 h of kick-off).

Deviations:
- Quiet mode does not gate FPL sync, locks, settlement or gameweek maintenance (deadline and
  payout latency unchanged). Only fixture-data freshness lags, by ≤10 min, outside match windows.
- The insights writer claim stays ungated; it is one RPC and self-schedules.
- `CRON_SECRET` is stored in plaintext in `cron.job` by design (pg_net needs it). Rotating it
  means updating both the Vercel env var and the cron job command; not done here.
```

- [ ] **Step 3: Stamp, commit, push (deploys production)**

```bash
node scripts/stamp-version.mjs
git add CLAUDE.md docs/plans/implementation-notes.md docs/plans/2026-09-15-019-tick-egress-plan.md lib/version.ts
git commit -m "$(cat <<'EOF'
docs(tick): record the egress cut and stamp the release
EOF
)"
git push origin main
```

If the current branch is `feature/cashford-2`, first `git checkout main` and make sure the four task commits are on `main` (`git log --oneline -6`). If they were made on `feature/cashford-2`, fast-forward: `git checkout main && git merge --ff-only feature/cashford-2`.

- [ ] **Step 4: Confirm the deploy and a manual tick**

Wait for Vercel (about 2 minutes), then from the repo dir (`.env.local` holds `CRON_SECRET`; never print it):

```bash
set -a; source .env.local; set +a
/usr/bin/curl -s "https://cashford.vercel.app/api/cron/tick?secret=$CRON_SECRET" | python3 -c 'import json,sys; b=json.load(sys.stdin); print({k: b.get(k) for k in ["ok","tickMode","fixturePollers","fpl","gameweeks"]}); print({k: (v.get("lease") if isinstance(v, dict) else v) for k, v in b.get("phase4", {}).items()})'
```

Expected: `ok: True`, `tickMode` present, `fixturePollers: 'ran'` (manual always runs), Phase 4 entries showing `claimed`/`not_due`/`leased`, no `error` keys. If any Phase 4 step reports an error mentioning a column, stop and report — that would mean a poller reads a column the named select dropped.

- [ ] **Step 5: Verify a cron-driven tick on the real surface**

Wait 3 minutes, then query the Supabase Management API for the last five minutes of PostgREST traffic from the tick (PAT retrieval as documented in the session; run from the cashford dir with `/usr/bin/curl`):

```bash
PAT=$(security find-generic-password -s "Supabase CLI" -w | sed 's/^go-keyring-base64://' | base64 -d)
START=$(date -u -v-5M +%Y-%m-%dT%H:%M:%SZ); END=$(date -u +%Y-%m-%dT%H:%M:%SZ)
SQL="select r.method, r.path, count(*) as n from edge_logs cross join unnest(metadata) as m cross join unnest(m.request) as r where r.path like '/rest/v1/%' group by 1,2 order by n desc limit 30"
/usr/bin/curl -s -G "https://api.supabase.com/v1/projects/fwqgyycqnslafpcetjqo/analytics/endpoints/logs.all" -H "Authorization: Bearer $PAT" --data-urlencode "sql=$SQL" --data-urlencode "iso_timestamp_start=$START" --data-urlencode "iso_timestamp_end=$END" | python3 -m json.tool | head -80
```

Expected: `/rest/v1/fixture_match_data` appears at most once per 10 minutes in quiet mode (or once per minute if a match is on), and the `/rest/v1/rpc/claim_phase4_lease` count over 5 minutes is well under 40 (was 40 = 8 × 5). Record the counts in the final report.

---

## Egress estimate after this plan (for the report to Ananth)

Per minute, quiet: fixtures probe (~0.2 KB) + FPL claim RPC (~0.1 KB) + locks/settles/gameweek reads (~1 KB) + insights claim (~0.1 KB) ≈ 1.5 KB → ~2 MB/day.
Per minute, active: above + `sync_state` read (~1 KB) + Phase 4 pollers that are due (reconcile ~15 KB gz incl. fixtures/revisions, match data ~10 KB gz) ≈ 30 KB → ~1.8 MB/h. A PL weekend has ~20 active hours; midweek rounds add ~10 → ~50 MB/week ≈ 0.2 GB/month.
Total Cashford tick: ≈ 0.25 GB/month, down from ≈ 15 GB/month.

## Self-review notes

- Spec coverage: column selects (Tasks 1–2), due-check before claim (Task 3), tick quiet mode (Task 4), docs/deploy/verify (Task 5). CRON_SECRET rotation is called out, not done.
- Type consistency: `Phase4DueSnapshot.isDue(key: Phase4SyncKey)`; `TickMode = { mode, reason }`; `shouldRunFixturePollers(mode, now, manual)` used with the same argument order in route and tests.
- Every gate fails open to the previous behaviour.
