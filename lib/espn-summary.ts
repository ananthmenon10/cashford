type Side = "home" | "away";

export interface MatchEvent {
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
  team: Side;
  player: string;
  assist: string | null;
  detail: string | null;
}

export interface Scorer {
  team: Side;
  player: string;
  minutes: number[];
}

export interface StatPair {
  h: number;
  a: number;
}

export interface TeamStats {
  shots?: StatPair;
  onTarget?: StatPair;
  corners?: StatPair;
  possession?: StatPair;
  xg?: StatPair;
}

export interface PlayerStat {
  player: string;
  team: Side;
  // ESPN summaries do not publish player ratings. FotMob owns that field.
  rating: null;
  goals: number;
  assists: number;
  totalShots: number;
  shotsOnTarget: number;
  yellowCards: number;
  redCards: number;
  saves: number;
  goalsConceded: number;
}

export interface CommentaryLine {
  minute: string;
  text: string;
}

export interface XiBlock {
  formation: string | null;
  players: Array<{ name: string; shirt: string | null }>;
}

export interface Lineups {
  home: XiBlock;
  away: XiBlock;
}

type RecordValue = Record<string, unknown>;

const object = (value: unknown): value is RecordValue =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const text = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null;
const number = (value: unknown): number | null => {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number.parseFloat(value.replace(/[^0-9.-]/g, ""))
        : NaN;
  return Number.isFinite(parsed) ? parsed : null;
};

function competitors(summary: RecordValue) {
  const header = object(summary.header) ? summary.header : {};
  const competitions = list(header.competitions);
  const first = object(competitions[0]) ? competitions[0] : {};
  return list(first.competitors).filter(object);
}

function sideFor(summary: RecordValue, competitorId: unknown): Side | null {
  if (competitorId === null || competitorId === undefined || competitorId === "") {
    return null;
  }
  const candidate = competitors(summary).find(
    (row) => {
      const team = object(row.team) ? row.team : {};
      return [
        row.id,
        team.id,
        team.displayName,
        team.name,
        team.abbreviation,
      ].some((value) => String(value ?? "") === String(competitorId ?? ""));
    },
  );
  return candidate?.homeAway === "home" || candidate?.homeAway === "away"
    ? candidate.homeAway
    : null;
}

export function validateSummary(
  summary: unknown,
  expectedEventId: string | number,
): summary is RecordValue {
  if (!object(summary) || !object(summary.header)) return false;
  return String(summary.header.id ?? "") === String(expectedEventId);
}

export function parseSummaryScore(
  summary: unknown,
): { home: number; away: number } | null {
  if (!object(summary)) return null;
  const rows = competitors(summary);
  const home = rows.find((row) => row.homeAway === "home");
  const away = rows.find((row) => row.homeAway === "away");
  const homeScore = number(home?.score);
  const awayScore = number(away?.score);
  return homeScore != null && awayScore != null
    ? { home: homeScore, away: awayScore }
    : null;
}

const EVENT_TYPES: Record<string, MatchEvent["type"]> = {
  goal: "goal",
  "own goal": "own_goal",
  "penalty - scored": "pen",
  "penalty - missed": "miss_pen",
  "yellow card": "yellow",
  "red card": "red",
  substitution: "sub",
  var: "var",
};

function matchMinute(value: unknown): number | null {
  const raw = text(value);
  if (raw) {
    const parts = raw.match(/(\d+)(?:\+(\d+))?/);
    if (parts) return Number(parts[1]) + Number(parts[2] ?? 0);
  }
  return number(value);
}

