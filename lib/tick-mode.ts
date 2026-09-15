// The pg_cron tick fires every minute. Outside match windows nothing about
// fixtures changes minute to minute, yet the fixture pollers still ran nine
// leases and several table reads each tick. Quiet mode runs them every ten
// minutes instead. FPL sync, contest locks, settlement and gameweek
// maintenance are NOT gated by this — they stay on the one-minute cadence
// so deadlines and payouts keep their latency.
type Admin = ReturnType<typeof import("./supabase/service").createServiceRoleClient>;

export type TickMode = { mode: "active" | "quiet"; reason: string };

export const ACTIVE_BEFORE_KICKOFF_MS = 2 * 3600e3;
// Kick-off + 5 h covers a normal finish (+~2 h) plus the ~3 h of post-match
// polling (result corrections, stats freeze at +30 min, commentary).
export const ACTIVE_AFTER_KICKOFF_MS = 5 * 3600e3;
export const QUIET_RUN_EVERY_MINUTES = 10;

// Failing open is silent by design: an always-failing probe looks exactly like a
// permanent match window. Log it so the cost shows up in the Vercel logs.
function logProbeFailure(err: unknown) {
  console.error("[tick] fixtures probe failed, failing open to active", err);
}

export async function resolveTickMode(admin: Admin, now = new Date()): Promise<TickMode> {
  const since = new Date(now.getTime() - ACTIVE_AFTER_KICKOFF_MS).toISOString();
  const until = new Date(now.getTime() + ACTIVE_BEFORE_KICKOFF_MS).toISOString();
  try {
    const { data, error } = await admin
      .from("fixtures")
      .select("id")
      .not("external_id", "is", null)
      .or(
        [
          "status.eq.live",
          `and(status.eq.scheduled,kickoff_at.gte.${since},kickoff_at.lte.${until})`,
          `and(status.eq.finished,kickoff_at.gte.${since})`,
        ].join(","),
      )
      .limit(1);
    if (error) {
      logProbeFailure(error);
      return { mode: "active", reason: `probe error: ${error.message}` };
    }
    // Only an actual empty result set proves nothing is near. A shape we did not
    // expect fails open like every other doubt, never quiet.
    if (!Array.isArray(data)) {
      logProbeFailure({ message: "probe returned a non-array payload" });
      return { mode: "active", reason: "probe returned a non-array payload" };
    }
    if (data.length > 0) return { mode: "active", reason: "fixture near" };
    return { mode: "quiet", reason: "no fixture near" };
  } catch (err) {
    logProbeFailure(err);
    return { mode: "active", reason: `probe threw: ${err instanceof Error ? err.message : "unknown"}` };
  }
}

export function shouldRunFixturePollers(mode: TickMode, now: Date, manual: boolean): boolean {
  if (manual || mode.mode === "active") return true;
  return now.getUTCMinutes() % QUIET_RUN_EVERY_MINUTES === 0;
}
