import type { ContestLifecycle } from "./gw-state";

export type GwRef = { id: string; number: number; label: string };

export type AppGwResolution = {
  currentGw: GwRef | null;
  nextOpenGw: GwRef | null;
  latestSettledGw: GwRef | null;
  overlapAlert: { gws: number[] } | null;
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
      return !(byGw.get(gw.id) ?? []).some(
        (contest) => contest.cl !== "CL0" && contest.cl !== "CL1",
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
