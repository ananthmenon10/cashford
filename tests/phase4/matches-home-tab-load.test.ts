import { describe, expect, it } from "vitest";
import { loadMatchesHomeTab, buildReceiptSummary } from "../../lib/matches-home-tab-load";
import { loadMatchesTab, loadMatchesTabInternal } from "../../lib/matches-tab-load";
import type { LeagueRowView, MatchesTabView } from "../../lib/matches-tab";

const USER = "viewer";
const NOW = new Date("2026-08-13T12:00:00.000Z");
const FUTURE_1 = "2026-08-14T12:00:00.000Z";
const FUTURE_2 = "2026-08-15T12:00:00.000Z";
const FUTURE_3 = "2026-08-16T12:00:00.000Z";
const PAST = "2026-08-12T12:00:00.000Z";

type Dataset = Record<string, unknown[]>;
type Query = {
  table: string;
  select: string;
  filters: Array<[string, string, unknown]>;
};
type SessionOptions = {
  errorPurpose?: string;
  resolveRows?: (query: Query, rows: unknown[]) => unknown[];
};

function gw(number: number, deadlineAt: string | null = number === 1 ? FUTURE_1 : FUTURE_2) {
  return {
    id: `gw${number}`,
    number,
    name: `Gameweek ${number}`,
    deadline_at: deadlineAt,
    status: deadlineAt && new Date(deadlineAt) > NOW ? "open" : "locked",
  };
}

function fixture(
  gameweekId: string,
  index: number,
  status: "scheduled" | "live" | "finished" = "scheduled",
  state: "active" | "void" = "active",
  kickoffAt = status === "scheduled" ? FUTURE_1 : PAST,
) {
  const id = `fixture-${gameweekId}-${index}`;
  return {
    id: `${gameweekId}-membership-${index}`,
    gameweek_id: gameweekId,
    fixture_id: id,
    state,
    fixtures: {
      id,
      kickoff_at: kickoffAt,
      status,
      status_detail: status,
      minute: status === "live" ? 42 : null,
      ft_home: status === "finished" ? 2 : null,
      ft_away: status === "finished" ? 1 : null,
      home: { id: `home-${id}`, name: `Home ${id}`, flag_url: null },
      away: { id: `away-${id}`, name: `Away ${id}`, flag_url: null },
      fixture_insights: [],
    },
  };
}

function contest(
  id: string,
  leagueId: string,
  gameweekId: string,
  deadlineAt: string,
  status: "open" | "locked" | "settled" | "void" = "open",
  inputVersion = 1,
) {
  return {
    id,
    league_id: leagueId,
    gameweek_id: gameweekId,
    stake_inr: 100,
    deadline_at: deadlineAt,
    status,
    input_version: inputVersion,
  };
}

function result(contestId: string, outcome: "settled" | "void" = "settled", settledVersion = 1) {
  return {
    gameweek_contest_id: contestId,
    outcome,
    settled_version: settledVersion,
    void_reason: outcome === "void" ? "single_entrant" : null,
    tiebreak_used: "none",
    pot_inr: 100,
  };
}

function entry(
  contestId: string,
  leagueId: string,
  status: "entered" | "needs_update" | "locked_in" | "invalid" = "entered",
  userId = USER,
) {
  return {
    id: `entry-${contestId}-${userId}`,
    gameweek_contest_id: contestId,
    league_id: leagueId,
    user_id: userId,
    status,
    profiles: { display_name: userId, username: userId },
  };
}

function entryResult(entryId: string, contestId: string, netInr = 100) {
  return {
    entry_id: entryId,
    gameweek_contest_id: contestId,
    points: 10,
    exacts: 1,
    goal_error: 0,
    net_inr: netInr,
    is_winner: true,
    per_fixture: [],
    settled_version: 1,
  };
}

function dataset(options: {
  gameweeks?: unknown[];
  leagues?: Array<{ id: string; slug: string; name: string; status?: string }>;
  links?: Array<{ league_id: string; status?: string; eligible_from_gameweek_id?: string | null }>;
  members?: Array<{ league_id: string; eligible_from_gameweek_id?: string | null; left_at?: string | null }>;
  contests?: unknown[];
  fixtures?: unknown[];
  results?: unknown[];
  entries?: unknown[];
  entryResults?: unknown[];
  picks?: unknown[];
} = {}): Dataset {
  const leagues = options.leagues ?? [{ id: "league-1", slug: "friends", name: "Friends" }];
  const links = options.links ?? leagues.map((league) => ({
    league_id: league.id,
    status: "active",
    eligible_from_gameweek_id: "gw1",
  }));
  const members = options.members ?? leagues.map((league) => ({
    league_id: league.id,
    eligible_from_gameweek_id: "gw1",
    left_at: null,
  }));
  return {
    competitions: [{ id: "competition-1", slug: "pl-2026-27", name: "Premier League", status: "active" }],
    leagues: leagues.map((league) => ({ ...league, status: league.status ?? "active" })),
    league_competitions: links.map((link) => ({
      ...link,
      competition_id: "competition-1",
      joined_at: "2026-01-01T00:00:00.000Z",
      competitions: {
        id: "competition-1",
        slug: "pl-2026-27",
        name: "Premier League",
        status: "active",
        format: "league",
      },
    })),
    member_competitions: members.map((member) => ({
      ...member,
      competition_id: "competition-1",
      user_id: USER,
    })),
    gameweeks: (options.gameweeks ?? [gw(1)]).map((row: any) => ({
      ...row,
      competition_id: "competition-1",
    })),
    gameweek_contests: (options.contests ?? []).map((row: any) => ({
      ...row,
      competition_id: "competition-1",
    })),
    gameweek_fixtures: options.fixtures ?? [],
    gameweek_results: options.results ?? [],
    gameweek_entries: options.entries ?? [],
    gameweek_entry_results: options.entryResults ?? [],
    gameweek_picks: options.picks ?? [],
  };
}

