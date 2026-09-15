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

  it("fails open to active when the probe returns a non-array payload", async () => {
    // Every other failure path fails open. A null data with no error must not be
    // the one branch that falls closed and silences the fixture pollers.
    const { admin } = probeAdmin({ data: null, error: null });
    expect((await resolveTickMode(admin as never, NOW)).mode).toBe("active");
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
