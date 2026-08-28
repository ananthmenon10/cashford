import { describe, expect, it } from "vitest";
import { buildPointGrid, type PointGridView } from "../../lib/point-grid";

const fixture = (
  fixtureId: string,
  kickoffAt: string | null,
  extra: Partial<Parameters<typeof buildPointGrid>[0]["fixtures"][number]> = {},
) => ({
  fixtureId,
  externalId: null,
  homeName: `${fixtureId} home`,
  awayName: `${fixtureId} away`,
  kickoffAt,
  status: "scheduled",
  minute: null,
  homeScore: null,
  awayScore: null,
  state: "active" as const,
  matchHref: `/matches/${fixtureId}`,
  ...extra,
});

const baseInput = (overrides: Partial<Parameters<typeof buildPointGrid>[0]> = {}) => ({
  leagueId: "league-1",
  leagueName: "Test League",
  gameweekNumber: 4,
  viewerId: "user-1",
  mode: "live" as const,
  entries: [
    {
      entryId: "entry-1",
      userId: "user-1",
      name: "Ananth Menon",
      status: "locked_in",
      picks: [
        { fixtureId: "one", predHome: 2, predAway: 1 },
        { fixtureId: "two", predHome: 0, predAway: 1 },
      ],
    },
  ],
  fixtures: [fixture("one", "2026-08-15T15:00:00.000Z"), fixture("two", "2026-08-15T13:00:00.000Z")],
  snapshots: {},
  ...overrides,
});