function purposeMatches(query: Query, purpose: string): boolean {
  const has = (field: string, value: unknown) => query.filters.some(([kind, name, actual]) => kind === field && name === value);
  if (purpose === "scope-links") {
    return query.table === "league_competitions" && !query.select.includes("competitions(") && has("eq", "competition_id");
  }
  if (purpose === "member-scopes") {
    return query.table === "member_competitions" && query.select.includes("eligible_from_gameweek_id") && has("eq", "user_id");
  }
  if (purpose === "focus-entries") return query.table === "gameweek_entries" && query.select.includes("profiles(");
  if (purpose === "entry-results") return query.table === "gameweek_entry_results";
  if (purpose === "picks") return query.table === "gameweek_picks";
  return false;
}

function sessionFor(data: Dataset, options: SessionOptions = {}) {
  return {
    from(table: string) {
      const rawRows = data[table] ?? [];
      const query: any = {
        state: { table, select: "", filters: [] as Array<[string, string, unknown]> },
        select(value: string) {
          query.state.select = value;
          return query;
        },
        eq(field: string, value: unknown) {
          query.state.filters.push(["eq", field, value]);
          return query;
        },
        neq(field: string, value: unknown) {
          query.state.filters.push(["neq", field, value]);
          return query;
        },
        is(field: string, value: unknown) {
          query.state.filters.push(["is", field, value]);
          return query;
        },
        in(field: string, values: unknown[]) {
          query.state.filters.push(["in", field, values]);
          return query;
        },
        order() {
          return query;
        },
        then(resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) {
          const spec = query.state as Query;
          let rows = [...rawRows];
          for (const [kind, field, value] of spec.filters) {
            if (kind === "eq") rows = rows.filter((row: any) => row[field] === value);
            if (kind === "neq") rows = rows.filter((row: any) => row[field] !== value);
            if (kind === "is") rows = rows.filter((row: any) => value === null ? row[field] == null : row[field] === value);
            if (kind === "in") rows = rows.filter((row: any) => (value as unknown[]).includes(row[field]));
          }
          if (options.resolveRows) rows = options.resolveRows(spec, rows) as unknown[];
          const error = options.errorPurpose && purposeMatches(spec, options.errorPurpose)
            ? { message: `${options.errorPurpose} read failed` }
            : null;
          return Promise.resolve(resolve({ data: error ? null : rows, error }));
        },
      };
      return query;
    },
  } as never;
}

async function load(data: Dataset, options: SessionOptions = {}, requestedScopeSlug?: string, requestedGameweek?: number) {
  return loadMatchesHomeTab(sessionFor(data, options), USER, {
    requestedScopeSlug,
    requestedGameweek,
    now: NOW,
  });
}

function oneOpen(
  extra: Partial<Parameters<typeof dataset>[0]> = {},
) {
  const gameweeks = [gw(1)];
  return dataset({
    gameweeks,
    contests: [contest("contest-1", "league-1", "gw1", FUTURE_1)],
    fixtures: [fixture("gw1", 1)],
    ...extra,
  });
}

function parityScenario() {
  return dataset({
    gameweeks: [gw(1, PAST), gw(2, FUTURE_2), gw(3, FUTURE_3)],
    contests: [
      contest("contest-1", "league-1", "gw1", PAST, "settled"),
      contest("contest-2", "league-1", "gw2", FUTURE_2),
      contest("contest-3", "league-1", "gw3", FUTURE_3),
    ],
    results: [result("contest-1")],
    fixtures: [
      fixture("gw1", 1, "finished"),
      fixture("gw2", 1, "scheduled", "active", "2026-08-15T15:00:00.000Z"),
      fixture("gw2", 2, "scheduled", "active", "2026-08-15T13:00:00.000Z"),
      fixture("gw3", 1, "scheduled", "active", "2026-08-16T13:00:00.000Z"),
    ],
    entries: [entry("contest-2", "league-1", "entered")],
    picks: [{
      entry_id: "entry-contest-2-viewer",
      fixture_id: "fixture-gw2-2",
      pred_home: 1,
      pred_away: 0,
    }],
  });
}

