import { describe, it, expect } from "vitest";
import { lockDueContests, settleContest, settleFinishedContests } from "./settle-contest";
import { makeClient, eqValue, type QuerySpec } from "../test/supabase-fake";

// settle-contest wires the pure settle() engine to persistence. These tests drive
// the orchestration — claim/void/release/idempotent-write decisions — against the
// fake supabase client, asserting both the returned summary and what got written.

const admin = (resolve: (s: QuerySpec) => any) => makeClient(resolve) as any;
const contestsWritten = (c: ReturnType<typeof makeClient>, status: string) =>
  c.calls.filter((s) => s.table === "contests" && s.op === "update" && (s.payload as any)?.status === status);
const insertInto = (c: ReturnType<typeof makeClient>, table: string) =>
  c.calls.find((s) => s.table === table && s.op === "insert");

describe("lockDueContests", () => {
  it("locks contests with ≥2 entries and voids those with fewer", () => {
    const due = [{ id: "c1" }, { id: "c2" }, { id: "c3" }];
    const counts: Record<string, number> = { c1: 5, c2: 1, c3: 2 };
    const client = makeClient((s) => {
      if (s.table === "contests" && s.op === "select") return { data: due };
      if (s.table === "predictions" && s.op === "select") return { count: counts[String(eqValue(s, "contest_id"))] };
      return {};
    });

    return lockDueContests(client as any).then((r) => {
      expect(r).toEqual({ processed: 3, locked: 2, voided: 1 });

      const voided = contestsWritten(client, "void");
      expect(voided).toHaveLength(1);
      expect(eqValue(voided[0], "id")).toBe("c2");
      expect((voided[0].payload as any).void_reason).toBe("insufficient_entries");
      // every state transition is guarded on the still-open status (no double-lock race)
      expect(voided[0].filters).toContainEqual(["eq", "status", "open"]);

      expect(contestsWritten(client, "locked")).toHaveLength(2);
    });
  });

  it("no due contests → nothing written", async () => {
    const client = makeClient((s) => (s.table === "contests" && s.op === "select" ? { data: [] } : {}));
    expect(await lockDueContests(client as any)).toEqual({ processed: 0, locked: 0, voided: 0 });
    expect(client.mutations()).toHaveLength(0);
  });
});

describe("settleContest — claim guard", () => {
  it("returns 'not claimable' and writes nothing when the atomic claim matches no row", async () => {
    const client = makeClient((s) =>
      s.table === "contests" && s.op === "update" ? { data: [] } : {},
    );
    const r = await settleContest(client as any, "cX");
    expect(r).toEqual({ settled: false, reason: "not claimable" });
    // only the claim attempt ran — no fixture/prediction reads, no writes
    expect(client.calls).toHaveLength(1);
  });
});

// Shared resolver factory for a single claimable contest + its fixture + predictions.
function single(opts: { contest: any; fixture: any; preds?: any[] }) {
  return makeClient((s) => {
    if (s.table === "contests" && s.op === "update" && s.selectArgs) return { data: [opts.contest] }; // claim
    if (s.table === "fixtures" && s.single) return { data: opts.fixture };
    if (s.table === "predictions" && s.op === "select") return { data: opts.preds ?? [] };
    return {};
  });
}

describe("settleContest — fixture gating", () => {
  it("abnormal match (postponed/cancelled/abandoned) → contest cancelled", async () => {
    const client = single({
      contest: { id: "c1", league_id: "L", stake_inr: 100, is_knockout: false, fixture_id: "F" },
      fixture: { status: "postponed", ft_home: null, ft_away: null, advancer_team_id: null, home_team_id: "h", away_team_id: "a" },
    });
    const r = await settleContest(client as any, "c1");
    expect(r).toEqual({ settled: true, status: "cancelled" });
    const cancelled = contestsWritten(client, "cancelled");
    expect(cancelled).toHaveLength(1);
    expect((cancelled[0].payload as any).void_reason).toBe("match_postponed");
  });

  it("not finished / score missing → released back to locked for a later tick", async () => {
    const client = single({
      contest: { id: "c1", league_id: "L", stake_inr: 100, is_knockout: false, fixture_id: "F" },
      fixture: { status: "finished", ft_home: null, ft_away: 1, advancer_team_id: null, home_team_id: "h", away_team_id: "a" },
    });
    const r = await settleContest(client as any, "c1");
    expect(r).toEqual({ settled: false, reason: "fixture not ready" });
    expect(contestsWritten(client, "locked")).toHaveLength(1);
    expect(insertInto(client, "transfers")).toBeUndefined();
  });

  it("knockout finished but advancer not yet decided → released", async () => {
    const client = single({
      contest: { id: "c1", league_id: "L", stake_inr: 100, is_knockout: true, fixture_id: "F" },
      fixture: { status: "finished", ft_home: 1, ft_away: 1, advancer_team_id: null, home_team_id: "h", away_team_id: "a" },
    });
    const r = await settleContest(client as any, "c1");
    expect(r.settled).toBe(false);
    expect(contestsWritten(client, "locked")).toHaveLength(1);
  });
});

