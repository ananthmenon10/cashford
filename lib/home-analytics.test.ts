import { describe, expect, it } from "vitest";

import { viewerHasSettledCupHistory } from "./home-analytics";

type Row = Record<string, unknown>;

function nestedValue(row: Row, path: string): unknown {
  return path.split(".").reduce<unknown>((value, key) => {
    const current = Array.isArray(value) ? value[0] : value;
    return current && typeof current === "object"
      ? (current as Row)[key]
      : undefined;
  }, row);
}

function fakeReader(
  tables: Record<string, readonly Row[]>,
  errors: Record<string, { message: string }> = {},
) {
  return {
    from(table: string) {
      const filters: Array<(row: Row) => boolean> = [];
      let rowLimit: number | null = null;
      const chain: any = {
        select: () => chain,
        eq: (field: string, value: unknown) => {
          filters.push((row) => nestedValue(row, field) === value);
          return chain;
        },
        in: (field: string, values: readonly unknown[]) => {
          filters.push((row) => values.includes(nestedValue(row, field)));
          return chain;
        },
        not: (field: string, operator: string, value: unknown) => {
          if (operator === "is" && value === null) {
            filters.push((row) => nestedValue(row, field) != null);
          }
          return chain;
        },
        limit: (value: number) => {
          rowLimit = value;
          return chain;
        },
        then: (
          resolve: (value: { data: Row[]; error: { message: string } | null }) => unknown,
          reject?: (reason: unknown) => unknown,
        ) => {
          const error = errors[table] ?? null;
          const data = (tables[table] ?? [])
            .filter((row) => filters.every((matches) => matches(row)))
            .slice(0, rowLimit ?? undefined) as Row[];
          return Promise.resolve({ data, error }).then(resolve, reject);
        },
      };
      return chain;
    },
  };
}

function finishedResult() {
  return {
    contest_id: "contest-finished",
    user_id: "viewer",
    contests: { fixtures: { ft_home: 2, ft_away: 1 } },
  };
}

describe("viewerHasSettledCupHistory", () => {
  it("is true when a finished contest has both the viewer's prediction and result", async () => {
    const reader = fakeReader({
      contest_results: [finishedResult()],
      predictions: [{ contest_id: "contest-finished", user_id: "viewer" }],
    });

    await expect(viewerHasSettledCupHistory(reader as never, "viewer")).resolves.toBe(true);
  });

  it("is false when the viewer result belongs to an unfinished fixture", async () => {
    const reader = fakeReader({
      contest_results: [{
        ...finishedResult(),
        contests: { fixtures: { ft_home: null, ft_away: null } },
      }],
      predictions: [{ contest_id: "contest-finished", user_id: "viewer" }],
    });

    await expect(viewerHasSettledCupHistory(reader as never, "viewer")).resolves.toBe(false);
  });

  it("is false when the viewer has a prediction but no result", async () => {
    const reader = fakeReader({
      contest_results: [],
      predictions: [{ contest_id: "contest-finished", user_id: "viewer" }],
    });

    await expect(viewerHasSettledCupHistory(reader as never, "viewer")).resolves.toBe(false);
  });

  it("is false when the viewer has a result but no prediction", async () => {
    const reader = fakeReader({ contest_results: [finishedResult()], predictions: [] });

    await expect(viewerHasSettledCupHistory(reader as never, "viewer")).resolves.toBe(false);
  });

  it("throws when either history read fails", async () => {
    const reader = fakeReader(
      { contest_results: [], predictions: [] },
      { contest_results: { message: "history unavailable" } },
    );

    await expect(viewerHasSettledCupHistory(reader as never, "viewer"))
      .rejects.toThrow("analytics-history-results: history unavailable");
  });
});
