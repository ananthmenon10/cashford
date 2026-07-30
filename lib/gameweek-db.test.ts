import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import { dispatchGameweekSettlements, leagueNetByUser } from "./gameweek-db";

const MIGRATION = "supabase/migrations/20260727000002_gameweek_entries.sql";

function routineBody(name: string) {
  const sql = readFileSync(MIGRATION, "utf8");
  const start = sql.indexOf(`create or replace function cashford.${name}(`);
  if (start < 0) throw new Error(`${name} is not in the migration`);
  const end = sql.indexOf("\n$$;", start);
  return sql.slice(start, end);
}

// A stand-in for the Supabase query builder: records the select string it was handed and
// returns whatever the test told it to return.
function fakeReader(
  results: Record<string, { data?: unknown[]; error?: { message: string } }>,
  seen: Record<string, string> = {},
) {
  return {
    from(table: string) {
      const chain: any = {
        select(cols: string) {
          seen[table] = cols;
          return chain;
        },
        eq() {
          return Promise.resolve(results[table] ?? { data: [], error: null });
        },
      };
      return chain;
    },
  };
}

describe("leagueNetByUser", () => {
  it("adds the legacy cup era and the gameweek era into one net per member", async () => {
    const net = await leagueNetByUser(
      fakeReader({
        contest_results: { data: [{ user_id: "u1", net_inr: 300 }, { user_id: "u2", net_inr: -300 }] },
        gameweek_entry_results: {
          data: [
            { net_inr: 34, gameweek_entries: { user_id: "u1" } },
            { net_inr: -34, gameweek_entries: { user_id: "u3" } },
          ],
        },
      }),
      "league-1",
      ["u1", "u2", "u3", "u4"],
    );

    expect(net).toEqual({ u1: 334, u2: -300, u3: -34, u4: 0 });
  });

  // gameweek_entry_results has two foreign keys to gameweek_entries, so an unhinted embed is
  // ambiguous and PostgREST refuses it. Swallowing that error would show every settled
  // gameweek as ₹0 owed, which is exactly the kind of silence Dues must never have.
  it("names the foreign key it follows, using one that the migration actually declares", () => {
    const seen: Record<string, string> = {};
    void leagueNetByUser(fakeReader({}, seen), "league-1");
    expect(seen.gameweek_entry_results).toContain(
      "gameweek_entries!gameweek_entry_results_entry_id_fkey",
    );

    const sql = readFileSync("supabase/migrations/20260727000002_gameweek_entries.sql", "utf8");
    const table = sql.slice(sql.indexOf("create table if not exists cashford.gameweek_entry_results"));
    const body = table.slice(0, table.indexOf(");"));
    // Postgres derives gameweek_entry_results_entry_id_fkey from this inline reference, and the
    // composite below it is the second, ambiguous-making key.
    expect(body).toMatch(/entry_id\s+uuid primary key\s*\n?\s*references cashford\.gameweek_entries/);
    expect(body).toContain("foreign key (entry_id, gameweek_contest_id)");
  });

  it("throws rather than reporting zero when either era fails to read", async () => {
    await expect(
      leagueNetByUser(
        fakeReader({ gameweek_entry_results: { error: { message: "ambiguous relationship" } } }),
        "league-1",
      ),
    ).rejects.toThrow(/gameweek_entry_results read failed: ambiguous relationship/);

    await expect(
      leagueNetByUser(
        fakeReader({ contest_results: { error: { message: "boom" } } }),
        "league-1",
      ),
    ).rejects.toThrow(/contest_results read failed: boom/);
  });
});

