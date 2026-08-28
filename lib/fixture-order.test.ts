import { describe, expect, it } from "vitest";
import { compareFixtureKickoff, sortFixturesByKickoff } from "./fixture-order";

type Row = {
  id: string;
  kickoffAt: string | null;
  externalId?: number | string | null;
};

describe("fixture kickoff ordering", () => {
  it("sorts an unsorted list by kickoff ascending", () => {
    const rows: Row[] = [
      { id: "late", kickoffAt: "2026-08-15T15:00:00.000Z" },
      { id: "early", kickoffAt: "2026-08-15T13:00:00.000Z" },
    ];

    expect(sortFixturesByKickoff(rows).map((row) => row.id)).toEqual(["early", "late"]);
    expect(rows.map((row) => row.id)).toEqual(["late", "early"]);
  });

  it("uses external IDs as string ties when both fixtures have one", () => {
    const kickoffAt = "2026-08-15T13:00:00.000Z";
    const rows: Row[] = [
      { id: "fixture-b", kickoffAt, externalId: 3 },
      { id: "fixture-a", kickoffAt, externalId: 20 },
    ];

    expect(sortFixturesByKickoff(rows).map((row) => row.id)).toEqual([
      "fixture-a",
      "fixture-b",
    ]);
  });

  it("falls back to row IDs when an external ID is missing", () => {
    const kickoffAt = "2026-08-15T13:00:00.000Z";
    const rows: Row[] = [
      { id: "fixture-z", kickoffAt, externalId: null },
      { id: "fixture-a", kickoffAt, externalId: 20 },
    ];

    expect(sortFixturesByKickoff(rows).map((row) => row.id)).toEqual([
      "fixture-a",
      "fixture-z",
    ]);
  });

  it("puts missing kickoff values after dated fixtures", () => {
    const rows: Row[] = [
      { id: "tbc", kickoffAt: null },
      { id: "dated", kickoffAt: "2026-08-15T13:00:00.000Z" },
    ];

    expect(sortFixturesByKickoff(rows).map((row) => row.id)).toEqual(["dated", "tbc"]);
  });

  it("orders two missing kickoffs by external ID regardless of input order", () => {
    const first: Row = { id: "zzz", kickoffAt: null, externalId: "999" };
    const second: Row = { id: "aaa", kickoffAt: null, externalId: "111" };

    expect(Number.isNaN(compareFixtureKickoff(first, second))).toBe(false);
    expect(compareFixtureKickoff(first, second)).toBeGreaterThan(0);
    expect(sortFixturesByKickoff([first, second]).map((row) => row.id)).toEqual(["aaa", "zzz"]);
    expect(sortFixturesByKickoff([second, first]).map((row) => row.id)).toEqual(["aaa", "zzz"]);
  });

  it("orders two missing kickoffs by row ID when external IDs are absent", () => {
    const first: Row = { id: "zzz", kickoffAt: null };
    const second: Row = { id: "aaa", kickoffAt: null };

    expect(Number.isNaN(compareFixtureKickoff(first, second))).toBe(false);
    expect(compareFixtureKickoff(first, second)).toBeGreaterThan(0);
    expect(sortFixturesByKickoff([first, second]).map((row) => row.id)).toEqual(["aaa", "zzz"]);
    expect(sortFixturesByKickoff([second, first]).map((row) => row.id)).toEqual(["aaa", "zzz"]);
  });

  it("orders two invalid kickoffs deterministically using the external-ID tie-break", () => {
    const first: Row = { id: "fixture-z", kickoffAt: "not-a-date", externalId: 20 };
    const second: Row = { id: "fixture-a", kickoffAt: "still-not-a-date", externalId: 3 };

    expect(Number.isNaN(compareFixtureKickoff(first, second))).toBe(false);
    expect(sortFixturesByKickoff([first, second]).map((row) => row.id)).toEqual([
      "fixture-z",
      "fixture-a",
    ]);
    expect(sortFixturesByKickoff([second, first]).map((row) => row.id)).toEqual([
      "fixture-z",
      "fixture-a",
    ]);
  });

  it("provides a deterministic comparator for equal rows", () => {
    expect(
      compareFixtureKickoff(
        { id: "fixture-a", kickoffAt: "2026-08-15T13:00:00.000Z" },
        { id: "fixture-b", kickoffAt: "2026-08-15T13:00:00.000Z" },
      ),
    ).toBeLessThan(0);
  });
});