describe("loadMatchesHomeTab focus, banner, and freshness", () => {
  it("S1: focuses an open gameweek and shows the not-entered row", async () => {
    const payload = await load(oneOpen());
    expect(payload.empty).toBe(false);
    if (payload.empty) return;
    expect(payload.view.gw.number).toBe(1);
    expect(payload.view.yourGw?.rows[0]?.kind).toBe("open-not-entered");
    expect(payload.nextGw).toBeNull();
    expect(payload.freshness).toBe("pre");
  });

  it("S1b: maps stored entered to the open-entered row without reading picks for banner status", async () => {
    const data = oneOpen({ entries: [entry("contest-1", "league-1", "entered")] });
    const payload = await load(data);
    if (payload.empty) throw new Error("expected payload");
    expect(payload.view.yourGw?.rows[0]?.kind).toBe("open-entered");
  });

  it("loads the requested gameweek and echoes it for response matching", async () => {
    const data = parityScenario();
    const payload = await load(data, {}, undefined, 2);

    expect(payload.empty).toBe(false);
    if (payload.empty) return;
    expect(payload.requestedGw).toBe(2);
    expect(payload.view.gw.number).toBe(2);
  });

  it("keeps a locked current gameweek and unavailable next week in the shared switch options", async () => {
    const data = dataset({
      gameweeks: [gw(1, PAST), gw(2, FUTURE_2), gw(3, FUTURE_3)],
      contests: [
        contest("contest-1", "league-1", "gw1", PAST, "settled"),
        contest("contest-2", "league-1", "gw2", FUTURE_2),
        contest("contest-3", "league-1", "gw3", PAST, "locked"),
      ],
      fixtures: [fixture("gw1", 1, "finished"), fixture("gw2", 1), fixture("gw3", 1)],
      results: [result("contest-1")],
    });
    const payload = await load(data);
    if (payload.empty) throw new Error("expected payload");
    expect(payload.view.picker.switcher).toEqual([
      { role: "previous", number: 2, name: "Gameweek 2", openingAt: FUTURE_2, state: "open", lifecycle: "CL1", disabled: false },
      { role: "current", number: 3, name: "Gameweek 3", openingAt: FUTURE_3, state: "locked", lifecycle: "CL2", disabled: false },
      { role: "next", number: null, name: null, openingAt: null, state: "unavailable", lifecycle: null, disabled: true },
    ]);
  });

  it("S2: keeps locked GW1 as the body and exposes GW2 as a banner", async () => {
    const data = dataset({
      gameweeks: [gw(1, PAST), gw(2, FUTURE_2)],
      contests: [
        contest("contest-1", "league-1", "gw1", PAST, "locked"),
        contest("contest-2", "league-1", "gw2", FUTURE_2),
      ],
      fixtures: [fixture("gw1", 1), fixture("gw2", 1)],
      entries: [entry("contest-1", "league-1", "entered")],
    });
    const payload = await load(data);
    if (payload.empty) throw new Error("expected payload");
    expect([payload.view.gw.number, payload.nextGw?.number]).toEqual([1, 2]);
    expect(payload.view.yourGw?.rows[0]?.kind).toBe("locked-awaiting");
    expect(payload.nextGw?.leagues).toMatchObject([{ status: "none", enterHref: "/leagues/friends/enter?gw=2" }]);
  });

  it("S3: a live GW leads while the next open GW still gets a banner", async () => {
    const data = dataset({
      gameweeks: [gw(1, PAST), gw(2, FUTURE_2)],
      contests: [contest("contest-1", "league-1", "gw1", PAST, "locked"), contest("contest-2", "league-1", "gw2", FUTURE_2)],
      fixtures: [fixture("gw1", 1, "finished"), fixture("gw1", 2, "live"), fixture("gw2", 1)],
    });
    const payload = await load(data);
    if (payload.empty) throw new Error("expected payload");
    expect(payload.view.gw.number).toBe(1);
    expect(payload.view.gw.state).toBe("live");
    expect(payload.nextGw?.number).toBe(2);
    expect(payload.freshness).toBe("unresolved");
  });

  it("S3b: a mid-GW body with no live fixture stays pre and has no banner", async () => {
    const data = dataset({
      gameweeks: [gw(1, PAST)],
      contests: [contest("contest-1", "league-1", "gw1", PAST, "locked")],
      fixtures: [fixture("gw1", 1)],
    });
    const payload = await load(data);
    if (payload.empty) throw new Error("expected payload");
    expect(payload.view.gw.number).toBe(1);
    expect(payload.view.gw.state).toBe("pre");
    expect(payload.nextGw).toBeNull();
  });

  it("S4: after settlement the next open GW leads and the prior GW becomes a receipt", async () => {
    const priorEntry = entry("contest-1", "league-1", "locked_in");
    const data = dataset({
      gameweeks: [gw(1, PAST), gw(2, FUTURE_2)],
      contests: [contest("contest-1", "league-1", "gw1", PAST, "settled"), contest("contest-2", "league-1", "gw2", FUTURE_2)],
      fixtures: [fixture("gw1", 1, "finished"), fixture("gw2", 1)],
      results: [result("contest-1")],
      entries: [priorEntry],
      entryResults: [entryResult(priorEntry.id, "contest-1")],
    });
    const payload = await load(data);
    if (payload.empty) throw new Error("expected payload");
    expect(payload.view.gw.number).toBe(2);
    expect(payload.freshness).toBe("pre");
    expect(payload.receipt?.summary).toBe("GW1 · 1st of 1 · 10 pts · +₹100");
  });

  it("GW38 season over: latest settled is the body with no next GW or receipt", async () => {
    const data = dataset({
      gameweeks: [gw(38, PAST)],
      contests: [contest("contest-38", "league-1", "gw38", PAST, "settled")],
      fixtures: [fixture("gw38", 1, "finished")],
      results: [result("contest-38")],
    });
    const payload = await load(data);
    if (payload.empty) throw new Error("expected payload");
    expect(payload.view.gw.number).toBe(38);
    expect(payload.freshness).toBe("settled");
    expect(payload.nextGw).toBeNull();
    expect(payload.receipt).toBeNull();
  });

  it("builds a sat-out receipt when the prior resolved GW has no viewer entry", async () => {
    const data = dataset({
      gameweeks: [gw(1, PAST), gw(2, FUTURE_2)],
      contests: [contest("contest-1", "league-1", "gw1", PAST, "settled"), contest("contest-2", "league-1", "gw2", FUTURE_2)],
      fixtures: [fixture("gw1", 1, "finished"), fixture("gw2", 1)],
      results: [result("contest-1")],
    });
    const payload = await load(data);
    if (payload.empty) throw new Error("expected payload");
    expect(payload.receipt?.summary).toBe("GW1 · sat out");
  });

  it("keeps a focus-GW VP0 row while evaluating next-GW eligibility against GW2", async () => {
    const data = dataset({
      gameweeks: [gw(1), gw(2, FUTURE_2)],
      members: [{ league_id: "league-1", eligible_from_gameweek_id: "gw2", left_at: null }],
      contests: [contest("contest-1", "league-1", "gw1", FUTURE_1), contest("contest-2", "league-1", "gw2", FUTURE_2)],
      fixtures: [fixture("gw1", 1), fixture("gw2", 1)],
    });
    const payload = await load(data);
    if (payload.empty) throw new Error("expected payload");
    expect(payload.view.yourGw?.rows[0]?.kind).toBe("ineligible");
    expect(payload.nextGw?.leagues[0]?.status).toBe("none");
  });

  it("hides a next-GW banner when the next-GW active-pair read says the member is ineligible", async () => {
    const data = dataset({
      gameweeks: [gw(1), gw(2, FUTURE_2)],
      members: [{ league_id: "league-1", eligible_from_gameweek_id: "gw1", left_at: null }],
      contests: [contest("contest-1", "league-1", "gw1", FUTURE_1), contest("contest-2", "league-1", "gw2", FUTURE_2)],
      fixtures: [fixture("gw1", 1), fixture("gw2", 1)],
    });
    const payload = await load(data, {
      resolveRows: (query, rows) => query.table === "member_competitions" && query.filters.some(([kind, field]) => kind === "is" && field === "left_at")
        ? rows.map((row: any) => ({ ...row, eligible_from_gameweek_id: "gw3" }))
        : rows,
    });
    if (payload.empty) throw new Error("expected payload");
    expect(payload.view.yourGw?.rows[0]?.kind).toBe("open-not-entered");
    expect(payload.nextGw?.leagues[0]?.status).toBe("ineligible");
  });

  it("CL9 sync-issue is the body, not a settled receipt", async () => {
    const data = dataset({
      gameweeks: [gw(1, PAST)],
      contests: [contest("contest-1", "league-1", "gw1", PAST, "settled")],
      fixtures: [fixture("gw1", 1, "finished")],
    });
    const payload = await load(data);
    if (payload.empty) throw new Error("expected payload");
    expect(payload.view.gw.number).toBe(1);
    expect(payload.view.yourGw?.rows[0]?.kind).toBe("sync-issue");
    expect(payload.freshness).toBe("unresolved");
  });

  it("CL10 all-void is the body until maintenance writes the void result", async () => {
    const data = dataset({
      gameweeks: [gw(1, PAST)],
      contests: [contest("contest-1", "league-1", "gw1", PAST, "locked")],
      fixtures: [fixture("gw1", 1, "scheduled", "void")],
      entries: [entry("contest-1", "league-1", "entered")],
    });
    const payload = await load(data);
    if (payload.empty) throw new Error("expected payload");
    expect(payload.view.yourGw?.rows[0]?.kind).toBe("all-called-off");
    expect(payload.freshness).toBe("unresolved");
  });

  it("dirty/recalculating body stays focused until the stored result is clean", async () => {
    const data = dataset({
      gameweeks: [gw(1, PAST)],
      contests: [contest("contest-1", "league-1", "gw1", PAST, "settled", 2)],
      fixtures: [fixture("gw1", 1, "finished")],
      results: [result("contest-1", "settled", 1)],
      entries: [entry("contest-1", "league-1", "entered")],
    });
    const payload = await load(data);
    if (payload.empty) throw new Error("expected payload");
    expect(payload.view.yourGw?.rows[0]?.kind).toBe("recalculating");
    expect(payload.freshness).toBe("unresolved");
  });

  it("does not build a receipt when the previous gameweek is unresolved", async () => {
    const data = dataset({
      gameweeks: [gw(1, PAST), gw(2, FUTURE_2)],
      contests: [contest("contest-1", "league-1", "gw1", PAST, "locked"), contest("contest-2", "league-1", "gw2", FUTURE_2)],
      fixtures: [fixture("gw1", 1), fixture("gw2", 1)],
    });
    const payload = await load(data);
    if (payload.empty) throw new Error("expected payload");
    expect(payload.view.gw.number).toBe(1);
    expect(payload.receipt).toBeNull();
  });

  it("overlap: the newest unresolved gameweek is the body", async () => {
    const data = dataset({
      gameweeks: [gw(1, PAST), gw(2, PAST), gw(3, FUTURE_2)],
      contests: [
        contest("contest-1", "league-1", "gw1", PAST, "locked"),
        contest("contest-2", "league-1", "gw2", PAST, "locked"),
        contest("contest-3", "league-1", "gw3", FUTURE_2),
      ],
      fixtures: [fixture("gw1", 1), fixture("gw2", 1, "scheduled", "void"), fixture("gw3", 1)],
    });
    const payload = await load(data);
    if (payload.empty) throw new Error("expected payload");
    expect(payload.view.gw.number).toBe(2);
    expect(payload.nextGw?.number).toBe(3);
  });

  it("pre-season no-contest gameweek is a pre focus with the empty-contest freshness guard", async () => {
    const payload = await load(dataset({ gameweeks: [gw(1, FUTURE_1)], contests: [], fixtures: [] }));
    if (payload.empty) throw new Error("expected payload");
    expect(payload.view.gw.number).toBe(1);
    expect(payload.view.yourGw).toBeNull();
    expect(payload.freshness).toBe("pre");
  });

  it("mixed lifecycle across leagues keeps the current resolver outcome", async () => {
    const data = dataset({
      leagues: [
        { id: "league-1", slug: "alpha", name: "Alpha" },
        { id: "league-2", slug: "beta", name: "Beta" },
      ],
      gameweeks: [gw(1, PAST), gw(2, FUTURE_2)],
      contests: [
        contest("contest-1", "league-1", "gw1", PAST, "settled"),
        contest("contest-2", "league-2", "gw1", PAST, "locked"),
        contest("contest-3", "league-1", "gw2", FUTURE_2),
        contest("contest-4", "league-2", "gw2", FUTURE_2),
      ],
      fixtures: [fixture("gw1", 1, "finished"), fixture("gw1", 2), fixture("gw2", 1)],
      results: [result("contest-1")],
      entries: [entry("contest-1", "league-1", "locked_in"), entry("contest-2", "league-2", "entered")],
    });
    const payload = await load(data);
    if (payload.empty) throw new Error("expected payload");
    expect(payload.view.gw.number).toBe(1);
    expect(payload.view.yourGw?.rows.map((row) => row.kind)).toEqual(["settled", "provisional"]);
  });

  it("builds separate entrant grids in the existing league-row order", async () => {
    const data = dataset({
      leagues: [
        { id: "league-1", slug: "alpha", name: "Alpha" },
        { id: "league-2", slug: "beta", name: "Beta" },
      ],
      gameweeks: [gw(1, PAST)],
      contests: [
        contest("contest-1", "league-1", "gw1", PAST, "locked"),
        contest("contest-2", "league-2", "gw1", PAST, "locked"),
      ],
      fixtures: [
        fixture("gw1", 2, "scheduled", "active", "2026-08-14T15:00:00.000Z"),
        fixture("gw1", 1, "finished", "active", "2026-08-14T13:00:00.000Z"),
      ],
      entries: [
        entry("contest-1", "league-1", "locked_in", "viewer"),
        entry("contest-1", "league-1", "locked_in", "alpha-player"),
        entry("contest-1", "league-1", "entered", "not-locked"),
        entry("contest-2", "league-2", "locked_in", "beta-player"),
      ],
      picks: [
        { entry_id: "entry-contest-1-viewer", fixture_id: "fixture-gw1-1", pred_home: 2, pred_away: 1 },
        { entry_id: "entry-contest-1-viewer", fixture_id: "fixture-gw1-2", pred_home: 1, pred_away: 0 },
        { entry_id: "entry-contest-1-alpha-player", fixture_id: "fixture-gw1-1", pred_home: 0, pred_away: 1 },
        { entry_id: "entry-contest-2-beta-player", fixture_id: "fixture-gw1-1", pred_home: 2, pred_away: 1 },
      ],
    });

    const payload = await load(data);
    if (payload.empty) throw new Error("expected payload");
    expect(payload.view.pointGrids?.map((grid) => grid.leagueId)).toEqual(["league-1", "league-2"]);
    expect(payload.view.pointGrids?.[0]?.entrants.map((entrant) => entrant.userId)).toEqual([
      "viewer",
      "alpha-player",
    ]);
    expect(payload.view.pointGrids?.[0]?.rows.map((row) => row.fixture.fixtureId)).toEqual([
      "fixture-gw1-1",
      "fixture-gw1-2",
    ]);
    expect(payload.view.pointGrids?.[0]?.rows[0]?.cells[0]).toMatchObject({
      pick: [2, 1],
      points: 3,
      verdict: "exact",
    });
  });

  it("renders a CL2 grid with locked picks and no points before the first final", async () => {
    const data = dataset({
      gameweeks: [gw(1, PAST)],
      contests: [contest("contest-1", "league-1", "gw1", PAST, "locked")],
      fixtures: [fixture("gw1", 1, "scheduled")],
      entries: [entry("contest-1", "league-1", "locked_in")],
      picks: [{ entry_id: "entry-contest-1-viewer", fixture_id: "fixture-gw1-1", pred_home: 2, pred_away: 1 }],
    });

    const payload = await load(data);
    if (payload.empty) throw new Error("expected payload");
    expect(payload.view.pointGrids).toHaveLength(1);
    expect(payload.view.pointGrids?.[0]?.rows[0]?.cells[0]).toEqual({
      pick: [2, 1],
      points: null,
      verdict: null,
    });
    expect(payload.view.pointGrids?.[0]?.entrants[0]?.totalPoints).toBeNull();
  });

  it("uses the settled snapshot for a CL5 grid", async () => {
    const priorEntry = entry("contest-1", "league-1", "locked_in");
    const data = dataset({
      gameweeks: [gw(1, PAST)],
      contests: [contest("contest-1", "league-1", "gw1", PAST, "settled")],
      fixtures: [fixture("gw1", 1, "finished")],
      results: [result("contest-1")],
      entries: [priorEntry],
      entryResults: [{
        ...entryResult(priorEntry.id, "contest-1"),
        points: 7,
        per_fixture: [{ fixtureId: "fixture-gw1-1", pts: 3, verdict: "exact" }],
      }],
      picks: [{ entry_id: priorEntry.id, fixture_id: "fixture-gw1-1", pred_home: 2, pred_away: 1 }],
    });

    const payload = await load(data);
    if (payload.empty) throw new Error("expected payload");
    expect(payload.view.pointGrids?.[0]?.entrants[0]?.totalPoints).toBe(7);
    expect(payload.view.pointGrids?.[0]?.rows[0]?.cells[0]).toMatchObject({
      points: 3,
      verdict: "exact",
    });
  });

  it("uses the settled snapshot for a CL6 grid while keeping the recalculating row", async () => {
    const staleEntry = entry("contest-1", "league-1", "locked_in");
    const data = dataset({
      gameweeks: [gw(1, PAST)],
      contests: [contest("contest-1", "league-1", "gw1", PAST, "settled", 2)],
      fixtures: [fixture("gw1", 1, "finished")],
      results: [result("contest-1", "settled", 1)],
      entries: [staleEntry],
      entryResults: [{
        ...entryResult(staleEntry.id, "contest-1"),
        points: 0,
        per_fixture: [{ fixtureId: "fixture-gw1-1", pts: 0, verdict: "miss" }],
      }],
      picks: [{ entry_id: staleEntry.id, fixture_id: "fixture-gw1-1", pred_home: 2, pred_away: 1 }],
    });

    const payload = await load(data);
    if (payload.empty) throw new Error("expected payload");
    expect(payload.view.yourGw?.rows[0]?.kind).toBe("recalculating");
    expect(payload.view.pointGrids?.[0]?.entrants[0]?.totalPoints).toBe(0);
    expect(payload.view.pointGrids?.[0]?.rows[0]?.cells[0]).toMatchObject({
      points: 0,
      verdict: "miss",
    });
  });

  it("returns an empty payload for zero scopes and for a competition with no gameweeks", async () => {
    const zeroScope = await load(dataset({ leagues: [], links: [], members: [], gameweeks: [] }));
    expect(zeroScope).toEqual({ empty: true, requestedComp: null, requestedGw: null, selectedComp: null, freshness: "empty" });
    const noGameweeks = await load(dataset({ gameweeks: [] }));
    expect(noGameweeks).toEqual({ empty: true, requestedComp: null, requestedGw: null, selectedComp: null, freshness: "empty" });
  });

  it("returns empty for an unknown requested scope instead of falling back", async () => {
    const data = oneOpen();
    const payload = await load(data, {}, "foreign-scope");
    expect(payload).toEqual({ empty: true, requestedComp: "foreign-scope", requestedGw: null, selectedComp: null, freshness: "empty" });
    const fallback = await loadMatchesTab(sessionFor(data), USER, undefined, NOW, "foreign-scope");
    expect(fallback?.selectedScope).toBe("pl-2026-27");
  });

  it("covers every next-GW status and keeps the rows split by league", async () => {
    const data = dataset({
      leagues: [
        { id: "league-1", slug: "none-league", name: "None" },
        { id: "league-2", slug: "complete-league", name: "Complete" },
        { id: "league-3", slug: "update-league", name: "Update" },
        { id: "league-4", slug: "ineligible-league", name: "Ineligible" },
      ],
      members: [
        { league_id: "league-1", eligible_from_gameweek_id: "gw1", left_at: null },
        { league_id: "league-2", eligible_from_gameweek_id: "gw1", left_at: null },
        { league_id: "league-3", eligible_from_gameweek_id: "gw1", left_at: null },
        { league_id: "league-4", eligible_from_gameweek_id: "gw3", left_at: null },
      ],
      gameweeks: [gw(1), gw(2, FUTURE_2)],
      contests: [
        contest("c1", "league-1", "gw1", FUTURE_1), contest("c2", "league-2", "gw1", FUTURE_1),
        contest("c3", "league-3", "gw1", FUTURE_1), contest("c4", "league-4", "gw1", FUTURE_1),
        contest("n1", "league-1", "gw2", FUTURE_2), contest("n2", "league-2", "gw2", FUTURE_2),
        contest("n3", "league-3", "gw2", FUTURE_2), contest("n4", "league-4", "gw2", FUTURE_2),
      ],
      fixtures: [fixture("gw1", 1), fixture("gw2", 1)],
      entries: [entry("n2", "league-2", "entered"), entry("n3", "league-3", "needs_update")],
    });
    const payload = await load(data);
    if (payload.empty) throw new Error("expected payload");
    expect(payload.nextGw?.leagues.map((league) => league.status)).toEqual([
      "none",
      "complete",
      "needs_update",
      "ineligible",
    ]);
  });

  it("freshness uses focus contest lifecycle and does not call a no-contest focus settled", async () => {
    const settled = await load(oneOpen({
      gameweeks: [gw(1, PAST)],
      contests: [contest("c1", "league-1", "gw1", PAST, "settled")],
      fixtures: [fixture("gw1", 1, "finished")],
      results: [result("c1")],
    }));
    if (settled.empty) throw new Error("expected payload");
    expect(settled.freshness).toBe("settled");
    const preSeason = await load(dataset({ gameweeks: [gw(1, FUTURE_1)], contests: [], fixtures: [] }));
    if (preSeason.empty) throw new Error("expected payload");
    expect(preSeason.freshness).toBe("pre");
  });
});

