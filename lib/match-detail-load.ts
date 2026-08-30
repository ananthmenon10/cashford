// Session reads below are user-scoped: leagues, contests, entries, picks and results.
// Service-role reads are limited to fixture/reference caches that authenticated users may select.
import { buildMatchDetailView, type MatchDetailView } from "./match-detail";
import { buildLiveInput, liveMoney } from "./gw-live-money";
import { matchStatusLabel } from "./contest-state";
import type { LeagueRef } from "./matches-tab";
import { MATCH_COPY } from "./match-copy";
import { collapseGameweekFixtures } from "./gw-fixtures";
import {
  selectStandingsRow,
  type StandingsCacheRow,
} from "./standings-view";

type Client = Awaited<ReturnType<typeof import("./supabase/server").createClient>>;
type Admin = ReturnType<typeof import("./supabase/service").createServiceRoleClient>;

function one<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

function verdict(
  result: any,
  fixtureId: string,
): "exact" | "result" | "miss" | undefined {
  const value = result?.per_fixture?.find(
    (row: any) => row.fixtureId === fixtureId,
  )?.verdict;
  return value === "exact" || value === "result" || value === "miss"
    ? value
    : undefined;
}

export async function loadMatchDetail(
  session: Client,
  admin: Admin,
  userId: string,
  fixtureId: string,
  selectedLeagueSlug?: string,
  now = new Date(),
): Promise<MatchDetailView | null> {
  const { data: fixtureRows, error: fixtureError } = await admin
    .from("fixtures")
    .select(
      "id,competition_id,kickoff_at,status,status_detail,minute,ft_home,ft_away,finished_at,home:teams!fixtures_home_team_id_fkey(id,name,flag_url),away:teams!fixtures_away_team_id_fkey(id,name,flag_url)",
    )
    .eq("id", fixtureId)
    .limit(1);
  if (fixtureError) {
    throw new Error(`match detail fixture: ${fixtureError.message}`);
  }
  const fixture: any = fixtureRows?.[0];
  if (!fixture) return null;
  const home: any = one(fixture.home);
  const away: any = one(fixture.away);
  const { data: membershipRows, error: membershipError } = await session
    .from("gameweek_fixtures")
    .select("id,fixture_id,gameweek_id,state,void_reason,added_at")
    .eq("fixture_id", fixtureId)
    .order("added_at", { ascending: false });
  if (membershipError) {
    throw new Error(`match detail membership: ${membershipError.message}`);
  }
  const membershipById = new Map(
    (membershipRows ?? []).map((row: any) => [row.id, row]),
  );
  const effectiveMemberships = [
    ...new Set((membershipRows ?? []).map((row: any) => row.gameweek_id)),
  ].flatMap((gameweekId) =>
    collapseGameweekFixtures(
      (membershipRows ?? [])
        .filter((row: any) => row.gameweek_id === gameweekId)
        .map((row: any) => ({
          fixtureId: row.fixture_id,
          membershipId: row.id,
          state: row.state,
          voidReason: row.void_reason,
        })),
    ).flatMap((effective) => {
      const original: any = membershipById.get(effective.membershipId);
      return original ? [{ ...original, effective_state: effective.state }] : [];
    }),
  );
  const membership: any =
    effectiveMemberships.find((row: any) => row.effective_state === "active") ??
    effectiveMemberships[0] ??
    null;
  if (!membership) return null;

  const [{ data: leagues, error: leagueError }, { data: scopes }] =
    await Promise.all([
      session.from("leagues").select("id,slug,name").order("name"),
      session
        .from("league_competitions")
        .select("league_id")
        .eq("competition_id", fixture.competition_id),
    ]);
  if (leagueError) throw new Error(`match detail leagues: ${leagueError.message}`);
  const scopeIds = new Set((scopes ?? []).map((row: any) => row.league_id));
  const leagueOptions: LeagueRef[] = (leagues ?? [])
    .filter((league: any) => scopeIds.has(league.id))
    .map((league: any) => ({
      id: league.id,
      slug: league.slug,
      name: league.name,
    }));
  const leagueById = new Map(leagueOptions.map((league) => [league.id, league]));

  // A neutral viewer has no contest scope. Do not issue a contest query for that case.
  const { data: contests, error: contestError } = leagueOptions.length
    ? await session
        .from("gameweek_contests")
        .select("id,league_id,stake_inr,deadline_at")
        .eq("gameweek_id", membership.gameweek_id)
        .in("league_id", leagueOptions.map((league) => league.id))
    : { data: [], error: null };
  if (contestError) {
    throw new Error(`match detail contests: ${contestError.message}`);
  }
  const contestIds = (contests ?? []).map((contest: any) => contest.id);
  const [{ data: entries }, { data: entryResults }] = contestIds.length
    ? await Promise.all([
        session
          .from("gameweek_entries")
          .select(
            "id,gameweek_contest_id,league_id,user_id,status,profiles(display_name,username)",
          )
          .in("gameweek_contest_id", contestIds),
        session
          .from("gameweek_entry_results")
          .select("entry_id,points,per_fixture")
          .in("gameweek_contest_id", contestIds),
      ])
    : [{ data: [] }, { data: [] }];
  const entryIds = (entries ?? []).map((entry: any) => entry.id);
  const { data: picks } = entryIds.length
    ? await session
        .from("gameweek_picks")
        .select("entry_id,fixture_id,pred_home,pred_away")
        .in("entry_id", entryIds)
    : { data: [] };
  const pickByEntry = new Map(
    (picks ?? []).map((pick: any) => [
      `${pick.entry_id}:${pick.fixture_id}`,
      pick,
    ]),
  );
  const resultByEntry = new Map(
    (entryResults ?? []).map((result: any) => [result.entry_id, result]),
  );

  const yourCalls: MatchDetailView["yourCalls"] = (contests ?? [])
    .flatMap((contest: any) => {
      const league = leagueById.get(contest.league_id);
      if (!league) return [];
      const entry: any = (entries ?? []).find(
        (row: any) =>
          row.gameweek_contest_id === contest.id && row.user_id === userId,
      );
      const pick: any = entry
        ? pickByEntry.get(`${entry.id}:${fixtureId}`)
        : null;
      const result: any = entry ? resultByEntry.get(entry.id) : null;
      return [{
        league,
        anteInr: contest.stake_inr,
        score: pick
          ? [pick.pred_home, pick.pred_away] as [number, number]
          : null,
        deadlineAt: contest.deadline_at,
        entered: !!entry && entry.status !== "invalid",
        ...(result?.points != null ? { points: result.points } : {}),
        ...(verdict(result, fixtureId)
          ? { verdict: verdict(result, fixtureId) }
          : {}),
      }];
    });

  const selectedContest =
    (contests ?? []).find((contest: any) => {
      const league = leagueById.get(contest.league_id);
      return league?.slug === selectedLeagueSlug;
    }) ??
    (contests ?? []).find((contest: any) =>
      yourCalls.some((call) => call.league.id === contest.league_id),
    ) ??
    contests?.[0] ??
    null;
  const selectedLeague = selectedContest
    ? leagueById.get(selectedContest.league_id) ?? null
    : null;
  const reveal = selectedContest
    ? now.getTime() >= new Date(selectedContest.deadline_at).getTime()
    : false;
  const room: MatchDetailView["room"] =
    selectedContest && selectedLeague
      ? {
          league: selectedLeague,
          leagueOptions,
          deadlineAt: selectedContest.deadline_at,
          entrants: (entries ?? [])
            .filter(
              (entry: any) =>
                entry.gameweek_contest_id === selectedContest.id,
            )
            .map((entry: any) => {
              const profile: any = one(entry.profiles);
              const pick: any = pickByEntry.get(`${entry.id}:${fixtureId}`);
              const result: any = resultByEntry.get(entry.id);
              const visible = reveal || entry.user_id === userId;
              return {
                name:
                  profile?.display_name ??
                  profile?.username ??
                  "Player",
                score:
                  visible && pick
                    ? [pick.pred_home, pick.pred_away] as [number, number]
                    : null,
                hidden: !visible,
                ...(result?.points != null ? { points: result.points } : {}),
                ...(verdict(result, fixtureId)
                  ? { verdict: verdict(result, fixtureId) }
                  : {}),
              };
            }),
        }
      : null;

  const [
    { data: insightsRows },
    { data: matchRows },
    { data: providerRows },
    { data: gameweekMemberships },
    { data: standingRows },
    { data: liveCompetitionFixtures },
  ] = await Promise.all([
    admin.from("fixture_insights").select("*").eq("fixture_id", fixtureId),
    admin.from("fixture_match_data").select("*").eq("fixture_id", fixtureId),
    admin
      .from("fixture_provider_data")
      .select("*")
      .eq("fixture_id", fixtureId),
    session
      .from("gameweek_fixtures")
      .select(
        "id,fixture_id,state,void_reason,fixtures(status,ft_home,ft_away)",
      )
      .eq("gameweek_id", membership.gameweek_id),
    admin
      .from("competition_standings")
      .select("source,rows,note,fetched_at")
      .eq("competition_id", fixture.competition_id),
    admin
      .from("fixtures")
      .select("id")
      .eq("competition_id", fixture.competition_id)
      .eq("status", "live")
      .limit(1),
  ]);
  const state: MatchDetailView["state"] =
    fixture.status === "live"
      ? "live"
      : fixture.status === "finished" ||
          fixture.status === "postponed" ||
          fixture.status === "cancelled" ||
          fixture.status === "abandoned"
        ? "post"
        : "pre";
  const score =
    state === "pre" || fixture.ft_home == null || fixture.ft_away == null
      ? null
      : [fixture.ft_home, fixture.ft_away] as [number, number];
  const slowRows = (providerRows ?? []) as Array<Record<string, any>>;
  const selectedEntries = selectedContest
    ? (entries ?? []).filter(
        (entry: any) =>
          entry.gameweek_contest_id === selectedContest.id &&
          entry.status === "locked_in",
      )
    : [];
  const engineEntries = selectedEntries.map((entry: any) => ({
    userId: entry.user_id,
    picks: (picks ?? [])
      .filter((pick: any) => pick.entry_id === entry.id)
      .map((pick: any) => ({
        fixtureId: pick.fixture_id,
        predHome: pick.pred_home,
        predAway: pick.pred_away,
      })),
  }));
  const liveFixtures = collapseGameweekFixtures(
    (gameweekMemberships ?? []).map((row: any) => ({
      fixtureId: row.fixture_id,
      membershipId: row.id,
      state: row.state,
      voidReason: row.void_reason,
      fixture: one(row.fixtures),
    })),
  ).map((row) => {
    const match: any = row.fixture;
    return {
      fixtureId: row.fixtureId,
      state:
        row.state === "void"
          ? ("void" as const)
          : match?.status === "finished"
            ? ("final" as const)
            : match?.status === "live"
              ? ("live" as const)
              : ("upcoming" as const),
      home: match?.ft_home ?? null,
      away: match?.ft_away ?? null,
    };
  });
  const raceSnapshot = (
    fixtures: typeof liveFixtures,
  ) => {
    if (!selectedContest) return null;
    const input = buildLiveInput({
      entries: engineEntries,
      fixtures,
      stakeInr: selectedContest.stake_inr,
    });
    if (!input) return null;
    try {
      return liveMoney(input)?.find((row) => row.userId === userId) ?? null;
    } catch {
      return null;
    }
  };
  const currentRace = state === "live" ? raceSnapshot(liveFixtures) : null;
  const homeGoal =
    state === "live" && score
      ? raceSnapshot(
          liveFixtures.map((row) =>
            row.fixtureId === fixtureId
              ? { ...row, state: "live" as const, home: score[0] + 1, away: score[1] }
              : row,
          ),
        )
      : null;
  const awayGoal =
    state === "live" && score
      ? raceSnapshot(
          liveFixtures.map((row) =>
            row.fixtureId === fixtureId
              ? { ...row, state: "live" as const, home: score[0], away: score[1] + 1 }
              : row,
          ),
        )
      : null;
  const matchData: any = matchRows?.[0] ?? null;
  const revisionCount = Number(
    String(matchData?.result_fingerprint ?? "").split("@").at(-1),
  );
  const correctedStamp = [
    matchData?.key_events_fetched_at,
    matchData?.scorers_fetched_at,
    matchData?.team_stats_fetched_at,
    matchData?.player_stats_fetched_at,
    matchData?.commentary_fetched_at,
  ]
    .filter(Boolean)
    .sort()
    .at(-1);
  const correctedAt =
    revisionCount > 0 && correctedStamp ? String(correctedStamp) : undefined;
  const standings = selectStandingsRow(
    (standingRows ?? []) as StandingsCacheRow[],
    now,
    !!liveCompetitionFixtures?.length,
  );
  return buildMatchDetailView({
    now,
    state,
    fixture: {
      id: fixture.id,
      home: {
        id: home?.id ?? "home-tbc",
        name: home?.name ?? "TBC",
        crest: home?.flag_url ?? null,
      },
      away: {
        id: away?.id ?? "away-tbc",
        name: away?.name ?? "TBC",
        crest: away?.flag_url ?? null,
      },
      score,
      status: matchStatusLabel(fixture.status, fixture.status_detail, fixture.minute),
      kickoffAt: fixture.kickoff_at,
      finishedAt: fixture.finished_at,
    },
    selectedRoom: room,
    yourCalls,
    insights: insightsRows?.[0] ?? null,
    standings,
    matchData,
    providerRows: slowRows.map((row) => ({
      provider: row.provider,
      xg_home: row.xg_home,
      xg_away: row.xg_away,
      xg_model: row.xg_model,
      xg_fetched_at: row.xg_fetched_at,
      xg_ok: row.xg_ok,
      fixtureKickoffAt: fixture.kickoff_at,
    })),
    slowRows,
    liveRace:
      selectedLeague && currentRace && homeGoal && awayGoal
        ? {
            league: selectedLeague,
            current: {
              points: currentRace.points,
              rank: currentRace.rank,
              fieldSize: currentRace.fieldSize,
            },
            homeGoal: { points: homeGoal.points, rank: homeGoal.rank },
            awayGoal: { points: awayGoal.points, rank: awayGoal.rank },
          }
        : undefined,
    correctedAt,
  });
}