// A fake service client for the dispatcher: answers rpc() from a script keyed by routine name.
function fakeAdmin(script: {
  candidates?: { data?: unknown; error?: { message: string } };
  claims?: Record<string, unknown>;
  calls?: string[][];
}) {
  const calls = script.calls ?? [];
  return {
    calls,
    from: () => ({ insert: async () => ({ data: null, error: null }) }),
    async rpc(name: string, args: Record<string, unknown>) {
      calls.push([name, JSON.stringify(args)]);
      if (name === "gameweek_settlement_candidates") {
        return script.candidates ?? { data: [], error: null };
      }
      if (name === "claim_gameweek_settlement") {
        const id = args.p_contest_id as string;
        return { data: script.claims?.[id] ?? { claimed: false, reason: "not ready" }, error: null };
      }
      return { data: null, error: null };
    },
  } as any;
}

describe("dispatchGameweekSettlements", () => {
  // A silent zero here is the worst outcome the worker has: an unreachable candidate scan means
  // no pot is ever settled and the tick still reports success. It has to be a loud failure.
  it("throws when the candidate scan fails instead of reporting an empty tick", async () => {
    await expect(
      dispatchGameweekSettlements(fakeAdmin({ candidates: { error: { message: "no such function" } } })),
    ).rejects.toThrow(/candidate scan failed: no such function/);
  });

  it("passes its limit to the routine and tries every row the routine returned, in order", async () => {
    const admin = fakeAdmin({
      candidates: {
        data: [
          { gameweek_contest_id: "p-expired", reason: "expired" },
          { gameweek_contest_id: "p-dirty", reason: "dirty" },
          { gameweek_contest_id: "p-corrupt", reason: "corrupt" },
        ],
      },
    });

    const out = await dispatchGameweekSettlements(admin, { limit: 7 });

    expect(admin.calls[0]).toEqual(["gameweek_settlement_candidates", JSON.stringify({ p_limit: 7 })]);
    // The DB decides the priority; the worker must not re-sort or filter it.
    expect(admin.calls.slice(1).map((c: string[]) => JSON.parse(c[1]).p_contest_id)).toEqual([
      "p-expired",
      "p-dirty",
      "p-corrupt",
    ]);
    expect(out.scanned).toBe(3);
  });
});