function league(slug: string, name: string): LeagueRowView["league"] {
  return { id: slug, slug, name };
}

describe("receipt summary precedence", () => {
  const settled = (name: string, netInr = 100, ordinal = "1st"): LeagueRowView => ({
    kind: "settled",
    league: league(name, name),
    ordinal,
    fieldSize: 4,
    points: 10,
    netInr,
    raceHref: `/leagues/${name}`,
  });
  const voidRow = (name: string): LeagueRowView => ({
    kind: "void",
    league: league(name, name),
    voidReason: "single_entrant",
    raceHref: `/leagues/${name}`,
  });
  const invalid = (name: string): LeagueRowView => ({
    kind: "invalid",
    league: league(name, name),
    reason: "Entry incomplete at the deadline",
    raceHref: `/leagues/${name}`,
  });
  const satOut: LeagueRowView = {
    kind: "closed-not-entered",
    league: league("sat", "Sat"),
    raceHref: "/leagues/sat",
  };
  const ineligible: LeagueRowView = {
    kind: "ineligible",
    league: league("vp0", "VP0"),
    raceHref: "/leagues/vp0",
  };

  it.each([
    ["zero-entrant void", [satOut], "GW3 · sat out"],
    ["single-entrant void", [voidRow("one")], "GW3 · void — stakes returned"],
    ["all-fixtures void", [voidRow("void")], "GW3 · void — stakes returned"],
    ["prior-GW VP0", [ineligible], null],
    ["invalid single", [invalid("bad")], "GW3 · entry not counted"],
    ["two invalid rows", [invalid("bad-1"), invalid("bad-2")], "GW3 · entries not counted"],
    ["ranked + void", [settled("ranked"), voidRow("void")], "GW3 · 2 leagues"],
    ["ranked + invalid", [settled("ranked"), invalid("bad")], "GW3 · 1st of 4 · 10 pts · +₹100"],
    ["ranked + sat-out", [settled("ranked"), satOut], "GW3 · 1st of 4 · 10 pts · +₹100"],
    ["void + VP0", [voidRow("void"), ineligible], "GW3 · void — stakes returned"],
  ] as Array<[string, LeagueRowView[], string | null]>)('%s', (_label, rows, expected) => {
    expect(buildReceiptSummary(3, rows)).toBe(expected);
  });

  it("includes net only when every counted row has numeric net", () => {
    expect(buildReceiptSummary(3, [settled("a", 100), settled("b", -40)])).toBe("GW3 · 2 leagues · net +₹60");
  });
});

