import {
  sourcedBlock,
  type Sourced,
} from "./match-blocks";
import type {
  MatchLineupPlayer,
  MatchLineupSide,
  MatchPlayerStatRow,
  MatchShot,
  MatchShotResult,
  MatchSide,
} from "./match-types";
export type {
  MatchLineupPlayer,
  MatchLineupSide,
  MatchPlayerStatRow,
  MatchShot,
  MatchShotResult,
  MatchSide,
} from "./match-types";
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
export type ScorerLine = {
  team: MatchSide;
  player: string;
  minutes: number[];
};
export type TeamNewsStatus = "d" | "i" | "s" | "u" | "n";
export type TeamNewsItem = {
  player: string;
  reason: string;
  status: TeamNewsStatus;
};
export type MatchTimelineEvent = {
  minute: number;
  clock: string;
  type:
    | "goal"
    | "own_goal"
    | "pen"
    | "miss_pen"
    | "yellow"
    | "red"
    | "sub"
    | "var";
  team: MatchSide;
  player: string;
  assist: string | null;
  detail: string | null;
};
export type MatchStatLabel =
  | "shots"
  | "onTarget"
  | "corners"
  | "possession"
  | "xg";
export type MatchStatRow = {
  label: MatchStatLabel;
  value: { h: number; a: number };
};
export type MatchCommentaryLine = { minute: string; text: string };
export type MatchPlayerRating = {
  player: string;
  team: MatchSide;
  rating: number;
  goals?: number;
};

export type MatchDetailView = {
  state: "pre" | "live" | "post";
  header: {
    home: Club;
    away: Club;
    score: [number, number] | null;
    status: string;
    kickoffAt: string | null;
    deadlineAt: string | null;
    scorers?: Sourced<{ lines: ScorerLine[] }>;
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
    pHome: number;
    pDraw: number;
    pAway: number;
    mlHome: number;
    mlDraw: number;
    mlAway: number;
    book: string;
  }>;
  model?: Sourced<{
    topScores: ScoreProb[];
    btts: number | null;
    cleanSheets: [number | null, number | null];
    pOver: number | null;
    totalLine: number | null;
  }>;
  form?: Sourced<{ home: unknown[]; away: unknown[] }>;
  h2h?: Sourced<{ games: unknown[]; summary: string }>;
  table?: Sourced<{
    window: unknown[];
    source: "espn" | "derived";
    note: string | null;
  }>;
  teamNews?: Sourced<{ home: TeamNewsItem[]; away: TeamNewsItem[] }>;
  keyEvents?: Sourced<{ timeline: MatchTimelineEvent[] }>;
  teamStats?: Sourced<{
    phase: "live" | "final";
    minute: string | null;
    rows: MatchStatRow[];
  }>;
  playerStats?: Sourced<{ rows: MatchPlayerStatRow[] }>;
  commentary?: Sourced<{ lines: MatchCommentaryLine[] }>;
  lineups?: Sourced<{ home: MatchLineupSide; away: MatchLineupSide }>;
  retrospective?: Sourced<{ line: string }>;
  xg?: Sourced<{
    home: number;
    away: number;
    provider: "FotMob" | "Understat";
    model: string;
    afterFt: string;
  }>;
  shotMap?: Sourced<{
    shots: MatchShot[];
    provider: "FotMob" | "Understat";
  }>;
  ratings?: Sourced<{
    potm: MatchPlayerRating;
    others: MatchPlayerRating[];
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
  correctedAt?: string;
};

type BlockRow = Record<string, any> | null;

type RawRow = Record<string, unknown>;

function rawRow(value: unknown): RawRow | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as RawRow)
    : null;
}

