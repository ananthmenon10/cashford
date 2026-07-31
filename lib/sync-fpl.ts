// FPL ingest (Phase 1 §4). Runs under a sync_state lease; every write lands through the
// DB routines, because a chain of Supabase client calls is not a transaction.
//
// The whole diff goes into ONE cashford.apply_fpl_reconciliation call per run. Batching it
// would leave partial reconciliation behind if a later batch failed.

import { fetchFplSnapshot, normalizeClubName, type FplSnapshot, type FplTeam } from "./fpl";

type Admin = ReturnType<typeof import("./supabase/service").createServiceRoleClient>;

export const COMPETITION_SLUG = "pl-2026-27";
export const SEASON = "2026-27";
const LEASE_KEY = "fpl-sync";

const CADENCE_NORMAL_MS = 6 * 3600e3;
const CADENCE_NEAR_DEADLINE_MS = 15 * 60e3;
const NEAR_DEADLINE_WINDOW_MS = 48 * 3600e3;
const RETRY_AFTER_FAILURE_MS = 15 * 60e3;

export type SyncResult = {
  ran: boolean;
  reason?: string;
  reconciliation?: any;
  maintenance?: any;
  teamsCreated?: number;
  fixturesSkipped?: number;
  nextDueAt?: string;
};

async function logIssue(admin: Admin, kind: string, ref: string | null, detail?: unknown) {
  await admin.from("sync_issues").insert({
    source: "fpl",
    kind,
    ref,
    detail: detail === undefined ? null : detail,
  });
}

// Resolve every FPL club to a cashford team id, creating rows for clubs we have never seen
// (promoted sides arrive with no ESPN mapping — external_id stays null until espn-match runs).
async function resolveTeams(
  admin: Admin,
  teams: FplTeam[],
): Promise<{ byFplId: Map<number, string>; created: number; unresolved: FplTeam[] }> {
  const byFplId = new Map<number, string>();
  const unresolved: FplTeam[] = [];
  let created = 0;

  // Both reads MUST succeed. Treating a transient failure as "no rows" would make every club
  // look unknown and create 20 duplicate teams, then repoint the provider mappings at them.
  const { data: mapped, error: mapReadErr } = await admin
    .from("team_provider_ids")
    .select("team_id, provider_key")
    .eq("provider", "fpl")
    .eq("season", SEASON);
  if (mapReadErr) throw new Error(`team_provider_ids read failed: ${mapReadErr.message}`);
  const existing = new Map((mapped ?? []).map((r: any) => [String(r.provider_key), r.team_id as string]));

  const { data: allTeams, error: teamReadErr } = await admin.from("teams").select("id, name");
  if (teamReadErr) throw new Error(`teams read failed: ${teamReadErr.message}`);
  const byName = new Map(
    (allTeams ?? []).map((t: any) => [normalizeClubName(t.name), t.id as string]),
  );

  for (const t of teams) {
    const already = existing.get(String(t.fplTeamId));
    if (already) {
      byFplId.set(t.fplTeamId, already);
      continue;
    }

    let teamId: string | undefined = byName.get(normalizeClubName(t.name));
    let justCreated = false;
    if (!teamId) {
      const { data: inserted, error } = await admin
        .from("teams")
        .insert({ name: t.name, short_name: t.shortName })
        .select("id")
        .single();
      if (error || !inserted) {
        await logIssue(admin, "team-unresolved", String(t.fplTeamId), {
          name: t.name,
          error: error?.message ?? null,
        });
        unresolved.push(t);
        continue;
      }
      teamId = inserted.id as string;
      justCreated = true;
      created++;
    }

    const { error: mapErr } = await admin
      .from("team_provider_ids")
      .upsert(
        { team_id: teamId, provider: "fpl", season: SEASON, provider_key: String(t.fplTeamId) },
        { onConflict: "provider,season,provider_key" },
      );
    if (mapErr) {
      // A team with no provider mapping would be recreated on the next run, so undo it here.
      // Only a row this run created is safe to remove.
      if (justCreated) {
        const { error: undoErr } = await admin.from("teams").delete().eq("id", teamId);
        if (undoErr) {
          await logIssue(admin, "team-orphaned", String(t.fplTeamId), {
            name: t.name,
            team_id: teamId,
            error: undoErr.message,
          });
        } else {
          created--;
        }
      }
      await logIssue(admin, "team-unresolved", String(t.fplTeamId), {
        name: t.name,
        error: mapErr.message,
      });
      unresolved.push(t);
      continue;
    }
    byFplId.set(t.fplTeamId, teamId);
  }

  return { byFplId, created, unresolved };
}

