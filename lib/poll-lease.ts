import {
  isPhase4SyncKey,
  type Phase4SyncKey,
} from "./poll-keys";

type Admin = ReturnType<typeof import("./supabase/service").createServiceRoleClient>;

export type Phase4LeaseResult =
  | { outcome: "claimed"; token: string }
  | { outcome: "not_due" }
  | { outcome: "leased" };

export type Phase4PollOutcome = {
  lease: Phase4LeaseResult["outcome"];
  fetches: number;
  writes: number;
};

export type Phase4ClaimedPollOutcome = Phase4PollOutcome & {
  lease: "claimed";
};

export type InsightsWriterResult =
  | { writer: "legacy"; token: string }
  | { writer: "leased"; token: string }
  | { writer: "none"; reason: "not_due" | "leased" };

const MISSING_INSIGHTS_WRITER_CODES = new Set(["PGRST202", "42883"]);

type RpcErrorLike = {
  code?: unknown;
  details?: unknown;
  hint?: unknown;
  message?: unknown;
};

function rpcErrorField(error: unknown, field: keyof RpcErrorLike): unknown {
  if (!error || typeof error !== "object") return undefined;
  return (error as RpcErrorLike)[field];
}

function wrappedRpcError(name: string, error: unknown): Error {
  const message = rpcErrorField(error, "message");
  const wrapped = new Error(
    `${name}: ${
      error instanceof Error
        ? error.message
        : typeof message === "string"
          ? message
          : "unknown RPC error"
    }`,
  ) as Error & RpcErrorLike;
  for (const field of ["code", "details", "hint"] as const) {
    const value = rpcErrorField(error, field);
    if (value !== undefined) wrapped[field] = value;
  }
  return wrapped;
}

export function isMissingInsightsWriterRpcError(error: unknown): boolean {
  const code = rpcErrorField(error, "code");
  if (typeof code === "string") {
    return MISSING_INSIGHTS_WRITER_CODES.has(code);
  }
  return false;
}

function assertKey(key: string): asserts key is Phase4SyncKey {
  if (!isPhase4SyncKey(key)) {
    throw new Error(`Phase 4 lease helper rejected key: ${key}`);
  }
}

export async function claimPhase4Lease(
  admin: Admin,
  key: Phase4SyncKey,
  leaseSeconds = 300,
): Promise<Phase4LeaseResult> {
  assertKey(key);
  const { data, error } = await admin.rpc("claim_phase4_lease", {
    p_key: key,
    p_lease_seconds: leaseSeconds,
  });
  if (error) throw new Error(`claim_phase4_lease(${key}): ${error.message}`);
  const row = Array.isArray(data) ? data[0] : data;
  if (row?.outcome === "claimed" && typeof row.token === "string") {
    return { outcome: "claimed", token: row.token };
  }
  if (row?.outcome === "not_due" || row?.outcome === "leased") {
    return { outcome: row.outcome };
  }
  throw new Error(`claim_phase4_lease(${key}): invalid result`);
}

export async function claimInsightsWriter(
  admin: Admin,
  leaseSeconds = 300,
): Promise<InsightsWriterResult> {
  const { data, error } = await admin.rpc("claim_insights_writer", {
    p_lease_seconds: leaseSeconds,
  });
  if (error) throw wrappedRpcError("claim_insights_writer", error);
  const row = Array.isArray(data) ? data[0] : data;
  if (
    (row?.writer === "legacy" || row?.writer === "leased") &&
    typeof row.token === "string"
  ) {
    return { writer: row.writer, token: row.token };
  }
  if (
    row?.writer === "none" &&
    (row.reason === "not_due" || row.reason === "leased")
  ) {
    return { writer: "none", reason: row.reason };
  }
  throw new Error("claim_insights_writer: invalid result");
}

export async function renewPhase4Lease(
  admin: Admin,
  key: Phase4SyncKey,
  token: string,
): Promise<boolean> {
  assertKey(key);
  const { data, error } = await admin.rpc("renew_sync_lease", {
    p_key: key,
    p_token: token,
  });
  if (error) throw new Error(`renew_sync_lease(${key}): ${error.message}`);
  return data === true;
}

export async function releasePhase4Lease(
  admin: Admin,
  key: Phase4SyncKey,
  token: string,
  schedule:
    | { nextDueAt: string }
    | { jitterSeconds: readonly [min: number, max: number] },
): Promise<boolean> {
  assertKey(key);
  const result =
    "nextDueAt" in schedule
      ? await admin.rpc("release_sync_lease", {
          p_key: key,
          p_token: token,
          p_next_due: schedule.nextDueAt,
        })
      : await admin.rpc("release_sync_lease_jittered", {
          p_key: key,
          p_token: token,
          p_min_secs: schedule.jitterSeconds[0],
          p_max_secs: schedule.jitterSeconds[1],
        });
  if (result.error) {
    throw new Error(`release lease(${key}): ${result.error.message}`);
  }
  return result.data === true;
}

export async function armPhase4Key(
  admin: Admin,
  key: Phase4SyncKey,
  dueAt: string,
): Promise<boolean> {
  assertKey(key);
  const { data, error } = await admin.rpc("arm_sync_key", {
    p_key: key,
    p_due_at: dueAt,
  });
  if (error) throw new Error(`arm_sync_key(${key}): ${error.message}`);
  return data === true;
}

export function skippedPollOutcome(
  lease: Exclude<Phase4LeaseResult["outcome"], "claimed">,
): Phase4PollOutcome {
  return { lease, fetches: 0, writes: 0 };
}
