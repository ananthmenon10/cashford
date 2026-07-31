import {
  claimPhase4Lease,
  releasePhase4Lease,
  renewPhase4Lease,
  skippedPollOutcome,
  type Phase4PollOutcome,
} from "./poll-lease";
import type { Phase4SyncKey } from "./poll-keys";

type Admin = ReturnType<typeof import("./supabase/service").createServiceRoleClient>;

export type PollCounter = {
  fetched(count?: number): void;
  wrote(count?: number): void;
  renew(): Promise<void>;
  disarm(): void;
  nextDueIn(milliseconds: number): void;
};

export class Phase4LeaseLost extends Error {}

export async function runPhase4Poller(
  admin: Admin,
  key: Phase4SyncKey,
  schedule:
    | { nextDueMs: number }
    | { jitterSeconds: readonly [min: number, max: number] },
  work: (counter: PollCounter) => Promise<void>,
): Promise<Phase4PollOutcome> {
  const claim = await claimPhase4Lease(admin, key);
  if (claim.outcome !== "claimed") {
    return skippedPollOutcome(claim.outcome);
  }

  return runClaimedPhase4Poller(admin, key, schedule, work, claim.token);
}

export async function runPhase4PollerWithClaim(
  admin: Admin,
  key: Phase4SyncKey,
  schedule:
    | { nextDueMs: number }
    | { jitterSeconds: readonly [min: number, max: number] },
  work: (counter: PollCounter) => Promise<void>,
  token: string,
): Promise<Phase4PollOutcome> {
  return runClaimedPhase4Poller(admin, key, schedule, work, token);
}

async function runClaimedPhase4Poller(
  admin: Admin,
  key: Phase4SyncKey,
  schedule:
    | { nextDueMs: number }
    | { jitterSeconds: readonly [min: number, max: number] },
  work: (counter: PollCounter) => Promise<void>,
  token: string,
): Promise<Phase4PollOutcome> {

  let fetches = 0;
  let writes = 0;
  let disarm = false;
  let nextDueMsOverride: number | null = null;
  const counter: PollCounter = {
    fetched(count = 1) {
      fetches += count;
    },
    wrote(count = 1) {
      writes += count;
    },
    async renew() {
      if (!(await renewPhase4Lease(admin, key, token))) {
        throw new Phase4LeaseLost(`Phase 4 lease lost: ${key}`);
      }
    },
    disarm() {
      disarm = true;
    },
    nextDueIn(milliseconds) {
      if (!Number.isFinite(milliseconds) || milliseconds <= 0) {
        throw new Error(`Invalid Phase 4 next-due interval: ${milliseconds}`);
      }
      nextDueMsOverride = milliseconds;
    },
  };

  let thrown: unknown;
  try {
    await work(counter);
  } catch (error) {
    thrown = error;
  }

  const releaseSchedule = disarm
    ? { nextDueAt: "infinity" }
    : nextDueMsOverride != null
      ? {
          nextDueAt: new Date(
            Date.now() + nextDueMsOverride,
          ).toISOString(),
        }
    : "nextDueMs" in schedule
      ? { nextDueAt: new Date(Date.now() + schedule.nextDueMs).toISOString() }
      : { jitterSeconds: schedule.jitterSeconds };
  const released = await releasePhase4Lease(
    admin,
    key,
    token,
    releaseSchedule,
  );
  if (!released && !thrown) {
    thrown = new Phase4LeaseLost(`Phase 4 lease lost before release: ${key}`);
  }
  if (thrown) throw thrown;
  return { lease: "claimed", fetches, writes };
}
