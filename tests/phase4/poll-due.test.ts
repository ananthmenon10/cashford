import { describe, expect, it } from "vitest";
import {
  commentaryDueAt,
  contextDueAt,
  eventsDueAt,
  lineupsDueAt,
  oddsDueAt,
  statsDueAt,
  teamNewsDueAt,
} from "../../lib/poll-due";
import { finished, live, upcoming } from "./helpers";

const now = new Date("2026-02-03T10:00:00.000Z");

describe("poll cadence boundaries", () => {
  it("moves odds from six-hour to hourly and ten-minute rungs", () => {
    expect(
      oddsDueAt(upcoming(24 * 60 + 1, now), new Date(now.getTime() - 5 * 3_600_000), now),
    ).toBe(false);
    expect(
      oddsDueAt(upcoming(24 * 60, now), new Date(now.getTime() - 3_600_000), now),
    ).toBe(true);
    expect(
      oddsDueAt(upcoming(120, now), new Date(now.getTime() - 10 * 60_000), now),
    ).toBe(true);
    expect(oddsDueAt(upcoming(0, now), null, now)).toBe(false);
  });

  it("keeps context hourly and lineups inside T-90", () => {
    expect(contextDueAt(upcoming(60, now), null, now)).toBe(true);
    expect(lineupsDueAt(upcoming(91, now), null, now)).toBe(false);
    expect(lineupsDueAt(upcoming(90, now), null, now)).toBe(true);
  });

  it("polls live events every minute and stats every two", () => {
    expect(eventsDueAt(live(30, now), new Date(now.getTime() - 60_000), now)).toBe(true);
    expect(statsDueAt(live(30, now), new Date(now.getTime() - 60_000), now)).toBe(false);
    expect(statsDueAt(live(30, now), new Date(now.getTime() - 120_000), now)).toBe(true);
  });

  it("runs commentary once at FT+10", () => {
    expect(commentaryDueAt(finished(9, now), null, now)).toBe(false);
    expect(commentaryDueAt(finished(10, now), null, now)).toBe(true);
    expect(commentaryDueAt(finished(30, now), now, now)).toBe(false);
  });

  it("uses 30-minute team-news cadence through T-48h on both sides", () => {
    expect(teamNewsDueAt(upcoming(48 * 60 + 1, now), new Date(now.getTime() - 30 * 60_000), now)).toBe(false);
    expect(teamNewsDueAt(upcoming(48 * 60 - 1, now), new Date(now.getTime() - 30 * 60_000), now)).toBe(true);
  });

  it("switches team-news cadence at T-3h on both sides", () => {
    expect(teamNewsDueAt(upcoming(3 * 60 + 1, now), new Date(now.getTime() - 10 * 60_000), now)).toBe(false);
    expect(teamNewsDueAt(upcoming(3 * 60 + 1, now), new Date(now.getTime() - 30 * 60_000), now)).toBe(true);
    expect(teamNewsDueAt(upcoming(3 * 60 - 1, now), new Date(now.getTime() - 9 * 60_000), now)).toBe(false);
    expect(teamNewsDueAt(upcoming(3 * 60 - 1, now), new Date(now.getTime() - 10 * 60_000), now)).toBe(true);
  });

  it("stops team-news fetches at kickoff", () => {
    expect(teamNewsDueAt(upcoming(1, now), new Date(now.getTime() - 10 * 60_000), now)).toBe(true);
    expect(teamNewsDueAt(upcoming(-1, now), new Date(now.getTime() - 10 * 60_000), now)).toBe(false);
  });
});