// The routine — not the client — is where the queue contract lives, because the limit and the
// predicates have to be applied in the same statement. These pin the three properties the
// dispatcher depends on and cannot check for itself. Behaviour is proved against a real
// Postgres in scripts/disposable-db/round2-test.sql; these keep the SQL from drifting back.
describe("gameweek_settlement_candidates contract", () => {
  const body = routineBody("gameweek_settlement_candidates");

  it("applies every predicate before the limit", () => {
    // One statement, so LIMIT is the last thing in it: anything that filtered after the limit
    // would let clean or unactionable rows consume the queue.
    const limitAt = body.lastIndexOf("limit greatest");
    expect(limitAt).toBeGreaterThan(0);
    expect(body.slice(limitAt)).not.toMatch(/\bwhere\b/);
    for (const predicate of ["'expired'", "'corrupt'", "'dirty'", "'ready'"]) {
      expect(body.indexOf(predicate)).toBeLessThan(limitAt);
    }
  });

  it("ranks the money-bearing reasons above corrupt, then oldest deadline first", () => {
    // Corrupt rows only ever produce a sync_issue. Ranking them first is what starved a real
    // expired claim behind a persistent pile of them.
    const order = body.slice(body.lastIndexOf("order by case"));
    expect(order).toMatch(
      /when 'expired' then 0\s+when 'dirty' then 1\s+when 'ready'\s+then 2 else 3 end,\s+g\.deadline_at, g\.id/,
    );
  });

  it("stops returning a corrupt row once its unresolved issue is on file", () => {
    // The worker cannot repair a corrupt row, so it must leave the queue after one dispatch or
    // it occupies the queue forever and nothing actionable is ever reached.
    expect(body).toMatch(/s\.reason <> 'corrupt'\s+or not exists \(/);
    expect(body).toContain("si.kind = 'missing-result-row'");
    expect(body).toContain("si.resolved_at is null");
  });

  // Round 3. 'expired' ranks FIRST and is admitted with no entrant or readiness gate, because
  // releasing an abandoned claim is the only thing that clears it. The other half of that bargain
  // is that the claim routine must never refuse an expired row and leave it in 'settling' — 40 of
  // those on 0/1-entrant pots owned the whole queue and the dirty pot behind them never ran.
  // Behaviour is proved in scripts/disposable-db/round3-{test.sql,proof.mts}; these pin the shape.
  describe("release-or-reclaim rule", () => {
    const claim = routineBody("claim_gameweek_settlement");

    it("decides expiry before the first validation gate, not after it", () => {
      // The ordering IS the fix. A validation added ahead of the expiry calculation re-opens the
      // hole, whichever validation it is.
      expect(claim.indexOf("v_expired :=")).toBeLessThan(claim.indexOf("v_locked_in < 2"));
    });

    it("routes both refusals reachable while settling through the one release routine", () => {
      const calls = claim.match(/cashford\.release_expired_gameweek_claim\(/g) ?? [];
      expect(calls).toHaveLength(2);
      expect(claim).toContain("'expired-under-min-entrants'");
      expect(claim).toContain("'expired-unready'");
    });

    it("uses the same definition of expired as the scan, including a missing claim stamp", () => {
      // A row one of them calls expired and the other refuses is a permanent rank-0 candidate.
      for (const src of [claim, body]) {
        expect(src).toContain("claim_started_at is null");
        expect(src).toContain("interval '10 minutes'");
      }
    });
  });

  it("files that issue exactly once per corrupt row", () => {
    const claim = routineBody("claim_gameweek_settlement");
    const insert = claim.slice(claim.indexOf("'missing-result-row'"));
    // insert … select … where not exists, not insert … values: values would append a duplicate
    // finding on every single tick.
    expect(insert).toMatch(/where not exists \(\s*select 1 from cashford\.sync_issues si/);
  });
});

// Round 3, finding 2. The deadlock was a lock-STRENGTH problem: FOR UPDATE on a leagues row
// refuses the FOR KEY SHARE that another transaction's foreign-key insert needs, so maintenance
// provisioning a pot and a repeated join waiting on a member_competitions row closed a cycle.
// The two-session proof lives in scripts/disposable-db/round3-proof.mts (and reproduces the 40P01
// against the old body); this pins the rule for every routine in both migrations.
describe("leagues row lock strength", () => {
  const files = [
    "supabase/migrations/20260727000001_competitions_gameweeks.sql",
    MIGRATION,
  ].map((f) => readFileSync(f, "utf8"));

  it("is FOR NO KEY UPDATE in the definition of join_league that ends up deployed", () => {
    // Migrations apply in filename order, so the last definition wins. Phase 1's text stays as it
    // was applied and reviewed; Phase 2 replaces the routine.
    const last = files
      .flatMap((sql) => [...sql.matchAll(/create or replace function cashford\.join_league\(/g)]
        .map((m) => sql.slice(m.index!, sql.indexOf("\n$$;", m.index!))))
      .at(-1)!;
    expect(last).toMatch(/from cashford\.leagues where id = v_inv\.league_id for no key update/);
    // Lock strength only: the guard and both idempotent inserts are Phase 1's.
    expect(last).toContain("join_league: league is archived");
    expect(last).toContain("on conflict (league_id, user_id) do nothing");
    expect(last).toContain("on conflict (league_id, user_id, competition_id) do nothing");
  });

  it("is never stronger than that anywhere Phase 2 defines a routine", () => {
    expect(files[1]).not.toMatch(/cashford\.leagues[^;]*\bfor update\b/);
    // Phase 1's text keeps its FOR UPDATE — it is applied and reviewed, and this is the one and
    // only place it survives, which is exactly the routine Phase 2 replaces above. The live check
    // over every deployed routine is in scripts/disposable-db/round3-test.sql.
    const strong = [...files[0].matchAll(/cashford\.leagues[^;]*\bfor update\b/g)];
    expect(strong).toHaveLength(1);
    const joinAt = files[0].indexOf("create or replace function cashford.join_league(");
    expect(strong[0].index!).toBeGreaterThan(joinAt);
  });
});
