import {
  arrayBlock,
  sourcedBlock,
  type Sourced,
} from "./match-blocks";
import type { LeagueRef } from "./matches-tab";
import { MATCH_COPY } from "./match-copy";
import { modelUsable } from "./insights-cadence";
import type { StandingsCacheRow } from "./standings-view";
import { ordinal } from "./view-format";
import {
  selectXg,
  type ProviderXgRow,
} from "./xg-select";

export type Club = { id: string; name: string; crest?: string | null };
export type ScoreProb = { h: number; a: number; p: number };

export type MatchDetailView = {
  state: "pre" | "live" | "post";
  header: {
    home: Club;
    away: Club;
    score: [number, number] | null;
    status: string;
    kickoffAt: string | null;
    deadlineAt: string | null;
    scorers?: Sourced<{ lines: unknown[] }>;
  };
  yourCalls: Array<{
    league: LeagueRef;
    anteInr: number;
    score: [number, number] | null;
    deadlineAt: string;
    entered: boolean;
    points?: number;
    verdict?: "exact" | "result" | "miss";
  }>;
  room: {
    league: LeagueRef;
    leagueOptions: LeagueRef[];
    deadlineAt: string;
    entrants: Array<{
      name: string;
      score: [number, number] | null;
      hidden: boolean;
      annotation?: string;
      points?: number;
      offBy?: number;
      verdict?: "exact" | "result" | "miss";
    }>;
  } | null;
  whatIf?: { line: string };
  odds?: Sourced<{
    home: number;
    draw: number;
    away: number;
    book: string;
  }>;
  model?: Sourced<{
    topScores: ScoreProb[];
    btts: number;
    cleanSheets: [number, number];
    pOver: number;
  }>;
  form?: Sourced<{ home: unknown[]; away: unknown[] }>;
  h2h?: Sourced<{ games: unknown[]; summary: string }>;
  table?: Sourced<{
    window: unknown[];
    source: "espn" | "derived";
    note: string | null;
  }>;
  teamNews?: Sourced<{ home: unknown[]; away: unknown[] }>;
  keyEvents?: Sourced<{ timeline: unknown[] }>;
  teamStats?: Sourced<{
    phase: "live" | "final";
    minute: string | null;
    rows: unknown[];
  }>;
  playerStats?: Sourced<{ rows: unknown[] }>;
  commentary?: Sourced<{ lines: Array<{ minute: string; text: string }> }>;
  lineups?: Sourced<{ home: unknown; away: unknown }>;
  retrospective?: Sourced<{ line: string }>;
  xg?: Sourced<{
    home: number;
    away: number;
    provider: "FotMob" | "Understat";
    model: string;
    afterFt: string;
  }>;
  shotMap?: Sourced<{
    shots: unknown[];
    provider: "FotMob" | "Understat";
  }>;
  ratings?: Sourced<{
    potm: unknown;
    others: unknown[];
    provider: string;
  }>;
  momentum?: Sourced<{ series: unknown[]; provider: string }>;
  predictedXi?: Sourced<{
    home: unknown;
    away: unknown;
    provider: "FotMob";
  }>;
  raceLink?: { league: LeagueRef; standingLine: string; href: string };
  notes: string[];
};

type BlockRow = Record<string, any> | null;

export type MatchDetailInput = {
  now: Date;
  state: MatchDetailView["state"];
  fixture: {
    id: string;
    home: Club;
    away: Club;
    score: [number, number] | null;
    status: string;
    kickoffAt: string | null;
    finishedAt?: string | null;
  };
  selectedRoom: MatchDetailView["room"];
  yourCalls: MatchDetailView["yourCalls"];
  insights: BlockRow;
  standings: StandingsCacheRow | null;
  matchData: BlockRow;
  providerRows: ProviderXgRow[];
  slowRows: Array<Record<string, any>>;
  liveRace?: {
    league: LeagueRef;
    current: { points: number; rank: number; fieldSize: number };
    homeGoal: { points: number; rank: number };
    awayGoal: { points: number; rank: number };
  };
  notes?: string[];
};