describe("/matches parity and strict-read refactor", () => {
  it("keeps the non-strict wrapper output byte-identical to the pre-refactor fixture", async () => {
    const data = parityScenario();
    const wrapper = await loadMatchesTab(sessionFor(data), USER, undefined, NOW);
    const expectedMatchesView: MatchesTabView = {
      competition: {
        id: "competition-1",
        slug: "pl-2026-27",
        name: "Premier League",
        archived: false,
      },
      scopes: [{ slug: "pl-2026-27", name: "Premier League" }],
      selectedScope: "pl-2026-27",
      gw: {
        id: "gw2",
        number: 2,
        label: "Gameweek 2",
        state: "pre",
        deadlineAt: FUTURE_2,
        isCurrent: false,
      },
      picker: {
        prev: 1,
        next: 3,
        range: [1, 2, 3],
        futureCaveat: true,
        switcher: [
          { role: "previous", number: 1, name: "Gameweek 1", openingAt: PAST, state: "settled", lifecycle: "CL5", disabled: false },
          { role: "current", number: 2, name: "Gameweek 2", openingAt: FUTURE_2, state: "open", lifecycle: "CL1", disabled: false },
          { role: "next", number: 3, name: "Gameweek 3", openingAt: FUTURE_3, state: "open", lifecycle: "CL1", disabled: false },
        ],
      },
      yourGw: {
        enteredCount: 1,
        leagueCount: 1,
        toGo: 0,
        headerPoints: null,
        rows: [{
          kind: "open-entered",
          league: { id: "league-1", slug: "friends", name: "Friends" },
          cta: { label: "Edit picks", href: "/leagues/friends/enter" },
          raceHref: "/leagues/friends",
        }],
        provisional: false,
        recap: { gwNumber: 1, href: "/matches?gw=1" },
      },
      winnersRecap: null,
      fixtures: [{
        id: "fixture-gw2-2",
        externalId: null,
        state: "",
        scheduled: true,
        kickoffAt: "2026-08-15T13:00:00.000Z",
        home: { name: "Home fixture-gw2-2", crest: null },
        away: { name: "Away fixture-gw2-2", crest: null },
        score: null,
        matchHref: "/m/fixture-gw2-2",
        insightsMark: false,
        yourCall: {
          kind: "same",
          score: [1, 0],
          leagues: [{ id: "league-1", slug: "friends", name: "Friends" }],
          points: 0,
          verdict: undefined,
        },
      }, {
        id: "fixture-gw2-1",
        externalId: null,
        state: "",
        scheduled: true,
        kickoffAt: "2026-08-15T15:00:00.000Z",
        home: { name: "Home fixture-gw2-1", crest: null },
        away: { name: "Away fixture-gw2-1", crest: null },
        score: null,
        matchHref: "/m/fixture-gw2-1",
        insightsMark: false,
        yourCall: { kind: "none" },
      }],
    };
    expect(wrapper).toEqual(expectedMatchesView);
  });

  it("pins scope fallback on /matches and strict empty on home", async () => {
    const data = oneOpen();
    expect((await loadMatchesTab(sessionFor(data), USER, undefined, NOW, "foreign"))?.selectedScope).toBe("pl-2026-27");
    expect((await loadMatchesHomeTab(sessionFor(data), USER, { requestedScopeSlug: "foreign", now: NOW })).empty).toBe(true);
  });

  it.each(["scope-links", "member-scopes", "focus-entries", "entry-results", "picks"] as const)(
    "swallows the tolerated %s read for /matches but makes the home loader throw",
    async (purpose) => {
      const data = oneOpen({
        entries: [entry("contest-1", "league-1", "entered")],
        entryResults: [entryResult("entry-contest-1-viewer", "contest-1")],
        picks: [{ entry_id: "entry-contest-1-viewer", fixture_id: "fixture-gw1-1", pred_home: 1, pred_away: 0 }],
      });
      const tolerant = await loadMatchesTab(sessionFor(data, { errorPurpose: purpose }), USER, undefined, NOW);
      const internal = await loadMatchesTabInternal(sessionFor(data, { errorPurpose: purpose }), USER, undefined, NOW, undefined, { strictScope: false, strictReadErrors: false });
      expect(tolerant).toEqual(internal?.view ?? null);
      await expect(loadMatchesHomeTab(sessionFor(data, { errorPurpose: purpose }), USER, { now: NOW })).rejects.toThrow(purpose);
    },
  );
});