describe("settleContest — settling & writing results", () => {
  it("group win → settled, with transfers and results matching the engine", async () => {
    const client = single({
      contest: { id: "c1", league_id: "L", stake_inr: 100, is_knockout: false, fixture_id: "F" },
      fixture: { status: "finished", ft_home: 2, ft_away: 1, advancer_team_id: null, home_team_id: "h", away_team_id: "a" },
      preds: [
        { user_id: "A", outcome: "home", pred_home: 2, pred_away: 1 },
        { user_id: "B", outcome: "away", pred_home: 0, pred_away: 1 },
        { user_id: "C", outcome: "draw", pred_home: 1, pred_away: 1 },
      ],
    });
    const r = await settleContest(client as any, "c1");
    expect(r).toEqual({ settled: true, status: "settled" });

    // idempotent: prior rows cleared before re-writing
    expect(client.calls.filter((s) => s.op === "delete").map((s) => s.table).sort()).toEqual(["contest_results", "transfers"]);

    const results = insertInto(client, "contest_results")!.payload as any[];
    expect(results).toHaveLength(3);
    expect(results.find((x) => x.user_id === "A")).toMatchObject({ result: "win", net_inr: 200 });
    expect(results.filter((x) => x.result === "loss")).toHaveLength(2);

    const transfers = insertInto(client, "transfers")!.payload as any[];
    expect(transfers).toHaveLength(2);
    expect(transfers.every((t) => t.to_user_id === "A" && t.amount_inr === 100 && t.league_id === "L")).toBe(true);

    expect(contestsWritten(client, "settled")).toHaveLength(1);
    expect(insertInto(client, "contest_audit_log")).toBeDefined();
  });

  it("knockout settles on the advancer, not the 90' scoreline", async () => {
    const client = single({
      contest: { id: "c1", league_id: "L", stake_inr: 50, is_knockout: true, fixture_id: "F" },
      // level on 90', but home advanced (on pens) → home picks win
      fixture: { status: "finished", ft_home: 1, ft_away: 1, advancer_team_id: "h", home_team_id: "h", away_team_id: "a" },
      preds: [
        { user_id: "A", outcome: "home", pred_home: 1, pred_away: 1 },
        { user_id: "B", outcome: "away", pred_home: 1, pred_away: 1 },
      ],
    });
    await settleContest(client as any, "c1");
    const results = insertInto(client, "contest_results")!.payload as any[];
    expect(results.find((x) => x.user_id === "A")).toMatchObject({ result: "win" });
    expect(results.find((x) => x.user_id === "B")).toMatchObject({ result: "loss" });
  });

  it("insufficient entries → void (no transfers, void rows written)", async () => {
    const client = single({
      contest: { id: "c1", league_id: "L", stake_inr: 100, is_knockout: false, fixture_id: "F" },
      fixture: { status: "finished", ft_home: 1, ft_away: 0, advancer_team_id: null, home_team_id: "h", away_team_id: "a" },
      preds: [{ user_id: "A", outcome: "home", pred_home: 1, pred_away: 0 }],
    });
    const r = await settleContest(client as any, "c1");
    expect(r).toEqual({ settled: true, status: "void" });
    expect(contestsWritten(client, "void")).toHaveLength(1);
    expect((contestsWritten(client, "void")[0].payload as any).void_reason).toBe("insufficient_entries");
    expect(insertInto(client, "transfers")).toBeUndefined(); // r.transfers empty → no insert
    const results = insertInto(client, "contest_results")!.payload as any[];
    expect(results.every((x) => x.result === "void" && x.net_inr === 0)).toBe(true);
  });
});

describe("settleFinishedContests", () => {
  it("iterates locked+finished candidates and settles each", async () => {
    const contest = { id: "c1", league_id: "L", stake_inr: 100, is_knockout: false, fixture_id: "F" };
    const client = makeClient((s) => {
      if (s.table === "contests" && s.op === "select") return { data: [{ id: "c1" }] }; // candidate list
      if (s.table === "contests" && s.op === "update" && s.selectArgs) return { data: [contest] }; // claim
      if (s.table === "fixtures" && s.single)
        return { data: { status: "finished", ft_home: 2, ft_away: 0, advancer_team_id: null, home_team_id: "h", away_team_id: "a" } };
      if (s.table === "predictions" && s.op === "select")
        return { data: [
          { user_id: "A", outcome: "home", pred_home: 2, pred_away: 0 },
          { user_id: "B", outcome: "away", pred_home: 0, pred_away: 1 },
        ] };
      return {};
    });
    const r = await settleFinishedContests(client as any);
    expect(r).toEqual({ candidates: 1, settled: 1 });
    expect(contestsWritten(client, "settled")).toHaveLength(1);
  });
});
