// Phase 1 — lib/fpl.ts (pure adapter, no DB). Plan §3.
// Cases: docs/testing/phase1-cases.md P1-U01–U15.
//
// This suite imports from an interface the plan names but the implementer may still be
// writing (feat/p1-foundation is a parallel work-in-progress branch). Until lib/fpl.ts
// exists with these exports, these tests fail to import — expected at this stage; do not
// "fix" by stubbing the module here.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchFplSnapshot, mapEvent, mapFixture } from "../../lib/fpl";

// A minimal valid snapshot shape satisfying every §3 validation rule, used as the baseline
// that each invalid-case test perturbs by exactly one field.
function validBootstrap() {
  return {
    events: Array.from({ length: 38 }, (_, i) => ({
      id: i + 1,
      name: `Gameweek ${i + 1}`,
      // Weekly deadlines from GW1 (kept as a real Date, not string month arithmetic, so it
      // can't overflow past month 12 the way `8 + Math.floor(i / 4)` silently did).
      deadline_time: new Date(Date.UTC(2026, 7, 21 + i * 7, 17, 30, 0)).toISOString(),
    })),
    teams: Array.from({ length: 20 }, (_, i) => ({ id: i + 1, name: `Team ${i + 1}` })),
  };
}
function validFixtures() {
  return Array.from({ length: 380 }, (_, i) => ({
    id: i + 1,
    event: (i % 38) + 1,
    kickoff_time: "2026-08-21T19:00:00Z",
    team_h: (i % 20) + 1,
    team_a: ((i + 1) % 20) + 1,
    team_h_score: null,
    team_a_score: null,
    finished: false,
  }));
}

function mockFetchSequence(responses: Array<Response | Error>) {
  const impl = vi.fn();
  for (const r of responses) {
    impl.mockImplementationOnce(() => (r instanceof Error ? Promise.reject(r) : Promise.resolve(r)));
  }
  vi.stubGlobal("fetch", impl);
  return impl;
}
function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