export function parseKeyEvents(summary: unknown): MatchEvent[] | null {
  if (!object(summary)) return null;
  const result: MatchEvent[] = [];
  for (const raw of list(summary.keyEvents ?? summary.plays)) {
    if (!object(raw)) continue;
    const rawType = text(raw.type) ?? (object(raw.type) ? text(raw.type.text) : null);
    const normalizedType = rawType?.toLowerCase();
    const type = normalizedType
      ? EVENT_TYPES[normalizedType] ??
        (/^goal(?:\s*-\s*|---)/.test(normalizedType) ? "goal" : undefined)
      : undefined;
    const minute = matchMinute(
      raw.minute ??
        (object(raw.clock)
          ? raw.clock.displayValue ?? raw.clock.value
          : raw.clock),
    );
    const team = sideFor(
      summary,
      raw.teamId ?? (object(raw.team) ? raw.team.id : undefined),
    );
    const player =
      text(raw.player) ??
      (object(raw.athlete) ? text(raw.athlete.displayName) : null) ??
      (object(list(raw.athletesInvolved)[0])
        ? text((list(raw.athletesInvolved)[0] as RecordValue).displayName)
        : null) ??
      (object(list(raw.participants)[0]) &&
      object((list(raw.participants)[0] as RecordValue).athlete)
        ? text(
            ((list(raw.participants)[0] as RecordValue).athlete as RecordValue)
              .displayName,
          )
        : null);
    if (!type || minute == null || !team || !player) continue;
    const participants = list(raw.participants);
    const participantAssist =
      type === "goal" &&
      object(participants[1]) &&
      object((participants[1] as RecordValue).athlete)
        ? text(
            ((participants[1] as RecordValue).athlete as RecordValue)
              .displayName,
          )
        : null;
    result.push({
      minute,
      clock:
        text(object(raw.clock) ? raw.clock.displayValue : raw.clock) ??
        `${minute}'`,
      type,
      team,
      player,
      assist:
        text(raw.assist) ??
        (object(raw.assistAthlete)
          ? text(raw.assistAthlete.displayName)
          : null) ??
        participantAssist,
      detail: text(raw.detail ?? raw.text),
    });
  }
  return result.length ? result : null;
}

export function parseScorers(summary: unknown): Scorer[] | null {
  const events = parseKeyEvents(summary);
  if (!events) return null;
  const grouped = new Map<string, Scorer>();
  for (const event of events) {
    if (!["goal", "own_goal", "pen"].includes(event.type)) continue;
    const key = `${event.team}:${event.player}`;
    const scorer = grouped.get(key) ?? {
      team: event.team,
      player: event.player,
      minutes: [],
    };
    scorer.minutes.push(event.minute);
    grouped.set(key, scorer);
  }
  const rows = [...grouped.values()];
  return rows.length ? rows : null;
}

const STAT_KEYS: Record<string, keyof TeamStats> = {
  "total shots": "shots",
  totalshots: "shots",
  shots: "shots",
  "shots on target": "onTarget",
  shotsontarget: "onTarget",
  "corner kicks": "corners",
  woncorners: "corners",
  possession: "possession",
  "possession %": "possession",
  possessionpct: "possession",
  "expected goals": "xg",
};

export function parseTeamStats(summary: unknown): TeamStats | null {
  if (!object(summary)) return null;
  const box = Array.isArray(summary.boxscore)
    ? summary.boxscore
    : object(summary.boxscore)
      ? [summary.boxscore]
      : [];
  const first = object(box[0]) ? box[0] : {};
  const teams = list(first.teams).filter(object);
  if (teams.length < 2) return null;
  const out: TeamStats = {};
  for (const teamRow of teams) {
    const side = sideFor(
      summary,
      object(teamRow.team) ? teamRow.team.id : teamRow.id,
    );
    if (!side) continue;
    for (const raw of list(teamRow.statistics)) {
      if (!object(raw)) continue;
      const name = text(raw.name ?? raw.label);
      const key = name ? STAT_KEYS[name.toLowerCase()] : undefined;
      const value = number(raw.value ?? raw.displayValue);
      if (!key || value == null) continue;
      const current = out[key] ?? { h: 0, a: 0 };
      current[side === "home" ? "h" : "a"] = value;
      out[key] = current;
    }
  }
  return Object.keys(out).length ? out : null;
}