// The jsonb argument for cashford.apply_fpl_reconciliation. Fixtures whose clubs could not be
// resolved are dropped for this run rather than half-written.
export function buildReconciliationPayload(
  snapshot: FplSnapshot,
  byFplId: Map<number, string>,
): { payload: any; skipped: number } {
  const fixtures: any[] = [];
  let skipped = 0;
  for (const f of snapshot.fixtures) {
    const home = byFplId.get(f.homeFplTeamId);
    const away = byFplId.get(f.awayFplTeamId);
    if (!home || !away) {
      skipped++;
      continue;
    }
    fixtures.push({
      fpl_fixture_id: f.fplFixtureId,
      fpl_event_id: f.fplEventId,
      kickoff_at: f.kickoffAt,
      home_team_id: home,
      away_team_id: away,
      finished: f.finished,
      home_score: f.homeScore,
      away_score: f.awayScore,
    });
  }
  return {
    payload: {
      competition_slug: COMPETITION_SLUG,
      gameweeks: snapshot.events.map((e) => ({
        fpl_event_id: e.fplEventId,
        number: e.number,
        name: e.name,
        deadline_at: e.deadlineAt,
      })),
      fixtures,
    },
    skipped,
  };
}

// Tighten the cadence inside the 48h run-up to the open gameweek's deadline; 6h otherwise.
export function nextDueAt(deadlineAt: string | null, now = Date.now()): string {
  if (deadlineAt) {
    const deadline = new Date(deadlineAt).getTime();
    if (deadline - now <= NEAR_DEADLINE_WINDOW_MS && deadline >= now) {
      return new Date(now + CADENCE_NEAR_DEADLINE_MS).toISOString();
    }
  }
  return new Date(now + CADENCE_NORMAL_MS).toISOString();
}

// Thrown when a renewal shows the lease is no longer ours. Distinct from a crash so the catch
// block leaves another holder's sync_state row alone.
class LeaseLost extends Error {}