describe("fetchFplSnapshot — snapshot validation (§3)", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("P1-U01: resolves the snapshot when both endpoints are 200 and every count/ref check passes", async () => {
    mockFetchSequence([jsonResponse(validBootstrap()), jsonResponse(validFixtures())]);
    const result = await fetchFplSnapshot();
    expect(result).not.toBeNull();
    expect(result?.events).toHaveLength(38);
    expect(result?.teams).toHaveLength(20);
    expect(result?.fixtures).toHaveLength(380);
  });

  it("P1-U02: resolves null when bootstrap-static responds non-200", async () => {
    mockFetchSequence([jsonResponse({}, 500), jsonResponse(validFixtures())]);
    const result = await fetchFplSnapshot();
    expect(result).toBeNull();
  });

  it("P1-U03: resolves null when a request never resolves within the 10s budget", async () => {
    // lib/fpl.ts passes a real AbortSignal.timeout(10_000) into fetch — that native timer is
    // NOT affected by vi.useFakeTimers() (verified: faking + advancing does not fire it), so
    // this test can't wait out the real 10s and stay a fast unit test. Instead it drives the
    // exact contract the case cares about: when the underlying fetch call is aborted (the
    // real-world effect of the budget expiring), fetchFplSnapshot resolves null rather than
    // rejecting or hanging the caller.
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new DOMException("The operation was aborted.", "AbortError"))));
    await expect(fetchFplSnapshot()).resolves.toBeNull();
  });

  it("P1-U04: resolves null when bootstrap-static has 37 unique events", async () => {
    const bootstrap = validBootstrap();
    bootstrap.events = bootstrap.events.slice(0, 37);
    mockFetchSequence([jsonResponse(bootstrap), jsonResponse(validFixtures())]);
    expect(await fetchFplSnapshot()).toBeNull();
  });

  it("P1-U05: resolves null when bootstrap-static has 38 events but two share an id", async () => {
    const bootstrap = validBootstrap();
    bootstrap.events[1] = { ...bootstrap.events[1], id: bootstrap.events[0].id };
    mockFetchSequence([jsonResponse(bootstrap), jsonResponse(validFixtures())]);
    expect(await fetchFplSnapshot()).toBeNull();
  });

  it("P1-U06: resolves null when bootstrap-static has 19 teams", async () => {
    const bootstrap = validBootstrap();
    bootstrap.teams = bootstrap.teams.slice(0, 19);
    mockFetchSequence([jsonResponse(bootstrap), jsonResponse(validFixtures())]);
    expect(await fetchFplSnapshot()).toBeNull();
  });

  it("P1-U07: resolves null when fixtures has only 379 unique ids", async () => {
    mockFetchSequence([jsonResponse(validBootstrap()), jsonResponse(validFixtures().slice(0, 379))]);
    expect(await fetchFplSnapshot()).toBeNull();
  });

  it("P1-U07b: resolves null when fixtures has 380 rows but one id is duplicated", async () => {
    const fixtures = validFixtures();
    fixtures[1] = { ...fixtures[1], id: fixtures[0].id };
    mockFetchSequence([jsonResponse(validBootstrap()), jsonResponse(fixtures)]);
    expect(await fetchFplSnapshot()).toBeNull();
  });

  it("P1-U08: resolves null when a fixture references a team id or event id that doesn't exist", async () => {
    const fixtures = validFixtures();
    fixtures[0] = { ...fixtures[0], team_h: 999 };
    mockFetchSequence([jsonResponse(validBootstrap()), jsonResponse(fixtures)]);
    expect(await fetchFplSnapshot()).toBeNull();

    const fixturesBadEvent = validFixtures();
    fixturesBadEvent[0] = { ...fixturesBadEvent[0], event: 999 };
    mockFetchSequence([jsonResponse(validBootstrap()), jsonResponse(fixturesBadEvent)]);
    expect(await fetchFplSnapshot()).toBeNull();
  });

  it("P1-U10: an event with a null deadline_time makes the whole snapshot rejected", async () => {
    // Ruling (orchestrator, post-implementation): §3 is all-or-nothing — a snapshot is valid
    // only with 38 PARSEABLE events. An event we can't schedule (null deadline_time) is
    // exactly the kind of event mapEvent correctly treats as invalid (returns null), which
    // drops the event count below 38 and rejects the whole snapshot. This is the conservative
    // §3 posture, not a bug — every event that survives validation has a non-null deadlineAt
    // by construction (Phase 2 may rely on this).
    const bootstrap = validBootstrap();
    // Cast: deadline_time is null here specifically to exercise the invalid/unparseable input
    // shape the real FPL API can send, which validBootstrap()'s type doesn't otherwise allow.
    bootstrap.events[0] = { ...bootstrap.events[0], deadline_time: null as unknown as string };
    mockFetchSequence([jsonResponse(bootstrap), jsonResponse(validFixtures())]);
    expect(await fetchFplSnapshot()).toBeNull();
  });
});

describe("mapEvent (§3)", () => {
  it("P1-U09: maps a normal event row", () => {
    const raw = { id: 7, name: "Gameweek 7", deadline_time: "2026-10-02T17:30:00Z" };
    // deadlineAt is normalized through `new Date(...).toISOString()`, which stamps
    // milliseconds (".000Z") even when the input didn't have them.
    expect(mapEvent(raw)).toEqual({
      fplEventId: 7,
      number: 7,
      name: "Gameweek 7",
      deadlineAt: new Date("2026-10-02T17:30:00Z").toISOString(),
    });
  });

  // P1-U10 moved to the fetchFplSnapshot describe block above — it's a whole-snapshot
  // rejection case (a null deadline_time makes mapEvent return null for that event, which
  // drops the total below 38 and rejects the snapshot), not a mapEvent-output case.

  it("P1-U11: a non-parseable deadline_time is not silently accepted as a valid date", () => {
    const raw = { id: 3, name: "Gameweek 3", deadline_time: "not-a-date" };
    let threw = false;
    let mapped: ReturnType<typeof mapEvent> | undefined;
    try {
      mapped = mapEvent(raw);
    } catch {
      threw = true;
    }
    if (!threw) {
      expect(Number.isNaN(Date.parse(String(mapped?.deadlineAt)))).toBe(true);
    }
  });
});

