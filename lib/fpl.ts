// Fantasy Premier League adapter (Phase 1 §3). Pure: fetch + validate + map, no DB.
// FPL is the source of truth for gameweek assignment, deadlines, fixture existence and
// kickoff times. It is a score source only as a fallback (see lib/sync-fpl.ts and §2).
//
// Two keyless endpoints, both validated as a pair before anything is returned. A partial or
// mangled payload returns null so the caller writes nothing — a half-read season is worse
// than a skipped run.

const BOOTSTRAP = "https://fantasy.premierleague.com/api/bootstrap-static/";
const FIXTURES = "https://fantasy.premierleague.com/api/fixtures/";
const FETCH_TIMEOUT_MS = 10_000;

export const FPL_EVENT_COUNT = 38;
export const FPL_TEAM_COUNT = 20;
export const FPL_FIXTURE_COUNT = 380;
export const FPL_SEASON_START_YEAR = 2026;

export interface FplEvent {
  fplEventId: number;
  number: number;
  name: string;
  deadlineAt: string;
}

export interface FplTeam {
  fplTeamId: number;
  name: string;
  shortName: string;
}

export interface FplFixture {
  fplFixtureId: number;
  fplEventId: number | null; // null = not yet assigned to a gameweek
  kickoffAt: string | null; // null = date to be confirmed
  homeFplTeamId: number;
  awayFplTeamId: number;
  homeScore: number | null;
  awayScore: number | null;
  finished: boolean;
}

export interface FplSnapshot {
  events: FplEvent[];
  teams: FplTeam[];
  fixtures: FplFixture[];
}

// ---- pure mappers -------------------------------------------------------------------------

// FPL event ids run 1..38 and double as the gameweek number.
export function mapEvent(raw: any): FplEvent | null {
  const id = Number(raw?.id);
  const deadline = raw?.deadline_time;
  if (!Number.isInteger(id) || id <= 0) return null;
  if (typeof deadline !== "string" || Number.isNaN(Date.parse(deadline))) return null;
  return {
    fplEventId: id,
    number: id,
    name: typeof raw.name === "string" && raw.name ? raw.name : `Gameweek ${id}`,
    deadlineAt: new Date(deadline).toISOString(),
  };
}

export function mapTeam(raw: any): FplTeam | null {
  const id = Number(raw?.id);
  if (!Number.isInteger(id) || id <= 0) return null;
  if (typeof raw.name !== "string" || !raw.name) return null;
  return { fplTeamId: id, name: raw.name, shortName: String(raw.short_name ?? raw.name) };
}

// Returns undefined for a value that is present but not a legal score, so the caller can tell
// "no score yet" (exactly null) apart from "this payload is broken" — silently reading a mangled
// score as "unobserved" would let a bad feed erase a stored one. A missing key, an empty string
// and a numeric string are all broken: FPL sends JSON numbers or null, and anything else means
// the shape changed under us.
const score = (v: unknown): number | null | undefined => {
  if (v === null) return null;
  return typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : undefined;
};

// A null event (unassigned) and an absent kickoff_time (TBC) are both VALID outputs. A kickoff
// or score that is PRESENT but unparseable is not — it rejects the row, and one rejected row
// rejects the whole snapshot in validateSnapshot.
export function mapFixture(raw: any): FplFixture | null {
  const id = Number(raw?.id);
  const home = Number(raw?.team_h);
  const away = Number(raw?.team_a);
  if (!Number.isInteger(id) || id <= 0) return null;
  if (!Number.isInteger(home) || !Number.isInteger(away)) return null;

  const ev = raw.event;
  const evId = ev === null || ev === undefined ? null : Number(ev);
  if (evId !== null && (!Number.isInteger(evId) || evId <= 0)) return null;

  const ko = raw.kickoff_time;
  let kickoffAt: string | null;
  if (ko === null) {
    kickoffAt = null; // genuinely undated — and ONLY an explicit null means that
  } else if (typeof ko === "string" && !Number.isNaN(Date.parse(ko))) {
    kickoffAt = new Date(ko).toISOString();
  } else {
    // A garbled date, a missing key or "" must never be read as "undated" — that erases a stored
    // kickoff. Only an explicit null is a real TBC.
    return null;
  }

  const homeScore = score(raw.team_h_score);
  const awayScore = score(raw.team_a_score);
  if (homeScore === undefined || awayScore === undefined) return null;

  return {
    fplFixtureId: id,
    fplEventId: evId,
    kickoffAt,
    homeFplTeamId: home,
    awayFplTeamId: away,
    homeScore,
    awayScore,
    finished: raw.finished === true,
  };
}

// ---- validation ---------------------------------------------------------------------------

export type SnapshotFailure = { ok: false; reason: string };
export type SnapshotSuccess = { ok: true; snapshot: FplSnapshot };

