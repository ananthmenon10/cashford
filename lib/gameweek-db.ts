// Gameweek settlement worker + Dues aggregation (Phase 2 plan §0.6, L7, §5).
//
// This file is the ONLY bridge between the pure engine and the database. It does no scoring
// and no money arithmetic of its own: it claims a canonical input snapshot from the DB, hands
// it to settleGameweek() in lib/gameweek-settle.ts, and hands the outcome back to be validated
// and persisted. Every state change lives in a routine, because a chain of Supabase client
// calls is not a transaction.

import { settleGameweek, type GwOutcome } from "./gameweek-settle";
import { GwInputError, type GwInput } from "./gameweek-points";

type Admin = ReturnType<typeof import("./supabase/service").createServiceRoleClient>;

// The claim snapshot, in the DB's snake_case. Mapped to the engine's types below rather than
// passed through, so a shape change on either side is a type error and not a silent misread.
type ClaimSnapshot = {
  claimed: true;
  token: string;
  version: number;
  gameweek_contest_id: string;
  league_id: string;
  gameweek_id: string;
  stake_inr: number;
  prior_status: "locked" | "settled" | "void";
  cause: string;
  entries: { entry_id: string; user_id: string; picks: { fixture_id: string; pred_home: number; pred_away: number }[] }[];
  results: ({ fixture_id: string; state: "final"; home: number; away: number } | { fixture_id: string; state: "void" })[];
};

type ClaimRefused = { claimed: false; reason: string };

function toGwInput(snap: ClaimSnapshot): GwInput {
  return {
    stakeInr: snap.stake_inr,
    entries: snap.entries.map((e) => ({
      userId: e.user_id,
      picks: e.picks.map((p) => ({
        fixtureId: p.fixture_id,
        predHome: p.pred_home,
        predAway: p.pred_away,
      })),
    })),
    results: snap.results.map((r) =>
      r.state === "final"
        ? { fixtureId: r.fixture_id, state: "final" as const, home: r.home, away: r.away }
        : { fixtureId: r.fixture_id, state: "void" as const },
    ),
  };
}

function toFinalizePayload(outcome: GwOutcome) {
  if (outcome.kind === "void") return { kind: "void", reason: outcome.reason };

  const nets = new Map<string, number>();
  for (const s of outcome.scores) nets.set(s.userId, 0);
  for (const t of outcome.transfers) {
    nets.set(t.fromUserId, (nets.get(t.fromUserId) ?? 0) - t.amountInr);
    nets.set(t.toUserId, (nets.get(t.toUserId) ?? 0) + t.amountInr);
  }
  const winners = new Set(outcome.winners);

  return {
    kind: "settled",
    tiebreak_used: outcome.tiebreakUsed,
    pot_inr: outcome.potInr,
    diagnostics: outcome.diagnostics,
    entries: outcome.scores.map((s) => ({
      user_id: s.userId,
      points: s.points,
      exacts: s.exacts,
      goal_error: s.goalError,
      net_inr: nets.get(s.userId) ?? 0,
      is_winner: winners.has(s.userId),
      per_fixture: s.perFixture,
    })),
    transfers: outcome.transfers.map((t) => ({
      from_user_id: t.fromUserId,
      to_user_id: t.toUserId,
      amount_inr: t.amountInr,
    })),
  };
}

export type SettleOneResult = {
  contestId: string;
  outcome: "settled" | "void" | "retry" | "stale" | "skipped" | "aborted";
  reason?: string;
};

/**
 * Settle one gameweek pot: claim → compute → finalize.
 *
 * A compute failure aborts the claim so the pot returns to the status the claim found. A
 * corrupt snapshot (GwInputError) is a data problem, not a transient one — it is surfaced as
 * a sync_issue so it is visible rather than retried silently every minute.
 */
export async function settleGameweekContest(admin: Admin, contestId: string): Promise<SettleOneResult> {
  const { data, error } = await admin.rpc("claim_gameweek_settlement", { p_contest_id: contestId });
  if (error) return { contestId, outcome: "skipped", reason: error.message };

  const claim = data as ClaimSnapshot | ClaimRefused;
  if (!claim?.claimed) return { contestId, outcome: "skipped", reason: claim?.reason ?? "not claimable" };

  const input = toGwInput(claim);
  let outcome: GwOutcome;
  try {
    outcome = settleGameweek(input);
  } catch (e) {
    await admin.rpc("abort_gameweek_settlement", { p_contest_id: contestId, p_token: claim.token });
    const reason = e instanceof Error ? e.message : String(e);
    if (e instanceof GwInputError) {
      await admin.from("sync_issues").insert({
        source: "gameweek",
        kind: "corrupt-settlement-input",
        ref: contestId,
        detail: { reason, version: claim.version, entries: claim.entries.length },
      });
    }
    return { contestId, outcome: "aborted", reason };
  }

  const { data: fin, error: finError } = await admin.rpc("finalize_gameweek_settlement", {
    p_contest_id: contestId,
    p_token: claim.token,
    p_version: claim.version,
    p_outcome: toFinalizePayload(outcome),
  });

  if (finError) {
    // The routine rejected the outcome (a money invariant failed) and rolled itself back, so
    // the claim is still ours. Release it: retrying the same computation would fail the same way.
    await admin.rpc("abort_gameweek_settlement", { p_contest_id: contestId, p_token: claim.token });
    await admin.from("sync_issues").insert({
      source: "gameweek",
      kind: "settlement-rejected",
      ref: contestId,
      detail: { reason: finError.message, version: claim.version },
    });
    return { contestId, outcome: "aborted", reason: finError.message };
  }

  const result = (fin as { result: string; reason?: string })?.result;
  if (result === "settled" || result === "void") return { contestId, outcome: result };
  return { contestId, outcome: result === "retry" ? "retry" : "stale", reason: (fin as any)?.reason };
}