export function parsePlayerStats(summary: unknown): PlayerStat[] | null {
  if (!object(summary)) return null;
  const rows: PlayerStat[] = [];
  for (const group of list(summary.rosters)) {
    if (!object(group)) continue;
    const team = sideFor(
      summary,
      object(group.team) ? group.team.id : group.teamId,
    );
    if (!team) continue;
    for (const athlete of list(group.roster)) {
      if (!object(athlete)) continue;
      const player =
        text(athlete.displayName) ??
        (object(athlete.athlete)
          ? text(athlete.athlete.displayName)
          : null);
      if (!player) continue;
      const values = new Map(
        list(athlete.stats)
          .filter(object)
          .map((stat) => [stat.name, number(stat.value ?? stat.displayValue)] as const)
          .filter((entry): entry is readonly [string, number] => entry[1] != null),
      );
      const value = (name: string) => values.get(name) ?? 0;
      rows.push({
        player,
        team,
        rating: null,
        goals: value("totalGoals"),
        assists: value("goalAssists"),
        totalShots: value("totalShots"),
        shotsOnTarget: value("shotsOnTarget"),
        yellowCards: value("yellowCards"),
        redCards: value("redCards"),
        saves: value("saves"),
        goalsConceded: value("goalsConceded"),
      });
    }
  }
  return rows.length ? rows : null;
}

export function parseCommentary(summary: unknown): CommentaryLine[] | null {
  if (!object(summary)) return null;
  const commentary =
    summary.commentary ??
    (object(summary.gamecast) ? summary.gamecast.commentary : null);
  const rows = list(commentary)
    .filter(object)
    .map((line) => ({
      minute:
        text(object(line.time) ? line.time.displayValue : line.time) ??
        text(object(line.clock) ? line.clock.displayValue : line.clock) ??
        "",
      text: text(line.text) ?? "",
    }))
    .filter((line) => line.text);
  return rows.length ? rows : null;
}

export function parseLineups(summary: unknown): Lineups | null {
  if (!object(summary)) return null;
  const rosters = list(summary.rosters).filter(object);
  const bySide = new Map<Side, XiBlock>();
  for (const group of rosters) {
    const side = sideFor(
      summary,
      object(group.team) ? group.team.id : group.teamId,
    );
    if (!side) continue;
    const players = list(group.roster)
      .filter(object)
      .filter((row) => row.starter === true)
      .map((row) => ({
        name:
          text(row.displayName) ??
          (object(row.athlete) ? text(row.athlete.displayName) : null) ??
          "",
        shirt: text(row.jersey),
      }))
      .filter((row) => row.name);
    if (players.length) {
      bySide.set(side, {
        formation: text(group.formation),
        players,
      });
    }
  }
  const home = bySide.get("home");
  const away = bySide.get("away");
  return home && away ? { home, away } : null;
}

export type MatchDataBlock =
  | "key_events"
  | "scorers"
  | "team_stats"
  | "player_stats"
  | "commentary"
  | "lineups";

export function buildMatchDataPatch(
  fixtureId: string,
  summary: unknown,
  blocks: readonly MatchDataBlock[],
  fetchedAt = new Date().toISOString(),
) {
  const parsers = {
    key_events: parseKeyEvents,
    scorers: parseScorers,
    team_stats: parseTeamStats,
    player_stats: parsePlayerStats,
    commentary: parseCommentary,
    lineups: parseLineups,
  } satisfies Record<MatchDataBlock, (value: unknown) => unknown>;
  const patch: Record<string, unknown> = { fixture_id: fixtureId };
  for (const block of blocks) {
    const value = parsers[block](summary);
    patch[`${block}_ok`] = value !== null;
    if (value !== null) {
      patch[block] = value;
      patch[`${block}_fetched_at`] = fetchedAt;
    }
  }
  return patch;
}
