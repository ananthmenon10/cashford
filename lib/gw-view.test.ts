import { describe, expect, it } from "vitest";
import { contestsNeedingLivePicks, liveMatchCountForContest } from "./gw-view";

describe("contestsNeedingLivePicks", () => {
  const gameweekById = new Map([
    ["gw-1", { id: "gw-1" }],
    ["gw-2", { id: "gw-2" }],
    ["gw-3", { id: "gw-3" }],
  ]);

  it("includes a locked contest whose gameweek has a live fixture", () => {
    const fixtureRowsByGameweek = new Map([
      ["gw-1", [{ state: "active", fixtures: { status: "live" } }]],
    ]);
    const contests = [{ id: "c1", status: "locked" as const, gameweek_id: "gw-1" }];
    expect(contestsNeedingLivePicks(contests, gameweekById, fixtureRowsByGameweek)).toEqual(["c1"]);
  });

  it("excludes a settled contest even if its gameweek has a live-looking fixture row", () => {
    const fixtureRowsByGameweek = new Map([
      ["gw-1", [{ state: "active", fixtures: { status: "live" } }]],
    ]);
    const contests = [{ id: "c1", status: "settled" as const, gameweek_id: "gw-1" }];
    expect(contestsNeedingLivePicks(contests, gameweekById, fixtureRowsByGameweek)).toEqual([]);
  });

  it("excludes a locked contest with no live fixture (perf: this is the ~2k-row saving case)", () => {
    const fixtureRowsByGameweek = new Map([
      ["gw-2", [{ state: "active", fixtures: { status: "scheduled" } }]],
    ]);
    const contests = [{ id: "c2", status: "locked" as const, gameweek_id: "gw-2" }];
    expect(contestsNeedingLivePicks(contests, gameweekById, fixtureRowsByGameweek)).toEqual([]);
  });

  it("excludes a void fixture row from counting as live even under an active state", () => {
    const fixtureRowsByGameweek = new Map([
      ["gw-3", [{ state: "void", fixtures: { status: "live" } }]],
    ]);
    const contests = [{ id: "c3", status: "settling" as const, gameweek_id: "gw-3" }];
    expect(contestsNeedingLivePicks(contests, gameweekById, fixtureRowsByGameweek)).toEqual([]);
  });

  it("includes only the live contest among a mix", () => {
    const fixtureRowsByGameweek = new Map([
      ["gw-1", [{ state: "active", fixtures: { status: "live" } }]],
      ["gw-2", [{ state: "active", fixtures: { status: "finished" } }]],
    ]);
    const contests = [
      { id: "c1", status: "locked" as const, gameweek_id: "gw-1" },
      { id: "c2", status: "settling" as const, gameweek_id: "gw-2" },
      { id: "c-open", status: "open" as const, gameweek_id: "gw-1" },
    ];
    expect(contestsNeedingLivePicks(contests, gameweekById, fixtureRowsByGameweek)).toEqual(["c1"]);
  });
});

// Step 6A round 2 — item 8: contestsNeedingLivePicks and loadGameweekView's homeFactByContest
// loop both need "how many of this contest's fixtures are live right now" and previously each
// carried its own copy of that filter with nothing pinning them together. This test locks the
// shared liveMatchCountForContest helper's output to what contestsNeedingLivePicks's gating
// depends on (count > 0), so the two call sites can never silently diverge again.
describe("liveMatchCountForContest — shared by contestsNeedingLivePicks and loadGameweekView's homeFactByContest loop", () => {
  const gameweekById = new Map([["gw-1", { id: "gw-1" }]]);

  it("counts only active+live rows, matching contestsNeedingLivePicks' inclusion decision", () => {
    const fixtureRowsByGameweek = new Map([
      [
        "gw-1",
        [
          { state: "active", fixtures: { status: "live" } },
          { state: "active", fixtures: { status: "finished" } },
          { state: "void", fixtures: { status: "live" } },
        ],
      ],
    ]);
    const contest = { gameweek_id: "gw-1" };
    const count = liveMatchCountForContest(contest, gameweekById, fixtureRowsByGameweek);
    expect(count).toBe(1);
    const included = contestsNeedingLivePicks(
      [{ id: "c1", status: "locked" as const, gameweek_id: "gw-1" }],
      gameweekById,
      fixtureRowsByGameweek,
    );
    expect(included.length > 0).toBe(count > 0);
  });

  it("returns 0 for a gameweek not present in the map, same as contestsNeedingLivePicks excluding it", () => {
    const contest = { gameweek_id: "gw-unknown" };
    expect(liveMatchCountForContest(contest, gameweekById, new Map())).toBe(0);
  });
});
