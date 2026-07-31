import {
  resolveContestLifecycle,
  resolveViewerParticipation,
} from "./gw-state";
import { resolveAppGameweek } from "./gw-resolve-app";
import {
  buildLeagueRow,
  sharedHeaderPoints,
  type FixtureRowView,
  type LeagueRef,
  type MatchesTabView,
  type WinnersRecapView,
} from "./matches-tab";
import { isEligible } from "./gw-eligibility";
import { buildLiveInput, liveMoney } from "./gw-live-money";
import { collapseGameweekFixtures } from "./gw-fixtures";
import { rankGameweekScores } from "./gw-rank";
import { ordinal } from "./view-format";

type Client = Awaited<ReturnType<typeof import("./supabase/server").createClient>>;

function one<T>(value: T | T[]): T {
  return Array.isArray(value) ? value[0] : value;
}

function fixtureState(fixture: any) {
  if (fixture.effective_state === "void" || fixture.state === "void") {
    return { effectiveState: "void" as const };
  }
  return {
    effectiveState: "active" as const,
    status: fixture.fixtures?.status,
    homeScore: fixture.fixtures?.ft_home,
    awayScore: fixture.fixtures?.ft_away,
  };
}

export async function loadMatchesTab(
  session: Client,
  userId: string,
  requestedGw?: number,
  now = new Date(),
): Promise<MatchesTabView | null> {
  const { data: competitions, error: competitionError } = await session
    .from("competitions")
    .select("id, slug, name, status")
    .eq("slug", "pl-2026-27");
  if (competitionError) {
    throw new Error(`matches competition: ${competitionError.message}`);
  }
  const competition = competitions?.[0];
  if (!competition) return null;

  const [
    { data: leagues, error: leagueError },
    { data: scopes },
    { data: memberScopes },
  ] = await Promise.all([
      session.from("leagues").select("id, slug, name, status").order("name"),
      session
        .from("league_competitions")
        .select("league_id, status, eligible_from_gameweek_id")
        .eq("competition_id", competition.id),
      session
        .from("member_competitions")
        .select("league_id, eligible_from_gameweek_id, left_at")
        .eq("competition_id", competition.id)
        .eq("user_id", userId),
    ]);
  if (leagueError) throw new Error(`matches leagues: ${leagueError.message}`);
  const scopeIds = new Set((scopes ?? []).map((scope: any) => scope.league_id));
  const leagueRefs: LeagueRef[] = (leagues ?? [])
    .filter((league: any) => scopeIds.has(league.id))
    .map((league: any) => ({
      id: league.id,
      slug: league.slug,
      name: league.name,
    }));
  const leagueById = new Map(leagueRefs.map((league) => [league.id, league]));
  const scopeByLeague = new Map(
    (scopes ?? []).map((scope: any) => [scope.league_id, scope]),
  );
  const memberScopeByLeague = new Map(
    (memberScopes ?? []).map((scope: any) => [scope.league_id, scope]),
  );

  const { data: gameweeks, error: gameweekError } = await session
    .from("gameweeks")
    .select("id, number, name, deadline_at, status")
    .eq("competition_id", competition.id)
    .order("number");
  if (gameweekError) {
    throw new Error(`matches gameweeks: ${gameweekError.message}`);
  }
  if (!gameweeks?.length) return null;

  const { data: contests, error: contestError } = leagueRefs.length
    ? await session
        .from("gameweek_contests")
        .select(
          "id, league_id, gameweek_id, stake_inr, deadline_at, status, input_version",
        )
        .eq("competition_id", competition.id)
        .in("league_id", leagueRefs.map((league) => league.id))
    : { data: [], error: null };
  if (contestError) throw new Error(`matches contests: ${contestError.message}`);

  const gwIds = gameweeks.map((gw: any) => gw.id);
  const [
    { data: memberships, error: membershipError },
    { data: gwResults, error: resultError },
  ] = await Promise.all([
    session
      .from("gameweek_fixtures")
      .select(
        "id, gameweek_id, fixture_id, state, fixtures(id,kickoff_at,status,status_detail,minute,ft_home,ft_away,home:teams!fixtures_home_team_id_fkey(id,name,flag_url),away:teams!fixtures_away_team_id_fkey(id,name,flag_url),fixture_insights(fixture_id))",
      )
      .in("gameweek_id", gwIds),
    contests?.length
      ? session
          .from("gameweek_results")
          .select(
            "gameweek_contest_id, outcome, settled_version, void_reason, tiebreak_used, pot_inr",
          )
          .in("gameweek_contest_id", contests.map((contest: any) => contest.id))
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (membershipError) {
    throw new Error(`matches memberships: ${membershipError.message}`);
  }
  if (resultError) throw new Error(`matches results: ${resultError.message}`);
  const membershipByGw = new Map<string, any[]>();
  for (const gameweek of gameweeks) {
    const history = (memberships ?? [])
      .filter((membership: any) => membership.gameweek_id === gameweek.id)
      .map((membership: any) => ({
        fixtureId: membership.fixture_id,
        membershipId: membership.id,
        state: membership.state,
        fixture: one(membership.fixtures),
      }));
    const effective = collapseGameweekFixtures(history).map((membership) => ({
      id: membership.membershipId,
      gameweek_id: gameweek.id,
      fixture_id: membership.fixtureId,
      state: membership.state,
      effective_state: membership.state,
      fixtures: membership.fixture,
    }));
    membershipByGw.set(gameweek.id, effective);
  }
  const resultByContest = new Map(
    (gwResults ?? []).map((result: any) => [
      result.gameweek_contest_id,
      result,
    ]),
  );
  const contestWithCl = (contests ?? []).map((contest: any) => {
    const result: any = resultByContest.get(contest.id);
    const cl = resolveContestLifecycle(
      {
        status: contest.status,
        deadlineAt: contest.deadline_at,
        inputVersion: contest.input_version,
      },
      null,
      (membershipByGw.get(contest.gameweek_id) ?? []).map(fixtureState),
      result
        ? {
            outcome: result.outcome,
            settledVersion: result.settled_version,
            voidReason: result.void_reason,
          }
        : null,
      now,
    );
    return { ...contest, cl };
  });
  const resolution = resolveAppGameweek({
    competition: {
      id: competition.id,
      archived: competition.status === "archived",
    },
    gameweeks: gameweeks.map((gw: any) => ({
      id: gw.id,
      number: gw.number,
      label: gw.name,
      deadlineAt: gw.deadline_at ? new Date(gw.deadline_at) : null,
    })),
    contests: contestWithCl.map((contest: any) => ({
      gwId: contest.gameweek_id,
      leagueId: contest.league_id,
      status: contest.status,
      deadlineAt: new Date(contest.deadline_at),
      inputVersion: contest.input_version,
      cl: contest.cl,
    })),
    results: (gwResults ?? []).flatMap((result: any) => {
      const contest = (contests ?? []).find(
        (row: any) => row.id === result.gameweek_contest_id,
      );
      return contest
        ? [{
            gwId: contest.gameweek_id,
            leagueId: contest.league_id,
            outcome: result.outcome,
            settledVersion: result.settled_version,
          }]
        : [];
    }),
    viewerLeagueIds: leagueRefs.map((league) => league.id),
    now,
  });
  const requested = requestedGw
    ? gameweeks.find((gw: any) => gw.number === requestedGw)
    : null;
  const focusRef =
    requested ??
    (resolution.currentGw
      ? gameweeks.find((gw: any) => gw.id === resolution.currentGw!.id)
      : resolution.nextOpenGw
        ? gameweeks.find((gw: any) => gw.id === resolution.nextOpenGw!.id)
        : resolution.latestSettledGw
          ? gameweeks.find((gw: any) => gw.id === resolution.latestSettledGw!.id)
          : gameweeks[0]);
  if (!focusRef) return null;
  const focusContests = contestWithCl.filter(
    (contest: any) => contest.gameweek_id === focusRef.id,
  );
  const focusDeadline =
    focusRef.deadline_at ?? focusContests[0]?.deadline_at ?? null;
  if (!focusDeadline) return null;
  const contestIds = focusContests.map((contest: any) => contest.id);
  const [{ data: entries }, { data: entryResults }] = contestIds.length
    ? await Promise.all([
        session
          .from("gameweek_entries")
          .select(
            "id, gameweek_contest_id, league_id, user_id, status, profiles(display_name,username)",
          )
          .in("gameweek_contest_id", contestIds),
        session
          .from("gameweek_entry_results")
          .select("*")
          .in("gameweek_contest_id", contestIds),
      ])
    : [{ data: [] }, { data: [] }];
  const entryIds = (entries ?? []).map((entry: any) => entry.id);
  const { data: picks } = entryIds.length
    ? await session
        .from("gameweek_picks")
        .select("entry_id, fixture_id, pred_home, pred_away")
        .in("entry_id", entryIds)
    : { data: [] };
  const picksByEntry = new Map<string, any[]>();
  for (const pick of picks ?? []) {
    const rows = picksByEntry.get(pick.entry_id) ?? [];
    rows.push(pick);
    picksByEntry.set(pick.entry_id, rows);
  }
  const entryResultByEntry = new Map(
    (entryResults ?? []).map((result: any) => [result.entry_id, result]),
  );
  const myEntries = (entries ?? []).filter(
    (entry: any) => entry.user_id === userId,
  );
  const myEntryByContest = new Map(
    myEntries.map((entry: any) => [entry.gameweek_contest_id, entry]),
  );
  const myPickByFixture = new Map<string, any[]>();
  for (const pick of picks ?? []) {
    const entry = myEntries.find((row: any) => row.id === pick.entry_id);
    if (!entry) continue;
    const rows = myPickByFixture.get(pick.fixture_id) ?? [];
    rows.push({ ...pick, entry });
    myPickByFixture.set(pick.fixture_id, rows);
  }

  const boundaryById = new Map(
    gameweeks.map((gameweek: any) => [gameweek.id, gameweek.number]),
  );
  const focusMemberships = membershipByGw.get(focusRef.id) ?? [];
  const liveByContest = new Map<string, ReturnType<typeof liveMoney>>();
  for (const contest of focusContests) {
    if (!["CL3", "CL4", "CL6", "CL8"].includes(contest.cl)) continue;
    const lockedEntries = (entries ?? []).filter(
      (entry: any) =>
        entry.gameweek_contest_id === contest.id &&
        entry.status === "locked_in",
    );
    const liveInput = buildLiveInput({
      entries: lockedEntries.map((entry: any) => ({
        userId: entry.user_id,
        picks: (picksByEntry.get(entry.id) ?? []).map((pick: any) => ({
          fixtureId: pick.fixture_id,
          predHome: pick.pred_home,
          predAway: pick.pred_away,
        })),
      })),
      fixtures: focusMemberships.map((membership: any) => {
        const fixture = membership.fixtures;
        const voided =
          membership.effective_state === "void" ||
          membership.state === "void";
        return {
          fixtureId: membership.fixture_id,
          state: voided
            ? ("void" as const)
            : fixture?.status === "finished"
              ? ("final" as const)
              : fixture?.status === "live"
                ? ("live" as const)
                : ("upcoming" as const),
          home: fixture?.ft_home ?? null,
          away: fixture?.ft_away ?? null,
        };
      }),
      stakeInr: contest.stake_inr,
    });
    if (!liveInput) {
      liveByContest.set(contest.id, null);
      continue;
    }
    try {
      liveByContest.set(contest.id, liveMoney(liveInput));
    } catch {
      liveByContest.set(contest.id, null);
    }
  }

  const leagueRows = focusContests
    .map((contest: any) => {
      const league = leagueById.get(contest.league_id);
      if (!league) return null;
      const entry: any = myEntryByContest.get(contest.id);
      const leagueScope: any = scopeByLeague.get(contest.league_id);
      const memberScope: any = memberScopeByLeague.get(contest.league_id);
      const participation = resolveViewerParticipation({
        eligible: isEligible(
          {
            leagueEligibleFromNumber: leagueScope?.eligible_from_gameweek_id
              ? boundaryById.get(leagueScope.eligible_from_gameweek_id) ?? null
              : null,
            memberEligibleFromNumber: memberScope?.eligible_from_gameweek_id
              ? boundaryById.get(memberScope.eligible_from_gameweek_id) ?? null
              : null,
            leftAt: memberScope?.left_at ?? null,
          },
          focusRef.number,
        ),
        entryStatus: entry?.status ?? null,
      });
      const result: any = entry ? entryResultByEntry.get(entry.id) : null;
      const live = entry
        ? liveByContest
            .get(contest.id)
            ?.find((row) => row.userId === entry.user_id) ?? null
        : null;
      const lockedFieldSize = (entries ?? []).filter(
        (row: any) =>
          row.gameweek_contest_id === contest.id &&
          row.status === "locked_in",
      ).length;
      return buildLeagueRow(contest.cl, participation, {
        league,
        raceHref: `/leagues/${league.slug}`,
        cta:
          contest.cl === "CL1" &&
          ["VP1", "VP2", "VP3"].includes(participation)
            ? {
                label: participation === "VP1" ? "Enter GW" : "Edit picks",
                href: `/leagues/${league.slug}/enter`,
              }
            : undefined,
        points: live?.points ?? result?.points ?? null,
        netInr: live?.netInr ?? result?.net_inr ?? null,
        fieldSize: live?.fieldSize ?? lockedFieldSize,
        ordinal: live
          ? ordinal(live.rank)
          : result
            ? rankForEntry(
                entry.id,
                (entryResults ?? []).filter(
                  (row: any) => row.gameweek_contest_id === contest.id,
                ),
              )
            : null,
        voidReason: resultByContest.get(contest.id)?.void_reason,
      });
    })
    .filter((row): row is NonNullable<typeof row> => row !== null);

  const fixtureRows: FixtureRowView[] = (membershipByGw.get(focusRef.id) ?? [])
    .filter((membership: any) => membership.fixtures)
    .sort(
      (a: any, b: any) =>
        new Date(a.fixtures.kickoff_at ?? 0).getTime() -
        new Date(b.fixtures.kickoff_at ?? 0).getTime(),
    )
    .map((membership: any) => {
      const fixture = membership.fixtures;
      const membershipVoid =
        membership.effective_state === "void" || membership.state === "void";
      const calls = myPickByFixture.get(fixture.id) ?? [];
      const liveCall = (entry: any) => {
        const live = liveByContest
          .get(entry.gameweek_contest_id)
          ?.find((row) => row.userId === entry.user_id);
        return live?.perFixture.find(
          (score) => score.fixtureId === fixture.id,
        );
      };
      const call: FixtureRowView["yourCall"] =
        calls.length === 0
          ? ({ kind: "none" } as const)
          : calls.every(
                (row) =>
                  row.pred_home === calls[0].pred_home &&
                  row.pred_away === calls[0].pred_away,
              )
            ? {
                kind: "same",
                score: [
                  calls[0].pred_home,
                  calls[0].pred_away,
                ] as [number, number],
                leagues: calls.flatMap((row) => {
                  const league = leagueById.get(row.entry.league_id);
                  return league ? [league] : [];
                }),
                points:
                  liveCall(calls[0].entry)?.pts ??
                  pointsForFixture(
                    calls[0].entry.id,
                    fixture.id,
                    entryResultByEntry,
                  ),
                verdict: displayVerdict(
                  liveCall(calls[0].entry)?.verdict ??
                    verdictForFixture(
                      calls[0].entry.id,
                      fixture.id,
                      entryResultByEntry,
                    ),
                ),
              }
            : {
                kind: "varies",
                calls: calls
                  .flatMap((row) => {
                    const league = leagueById.get(row.entry.league_id);
                    if (!league) return [];
                    const callVerdict = displayVerdict(
                      liveCall(row.entry)?.verdict ??
                        verdictForFixture(
                          row.entry.id,
                          fixture.id,
                          entryResultByEntry,
                        ),
                    );
                    return [{
                      score: [row.pred_home, row.pred_away] as [number, number],
                      league,
                      points:
                        liveCall(row.entry)?.pts ??
                        pointsForFixture(
                          row.entry.id,
                          fixture.id,
                          entryResultByEntry,
                        ),
                      ...(callVerdict ? { verdict: callVerdict } : {}),
                    }];
                  })
                  .sort((a, b) => b.points - a.points),
              };
      return {
        id: fixture.id,
        state: fixtureLabel(fixture, membershipVoid),
        home: {
          name: one(fixture.home)?.name ?? "TBC",
          crest: one(fixture.home)?.flag_url ?? null,
        },
        away: {
          name: one(fixture.away)?.name ?? "TBC",
          crest: one(fixture.away)?.flag_url ?? null,
        },
        score:
          membershipVoid ||
          fixture.status === "scheduled" ||
          fixture.ft_home == null ||
          fixture.ft_away == null
            ? null
            : [fixture.ft_home, fixture.ft_away] as [number, number],
        matchHref: `/m/${fixture.id}`,
        insightsMark: Array.isArray(fixture.fixture_insights)
          ? fixture.fixture_insights.length > 0
          : !!fixture.fixture_insights,
        yourCall: call,
      };
    });
  const days = groupByDay(fixtureRows, membershipByGw.get(focusRef.id) ?? []);
  const displayed = limitDays(days, 7);
  const gwState: MatchesTabView["gw"]["state"] = focusContests.some(
    (contest: any) => contest.cl === "CL3" || contest.cl === "CL4",
  )
    ? "live"
    : focusContests.every(
          (contest: any) => contest.cl === "CL5" || contest.cl === "CL7",
        ) && focusContests.length > 0
      ? "settled"
      : "pre";
  const recap = buildWinnersRecap(
    focusContests,
    gwResults ?? [],
    entries ?? [],
    entryResults ?? [],
    leagueById,
  );
  const latestSettled = resolution.latestSettledGw;
  const settledRecap =
    !requested &&
    latestSettled &&
    resolution.nextOpenGw?.id === focusRef.id &&
    latestSettled.id !== focusRef.id
      ? {
          gwNumber: latestSettled.number,
          href: `/matches?gw=${latestSettled.number}`,
        }
      : undefined;
  return {
    competition: {
      id: competition.id,
      slug: competition.slug,
      name: competition.name,
      archived: competition.status === "archived",
    },
    gw: {
      id: focusRef.id,
      number: focusRef.number,
      label: focusRef.name,
      state: gwState,
      deadlineAt: focusDeadline,
      isCurrent: resolution.currentGw?.id === focusRef.id,
    },
    picker: {
      prev:
        gameweeks.find((gw: any) => gw.number === focusRef.number - 1)?.number,
      next:
        gameweeks.find((gw: any) => gw.number === focusRef.number + 1)?.number,
      range: gameweeks.map((gw: any) => gw.number),
      futureCaveat: gwState === "pre",
    },
    yourGw: leagueRows.length
      ? {
          enteredCount: myEntries.length,
          leagueCount: leagueRefs.length,
          toGo: gwState === "pre" ? leagueRefs.length - myEntries.length : null,
          headerPoints: sharedHeaderPoints(leagueRows),
          rows: leagueRows,
          provisional: gwState === "live",
          ...(settledRecap ? { recap: settledRecap } : {}),
        }
      : null,
    winnersRecap: recap.length ? recap : null,
    days: displayed.days,
    overflow: displayed.overflow,
  };
}

function rankForEntry(entryId: string, results: any[]) {
  const ranked = results.filter(
    (result) =>
      typeof result.points === "number" &&
      typeof result.exacts === "number" &&
      typeof result.goal_error === "number",
  );
  const rank = rankGameweekScores(
    ranked.map((result) => ({
      userId: result.entry_id,
      points: result.points,
      exacts: result.exacts,
      goalError: result.goal_error,
    })),
  ).get(entryId);
  return rank == null ? null : ordinal(rank);
}

function pointsForFixture(
  entryId: string,
  fixtureId: string,
  results: Map<string, any>,
) {
  return (
    results
      .get(entryId)
      ?.per_fixture?.find((row: any) => row.fixtureId === fixtureId)?.pts ?? 0
  );
}

function verdictForFixture(
  entryId: string,
  fixtureId: string,
  results: Map<string, any>,
) {
  return results
    .get(entryId)
    ?.per_fixture?.find((row: any) => row.fixtureId === fixtureId)?.verdict;
}

function displayVerdict(
  value: unknown,
): "exact" | "result" | "miss" | undefined {
  return value === "exact" || value === "result" || value === "miss"
    ? value
    : undefined;
}

function fixtureLabel(fixture: any, membershipVoid: boolean) {
  if (membershipVoid) {
    return fixture.status === "postponed" ? "Postponed · Void" : "Void";
  }
  if (fixture.status === "live") return `${fixture.minute ?? ""}' · LIVE`;
  if (fixture.status === "finished") return "FT";
  if (fixture.status === "postponed") return "Postponed";
  if (fixture.status === "cancelled" || fixture.status === "abandoned") {
    return "Void";
  }
  return fixture.kickoff_at
    ? new Intl.DateTimeFormat("en-IN", {
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "Asia/Kolkata",
      }).format(new Date(fixture.kickoff_at))
    : "Date TBC";
}

function groupByDay(rows: FixtureRowView[], memberships: any[]) {
  const kickoffById = new Map(
    memberships.map((membership) => [
      membership.fixtures?.id,
      membership.fixtures?.kickoff_at,
    ]),
  );
  const groups = new Map<string, FixtureRowView[]>();
  for (const row of rows) {
    const kickoff = kickoffById.get(row.id);
    const label = kickoff
      ? new Intl.DateTimeFormat("en-IN", {
          weekday: "long",
          day: "numeric",
          month: "short",
          timeZone: "Asia/Kolkata",
        }).format(new Date(kickoff))
      : "Date TBC";
    const values = groups.get(label) ?? [];
    values.push(row);
    groups.set(label, values);
  }
  return [...groups].map(([label, fixtures]) => ({ label, fixtures }));
}

function limitDays(
  days: MatchesTabView["days"],
  limit: number,
): Pick<MatchesTabView, "days" | "overflow"> {
  const visible: MatchesTabView["days"] = [];
  const hiddenLabels: string[] = [];
  let remaining = limit;
  let hidden = 0;
  for (const day of days) {
    let visibleHere = 0;
    if (remaining > 0) {
      const fixtures = day.fixtures.slice(0, remaining);
      if (fixtures.length) visible.push({ ...day, fixtures });
      visibleHere = fixtures.length;
      remaining -= fixtures.length;
    }
    const hiddenHere = day.fixtures.length - visibleHere;
    if (hiddenHere > 0) {
      hidden += hiddenHere;
      hiddenLabels.push(day.label.split(" ")[0]);
    }
  }
  const labels = [...new Set(hiddenLabels)];
  const label =
    labels.length <= 1
      ? (labels[0] ?? "")
      : `${labels.slice(0, -1).join(", ")} and ${labels.at(-1)}`;
  return {
    days: visible,
    overflow: hidden > 0 ? { count: hidden, label } : null,
  };
}

function buildWinnersRecap(
  contests: any[],
  results: any[],
  entries: any[],
  entryResults: any[],
  leagueById: Map<string, LeagueRef>,
): WinnersRecapView[] {
  const recap: WinnersRecapView[] = [];
  for (const contest of contests) {
    const league = leagueById.get(contest.league_id);
    const result = results.find(
      (row) => row.gameweek_contest_id === contest.id,
    );
    if (!league || !result) continue;
    if (contest.cl === "CL6" || contest.cl === "CL8") {
      recap.push({
        kind: "recalculating",
        league,
        href: `/leagues/${league.slug}`,
      });
      continue;
    }
    if (result.outcome === "void") {
      recap.push({
        kind: "void",
        league,
        voidReason: result.void_reason,
        href: `/leagues/${league.slug}`,
      });
      continue;
    }
    const winners = entryResults
      .filter(
        (row) =>
          row.gameweek_contest_id === contest.id && row.is_winner,
      )
      .flatMap((row) => {
        const entry = entries.find((candidate) => candidate.id === row.entry_id);
        const profile = entry ? one(entry.profiles) : null;
        return entry
          ? [{
              name: profile?.display_name ?? profile?.username ?? "Player",
              points: row.points,
            }]
          : [];
      });
    recap.push({
      kind: "settled",
      league,
      potInr: result.pot_inr ?? 0,
      winners,
      tiebreakUsed: result.tiebreak_used,
      href: `/leagues/${league.slug}`,
    });
  }
  return recap;
}
