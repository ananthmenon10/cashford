export interface FotMobXg {
  home: number;
  away: number;
  model: "fotmob-2026";
  firstHalf?: { home: number; away: number };
  secondHalf?: { home: number; away: number };
  openPlay?: { home: number; away: number };
  setPlay?: { home: number; away: number };
  xgot?: { home: number; away: number };
}

export interface FotMobShot {
  team: "home" | "away";
  player: string;
  minute: number;
  x: number;
  y: number;
  xg: number;
  result: "goal" | "saved" | "blocked" | "off_target" | "post";
}

export interface FotMobRating {
  player: string;
  team: "home" | "away";
  rating: number;
  goals?: number;
}

export interface FotMobMomentumPoint {
  minute: number;
  value: number;
}

export type FotMobFactKey =
  | "shots_on_target"
  | "possession_pct"
  | "big_chances"
  | "corners"
  | "saves"
  | "fouls"
  | "offsides"
  | "passes_completed_pct";

export interface FotMobFact {
  key: FotMobFactKey;
  args: number[];
}

export interface FotMobXi {
  formation: string;
  rows: Array<{ label: string; players: string[] }>;
}

export interface FotMobFields {
  xg?: FotMobXg;
  shots?: FotMobShot[];
  ratings?: FotMobRating[];
  potm?: FotMobRating;
  momentum?: FotMobMomentumPoint[];
  facts?: FotMobFact[];
  predictedXi?: { home: FotMobXi; away: FotMobXi };
}

export interface FotMobCandidate {
  id: string;
  date: string;
  homeName: string;
  awayName: string;
}

export type FetchResult<T> =
  | { kind: "ok"; value: T }
  | { kind: "disabled" }
  | { kind: "http"; status: number }
  | { kind: "timeout" }
  | { kind: "invalid_json" }
  | { kind: "shape" };

