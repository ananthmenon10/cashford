import type { SeasonPickCorpus } from "./analytics-corpus-load";
import type { SeasonMemberGameweek } from "./gw-season";

export type RivalrySwing = {
  gwNumber: number;
  fixtureId: string;
  homeShort: string;
  awayShort: string;
  ftHome: number;
  ftAway: number;
  viewerPts: number;
  rivalPts: number;
};

export type RivalryRecord = {
  won: number;
  lost: number;
  tied: number;
  viewerExacts: number;
  rivalExacts: number;
  sharedGameweeks: number;
  settledGameweeks: number;
  excludedGameweeks: number[];
  currentRunLength: number;
  runOwner: "viewer" | "rival" | null;
  biggestSwing: RivalrySwing | null;
};

export type AnalyticsRivalry = {
  options: { userId: string; name: string }[];
  byRivalId: Record<string, RivalryRecord>;
  defaultRivalId: string | null;
};

type Result = "viewer" | "rival" | "tie" | null;

function hasStoredTotals(row: SeasonMemberGameweek): boolean {
  return typeof row.points === "number" &&
    typeof row.exacts === "number" &&
    typeof row.goalError === "number";
}

function pairwiseResult(
  viewer: SeasonMemberGameweek,
  rival: SeasonMemberGameweek,
): Result {
  if (
    typeof viewer.points !== "number" ||
    typeof rival.points !== "number" ||
    typeof viewer.exacts !== "number" ||
    typeof rival.exacts !== "number" ||
    typeof viewer.goalError !== "number" ||
    typeof rival.goalError !== "number"
  ) {
    return null;
  }
  if (viewer.points !== rival.points) return viewer.points > rival.points ? "viewer" : "rival";
  if (viewer.exacts !== rival.exacts) return viewer.exacts > rival.exacts ? "viewer" : "rival";
  if (viewer.goalError !== rival.goalError) {
    return viewer.goalError < rival.goalError ? "viewer" : "rival";
  }
  return "tie";
}

function byUserAndGameweek(rows: readonly SeasonMemberGameweek[]) {
  const map = new Map<string, Map<number, SeasonMemberGameweek>>();
  for (const row of rows) {
    const byGw = map.get(row.userId) ?? new Map<number, SeasonMemberGameweek>();
    if (!byGw.has(row.gwNumber)) byGw.set(row.gwNumber, row);
    map.set(row.userId, byGw);
  }
  return map;
}

function storedFixtureResult(
  corpus: SeasonPickCorpus,
  userId: string,
  gwNumber: number,
  fixtureId: string,
) {
  for (const result of corpus.results) {
    if (result.userId !== userId || result.gwNumber !== gwNumber) continue;
    const row = result.perFixture.find((item) => item.fixtureId === fixtureId);
    if (row) return row;
  }
  return null;
}

function biggestSwing(
  corpus: SeasonPickCorpus | undefined,
  sharedGameweeks: readonly number[],
  viewerId: string,
  rivalId: string,
): RivalrySwing | null {
  if (!corpus) return null;
  const shared = new Set(sharedGameweeks);
  let selected: (RivalrySwing & { gap: number }) | null = null;
  for (const fixture of corpus.fixtures) {
    if (
      !shared.has(fixture.gwNumber) ||
      fixture.state !== "final" ||
      fixture.ftHome == null ||
      fixture.ftAway == null
    ) {
      continue;
    }
    const viewerResult = storedFixtureResult(corpus, viewerId, fixture.gwNumber, fixture.fixtureId);
    const rivalResult = storedFixtureResult(corpus, rivalId, fixture.gwNumber, fixture.fixtureId);
    if (!viewerResult || !rivalResult || viewerResult.verdict === "void" || rivalResult.verdict === "void") {
      continue;
    }
    const gap = Math.abs(viewerResult.pts - rivalResult.pts);
    if (
      gap === 0 ||
      (selected &&
        (gap < selected.gap ||
          (gap === selected.gap && fixture.gwNumber < selected.gwNumber) ||
          (gap === selected.gap &&
            fixture.gwNumber === selected.gwNumber &&
            fixture.fixtureId.localeCompare(selected.fixtureId) >= 0)))
    ) {
      continue;
    }
    selected = {
      gap,
      gwNumber: fixture.gwNumber,
      fixtureId: fixture.fixtureId,
      homeShort: fixture.homeShort,
      awayShort: fixture.awayShort,
      ftHome: fixture.ftHome,
      ftAway: fixture.ftAway,
      viewerPts: viewerResult.pts,
      rivalPts: rivalResult.pts,
    };
  }
  if (!selected) return null;
  const { gap: _gap, ...swing } = selected;
  return swing;
}

