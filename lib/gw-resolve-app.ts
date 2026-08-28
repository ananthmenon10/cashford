import type { ContestLifecycle } from "./gw-state";

export type GwRef = { id: string; number: number; label: string };

export type AppGwResolution = {
  currentGw: GwRef | null;
  nextOpenGw: GwRef | null;
  latestSettledGw: GwRef | null;
  overlapAlert: { gws: number[] } | null;
};

export type GameweekAccessTarget = GwRef & {
  lifecycle: ContestLifecycle | null;
};

export type GameweekAccess = {
  now: GameweekAccessTarget | null;
  last: GameweekAccessTarget | null;
};

type AppContest = {
  gwId: string;
  leagueId: string;
  status: "open" | "locked" | "settling" | "settled" | "void";
  deadlineAt: Date;
  inputVersion: number;
  cl: ContestLifecycle;
};

const ref = (gw: { id: string; number: number; label: string }): GwRef => ({
  id: gw.id,
  number: gw.number,
  label: gw.label,
});

export function resolveGameweekFocus(resolution: AppGwResolution): GwRef | null {
  return resolution.currentGw ?? resolution.nextOpenGw ?? resolution.latestSettledGw;
}

export function resolveGameweekAccess(input: {
  resolution: AppGwResolution;
  gameweeks: readonly GwRef[];
  lifecycleByGameweekId: ReadonlyMap<string, ContestLifecycle>;
}): GameweekAccess {
  const target = (gameweek: GwRef | null): GameweekAccessTarget | null =>
    gameweek
      ? {
          ...gameweek,
          lifecycle: input.lifecycleByGameweekId.get(gameweek.id) ?? null,
        }
      : null;
  const available = new Map(input.gameweeks.map((gameweek) => [gameweek.id, gameweek]));
  const focus = resolveGameweekFocus(input.resolution);
  const latest = input.resolution.latestSettledGw;
  return {
    now: target(focus ? available.get(focus.id) ?? focus : null),
    last: target(latest ? available.get(latest.id) ?? latest : null),
  };
}

export function resolveAppGameweek(input: {
  competition: { id: string; archived: boolean };
  gameweeks: Array<{
    id: string;
    number: number;
    label: string;
    deadlineAt: Date | null;
  }>;
  contests: AppContest[];
  results: Array<{
    gwId: string;
    leagueId: string;
    outcome: "settled" | "void";
    settledVersion: number;
  }>;
  viewerLeagueIds: string[];
  now: Date;
}): AppGwResolution {
  const leagueIds = new Set(input.viewerLeagueIds);
  const contests = input.contests.filter((contest) =>
    leagueIds.has(contest.leagueId),
  );
  const byGw = new Map<string, AppContest[]>();
  for (const contest of contests) {
    const rows = byGw.get(contest.gwId) ?? [];
    rows.push(contest);
    byGw.set(contest.gwId, rows);
  }
  const ordered = [...input.gameweeks].sort((a, b) => a.number - b.number);
  const settled = (gwId: string) => {
    const rows = byGw.get(gwId) ?? [];
    return (
      rows.length > 0 &&
      rows.every((contest) => contest.cl === "CL5" || contest.cl === "CL7")
    );
  };
  const latestSettled =
    [...ordered].reverse().find((gw) => settled(gw.id)) ?? null;
  if (input.competition.archived) {
    return {
      currentGw: null,
      nextOpenGw: null,
      latestSettledGw: latestSettled ? ref(latestSettled) : null,
      overlapAlert: null,
    };
  }
  const unresolved = new Set<ContestLifecycle>([
    "CL2",
    "CL3",
    "CL4",
    "CL6",
    "CL8",
    "CL9",
    "CL10",
  ]);
  const pending = ordered.filter((gw) =>
    (byGw.get(gw.id) ?? []).some((contest) => unresolved.has(contest.cl)),
  );
  const current = pending.at(-1) ?? null;
  const nextOpen =
    ordered.find((gw) => {
      if (!gw.deadlineAt || gw.deadlineAt <= input.now) return false;
      const rows = byGw.get(gw.id) ?? [];
      return rows.some((contest) => contest.cl === "CL1") && rows.every(
        (contest) => contest.cl === "CL0" || contest.cl === "CL1",
      );
    }) ?? null;
  return {
    currentGw: current ? ref(current) : null,
    nextOpenGw: nextOpen ? ref(nextOpen) : null,
    latestSettledGw: latestSettled ? ref(latestSettled) : null,
    overlapAlert:
      pending.length > 1
        ? { gws: pending.map((gw) => gw.number) }
        : null,
  };
}