export async function syncFpl(admin: Admin): Promise<SyncResult> {
  // The claim is BOTH the cadence gate and the single-flight lock: no row back means either
  // the run is not due or another holder has the lease.
  const { data: token, error: claimErr } = await admin.rpc("claim_sync_lease", { p_key: LEASE_KEY });
  if (claimErr) return { ran: false, reason: `claim failed: ${claimErr.message}` };
  if (!token) return { ran: false, reason: "not due or leased" };

  // Release is token-conditioned, so false means the lease was already taken from us and the
  // next_due_at we wanted was NOT written. Reporting success then would strand the cadence.
  const release = async (next: string): Promise<boolean> => {
    const { data, error } = await admin.rpc("release_sync_lease", {
      p_key: LEASE_KEY,
      p_token: token,
      p_next_due: next,
    });
    if (error) {
      console.error(`fpl sync: release failed: ${error.message}`);
      return false;
    }
    return data === true;
  };

  // Every failure path ends here. A false release means next_due_at was NOT written, so the
  // caller must not be handed a nextDueAt that nothing recorded.
  const finish = async (next: string, reason: string): Promise<SyncResult> => {
    if (!(await release(next))) {
      await logIssue(admin, "lease-lost", null, { stage: "release", after: reason });
      return { ran: false, reason: `${reason}; lease lost before release` };
    }
    return { ran: false, reason, nextDueAt: next };
  };

  // Every stage that is about to write renews first. The lease is five minutes and a full run
  // makes hundreds of round trips, so without this a slow run keeps writing after its lease
  // expired and a second runner has started.
  const renew = async (stage: string) => {
    const { data, error } = await admin.rpc("renew_sync_lease", {
      p_key: LEASE_KEY,
      p_token: token,
    });
    if (error) throw new LeaseLost(`renew before ${stage} failed: ${error.message}`);
    if (data !== true) throw new LeaseLost(`lease lost before ${stage}`);
  };

  try {
    const snapshot = await fetchFplSnapshot();
    if (!snapshot) {
      await logIssue(admin, "snapshot-rejected", null, { at: new Date().toISOString() });
      return finish(new Date(Date.now() + RETRY_AFTER_FAILURE_MS).toISOString(), "snapshot rejected");
    }

    // resolveTeams can insert teams and mappings, so it counts as a write stage.
    await renew("team writes");
    const { byFplId, created } = await resolveTeams(admin, snapshot.teams);
    const { payload, skipped } = buildReconciliationPayload(snapshot, byFplId);

    await renew("reconciliation");
    const { data: reconciliation, error: reconErr } = await admin.rpc("apply_fpl_reconciliation", {
      snapshot: payload,
    });
    if (reconErr) {
      await logIssue(admin, "reconciliation-failed", null, { error: reconErr.message });
      return finish(
        new Date(Date.now() + RETRY_AFTER_FAILURE_MS).toISOString(),
        `reconciliation failed: ${reconErr.message}`,
      );
    }

    const { data: competition } = await admin
      .from("competitions")
      .select("id")
      .eq("slug", COMPETITION_SLUG)
      .single();

    await renew("gameweek maintenance");
    const { data: maintenance } = await admin.rpc("run_gameweek_maintenance", {
      p_competition_id: competition!.id,
    });

    const { data: open } = await admin
      .from("gameweeks")
      .select("deadline_at")
      .eq("competition_id", competition!.id)
      .eq("status", "open")
      .maybeSingle();

    const next = nextDueAt(open?.deadline_at ?? null);
    if (!(await release(next))) {
      await logIssue(admin, "lease-lost", null, { stage: "release" });
      return { ran: false, reason: "lease lost before release" };
    }
    return {
      ran: true,
      reconciliation,
      maintenance,
      teamsCreated: created,
      fixturesSkipped: skipped,
      nextDueAt: next,
    };
  } catch (err: any) {
    // A lost lease is not a crash: another holder owns the row, so do not touch it and do not
    // reschedule — whoever holds it will set the next due time.
    if (err instanceof LeaseLost) {
      await logIssue(admin, "lease-lost", null, { detail: err.message });
      return { ran: false, reason: err.message };
    }
    await logIssue(admin, "sync-crashed", null, { error: String(err?.message ?? err) });
    return finish(
      new Date(Date.now() + RETRY_AFTER_FAILURE_MS).toISOString(),
      `crashed: ${err?.message ?? err}`,
    );
  }
}

// Cron-facing gameweek stamping for every FPL-sourced competition (open/lock/complete).
// Cheap and idempotent; runs outside the sync lease so a leased sync never blocks it.
export async function gameweekMaintenance(admin: Admin) {
  const { data: comps } = await admin
    .from("competitions")
    .select("id, slug")
    .eq("fpl_source", true)
    .in("status", ["preparing", "active"]);
  const results: Record<string, any> = {};
  for (const c of comps ?? []) {
    const { data, error } = await admin.rpc("run_gameweek_maintenance", { p_competition_id: c.id });
    results[c.slug] = error ? { error: error.message } : data;
  }
  return results;
}