export function buildMatchDetailView(
  input: MatchDetailInput,
): MatchDetailView {
  const { now, insights, matchData } = input;
  const kickoffAt = input.fixture.kickoffAt
    ? new Date(input.fixture.kickoffAt)
    : null;
  const room = input.selectedRoom;
  const view: MatchDetailView = {
    state: input.state,
    header: {
      home: input.fixture.home,
      away: input.fixture.away,
      score: input.fixture.score,
      status: input.fixture.status,
      kickoffAt: input.fixture.kickoffAt,
      deadlineAt: room?.deadlineAt ?? null,
    },
    yourCalls: input.yourCalls,
    room,
    notes: input.notes ?? [],
  };

  if (input.state === "live" && input.fixture.score && room && input.liveRace) {
    const selectedCall =
      input.yourCalls.find(
        (call) => call.league.id === room.league.id && call.score,
      ) ?? input.yourCalls.find((call) => call.score);
    if (selectedCall?.score) {
      const scenarios = [
        {
          club: input.fixture.home.name,
          result: input.liveRace.homeGoal,
        },
        {
          club: input.fixture.away.name,
          result: input.liveRace.awayGoal,
        },
      ]
        .map((scenario) => ({
          ...scenario,
          points: scenario.result.points,
        }))
        .sort((a, b) => b.points - a.points);
      const currentPoints = input.liveRace.current.points;
      const better = scenarios.find(
        (scenario) => scenario.points > currentPoints,
      );
      view.raceLink = {
        league: input.liveRace.league,
        standingLine: MATCH_COPY.standing(
          ordinal(input.liveRace.current.rank),
          input.liveRace.current.fieldSize,
          currentPoints,
        ),
        href: `/leagues/${input.liveRace.league.slug}`,
      };
      if (better) {
        view.whatIf = {
          line: MATCH_COPY.whatIfGoal(
            better.club,
            better.points,
            ordinal(better.result.rank),
            input.liveRace.current.fieldSize,
          ),
        };
      }
    }
  }

  if (matchData?.scorers) {
    view.header.scorers = arrayBlock(
      matchData.scorers,
      "lines",
      {
        ok: matchData.scorers_ok,
        source: "ESPN",
        fetchedAt: matchData.scorers_fetched_at,
      },
      now,
    ) as Sourced<{ lines: unknown[] }> | undefined;
  }
  if (input.state === "pre" && insights) {
    view.odds = sourcedBlock(
      insights.ml_home != null &&
        insights.ml_draw != null &&
        insights.ml_away != null
        ? {
            home: Number(insights.ml_home),
            draw: Number(insights.ml_draw),
            away: Number(insights.ml_away),
            book: insights.provider ?? "ESPN",
          }
        : null,
      {
        ok: insights.odds_ok,
        source: "ESPN",
        fetchedAt: insights.odds_fetched_at,
      },
      now,
    );
    const usableModel = modelUsable(insights, { kickoffAt }, now);
    view.model = sourcedBlock(
      Array.isArray(insights.top_scores) && insights.top_scores.length
        ? {
            topScores: insights.top_scores,
            btts: Number(insights.p_btts),
            cleanSheets: [
              Number(insights.p_cs_home),
              Number(insights.p_cs_away),
            ],
            pOver: Number(insights.p_over),
          }
        : null,
      {
        ok: usableModel,
        source: "Cashford model",
        fetchedAt: insights.model_fetched_at,
      },
      now,
    );
    view.form = sourcedBlock(
      (insights.form_home?.length || insights.form_away?.length)
        ? { home: insights.form_home ?? [], away: insights.form_away ?? [] }
        : null,
      {
        ok: insights.form_ok,
        source: "ESPN",
        fetchedAt: insights.form_fetched_at,
      },
      now,
    );
    view.h2h = sourcedBlock(
      insights.h2h?.games?.length
        ? {
            games: insights.h2h.games,
            summary: `${insights.h2h.tally?.w ?? 0} wins · ${insights.h2h.tally?.d ?? 0} draws`,
          }
        : null,
      {
        ok: insights.h2h_ok,
        source: "ESPN",
        fetchedAt: insights.h2h_fetched_at,
      },
      now,
    );
    view.teamNews = sourcedBlock(
      insights.team_news &&
        (insights.team_news.home?.length || insights.team_news.away?.length)
        ? insights.team_news
        : null,
      {
        ok: insights.team_news_ok,
        source: insights.team_news_source ?? "FPL",
        fetchedAt: insights.team_news_fetched_at,
      },
      now,
    );
  }
  if (input.state === "pre") {
    view.table = sourcedBlock(
      input.standings?.rows?.length
        ? {
            window: input.standings.rows,
            source: input.standings.source,
            note: input.standings.note,
          }
        : null,
      {
        ok: true,
        source: input.standings?.source ?? "derived",
        fetchedAt: input.standings?.fetched_at ?? null,
      },
      now,
    );
  }

  if (input.state !== "pre" && matchData) {
    view.keyEvents = arrayBlock(
      matchData.key_events,
      "timeline",
      {
        ok: matchData.key_events_ok,
        source: "ESPN",
        fetchedAt: matchData.key_events_fetched_at,
      },
      now,
    ) as Sourced<{ timeline: unknown[] }> | undefined;
    const stats = Array.isArray(matchData.team_stats)
      ? matchData.team_stats
      : matchData.team_stats
        ? Object.entries(matchData.team_stats).map(([label, value]) => ({
            label,
            value,
          }))
        : [];
    view.teamStats = sourcedBlock(
      stats.length
        ? {
            phase: input.state === "live" ? "live" : "final",
            minute:
              input.state === "live" ? input.fixture.status : null,
            rows: input.state === "live" ? stats.slice(0, 5) : stats,
          }
        : null,
      {
        ok: matchData.team_stats_ok,
        source: "ESPN",
        fetchedAt: matchData.team_stats_fetched_at,
      },
      now,
    );
    view.playerStats = arrayBlock(
      matchData.player_stats,
      "rows",
      {
        ok: matchData.player_stats_ok,
        source: "ESPN",
        fetchedAt: matchData.player_stats_fetched_at,
      },
      now,
    ) as Sourced<{ rows: unknown[] }> | undefined;
    view.commentary = arrayBlock(
      matchData.commentary,
      "lines",
      {
        ok: matchData.commentary_ok,
        source: "ESPN",
        fetchedAt: matchData.commentary_fetched_at,
      },
      now,
    ) as Sourced<{
      lines: Array<{ minute: string; text: string }>;
    }> | undefined;
  }
  if (matchData?.lineups) {
    view.lineups = sourcedBlock(
      matchData.lineups.home && matchData.lineups.away
        ? {
            home: matchData.lineups.home,
            away: matchData.lineups.away,
          }
        : null,
      {
        ok: matchData.lineups_ok,
        source: "ESPN",
        fetchedAt: matchData.lineups_fetched_at,
      },
      now,
    );
  }

  if (input.state === "pre") {
    const predicted = input.slowRows.find(
      (row) =>
        row.provider === "fotmob" &&
        row.predicted_xi_ok &&
        row.predicted_xi?.home &&
        row.predicted_xi?.away,
    );
    if (predicted) {
      view.predictedXi = sourcedBlock(
        {
          home: predicted.predicted_xi.home,
          away: predicted.predicted_xi.away,
          provider: "FotMob" as const,
        },
        {
          ok: predicted.predicted_xi_ok,
          source: "FotMob",
          fetchedAt: predicted.predicted_xi_fetched_at,
        },
        now,
      );
    }
  }

  if (input.state === "post") {
    const actual = input.fixture.score;
    const top = Array.isArray(insights?.top_scores)
      ? insights.top_scores[0]
      : null;
    if (
      actual &&
      top &&
      insights?.model_fetched_at &&
      modelMatchesKickoff(insights, input.fixture.kickoffAt)
    ) {
      const actualModel = insights.top_scores.find(
        (score: any) => score.h === actual[0] && score.a === actual[1],
      );
      view.retrospective = sourcedBlock(
        {
          line: MATCH_COPY.retrospectiveModel(
            `${actual[0]}–${actual[1]}`,
            actualModel?.p == null
              ? null
              : Math.round(Number(actualModel.p) * 100),
            `${top.h}–${top.a}`,
          ),
        },
        {
          ok: true,
          source: "Cashford model",
          fetchedAt: insights.model_fetched_at,
        },
        now,
      );
    }
    const selected = selectXg(input.providerRows, now);
    if (selected) {
      view.xg = sourcedBlock(
        {
          home: selected.home,
          away: selected.away,
          provider: selected.provider,
          model: selected.model,
          afterFt: input.fixture.finishedAt
            ? afterFullTime(selected.fetchedAt, input.fixture.finishedAt)
            : "",
        },
        {
          ok: true,
          source: selected.provider,
          fetchedAt: selected.fetchedAt,
        },
        now,
      );
    }
    const shotsSource =
      input.slowRows.find(
        (row) =>
          row.provider === "fotmob" &&
          row.shots_ok &&
          row.shots?.length &&
          fetchedAfterKickoff(
            row.shots_fetched_at,
            input.fixture.kickoffAt,
          ),
      ) ??
      input.slowRows.find(
        (row) =>
          row.provider === "understat" &&
          row.shots_ok &&
          row.shots?.length &&
          fetchedAfterKickoff(
            row.shots_fetched_at,
            input.fixture.kickoffAt,
          ),
      );
    if (shotsSource) {
      view.shotMap = sourcedBlock(
        {
          shots: shotsSource.shots,
          provider:
            shotsSource.provider === "fotmob"
              ? ("FotMob" as const)
              : ("Understat" as const),
        },
        {
          ok: true,
          source:
            shotsSource.provider === "fotmob" ? "FotMob" : "Understat",
          fetchedAt: shotsSource.shots_fetched_at,
        },
        now,
      );
    }
    const source = input.slowRows.find((row) => row.provider === "fotmob");
    if (source?.ratings?.length && source.potm) {
      view.ratings = sourcedBlock(
        {
          potm: source.potm,
          others: source.ratings.filter(
            (rating: any) => rating.player !== source.potm.player,
          ),
          provider: source.ratings_provider ?? "FotMob",
        },
        {
          ok:
            source.ratings_ok &&
            fetchedAfterKickoff(
              source.ratings_fetched_at,
              input.fixture.kickoffAt,
            ),
          source: source.ratings_provider ?? "FotMob",
          fetchedAt: source.ratings_fetched_at,
        },
        now,
      );
    }
    if (source?.momentum?.length) {
      view.momentum = sourcedBlock(
        {
          series: source.momentum,
          provider: source.momentum_provider ?? "FotMob",
        },
        {
          ok:
            source.momentum_ok &&
            fetchedAfterKickoff(
              source.momentum_fetched_at,
              input.fixture.kickoffAt,
            ),
          source: source.momentum_provider ?? "FotMob",
          fetchedAt: source.momentum_fetched_at,
        },
        now,
      );
    }
  }
  return view;
}

function modelMatchesKickoff(
  row: Record<string, any>,
  kickoffAt: string | null,
): boolean {
  return (
    row.model_ok === true &&
    kickoffAt != null &&
    row.model_source_kickoff_at != null &&
    new Date(row.model_source_kickoff_at).getTime() ===
      new Date(kickoffAt).getTime()
  );
}

function fetchedAfterKickoff(
  fetchedAt: string | null | undefined,
  kickoffAt: string | null,
): boolean {
  return (
    fetchedAt != null &&
    kickoffAt != null &&
    new Date(fetchedAt).getTime() >= new Date(kickoffAt).getTime()
  );
}

function afterFullTime(fetchedAt: string, finishedAt: string): string {
  const minutes = Math.max(
    0,
    Math.floor(
      (new Date(fetchedAt).getTime() - new Date(finishedAt).getTime()) /
        60_000,
    ),
  );
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m after full time`;
}
