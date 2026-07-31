import type { FetchResult } from "./fotmob";

export interface UnderstatCandidate {
  id: string;
  date: string;
  homeName: string;
  awayName: string;
}

export interface UnderstatShot {
  team: "home" | "away";
  player: string;
  minute: number;
  x: number;
  y: number;
  xg: number;
  result: "goal" | "saved" | "blocked" | "off_target" | "post";
}

export interface UnderstatMatch {
  xg: { home: number; away: number; model: "understat-2026" };
  shots: UnderstatShot[];
}

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
const name = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null;

export function understatSeason(season: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(season);
  if (!match) throw new Error(`Invalid Understat season: ${season}`);
  const start = Number(match[1]);
  if ((start + 1) % 100 !== Number(match[2])) {
    throw new Error(`Invalid Understat season: ${season}`);
  }
  return match[1];
}

export function parseUnderstatCandidates(
  raw: unknown,
): UnderstatCandidate[] | null {
  const rows = Array.isArray(raw)
    ? raw
    : object(raw) && Array.isArray(raw.dates)
      ? raw.dates
      : null;
  if (!rows) return null;
  const candidates = rows.flatMap((row: unknown) => {
    if (!object(row)) return [];
    const id = row.id == null ? null : String(row.id);
    const date = name(row.datetime ?? row.date);
    const homeName = name(row.h?.title ?? row.homeName);
    const awayName = name(row.a?.title ?? row.awayName);
    return id && date && homeName && awayName
      ? [{ id, date, homeName, awayName }]
      : [];
  });
  return candidates.length ? candidates : null;
}

const RESULT_MAP: Record<string, UnderstatShot["result"]> = {
  Goal: "goal",
  SavedShot: "saved",
  BlockedShot: "blocked",
  MissedShots: "off_target",
  ShotOnPost: "post",
};

export function parseUnderstatMatch(raw: unknown): UnderstatMatch | null {
  if (!object(raw)) return null;
  const shotsRoot = object(raw.shots) ? raw.shots : raw;
  if (!Array.isArray(shotsRoot.h) || !Array.isArray(shotsRoot.a)) return null;
  const home = shotsRoot.h;
  const away = shotsRoot.a;
  const mapShot = (
    row: unknown,
    team: "home" | "away",
  ): UnderstatShot | null => {
    if (!object(row)) return null;
    const player = name(row.player);
    const minute = finite(row.minute);
    const x = finite(row.X ?? row.x);
    const y = finite(row.Y ?? row.y);
    const xg = finite(row.xG ?? row.xg);
    const result = RESULT_MAP[String(row.result)];
    return player && minute != null && x != null && y != null &&
      xg != null && result
      ? { team, player, minute, x, y, xg, result }
      : null;
  };
  const shots = [
    ...home.map((row: unknown) => mapShot(row, "home")),
    ...away.map((row: unknown) => mapShot(row, "away")),
  ].filter((row): row is UnderstatShot => row !== null);
  const xgHome = finite(raw.xg?.home) ??
    home.reduce((total: number, row: any) => total + (finite(row?.xG) ?? 0), 0);
  const xgAway = finite(raw.xg?.away) ??
    away.reduce((total: number, row: any) => total + (finite(row?.xG) ?? 0), 0);
  return {
    xg: { home: xgHome, away: xgAway, model: "understat-2026" },
    shots,
  };
}

async function request<T>(
  url: string,
  parse: (raw: unknown) => T | null,
): Promise<FetchResult<T>> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(url, {
      cache: "no-store",
      signal: controller.signal,
      headers: {
        "X-Requested-With": "XMLHttpRequest",
        Referer: "https://understat.com/",
      },
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

export function fetchUnderstatCandidates(
  season: string,
): Promise<FetchResult<UnderstatCandidate[]>> {
  const start = understatSeason(season);
  return request(
    `https://understat.com/getLeagueData/EPL/${start}/`,
    parseUnderstatCandidates,
  );
}

export function fetchUnderstatMatch(
  id: string,
): Promise<FetchResult<UnderstatMatch>> {
  return request(
    `https://understat.com/getMatchData/${encodeURIComponent(id)}/`,
    parseUnderstatMatch,
  );
}
