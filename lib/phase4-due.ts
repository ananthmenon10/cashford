// One read of sync_state tells the tick which Phase 4 pollers can possibly
// claim their lease this minute. Before this, every tick spent eight
// claim_phase4_lease RPCs to hear "not_due" seven or eight times. The RPC
// stays authoritative — this only skips pollers whose next_due_at is in
// the future. Any doubt (missing row, bad value, read failure) resolves to
// "due" so the worst case is the old behaviour, never a silently dark poller.
import { PHASE4_SYNC_KEYS, type Phase4SyncKey } from "./poll-keys";

type Admin = ReturnType<typeof import("./supabase/service").createServiceRoleClient>;

export type Phase4DueSnapshot = {
  isDue(key: Phase4SyncKey): boolean;
  source: "sync_state" | "fallback";
};

export function isDueAt(nextDueAt: string | null | undefined, now: Date): boolean {
  if (nextDueAt == null) return true;
  if (nextDueAt === "infinity") return false;
  const at = Date.parse(nextDueAt);
  if (!Number.isFinite(at)) return true;
  return at <= now.getTime();
}

const EVERYTHING_DUE: Phase4DueSnapshot = { isDue: () => true, source: "fallback" };

export async function readPhase4Due(admin: Admin, now = new Date()): Promise<Phase4DueSnapshot> {
  try {
    const { data, error } = await admin
      .from("sync_state")
      .select("key, next_due_at")
      .in("key", [...PHASE4_SYNC_KEYS]);
    if (error || !Array.isArray(data)) return EVERYTHING_DUE;
    const byKey = new Map<string, string | null>();
    for (const row of data as Array<{ key: string; next_due_at: string | null }>) {
      byKey.set(row.key, row.next_due_at);
    }
    return {
      source: "sync_state",
      isDue: (key) => (byKey.has(key) ? isDueAt(byKey.get(key), now) : true),
    };
  } catch {
    return EVERYTHING_DUE;
  }
}