const object = (value: unknown): value is Record<string, any> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const finite = (value: unknown): number | null => {
  if (
    value === null ||
    value === undefined ||
    typeof value === "boolean" ||
    (typeof value === "string" && value.trim() === "")
  ) {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};
const nonempty = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null;
const side = (value: unknown): "home" | "away" | null =>
  value === "home" || value === "away" ? value : null;

function pair(value: unknown): { home: number; away: number } | undefined {
  if (!object(value)) return undefined;
  const home = finite(value.home);
  const away = finite(value.away);
  return home != null && away != null ? { home, away } : undefined;
}

function statGroups(raw: Record<string, any>): any[] {
  const groups = raw.content?.stats?.Periods?.All?.stats;
  return Array.isArray(groups)
    ? groups.flatMap((group: any) =>
        Array.isArray(group?.stats) ? group.stats : [],
      )
    : [];
}

function rawStatPair(
  raw: Record<string, any>,
  keys: readonly string[],
): { home: number; away: number } | undefined {
  const row = statGroups(raw).find((entry) =>
    keys.includes(String(entry?.key ?? "").toLowerCase()),
  );
  if (!Array.isArray(row?.stats) || row.stats.length < 2) return undefined;
  const home = finite(row.stats[0]);
  const away = finite(row.stats[1]);
  return home != null && away != null ? { home, away } : undefined;
}

const FACT_KEYS = new Set<FotMobFactKey>([
  "shots_on_target",
  "possession_pct",
  "big_chances",
  "corners",
  "saves",
  "fouls",
  "offsides",
  "passes_completed_pct",
]);

function parseXi(raw: unknown): FotMobXi | null {
  if (!object(raw)) return null;
  const formation = nonempty(raw.formation);
  if (!formation || !Array.isArray(raw.rows)) return null;
  const rows = raw.rows.flatMap((row: unknown) => {
    if (!object(row)) return [];
    const label = nonempty(row.label);
    const players = Array.isArray(row.players)
      ? row.players.map(nonempty).filter((name): name is string => !!name)
      : [];
    return label && players.length ? [{ label, players }] : [];
  });
  return rows.length ? { formation, rows } : null;
}

function realTeamSide(raw: Record<string, any>, teamId: unknown): "home" | "away" | null {
  const homeId = raw.general?.homeTeam?.id;
  const awayId = raw.general?.awayTeam?.id;
  if (teamId == null) return null;
  if (String(teamId) === String(homeId)) return "home";
  if (String(teamId) === String(awayId)) return "away";
  return null;
}

function parseRealShots(raw: Record<string, any>): FotMobShot[] {
  const shots = raw.content?.shotmap?.shots;
  if (!Array.isArray(shots)) return [];
  return shots.flatMap((shot: unknown) => {
    if (!object(shot)) return [];
    const team = realTeamSide(raw, shot.teamId);
    const player = nonempty(shot.playerName);
    const minute = finite(shot.min);
    const x = finite(shot.x);
    const y = finite(shot.y);
    const xg = finite(shot.expectedGoals);
    const event = String(shot.eventType ?? "").toLowerCase();
    const result: FotMobShot["result"] =
      event === "goal"
        ? "goal"
        : event.includes("woodwork") || event.includes("post")
          ? "post"
          : event.includes("saved")
            ? "saved"
            : shot.isBlocked === true
              ? "blocked"
              : "off_target";
    return team && player && minute != null && x != null && y != null && xg != null
      ? [{ team, player, minute, x, y, xg, result }]
      : [];
  });
}

function playerGoals(raw: Record<string, any>): Map<string, number> {
  const rows = raw.content?.playerStats;
  const result = new Map<string, number>();
  if (!object(rows)) return result;
  for (const value of Object.values(rows)) {
    if (!object(value)) continue;
    const id = value.id == null ? null : String(value.id);
    const name = nonempty(value.name);
    const top = Array.isArray(value.stats)
      ? value.stats.find((group: unknown) => object(group) && group.key === "top_stats")
      : null;
    const stats = object(top) && object(top.stats) ? top.stats : {};
    const goal = object(stats.Goals) ? finite(stats.Goals.stat?.value) : null;
    if (goal == null) continue;
    if (id) result.set(`id:${id}`, goal);
    if (name) result.set(`name:${name}`, goal);
  }
  return result;
}

function parseRealRatings(raw: Record<string, any>): FotMobRating[] {
  const lineup = raw.content?.lineup;
  if (!object(lineup)) return [];
  const goals = playerGoals(raw);
  return ([
    ["home", lineup.homeTeam],
    ["away", lineup.awayTeam],
  ] as const).flatMap(([team, group]) => {
    if (!object(group)) return [];
    return [...(Array.isArray(group.starters) ? group.starters : []), ...(Array.isArray(group.subs) ? group.subs : [])].flatMap((player: unknown) => {
      if (!object(player)) return [];
      const name = nonempty(player.name);
      const rating = finite(player.performance?.rating);
      if (!name || rating == null) return [];
      const goal = goals.get(`id:${player.id}`) ?? goals.get(`name:${name}`);
      return [{ team, player: name, rating, ...(goal != null ? { goals: goal } : {}) }];
    });
  });
}

function realXi(raw: Record<string, any>, group: unknown): FotMobXi | null {
  if (!object(group) || !nonempty(group.formation)) return null;
  const rows = new Map<string, string[]>();
  const starters = Array.isArray(group.starters) ? group.starters : [];
  for (const player of starters) {
    if (!object(player)) continue;
    const name = nonempty(player.name);
    if (!name) continue;
    const position = player.usualPlayingPositionId ?? player.positionId;
    const label = position === 0 || position === 11
      ? "Goalkeeper"
      : position === 1 || (typeof position === "number" && position >= 30 && position < 50)
        ? "Defenders"
        : position === 2 || (typeof position === "number" && position >= 50 && position < 80)
          ? "Midfielders"
          : position === 3 || (typeof position === "number" && position >= 80)
            ? "Forwards"
            : "Starting XI";
    const names = rows.get(label) ?? [];
    names.push(name);
    rows.set(label, names);
  }
  const parsedRows = [...rows].map(([label, players]) => ({ label, players }));
  return parsedRows.length
    ? { formation: group.formation.trim(), rows: parsedRows }
    : null;
}

function realPotm(raw: Record<string, any>, ratings: FotMobRating[]): FotMobRating | null {
  const potm = raw.content?.matchFacts?.playerOfTheMatch;
  if (!object(potm)) return null;
  const name = object(potm.name) ? nonempty(potm.name.fullName) : nonempty(potm.name);
  const rating = finite(potm.rating?.num) ?? finite(potm.rating);
  if (!name || rating == null) return null;
  const team = realTeamSide(raw, potm.teamId) ?? (potm.isHomeTeam === true ? "home" : potm.isHomeTeam === false ? "away" : null);
  if (!team) return null;
  const goal = ratings.find((row) => row.player === name)?.goals;
  return { team, player: name, rating, ...(goal != null ? { goals: goal } : {}) };
}

export function parseFotMob(
  raw: unknown,
  opts: { terminal: boolean },
): FotMobFields | null {
  if (!object(raw)) return null;
  const source = object(raw.cashford) ? raw.cashford : raw;
  const result: FotMobFields = {};

  if (object(source.xg)) {
    const base = pair(source.xg);
    if (base) {
      result.xg = {
        ...base,
        model: "fotmob-2026",
        firstHalf: pair(source.xg.firstHalf),
        secondHalf: pair(source.xg.secondHalf),
        openPlay: pair(source.xg.openPlay),
        setPlay: pair(source.xg.setPlay),
        xgot: pair(source.xg.xgot),
      };
    }
  } else {
    const base = rawStatPair(raw, ["expected_goals", "expectedgoals"]);
    if (base) result.xg = { ...base, model: "fotmob-2026" };
  }

  if (Array.isArray(source.shots)) {
    const shots = source.shots.flatMap((rawShot: unknown) => {
      if (!object(rawShot)) return [];
      const team = side(rawShot.team);
      const player = nonempty(rawShot.player);
      const minute = finite(rawShot.minute);
      const x = finite(rawShot.x);
      const y = finite(rawShot.y);
      const xg = finite(rawShot.xg);
      const shotResult = rawShot.result;
      const validResult =
        shotResult === "goal" ||
        shotResult === "saved" ||
        shotResult === "blocked" ||
        shotResult === "off_target" ||
        shotResult === "post";
      return team && player && minute != null && x != null && y != null &&
        xg != null && validResult
        ? [{ team, player, minute, x, y, xg, result: shotResult }]
        : [];
    });
    if (shots.length) result.shots = shots;
  } else {
    const shots = parseRealShots(raw);
    if (shots.length) result.shots = shots;
  }

  if (Array.isArray(source.ratings)) {
    const ratings = source.ratings.flatMap((rawRating: unknown) => {
      if (!object(rawRating)) return [];
      const team = side(rawRating.team);
      const player = nonempty(rawRating.player);
      const rating = finite(rawRating.rating);
      const goals = finite(rawRating.goals);
      return team && player && rating != null
        ? [{
            team,
            player,
            rating,
            ...(goals != null ? { goals } : {}),
          }]
        : [];
    });
    if (ratings.length) {
      result.ratings = ratings;
      const potmName = nonempty(source.potm);
      const potm = ratings.find((rating) => rating.player === potmName);
      if (potm) result.potm = potm;
    }
  } else {
    const ratings = parseRealRatings(raw);
    if (ratings.length) result.ratings = ratings;
    const potm = realPotm(raw, ratings);
    if (potm) result.potm = potm;
  }

  if (opts.terminal && Array.isArray(source.momentum)) {
    const momentum = source.momentum.flatMap((point: unknown) => {
      if (!object(point)) return [];
      const minute = finite(point.minute);
      const value = finite(point.value);
      return minute != null && value != null ? [{ minute, value }] : [];
    });
    if (momentum.length) result.momentum = momentum;
  } else if (opts.terminal && Array.isArray(raw.content?.momentum?.main?.data)) {
    const momentum = raw.content.momentum.main.data.flatMap((point: unknown) => {
      if (!object(point)) return [];
      const minute = finite(point.minute);
      const value = finite(point.value);
      return minute != null && value != null ? [{ minute, value }] : [];
    });
    if (momentum.length) result.momentum = momentum;
  }

  if (Array.isArray(source.facts)) {
    const facts = source.facts.flatMap((fact: unknown) => {
      if (!object(fact) || !FACT_KEYS.has(fact.key)) return [];
      const args = Array.isArray(fact.args)
        ? fact.args.map(finite).filter((value): value is number => value != null)
        : [];
      return args.length
        ? [{ key: fact.key as FotMobFactKey, args }]
        : [];
    });
    if (facts.length) result.facts = facts;
  } else {
    const aliases: Array<[FotMobFactKey, string[]]> = [
      ["shots_on_target", ["shots_on_target", "shotson_target"]],
      ["possession_pct", ["ball_possession", "possession"]],
      ["big_chances", ["big_chance", "big_chances"]],
      ["corners", ["corners"]],
      ["saves", ["saves"]],
      ["fouls", ["fouls_committed", "fouls"]],
      ["offsides", ["offsides"]],
      ["passes_completed_pct", ["accurate_passes", "passes_completed_pct"]],
    ];
    const facts = aliases.flatMap(([key, keys]) => {
      const values = rawStatPair(raw, keys);
      return values ? [{ key, args: [values.home, values.away] }] : [];
    });
    if (facts.length) result.facts = facts;
  }

  if (object(source.predictedXi)) {
    const home = parseXi(source.predictedXi.home);
    const away = parseXi(source.predictedXi.away);
    if (home && away) result.predictedXi = { home, away };
  } else if (object(raw.content?.lineup)) {
    const home = realXi(raw, raw.content.lineup.homeTeam);
    const away = realXi(raw, raw.content.lineup.awayTeam);
    if (home && away) result.predictedXi = { home, away };
  }

  return Object.keys(result).length ? result : null;
}

export function parseFotMobCandidates(
  raw: unknown,
): FotMobCandidate[] | null {
  const rows = Array.isArray(raw)
    ? raw
    : object(raw) && Array.isArray(raw.matches)
      ? raw.matches
      : object(raw) && Array.isArray(raw.leagues)
        ? raw.leagues.flatMap((league: any) =>
            Array.isArray(league?.matches) ? league.matches : [],
          )
        : null;
  if (!rows) return null;
  const candidates = rows.flatMap((row: unknown) => {
    if (!object(row)) return [];
    const id = row.id == null ? null : String(row.id);
    const date = nonempty(row.date ?? row.status?.utcTime);
    const homeName = nonempty(row.homeName ?? row.home?.name);
    const awayName = nonempty(row.awayName ?? row.away?.name);
    return id && date && homeName && awayName
      ? [{ id, date, homeName, awayName }]
      : [];
  });
  return candidates.length ? candidates : null;
}

async function fetchJson<T>(
  url: string,
  parse: (raw: unknown) => T | null,
): Promise<FetchResult<T>> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(url, {
      cache: "no-store",
      signal: controller.signal,
      headers: { "User-Agent": "Cashford/1.0" },
    });
    if (!response.ok) return { kind: "http", status: response.status };
    let raw: unknown;
    try {
      raw = await response.json();
    } catch {
      return { kind: "invalid_json" };
    }
    const value = parse(raw);
    return value ? { kind: "ok", value } : { kind: "shape" };
  } catch (error) {
    return error instanceof Error && error.name === "AbortError"
      ? { kind: "timeout" }
      : { kind: "http", status: 0 };
  } finally {
    clearTimeout(timeout);
  }
}

export function fetchFotMobMatch(
  id: string,
  opts: { terminal: boolean } = { terminal: true },
): Promise<FetchResult<FotMobFields>> {
  if (process.env.FOTMOB_ENABLED !== "true") {
    return Promise.resolve({ kind: "disabled" });
  }
  const url = `https://www.fotmob.com/api/data/matchDetails?matchId=${encodeURIComponent(id)}`;
  return fetchJson(url, (raw) => parseFotMob(raw, opts));
}

export function fetchFotMobCandidates(
  date: string,
): Promise<FetchResult<FotMobCandidate[]>> {
  if (process.env.FOTMOB_ENABLED !== "true") {
    return Promise.resolve({ kind: "disabled" });
  }
  const url = `https://www.fotmob.com/api/data/matches?date=${encodeURIComponent(date)}`;
  return fetchJson(url, parseFotMobCandidates);
}
