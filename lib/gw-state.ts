import { isGameweekResultDirty } from "./net-balance";

export type ContestLifecycle =
  | "CL0"
  | "CL1"
  | "CL2"
  | "CL3"
  | "CL4"
  | "CL5"
  | "CL6"
  | "CL7"
  | "CL8"
  | "CL9"
  | "CL10";

export type ViewerParticipation = "VP0" | "VP1" | "VP2" | "VP3" | "VP4" | "VP5";

export type LifecycleContest = {
  status: "open" | "locked" | "settling" | "settled" | "void";
  deadlineAt: Date | string | number;
  inputVersion: number;
} | null;

export type LifecycleFixture = {
  state?: "active" | "void";
  effectiveState?: "active" | "void";
  final?: boolean;
  status?: string | null;
  homeScore?: number | null;
  awayScore?: number | null;
};

export type LifecycleResult = {
  outcome: "settled" | "void";
  settledVersion: number;
  voidReason?: "no_entrants" | "single_entrant" | "all_fixtures_void" | null;
} | null;

const fixtureState = (fixture: LifecycleFixture) => fixture.effectiveState ?? fixture.state;
const isFinal = (fixture: LifecycleFixture) => {
  const rawFixtureShape =
    fixture.status != null ||
    fixture.homeScore !== undefined ||
    fixture.awayScore !== undefined;
  if (!rawFixtureShape) return fixture.final === true;
  return (
    (fixture.final === true || fixture.status === "finished") &&
    fixture.homeScore != null &&
    fixture.awayScore != null
  );
};

export function resolveContestLifecycle(
  contest: LifecycleContest,
  _gameweek: unknown,
  fixtures: readonly LifecycleFixture[],
  result: LifecycleResult,
  now: Date | string | number = new Date(),
): ContestLifecycle {
  if (!contest) return "CL0";

  if ((contest.status === "settled" || contest.status === "void") && !result) {
    return "CL9";
  }
  if (
    result &&
    isGameweekResultDirty({
      inputVersion: contest.inputVersion,
      settledVersion: result.settledVersion,
    })
  ) {
    return result.outcome === "settled" ? "CL6" : "CL8";
  }
  if (result) return result.outcome === "settled" ? "CL5" : "CL7";

  const active = fixtures.filter((fixture) => fixtureState(fixture) === "active");
  const voided = fixtures.filter((fixture) => fixtureState(fixture) === "void");
  if (active.length === 0 && voided.length === 0) return "CL0";

  const deadline = new Date(contest.deadlineAt).getTime();
  const at = new Date(now).getTime();
  if (deadline > at) return "CL1";
  if (active.length === 0) return "CL10";

  const finalCount = active.filter(isFinal).length;
  if (finalCount === 0) return "CL2";
  if (finalCount < active.length) return "CL3";
  return "CL4";
}

export function resolveViewerParticipation(input: {
  eligible: boolean;
  entryStatus?: "entered" | "needs_update" | "locked_in" | "invalid" | null;
}
): ViewerParticipation {
  if (!input.eligible) return "VP0";
  if (!input.entryStatus) return "VP1";
  if (input.entryStatus === "entered") return "VP2";
  if (input.entryStatus === "needs_update") return "VP3";
  if (input.entryStatus === "locked_in") return "VP4";
  return "VP5";
}

export type RenderResolution = {
  lifecycle: ContestLifecycle;
  participation: ViewerParticipation;
  showCta: boolean;
  cta: "enter" | "edit" | "complete" | null;
  editable: boolean;
  showMoney: boolean;
  showSnapshotPoints: boolean;
  showLivePoints: boolean;
  showStandings: boolean;
  standings: boolean;
  money: boolean;
  points: boolean;
  inPot: boolean;
  copy?: string;
  copyId?: string;
  voidReasonCopy?: string;
  state:
    | "blank"
    | "open"
    | "closed"
    | "live"
    | "settled"
    | "void"
    | "recalculating"
    | "sync_issue"
    | "all_void";
};

export function resolveRender(
  lifecycle: ContestLifecycle,
  participation: ViewerParticipation,
): RenderResolution {
  const dirty = lifecycle === "CL6" || lifecycle === "CL8";
  const corrupt = lifecycle === "CL9";
  const open = lifecycle === "CL1";
  const invalid = participation === "VP5";
  const eligible = participation !== "VP0";
  const cta =
    open && eligible
      ? participation === "VP1"
        ? "enter"
        : participation === "VP2"
          ? "edit"
          : participation === "VP3"
            ? "complete"
            : null
      : null;
  const state: RenderResolution["state"] =
    lifecycle === "CL0"
      ? "blank"
      : lifecycle === "CL1"
        ? "open"
        : lifecycle === "CL2"
          ? "closed"
          : lifecycle === "CL3" || lifecycle === "CL4"
            ? "live"
            : lifecycle === "CL5"
              ? "settled"
              : lifecycle === "CL7"
                ? "void"
                : dirty
                  ? "recalculating"
                  : corrupt
                    ? "sync_issue"
                    : "all_void";

  const terminal = lifecycle === "CL5" || lifecycle === "CL7" || lifecycle === "CL9";
  const money = lifecycle === "CL5" && !invalid && eligible;
  const points =
    !corrupt &&
    !invalid &&
    (lifecycle === "CL3" ||
      lifecycle === "CL4" ||
      lifecycle === "CL5" ||
      lifecycle === "CL6" ||
      lifecycle === "CL8");
  const standings =
    !corrupt &&
    lifecycle !== "CL0" &&
    lifecycle !== "CL1" &&
    lifecycle !== "CL2" &&
    lifecycle !== "CL7" &&
    lifecycle !== "CL10";
  const copy =
    participation === "VP1" && terminal
      ? "C66"
      : lifecycle === "CL7"
        ? "C27"
        : lifecycle === "CL9"
          ? "C64"
          : undefined;

  return {
    lifecycle,
    participation,
    showCta: cta != null,
    cta,
    editable: cta != null,
    showMoney: money,
    showSnapshotPoints: lifecycle === "CL5" && !invalid,
    showLivePoints: (lifecycle === "CL3" || lifecycle === "CL4" || dirty) && !corrupt,
    showStandings: standings,
    standings,
    money,
    points,
    inPot: !invalid && participation !== "VP0" && participation !== "VP1",
    copy,
    copyId: copy,
    voidReasonCopy: lifecycle === "CL7" ? "C27" : undefined,
    state,
  };
}

export function homeBadgeState(
  lifecycle: string,
  participation: string,
): "OPEN" | "ENTERED" | "ACTION NEEDED" | "LOCKED" | "LIVE" | "SETTLED" | "VOID" | "RECALCULATING" {
  if (lifecycle === "CL1") {
    if (participation === "VP2") return "ENTERED";
    if (participation === "VP3") return "ACTION NEEDED";
    return "OPEN";
  }
  if (lifecycle === "CL3" || lifecycle === "CL4") return "LIVE";
  if (lifecycle === "CL5") return "SETTLED";
  if (lifecycle === "CL6" || lifecycle === "CL8") return "RECALCULATING";
  if (lifecycle === "CL7" || lifecycle === "CL10") return "VOID";
  return "LOCKED";
}