// Exported so tests can drive validation without the network.
export function validateSnapshot(bootstrap: any, fixturesRaw: any): SnapshotFailure | SnapshotSuccess {
  if (!bootstrap || !Array.isArray(bootstrap.events) || !Array.isArray(bootstrap.teams)) {
    return { ok: false, reason: "bootstrap payload malformed" };
  }
  if (!Array.isArray(fixturesRaw)) return { ok: false, reason: "fixtures payload malformed" };

  // Raw lengths are checked BEFORE mapping. Counting only the rows that survived would let a
  // payload of 380 good fixtures plus a pile of malformed extras pass as complete.
  if (bootstrap.events.length !== FPL_EVENT_COUNT) {
    return { ok: false, reason: `expected ${FPL_EVENT_COUNT} raw events, got ${bootstrap.events.length}` };
  }
  if (bootstrap.teams.length !== FPL_TEAM_COUNT) {
    return { ok: false, reason: `expected ${FPL_TEAM_COUNT} raw teams, got ${bootstrap.teams.length}` };
  }
  if (fixturesRaw.length !== FPL_FIXTURE_COUNT) {
    return { ok: false, reason: `expected ${FPL_FIXTURE_COUNT} raw fixtures, got ${fixturesRaw.length}` };
  }

  // Every row must map. A dropped row is a payload we do not understand, not a row to skip.
  const events: FplEvent[] = [];
  for (const raw of bootstrap.events) {
    const e = mapEvent(raw);
    if (!e) return { ok: false, reason: `event ${raw?.id ?? "?"} failed to map` };
    events.push(e);
  }
  const teams: FplTeam[] = [];
  for (const raw of bootstrap.teams) {
    const t = mapTeam(raw);
    if (!t) return { ok: false, reason: `team ${raw?.id ?? "?"} failed to map` };
    teams.push(t);
  }
  const fixtures: FplFixture[] = [];
  for (const raw of fixturesRaw) {
    const f = mapFixture(raw);
    if (!f) return { ok: false, reason: `fixture ${raw?.id ?? "?"} failed to map` };
    fixtures.push(f);
  }

  const eventIds = new Set(events.map((e) => e.fplEventId));
  if (eventIds.size !== FPL_EVENT_COUNT) {
    return { ok: false, reason: `expected ${FPL_EVENT_COUNT} unique events, got ${eventIds.size}` };
  }
  const teamIds = new Set(teams.map((t) => t.fplTeamId));
  if (teamIds.size !== FPL_TEAM_COUNT) {
    return { ok: false, reason: `expected ${FPL_TEAM_COUNT} unique teams, got ${teamIds.size}` };
  }
  const fixtureIds = new Set(fixtures.map((f) => f.fplFixtureId));
  if (fixtureIds.size !== FPL_FIXTURE_COUNT) {
    return {
      ok: false,
      reason: `expected ${FPL_FIXTURE_COUNT} unique fixtures, got ${fixtureIds.size}`,
    };
  }
  for (const f of fixtures) {
    if (!teamIds.has(f.homeFplTeamId) || !teamIds.has(f.awayFplTeamId)) {
      return { ok: false, reason: `fixture ${f.fplFixtureId} references an unknown team` };
    }
    if (f.fplEventId !== null && !eventIds.has(f.fplEventId)) {
      return { ok: false, reason: `fixture ${f.fplFixtureId} references unknown event ${f.fplEventId}` };
    }
  }

  const gw1 = events.find((e) => e.number === 1);
  if (!gw1) return { ok: false, reason: "no gameweek 1" };
  if (new Date(gw1.deadlineAt).getUTCFullYear() !== FPL_SEASON_START_YEAR) {
    return { ok: false, reason: `gameweek 1 deadline ${gw1.deadlineAt} is not in ${FPL_SEASON_START_YEAR}` };
  }

  events.sort((a, b) => a.number - b.number);
  fixtures.sort((a, b) => a.fplFixtureId - b.fplFixtureId);
  return { ok: true, snapshot: { events, teams, fixtures } };
}

async function getJson(url: string): Promise<any | null> {
  try {
    const res = await fetch(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (res.status !== 200) return null;
    return await res.json();
  } catch {
    return null; // timeout / network / bad JSON — the caller writes nothing
  }
}

// Fetch both endpoints and validate them as a pair. Returns null on ANY failure; the caller
// logs a sync_issue and skips the run.
export async function fetchFplSnapshot(): Promise<FplSnapshot | null> {
  const [bootstrap, fixtures] = await Promise.all([getJson(BOOTSTRAP), getJson(FIXTURES)]);
  if (!bootstrap || !fixtures) return null;
  const result = validateSnapshot(bootstrap, fixtures);
  if (!result.ok) {
    console.error(`fpl: snapshot rejected — ${result.reason}`);
    return null;
  }
  return result.snapshot;
}

// ---- club-name normalization (shared with lib/espn-match.ts) -------------------------------
// FPL and ESPN disagree on club names ("Man City" / "Manchester City", "Nott'm Forest" /
// "Nottingham Forest"). Normalize to a comparable key rather than matching raw strings.

const ALIASES: Record<string, string> = {
  "man city": "manchester city",
  "man utd": "manchester united",
  "man united": "manchester united",
  "nottm forest": "nottingham forest",
  "notts forest": "nottingham forest",
  spurs: "tottenham hotspur",
  tottenham: "tottenham hotspur",
  wolves: "wolverhampton wanderers",
  brighton: "brighton hove albion",
  "brighton and hove albion": "brighton hove albion",
  "sheffield utd": "sheffield united",
  "west brom": "west bromwich albion",
  "leeds utd": "leeds united",
  leeds: "leeds united", // FPL says "Leeds", ESPN says "Leeds United"
  newcastle: "newcastle united",
  "west ham": "west ham united",
  "leicester city": "leicester",
  "ipswich town": "ipswich",
  "luton town": "luton",
};

export function normalizeClubName(raw: string): string {
  let s = raw
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/&/g, "and")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  s = s.replace(/\b(afc|fc)\b/g, "").replace(/\s+/g, " ").trim();
  return ALIASES[s] ?? s;
}
