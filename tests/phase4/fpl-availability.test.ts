import { describe, expect, it } from "vitest";
import {
  parseAvailability,
  teamNewsForFixture,
} from "../../lib/fpl-availability";
import bootstrap from "../fixtures/fpl/bootstrap-availability.json";

describe("FPL availability adapter", () => {
  it("parses a whole bootstrap availability snapshot", () => {
    const rows = parseAvailability(bootstrap);
    expect(rows).toHaveLength(3);
    expect(rows?.[1]).toMatchObject({
      name: "Odegaard",
      status: "d",
      chanceOfPlaying: 75,
    });
  });

  it("A-18: rejects a malformed player id", () => {
    expect(
      parseAvailability({
        teams: bootstrap.teams,
        elements: [{ ...bootstrap.elements[0], id: 0 }],
      }),
    ).toBeNull();
    expect(
      parseAvailability({
        teams: bootstrap.teams,
        elements: [{ ...bootstrap.elements[0], id: "not-a-number" }],
      }),
    ).toBeNull();
  });

  it("A-19: rejects missing and unresolved team ids", () => {
    expect(parseAvailability({ elements: [] })).toBeNull();
    expect(
      parseAvailability({
        teams: [{ id: 1 }],
        elements: [{ ...bootstrap.elements[0], team: 99 }],
      }),
    ).toBeNull();
  });

  it("returns an object for news and null for success with nothing to say", () => {
    const rows = parseAvailability(bootstrap)!;
    expect(teamNewsForFixture(rows, 1, 6)).toEqual({
      home: [
        {
          player: "Odegaard",
          reason: "Being assessed",
          status: "d",
        },
      ],
      away: [
        {
          player: "Jackson",
          reason: "Ankle injury",
          status: "i",
        },
      ],
    });
    expect(teamNewsForFixture(rows, 9, 10)).toBeNull();
  });
});
