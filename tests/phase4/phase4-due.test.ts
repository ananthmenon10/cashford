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