function finiteNumber(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function nonemptyText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function matchSide(value: unknown): MatchSide | null {
  return value === "home" || value === "away" ? value : null;
}

function coerceScorerLines(value: unknown): ScorerLine[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const rows = value.flatMap((candidate): ScorerLine[] => {
    const row = rawRow(candidate);
    const team = matchSide(row?.team);
    const player = nonemptyText(row?.player);
    if (!team || !player || !Array.isArray(row?.minutes)) return [];
    const minutes = row.minutes.flatMap((minute) => {
      const parsed = finiteNumber(minute);
      return parsed == null ? [] : [parsed];
    });
    if (!minutes.length) return [];
    return [{ team, player, minutes }];
  });
  return rows.length ? rows : undefined;
}

function coerceTeamNews(value: unknown):
  | { home: TeamNewsItem[]; away: TeamNewsItem[] }
  | undefined {
  const root = rawRow(value);
  if (!root) return undefined;
  const sideRows = (side: MatchSide): TeamNewsItem[] => {
    if (!Array.isArray(root[side])) return [];
    return root[side].flatMap((candidate): TeamNewsItem[] => {
      const row = rawRow(candidate);
      const player = nonemptyText(row?.player);
      const status = row?.status;
      const reason = nonemptyText(row?.reason);
      if (
        !player ||
        !reason ||
        (status !== "d" &&
          status !== "i" &&
          status !== "s" &&
          status !== "u" &&
          status !== "n")
      ) {
        return [];
      }
      return [{
        player,
        reason,
        status,
      }];
    });
  };
  const home = sideRows("home");
  const away = sideRows("away");
  return home.length || away.length ? { home, away } : undefined;
}

function timelineType(value: unknown): MatchTimelineEvent["type"] | null {
  return value === "goal" ||
    value === "own_goal" ||
    value === "pen" ||
    value === "miss_pen" ||
    value === "yellow" ||
    value === "red" ||
    value === "sub" ||
    value === "var"
    ? value
    : null;
}

function coerceTimeline(value: unknown): MatchTimelineEvent[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const rows = value.flatMap((candidate): MatchTimelineEvent[] => {
    const row = rawRow(candidate);
    const minute = finiteNumber(row?.minute);
    const clock = nonemptyText(row?.clock);
    const type = timelineType(row?.type);
    const team = matchSide(row?.team);
    const player = nonemptyText(row?.player);
    if (minute == null || !clock || !type || !team || !player) return [];
    return [{
      minute,
      clock,
      type,
      team,
      player,
      assist: nonemptyText(row?.assist),
      detail: nonemptyText(row?.detail),
    }];
  });
  return rows.length ? rows : undefined;
}

function statLabel(value: string): value is MatchStatLabel {
  return value === "shots" ||
    value === "onTarget" ||
    value === "corners" ||
    value === "possession" ||
    value === "xg";
}

function statPair(value: unknown): { h: number; a: number } | null {
  const row = rawRow(value);
  const home = finiteNumber(row?.h);
  const away = finiteNumber(row?.a);
  return home != null && away != null ? { h: home, a: away } : null;
}

function coerceTeamStats(value: unknown): MatchStatRow[] | undefined {
  const root = rawRow(value);
  if (!root) return undefined;
  const rows = Object.entries(root).flatMap(([label, value]) => {
    if (!statLabel(label)) return [];
    const pair = statPair(value);
    return pair ? [{ label, value: pair }] : [];
  });
  return rows.length ? rows : undefined;
}

export function coercePlayerStats(
  value: unknown,
): MatchPlayerStatRow[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const rows = value.flatMap((candidate): MatchPlayerStatRow[] => {
    const row = rawRow(candidate);
    const name = nonemptyText(row?.player ?? row?.name);
    const team = matchSide(row?.team);
    if (!name || !team) return [];
    const number = (key: string): number => finiteNumber(row?.[key]) ?? 0;
    return [{
      name,
      team,
      goals: number("goals"),
      assists: number("assists"),
      totalShots: number("totalShots"),
      shotsOnTarget: number("shotsOnTarget"),
      saves: number("saves"),
      goalsConceded: number("goalsConceded"),
      yellowCards: number("yellowCards"),
      redCards: number("redCards"),
    }];
  });
  return rows.length ? rows : undefined;
}

function coerceLineupSide(value: unknown): MatchLineupSide | undefined {
  const root = rawRow(value);
  const formation = nonemptyText(root?.formation);
  if (!formation || !Array.isArray(root?.players)) return undefined;
  const players = root.players.flatMap((candidate): MatchLineupPlayer[] => {
    const row = rawRow(candidate);
    const name = nonemptyText(row?.name ?? row?.player);
    if (!name) return [];
    return [{
      name,
      shirt: finiteNumber(row?.shirt),
    }];
  });
  return players.length >= 7 ? { formation, players } : undefined;
}

export function coerceLineups(value: unknown):
  | { home: MatchLineupSide; away: MatchLineupSide }
  | undefined {
  const root = rawRow(value);
  if (!root) return undefined;
  const home = coerceLineupSide(root.home);
  const away = coerceLineupSide(root.away);
  return home && away ? { home, away } : undefined;
}

function shotResult(value: unknown): MatchShotResult {
  return value === "goal" ||
    value === "saved" ||
    value === "blocked" ||
    value === "off_target"
    ? value
    : "other";
}

export function coerceShots(value: unknown): MatchShot[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const shots = value.flatMap((candidate): MatchShot[] => {
    const row = rawRow(candidate);
    const x = finiteNumber(row?.x);
    const y = finiteNumber(row?.y);
    const xg = finiteNumber(row?.xg);
    const minute = finiteNumber(row?.minute);
    const player = nonemptyText(row?.player);
    const team = matchSide(row?.team);
    if (x == null || y == null || xg == null || minute == null || !player || !team) {
      return [];
    }
    return [{
      x: Math.min(1, Math.max(0, x)),
      y: Math.min(1, Math.max(0, y)),
      xg: Math.max(0, xg),
      minute,
      player,
      team,
      result: shotResult(row?.result),
    }];
  });
  return shots.length ? shots : undefined;
}

function coerceCommentary(value: unknown): MatchCommentaryLine[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const rows = value.flatMap((candidate): MatchCommentaryLine[] => {
    const row = rawRow(candidate);
    const minute = typeof row?.minute === "string" ? row.minute.trim() : null;
    const text = nonemptyText(row?.text);
    if (minute == null || !text) return [];
    return [{ minute, text }];
  });
  return rows.length ? rows : undefined;
}

function coercePlayerRating(value: unknown): MatchPlayerRating | null {
  const row = rawRow(value);
  const player = nonemptyText(row?.player);
  const team = matchSide(row?.team);
  const rating = finiteNumber(row?.rating);
  if (!player || !team || rating == null) return null;
  const goals = finiteNumber(row?.goals);
  return { player, team, rating, ...(goals != null ? { goals } : {}) };
}

function coerceRatings(
  potmValue: unknown,
  values: unknown,
): { potm: MatchPlayerRating; others: MatchPlayerRating[] } | undefined {
  const potm = coercePlayerRating(potmValue);
  if (!potm || !Array.isArray(values)) return undefined;
  const rows = values.flatMap((value) => {
    const row = coercePlayerRating(value);
    return row ? [row] : [];
  });
  return {
    potm,
    others: rows.filter((row) => row.player !== potm.player),
  };
}

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
  correctedAt?: string;
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
    ...(input.correctedAt ? { correctedAt: input.correctedAt } : {}),
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
    const scorers = coerceScorerLines(matchData.scorers);
    view.header.scorers = sourcedBlock(
      scorers ? { lines: scorers } : null,
      {
        ok: matchData.scorers_ok,
        source: "ESPN",
        fetchedAt: matchData.scorers_fetched_at,
      },
      now,
    );
  }
  if (input.state === "pre" && insights) {
    view.odds = sourcedBlock(
      insights.ml_home != null &&
        insights.ml_draw != null &&
        insights.ml_away != null &&
        insights.p_home != null &&
        insights.p_draw != null &&
        insights.p_away != null
        ? {
            pHome: Number(insights.p_home),
            pDraw: Number(insights.p_draw),
            pAway: Number(insights.p_away),
            mlHome: Number(insights.ml_home),
            mlDraw: Number(insights.ml_draw),
            mlAway: Number(insights.ml_away),
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
            btts: insights.p_btts != null ? Number(insights.p_btts) : null,
            cleanSheets: [
              insights.p_cs_home != null ? Number(insights.p_cs_home) : null,
              insights.p_cs_away != null ? Number(insights.p_cs_away) : null,
            ],
            pOver: insights.p_over != null ? Number(insights.p_over) : null,
            totalLine: insights.total_line != null ? Number(insights.total_line) : null,
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
            summary: MATCH_COPY.h2hSummary(
              input.fixture.home.name,
              insights.h2h.tally?.w ?? 0,
              insights.h2h.tally?.d ?? 0,
              input.fixture.away.name,
              insights.h2h.tally?.l ?? 0,
            ),
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
      coerceTeamNews(insights.team_news),
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
    const timeline = coerceTimeline(matchData.key_events);
    view.keyEvents = sourcedBlock(
      timeline ? { timeline } : null,
      {
        ok: matchData.key_events_ok,
        source: "ESPN",
        fetchedAt: matchData.key_events_fetched_at,
      },
      now,
    );
    const stats = coerceTeamStats(matchData.team_stats) ?? [];
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
    const playerStats = coercePlayerStats(matchData.player_stats);
    view.playerStats = sourcedBlock(
      playerStats ? { rows: playerStats } : null,
      {
        ok: matchData.player_stats_ok,
        source: "ESPN",
        fetchedAt: matchData.player_stats_fetched_at,
      },
      now,
    );
    const commentary = coerceCommentary(matchData.commentary);
    view.commentary = sourcedBlock(
      commentary ? { lines: commentary } : null,
      {
        ok: matchData.commentary_ok,
        source: "ESPN",
        fetchedAt: matchData.commentary_fetched_at,
      },
      now,
    );
  }
  if (matchData?.lineups) {
    const lineups = coerceLineups(matchData.lineups);
    view.lineups = sourcedBlock(
      lineups,
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
      const shots = coerceShots(shotsSource.shots);
      if (shots) {
        view.shotMap = sourcedBlock(
          {
            shots,
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
    }
    const source = input.slowRows.find((row) => row.provider === "fotmob");
    const ratings = source
      ? coerceRatings(source.potm, source.ratings)
      : undefined;
    if (source && ratings) {
      view.ratings = sourcedBlock(
        {
          potm: ratings.potm,
          others: ratings.others,
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