export function buildRivalry(
  memberGameweeks: readonly SeasonMemberGameweek[],
  viewerId: string,
  rivalId: string,
  corpus?: SeasonPickCorpus,
): RivalryRecord | null {
  const byUser = byUserAndGameweek(memberGameweeks);
  const viewerRows = byUser.get(viewerId) ?? new Map();
  const rivalRows = byUser.get(rivalId) ?? new Map();
  const settledGameweeks = new Set<number>();
  for (const row of [...viewerRows.values(), ...rivalRows.values()]) {
    if (row.settled) settledGameweeks.add(row.gwNumber);
  }
  const sharedGameweeks = [...settledGameweeks]
    .filter((gwNumber) => {
      const viewer = viewerRows.get(gwNumber);
      const rival = rivalRows.get(gwNumber);
      return !!viewer?.entered && !!viewer?.settled && !!rival?.entered && !!rival?.settled &&
        hasStoredTotals(viewer) && hasStoredTotals(rival);
    })
    .sort((a, b) => a - b);
  if (sharedGameweeks.length === 0) return null;

  let won = 0;
  let lost = 0;
  let tied = 0;
  let viewerExacts = 0;
  let rivalExacts = 0;
  const outcomes: { gwNumber: number; result: Exclude<Result, null> }[] = [];
  for (const gwNumber of sharedGameweeks) {
    const viewer = viewerRows.get(gwNumber)!;
    const rival = rivalRows.get(gwNumber)!;
    if (typeof viewer.exacts === "number") viewerExacts += viewer.exacts;
    if (typeof rival.exacts === "number") rivalExacts += rival.exacts;
    const result = pairwiseResult(viewer, rival);
    if (result == null) continue;
    outcomes.push({ gwNumber, result });
    if (result === "viewer") won += 1;
    else if (result === "rival") lost += 1;
    else tied += 1;
  }

  const last = outcomes.at(-1)?.result ?? null;
  let currentRunLength = 0;
  if (last && last !== "tie") {
    for (let index = outcomes.length - 1; index >= 0; index -= 1) {
      if (outcomes[index].result !== last) break;
      currentRunLength += 1;
    }
  }
  const excludedGameweeks = new Set(
    [...settledGameweeks].filter((gwNumber) => !sharedGameweeks.includes(gwNumber)),
  );
  for (const gwNumber of new Set([...viewerRows.keys(), ...rivalRows.keys()])) {
    const viewer = viewerRows.get(gwNumber);
    const rival = rivalRows.get(gwNumber);
    if (viewer?.entered && rival?.entered && (!viewer.settled || !rival.settled)) {
      excludedGameweeks.add(gwNumber);
    }
  }
  return {
    won,
    lost,
    tied,
    viewerExacts,
    rivalExacts,
    sharedGameweeks: sharedGameweeks.length,
    settledGameweeks: settledGameweeks.size,
    excludedGameweeks: [...excludedGameweeks].sort((a, b) => a - b),
    currentRunLength,
    runOwner: last === "viewer" ? "viewer" : last === "rival" ? "rival" : null,
    biggestSwing: biggestSwing(corpus, sharedGameweeks, viewerId, rivalId),
  };
}

export function buildRivalryModule(
  memberGameweeks: readonly SeasonMemberGameweek[],
  viewerId: string,
  names: ReadonlyMap<string, string>,
  corpus?: SeasonPickCorpus,
): AnalyticsRivalry | null {
  const rivalIds = [...new Set(memberGameweeks.map((row) => row.userId))]
    .filter((userId) => userId !== viewerId);
  const records = new Map<string, RivalryRecord>();
  for (const rivalId of rivalIds) {
    const record = buildRivalry(memberGameweeks, viewerId, rivalId, corpus);
    if (record) records.set(rivalId, record);
  }
  if (records.size === 0) return null;
  const options = [...records.keys()]
    .map((userId) => ({ userId, name: names.get(userId) ?? "Player" }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.userId.localeCompare(b.userId));
  const defaultRivalId = [...options]
    .sort(
      (a, b) =>
        records.get(b.userId)!.sharedGameweeks - records.get(a.userId)!.sharedGameweeks ||
        a.name.localeCompare(b.name) ||
        a.userId.localeCompare(b.userId),
    )[0]?.userId ?? null;
  return {
    options,
    byRivalId: Object.fromEntries(
      [...records.entries()].map(([userId, record]) => [userId, record]),
    ),
    defaultRivalId,
  };
}
