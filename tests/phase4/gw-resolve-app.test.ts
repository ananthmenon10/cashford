import { describe, expect, it } from "vitest";
import {
  resolveAppGameweek,
  resolveGameweekAccess,
  resolveGameweekFocus,
} from "../../lib/gw-resolve-app";
import type { ContestLifecycle } from "../../lib/gw-state";

const now = new Date("2026-02-03T12:00:00.000Z");
const gw = (
  id: string,
  number: number,
  deadlineAt: string | null,
) => ({
  id,
  number,
  label: `GW ${number}`,
  deadlineAt: deadlineAt ? new Date(deadlineAt) : null,
});
const contest = (
  gwId: string,
  leagueId: string,
  cl: ContestLifecycle,
) => ({
  gwId,
  leagueId,
  status: "locked" as const,
  deadlineAt: new Date("2026-02-03T10:00:00.000Z"),
  inputVersion: 1,
  cl,
});

function resolve(input: {
  archived?: boolean;
  gameweeks: ReturnType<typeof gw>[];
  contests: ReturnType<typeof contest>[];
}) {
  return resolveAppGameweek({
    competition: { id: "pl", archived: !!input.archived },
    gameweeks: input.gameweeks,
    contests: input.contests,
    results: [],
    viewerLeagueIds: ["a", "b"],
    now,
  });
}

describe("app gameweek resolution", () => {
  it("keeps locked GW3 current while GW4 is next-open", () => {
    const result = resolve({
      gameweeks: [
        gw("gw3", 3, "2026-02-03T10:00:00.000Z"),
        gw("gw4", 4, "2026-02-10T10:00:00.000Z"),
      ],
      contests: [
        contest("gw3", "a", "CL2"),
        contest("gw4", "a", "CL1"),
      ],
    });
    expect(result.currentGw?.number).toBe(3);
    expect(result.nextOpenGw?.number).toBe(4);
  });

  it("reports overlap and uses the highest unresolved gameweek", () => {
    const result = resolve({
      gameweeks: [
        gw("gw2", 2, "2026-01-27T10:00:00.000Z"),
        gw("gw3", 3, "2026-02-03T10:00:00.000Z"),
      ],
      contests: [contest("gw2", "a", "CL3"), contest("gw3", "a", "CL10")],
    });
    expect(result.currentGw?.number).toBe(3);
    expect(result.overlapAlert).toEqual({ gws: [2, 3] });
  });

  it("treats CL7 as settled and CL0 as neither current nor settled", () => {
    const settled = resolve({
      gameweeks: [gw("gw2", 2, "2026-01-27T10:00:00.000Z")],
      contests: [contest("gw2", "a", "CL7")],
    });
    expect(settled.latestSettledGw?.number).toBe(2);
    const blank = resolve({
      gameweeks: [gw("gw3", 3, "2026-02-03T10:00:00.000Z")],
      contests: [contest("gw3", "a", "CL0")],
    });
    expect(blank.currentGw).toBeNull();
    expect(blank.latestSettledGw).toBeNull();
  });

  it("archives keep only the latest clean settled gameweek", () => {
    const result = resolve({
      archived: true,
      gameweeks: [
        gw("gw37", 37, "2026-05-10T10:00:00.000Z"),
        gw("gw38", 38, "2026-05-17T10:00:00.000Z"),
      ],
      contests: [contest("gw37", "a", "CL5"), contest("gw38", "a", "CL8")],
    });
    expect(result).toMatchObject({
      currentGw: null,
      nextOpenGw: null,
      latestSettledGw: { number: 37 },
      overlapAlert: null,
    });
  });

  it("skips a future gameweek whose deadline is unknown", () => {
    const result = resolve({
      gameweeks: [gw("gw4", 4, null)],
      contests: [contest("gw4", "a", "CL1")],
    });
    expect(result.nextOpenGw).toBeNull();
  });

  it("does not treat a gameweek with no contest as next-open", () => {
    const result = resolve({
      gameweeks: [gw("gw4", 4, "2026-02-10T10:00:00.000Z")],
      contests: [],
    });
    expect(result.nextOpenGw).toBeNull();
  });

  it("uses the same focus order as the Matches tab", () => {
    const resolution = resolve({
      gameweeks: [
        gw("gw2", 2, "2026-01-27T10:00:00.000Z"),
        gw("gw3", 3, "2026-02-03T10:00:00.000Z"),
        gw("gw4", 4, "2026-02-10T10:00:00.000Z"),
      ],
      contests: [
        contest("gw2", "a", "CL5"),
        contest("gw3", "a", "CL3"),
        contest("gw4", "a", "CL1"),
      ],
    });
    expect(resolveGameweekFocus(resolution)?.number).toBe(3);
    expect(resolveGameweekAccess({
      resolution,
      gameweeks: [
        { id: "gw2", number: 2, label: "GW 2" },
        { id: "gw3", number: 3, label: "GW 3" },
        { id: "gw4", number: 4, label: "GW 4" },
      ],
      lifecycleByGameweekId: new Map([
        ["gw2", "CL5" as const],
        ["gw3", "CL3" as const],
        ["gw4", "CL1" as const],
      ]),
    })).toEqual({
      now: { id: "gw3", number: 3, label: "GW 3", lifecycle: "CL3" },
      last: { id: "gw2", number: 2, label: "GW 2", lifecycle: "CL5" },
    });
  });

  it("keeps the last terminal gameweek even when it is void", () => {
    const resolution = resolve({
      gameweeks: [gw("gw2", 2, "2026-01-27T10:00:00.000Z")],
      contests: [contest("gw2", "a", "CL7")],
    });
    expect(resolveGameweekAccess({
      resolution,
      gameweeks: [{ id: "gw2", number: 2, label: "GW 2" }],
      lifecycleByGameweekId: new Map([["gw2", "CL7" as const]]),
    }).last?.lifecycle).toBe("CL7");
  });
});
