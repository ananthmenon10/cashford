// Server-side persistence wiring for the pure settle() engine (Phase 5/7b).
// Reuses lib/settlement.ts (19 golden tests) — the money logic lives in ONE place.
// Runs with the service-role client (bypasses RLS).
//
// Per-fixture contests are CUP-FORMAT ONLY (Phase 1 §0). The DB enforces that with
// contests_cup_only; these guards stop the engine touching a non-cup row that predates the
// trigger or arrived some other way.

import { settle, type Prediction, type Actual } from "./settlement";

type Admin = ReturnType<typeof import("./supabase/service").createServiceRoleClient>;

const CUP_ONLY = "fixtures!inner(competitions!inner(format))";

// Lock contests whose lock_at has passed; void those with <2 valid entries (§7.3).
export async function lockDueContests(admin: Admin) {
  const now = new Date().toISOString();
  const { data: due } = await admin
    .from("contests").select(`id, ${CUP_ONLY}`)
    .eq("status", "open").lte("lock_at", now)
    .eq("fixtures.competitions.format", "cup");
  let locked = 0, voided = 0;
  for (const c of due ?? []) {
    const { count } = await admin.from("predictions").select("*", { count: "exact", head: true }).eq("contest_id", c.id);
    if ((count ?? 0) < 2) {
      await admin.from("contests").update({ status: "void", void_reason: "insufficient_entries" }).eq("id", c.id).eq("status", "open");
      voided++;
    } else {
      await admin.from("contests").update({ status: "locked" }).eq("id", c.id).eq("status", "open");
      locked++;
    }
  }
  return { processed: due?.length ?? 0, locked, voided };
}

// Settle one contest. Atomic claim (locked→settling) guarantees exactly-once.
export async function settleContest(admin: Admin, contestId: string) {
  // Cup-only guard runs BEFORE the claim so a non-cup row is never moved to 'settling'.
  const { data: guard } = await admin
    .from("contests").select(CUP_ONLY).eq("id", contestId)
    .eq("fixtures.competitions.format", "cup").maybeSingle();
  if (!guard) return { settled: false, reason: "not a cup fixture" };

  const { data: claimed } = await admin
    .from("contests").update({ status: "settling" })
    .eq("id", contestId).eq("status", "locked")
    .select("id, league_id, stake_inr, is_knockout, fixture_id");
  if (!claimed || claimed.length === 0) return { settled: false, reason: "not claimable" };
  const c = claimed[0];

  const { data: fx } = await admin.from("fixtures")
    .select("status, ft_home, ft_away, advancer_team_id, home_team_id, away_team_id")
    .eq("id", c.fixture_id).single();

  const abnormal = fx && ["cancelled", "abandoned", "postponed"].includes(fx.status);
  if (abnormal) {
    await admin.from("contests").update({ status: "cancelled", void_reason: `match_${fx!.status}`, settled_at: new Date().toISOString() }).eq("id", contestId);
    return { settled: true, status: "cancelled" };
  }
  const ready = fx && fx.status === "finished" && fx.ft_home != null && fx.ft_away != null
    && (!c.is_knockout || fx.advancer_team_id != null);
  if (!ready) {
    await admin.from("contests").update({ status: "locked" }).eq("id", contestId); // release; retry next tick
    return { settled: false, reason: "fixture not ready" };
  }

  const { data: preds } = await admin.from("predictions").select("user_id, outcome, pred_home, pred_away").eq("contest_id", contestId);
  const input: Prediction[] = (preds ?? []).map((p) => ({ userId: p.user_id, outcome: p.outcome, predHome: p.pred_home, predAway: p.pred_away }));
  const actual: Actual = {
    isKnockout: c.is_knockout, ftHome: fx!.ft_home, ftAway: fx!.ft_away,
    advancer: c.is_knockout ? (fx!.advancer_team_id === fx!.home_team_id ? "home" : "away") : undefined,
  };
  const r = settle(input, actual, c.stake_inr);

  // Clear any prior rows (idempotent re-settle), then write fresh.
  await admin.from("transfers").delete().eq("contest_id", contestId);
  await admin.from("contest_results").delete().eq("contest_id", contestId);
  if (r.results.length) {
    await admin.from("contest_results").insert(r.results.map((x) => ({
      contest_id: contestId, user_id: x.userId, result: x.result, net_inr: x.net, graded_at: new Date().toISOString(),
    })));
  }
  if (r.transfers.length) {
    await admin.from("transfers").insert(r.transfers.map((t) => ({
      contest_id: contestId, league_id: c.league_id, from_user_id: t.from, to_user_id: t.to, amount_inr: t.amount,
    })));
  }
  const finalStatus = r.status === "void" ? "void" : "settled";
  await admin.from("contests").update({ status: finalStatus, void_reason: r.voidReason ?? null, settled_at: new Date().toISOString() }).eq("id", contestId);
  await admin.from("contest_audit_log").insert({ contest_id: contestId, action: `settle:${finalStatus}`, note: r.voidReason ?? `${r.transfers.length} transfers` });
  return { settled: true, status: finalStatus };
}

// Settle all locked contests whose fixture is finished/abnormal.
export async function settleFinishedContests(admin: Admin) {
  const { data: locked } = await admin
    .from("contests").select("id, fixtures!inner(status, competitions!inner(format))")
    .eq("status", "locked")
    .eq("fixtures.competitions.format", "cup")
    .in("fixtures.status", ["finished", "cancelled", "abandoned", "postponed"]);
  let settled = 0;
  for (const c of locked ?? []) {
    const res = await settleContest(admin, c.id);
    if (res.settled) settled++;
  }
  return { candidates: locked?.length ?? 0, settled };
}