/**
 * The dispatcher (§0.6). One pass per cron tick over the four claimable populations:
 *   ready       — locked, ≥2 locked-in entries, every effective-active fixture finished
 *   dirty       — settled or void with input_version > the version it consumed
 *   expired     — stuck in 'settling' for more than 10 minutes
 *   corrupt     — settled or void with no result row (the claim routine flags it)
 *
 * The whole predicate lives in cashford.gameweek_settlement_candidates so that the limit is
 * applied to real candidates only: a limit applied ahead of the filtering would let a few
 * hundred clean settled pots crowd out the one corrected contest that has work to do.
 *
 * The routine also guarantees progress past the corrupt population, which is the one reason the
 * worker cannot clear: corrupt rows sort below every money-bearing reason, and each drops out of
 * the queue once its sync_issue is filed. So a backlog of corrupt rows costs one pass, not every
 * pass. See the PROGRESS INVARIANT note above the routine.
 */
export async function dispatchGameweekSettlements(admin: Admin, opts?: { limit?: number }) {
  const limit = opts?.limit ?? 40;

  const { data, error } = await admin.rpc("gameweek_settlement_candidates", { p_limit: limit });
  if (error) throw new Error(`gameweek dispatch: candidate scan failed: ${error.message}`);

  const rows = (Array.isArray(data) ? data : []) as { gameweek_contest_id: string; reason: string }[];
  const candidates = new Set(rows.map((r) => r.gameweek_contest_id));

  const results: SettleOneResult[] = [];
  for (const id of candidates) results.push(await settleGameweekContest(admin, id));

  return {
    scanned: candidates.size,
    settled: results.filter((r) => r.outcome === "settled").length,
    voided: results.filter((r) => r.outcome === "void").length,
    retried: results.filter((r) => r.outcome === "retry").length,
    aborted: results.filter((r) => r.outcome === "aborted").length,
    skipped: results.filter((r) => r.outcome === "skipped").length,
    // Only the interesting rows; a tick where 300 pots were "not ready" is not a log entry.
    detail: results.filter((r) => r.outcome !== "skipped"),
  };
}

// ---------------------------------------------------------------------------
// Dues (§5). One net position per member per league, across BOTH eras: the legacy
// per-fixture cup contests and the new gameweek pots. Reversed transfers are excluded, so a
// re-settled gameweek contributes its current version only.
// ---------------------------------------------------------------------------

type Reader = {
  from: (table: string) => any;
};

/**
 * Net position per user for one league, in rupees. Positive means owed to them.
 *
 * Reads two sources and adds them:
 *   contest_results.net_inr           — legacy cup contests (World Cup 2026)
 *   gameweek_entry_results.net_inr    — gameweek pots
 * Both are per-settlement snapshots that already sum to zero within their own contest, so the
 * union sums to zero across the league too.
 *
 * Works with either client: pass the session-scoped client from a Server Component (RLS scopes
 * it to the viewer's leagues) or the service client from a job.
 */
export async function leagueNetByUser(
  db: Reader,
  leagueId: string,
  seedUserIds: string[] = [],
): Promise<Record<string, number>> {
  const net: Record<string, number> = {};
  for (const id of seedUserIds) net[id] = 0;

  // gameweek_entry_results has TWO foreign keys to gameweek_entries (entry_id, and the composite
  // entry_id+gameweek_contest_id), so the embed must name the one to follow or PostgREST refuses
  // it as ambiguous. A silent zero here would understate what a member is owed, so both reads
  // throw rather than fall back to an empty list.
  const [legacy, gameweek] = await Promise.all([
    db
      .from("contest_results")
      .select("user_id, net_inr, contests!inner(league_id)")
      .eq("contests.league_id", leagueId),
    db
      .from("gameweek_entry_results")
      .select("net_inr, gameweek_entries!gameweek_entry_results_entry_id_fkey!inner(user_id, league_id)")
      .eq("gameweek_entries.league_id", leagueId),
  ]);

  if (legacy.error) throw new Error(`dues: contest_results read failed: ${legacy.error.message}`);
  if (gameweek.error) throw new Error(`dues: gameweek_entry_results read failed: ${gameweek.error.message}`);

  for (const r of (legacy.data ?? []) as { user_id: string; net_inr: number }[]) {
    net[r.user_id] = (net[r.user_id] ?? 0) + (r.net_inr ?? 0);
  }
  for (const r of (gameweek.data ?? []) as {
    net_inr: number;
    gameweek_entries: { user_id: string } | { user_id: string }[];
  }[]) {
    const e = Array.isArray(r.gameweek_entries) ? r.gameweek_entries[0] : r.gameweek_entries;
    if (!e) continue;
    net[e.user_id] = (net[e.user_id] ?? 0) + (r.net_inr ?? 0);
  }

  return net;
}