describe("point grid", () => {
  it("keeps locked-in entrants in input order and derives initials", () => {
    const view = buildPointGrid(
      baseInput({
        entries: [
          ...baseInput().entries,
          {
            entryId: "entry-2",
            userId: "user-2",
            name: "Not Locked",
            status: "entered",
            picks: [],
          },
          {
            entryId: "entry-3",
            userId: "user-3",
            name: "Riya K",
            status: "locked_in",
            picks: [],
          },
        ],
      }),
    );

    expect(view.entrants.map(({ entryId, initials }) => ({ entryId, initials }))).toEqual([
      { entryId: "entry-1", initials: "AM" },
      { entryId: "entry-3", initials: "RK" },
    ]);
    expect(view.entrants.map(({ isViewer }) => isViewer)).toEqual([true, false]);
  });

  it("maps exact, result, miss, and void grades to points and verdicts", () => {
    const view = buildPointGrid(
      baseInput({
        entries: [
          {
            entryId: "entry-1",
            userId: "user-1",
            name: "A",
            status: "locked_in",
            picks: [
              { fixtureId: "exact", predHome: 2, predAway: 1 },
              { fixtureId: "result", predHome: 3, predAway: 1 },
              { fixtureId: "miss", predHome: 2, predAway: 0 },
              { fixtureId: "void", predHome: 1, predAway: 1 },
            ],
          },
        ],
        fixtures: [
          fixture("exact", "2026-08-15T13:00:00.000Z", { homeScore: 2, awayScore: 1, status: "finished" }),
          fixture("result", "2026-08-15T14:00:00.000Z", { homeScore: 2, awayScore: 0, status: "finished" }),
          fixture("miss", "2026-08-15T15:00:00.000Z", { homeScore: 1, awayScore: 2, status: "finished" }),
          fixture("void", "2026-08-15T16:00:00.000Z", { state: "void", status: "void" }),
        ],
      }),
    );

    expect(view.rows.map(({ cells }) => cells[0])).toEqual([
      { pick: [2, 1], points: 3, verdict: "exact" },
      { pick: [3, 1], points: 1, verdict: "result" },
      { pick: [2, 0], points: 0, verdict: "miss" },
      { pick: [1, 1], points: 0, verdict: "void" },
    ]);
    expect(view.entrants[0].totalPoints).toBe(4);
  });

  it("keeps upcoming picks visible without grading them", () => {
    const view = buildPointGrid(baseInput());

    expect(view.rows.find(({ fixture }) => fixture.fixtureId === "one")?.cells[0]).toEqual({
      pick: [2, 1],
      points: null,
      verdict: null,
    });
    expect(view.entrants[0].totalPoints).toBeNull();
  });

  it("grades a live score when both score fields are present", () => {
    const view = buildPointGrid(
      baseInput({
        fixtures: [
          fixture("one", "2026-08-15T13:00:00.000Z", {
            status: "live",
            minute: 67,
            homeScore: 2,
            awayScore: 1,
          }),
        ],
      }),
    );

    expect(view.rows[0].cells[0]).toEqual({ pick: [2, 1], points: 3, verdict: "exact" });
    expect(view.entrants[0].totalPoints).toBe(3);
  });

  it("only grades active fixtures with exactly live or finished status", () => {
    const view = buildPointGrid(
      baseInput({
        entries: [
          {
            entryId: "entry-1",
            userId: "user-1",
            name: "Ananth Menon",
            status: "locked_in",
            picks: [
              { fixtureId: "live", predHome: 2, predAway: 1 },
              { fixtureId: "finished", predHome: 1, predAway: 0 },
              { fixtureId: "scheduled", predHome: 3, predAway: 0 },
              { fixtureId: "postponed", predHome: 0, predAway: 2 },
            ],
          },
        ],
        fixtures: [
          fixture("live", "2026-08-15T13:00:00.000Z", { status: "live", homeScore: 2, awayScore: 1 }),
          fixture("finished", "2026-08-15T14:00:00.000Z", { status: "finished", homeScore: 1, awayScore: 0 }),
          fixture("scheduled", "2026-08-15T15:00:00.000Z", { status: "scheduled", homeScore: 3, awayScore: 0 }),
          fixture("postponed", "2026-08-15T16:00:00.000Z", { status: "postponed", homeScore: 0, awayScore: 2 }),
        ],
      }),
    );

    expect(view.rows.map(({ cells }) => cells[0])).toEqual([
      { pick: [2, 1], points: 3, verdict: "exact" },
      { pick: [1, 0], points: 3, verdict: "exact" },
      { pick: [3, 0], points: null, verdict: null },
      { pick: [0, 2], points: null, verdict: null },
    ]);
    expect(view.entrants[0].totalPoints).toBe(6);
  });

  it("uses settled snapshots for totals and cells, including a stored void", () => {
    const view = buildPointGrid(
      baseInput({
        mode: "settled",
        fixtures: [fixture("one", "2026-08-15T13:00:00.000Z"), fixture("two", "2026-08-15T14:00:00.000Z")],
        snapshots: {
          "entry-1": {
            totalPoints: 0,
            cells: {
              one: { points: 0, verdict: "void" },
            },
          },
        },
      }),
    );

    expect(view.entrants[0].totalPoints).toBe(0);
    expect(view.rows.map(({ cells }) => cells[0])).toEqual([
      { pick: [2, 1], points: 0, verdict: "void" },
      { pick: [0, 1], points: null, verdict: null },
    ]);
  });

  it("uses settled snapshot cells and totals over conflicting fixture scores", () => {
    const view = buildPointGrid(
      baseInput({
        mode: "settled",
        entries: [
          {
            entryId: "entry-1",
            userId: "user-1",
            name: "Ananth Menon",
            status: "locked_in",
            picks: [
              { fixtureId: "one", predHome: 2, predAway: 1 },
              { fixtureId: "two", predHome: 0, predAway: 1 },
            ],
          },
        ],
        fixtures: [
          fixture("one", "2026-08-15T13:00:00.000Z", { status: "finished", homeScore: 2, awayScore: 1 }),
          fixture("two", "2026-08-15T14:00:00.000Z", { status: "finished", homeScore: 0, awayScore: 1 }),
        ],
        snapshots: {
          "entry-1": {
            totalPoints: 7,
            cells: {
              one: { points: 0, verdict: "miss" },
              two: { points: 3, verdict: "exact" },
            },
          },
        },
      }),
    );

    expect(view.entrants[0].totalPoints).toBe(7);
    expect(view.rows.map(({ cells }) => cells[0])).toEqual([
      { pick: [2, 1], points: 0, verdict: "miss" },
      { pick: [0, 1], points: 3, verdict: "exact" },
    ]);
  });

  it("uses kickoff, external ID, and fixture ID ordering", () => {
    const view = buildPointGrid(
      baseInput({
        fixtures: [
          fixture("id-z", "2026-08-15T13:00:00.000Z", { externalId: 20 }),
          fixture("id-b", "2026-08-15T13:00:00.000Z", { externalId: 3 }),
          fixture("id-a", "2026-08-15T13:00:00.000Z", { externalId: null }),
        ],
      }),
    );

    expect(view.rows.map(({ fixture }) => fixture.fixtureId)).toEqual(["id-a", "id-z", "id-b"]);
  });

  it("uses the first and last words for initials and the first two letters for one word", () => {
    const view = buildPointGrid(
      baseInput({
        entries: [
          { entryId: "one", userId: "one", name: "pele", status: "locked_in", picks: [] },
          { entryId: "two", userId: "two", name: "  Ada   Lovelace   Byron ", status: "locked_in", picks: [] },
        ],
      }),
    );

    expect(view.entrants.map(({ initials }) => initials)).toEqual(["PE", "AB"]);
  });

  it("preserves a supplied non-empty initials value", () => {
    const view = buildPointGrid(
      baseInput({
        entries: [{ entryId: "entry-1", userId: "user-1", name: "Ananth Menon", initials: "XY", status: "locked_in", picks: [] }],
      }),
    );

    expect(view.entrants[0].initials).toBe("XY");
  });

  it("returns no live total until a fixture has a live, final, or void grade", () => {
    const views: PointGridView[] = [
      buildPointGrid(baseInput()),
      buildPointGrid(baseInput({ entries: [{ ...baseInput().entries[0], picks: [] }] })),
    ];

    expect(views.map((view) => view.entrants[0].totalPoints)).toEqual([null, null]);
  });
});