describe("mapFixture (§3)", () => {
  it("P1-U12: maps a normal upcoming fixture", () => {
    const raw = {
      id: 101,
      event: 5,
      kickoff_time: "2026-09-19T14:00:00Z",
      team_h: 1,
      team_a: 2,
      team_h_score: null,
      team_a_score: null,
      finished: false,
    };
    expect(mapFixture(raw)).toEqual({
      fplFixtureId: 101,
      fplEventId: 5,
      // kickoffAt is normalized through `new Date(...).toISOString()` (stamps milliseconds).
      kickoffAt: new Date("2026-09-19T14:00:00Z").toISOString(),
      homeFplTeamId: 1,
      awayFplTeamId: 2,
      homeScore: null,
      awayScore: null,
      finished: false,
    });
  });

  it("P1-U13: a null event (unassigned) maps to fplEventId: null — a valid output, not an error", () => {
    const raw = {
      id: 102,
      event: null,
      kickoff_time: null,
      team_h: 3,
      team_a: 4,
      team_h_score: null,
      team_a_score: null,
      finished: false,
    };
    const mapped = mapFixture(raw);
    expect(mapped).not.toBeNull();
    expect(mapped!.fplEventId).toBeNull();
  });

  it("P1-U14: a null kickoff_time (postponed, undated) maps to kickoffAt: null — a valid output", () => {
    const raw = {
      id: 103,
      event: 6,
      kickoff_time: null,
      team_h: 5,
      team_a: 6,
      team_h_score: null,
      team_a_score: null,
      finished: false,
    };
    const mapped = mapFixture(raw);
    expect(mapped).not.toBeNull();
    expect(mapped!.kickoffAt).toBeNull();
  });

  it("P1-U15: maps a finished fixture's score fields through", () => {
    const raw = {
      id: 104,
      event: 4,
      kickoff_time: "2026-09-12T14:00:00Z",
      team_h: 7,
      team_a: 8,
      team_h_score: 2,
      team_a_score: 1,
      finished: true,
    };
    const mapped = mapFixture(raw);
    expect(mapped).not.toBeNull();
    expect(mapped!.homeScore).toBe(2);
    expect(mapped!.awayScore).toBe(1);
    expect(mapped!.finished).toBe(true);
  });

  // P1-U25–U31 (Sol code-review addition): kickoff_time is undated ONLY when exactly `null`;
  // any other non-string, non-ISO value rejects the whole row rather than being read as "TBC".
  // Scores accept ONLY exactly `null` (unobserved) or a non-negative integer; anything else
  // (missing, empty string, numeric string, negative, non-integer) rejects the row. A rejected
  // row rejects the whole snapshot in validateSnapshot — silently reading a garbled value as
  // "no data yet" would let a bad feed erase a stored kickoff or score.
  function baseFixture() {
    return {
      id: 105,
      event: 6,
      kickoff_time: "2026-09-19T14:00:00Z",
      team_h: 1,
      team_a: 2,
      team_h_score: null,
      team_a_score: null,
      finished: false,
    };
  }

  it("P1-U25: kickoff_time undefined (missing field) rejects the row", () => {
    const raw = { ...baseFixture() };
    delete (raw as { kickoff_time?: unknown }).kickoff_time;
    expect(mapFixture(raw)).toBeNull();
  });

  it('P1-U26: kickoff_time === "" (empty string) rejects the row', () => {
    const raw = { ...baseFixture(), kickoff_time: "" };
    expect(mapFixture(raw)).toBeNull();
  });

  it("P1-U27: team_h_score undefined (missing field) rejects the row", () => {
    const raw = { ...baseFixture() };
    delete (raw as { team_h_score?: unknown }).team_h_score;
    expect(mapFixture(raw)).toBeNull();
  });

  it('P1-U28: team_a_score === "" (empty string) rejects the row', () => {
    const raw = { ...baseFixture(), team_a_score: "" };
    expect(mapFixture(raw)).toBeNull();
  });

  it('P1-U29: a numeric-string score ("2") rejects the row — no implicit coercion', () => {
    const raw = { ...baseFixture(), team_h_score: "2" };
    expect(mapFixture(raw)).toBeNull();
  });

  it("P1-U30: a negative score rejects the row", () => {
    const raw = { ...baseFixture(), team_h_score: -1 };
    expect(mapFixture(raw)).toBeNull();
  });

  it("P1-U31: a non-integer score (1.5) rejects the row", () => {
    const raw = { ...baseFixture(), team_a_score: 1.5 };
    expect(mapFixture(raw)).toBeNull();
  });
});
