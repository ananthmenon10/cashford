import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/settlement", async () => {
  const actual = await vi.importActual<typeof import("../../lib/settlement")>("../../lib/settlement");
  return {
    ...actual,
    simplifyDebts: vi.fn((nets?: Record<string, number>) => nets ? actual.simplifyDebts(nets) : []),
  };
});

import { simplifyDebts } from "../../lib/settlement";
import {
  buildCombinedDuesLedger,
  buildDuesLedger,
  duesDetailFingerprint,
  foldGameNet,
  foldPaymentNet,
  foldTransferNet,
  isDuesLedgerDirty,
  ledgerSum,
} from "../../lib/dues-ledger";

const simplifySpy = vi.mocked(simplifyDebts);
const MEMBERS = ["alice", "bob", "carol"] as const;

function movement(userId: string, netInr: number) {
  return { userId, netInr };
}

function transfer(fromUserId: string, toUserId: string, amountInr: number) {
  return { fromUserId, toUserId, amountInr };
}

describe("dues-ledger — §2 combined ledger contract", () => {
  beforeEach(() => simplifySpy.mockClear());

  it("T-U1: folds a World Cup-only balance", () => {
    // §2.1: WC net is the sum of contest-result movements.
    // Hand fold: alice −120 + bob ₹120 = ₹0 across the league.
    expect(foldGameNet(["alice", "bob"], [movement("alice", -120), movement("bob", 120)])).toEqual({
      alice: -120,
      bob: 120,
    });
  });

  it("T-U2: folds a Premier League-only balance", () => {
    // §2.1: PL net is the sum of gameweek-entry-result movements.
    // Hand fold: bob −80 + carol ₹80 = ₹0 across the league.
    expect(foldGameNet(["bob", "carol"], [movement("bob", -80), movement("carol", 80)])).toEqual({
      bob: -80,
      carol: 80,
    });
  });

  it("T-U3: combines World Cup and Premier League balances before simplifying", () => {
    // §2.1 worked example:
    // WC: alice → bob ₹120 gives alice −120, bob +120.
    // PL: bob → carol ₹80 gives bob −80, carol +80.
    // Combined: alice −120, bob (120 − 80) = +40, carol +80; −120 + 40 + 80 = 0.
    const result = buildDuesLedger({
      participantIds: MEMBERS,
      gameweekVersions: [],
      resultMovements: [movement("alice", -120), movement("bob", 120), movement("bob", -80), movement("carol", 80)],
      transferMovements: [transfer("alice", "bob", 120), transfer("bob", "carol", 80)],
      payments: [],
    });

    expect(result).toMatchObject({
      status: "clean",
      gameNetByUser: { alice: -120, bob: 40, carol: 80 },
      paymentNetByUser: { alice: 0, bob: 0, carol: 0 },
      netByUser: { alice: -120, bob: 40, carol: 80 },
    });
    expect(result.status === "clean" ? ledgerSum(result.netByUser) : null).toBe(0);
  });

  it("T-U4: a confirmed payment moves the payer toward zero and the receiver toward zero", () => {
    // §2.3: a confirmed payer→receiver payment adds to the payer and subtracts from the receiver.
    // Hand fold from game balances alice −100, bob +100 plus alice pays bob ₹40:
    // alice −100 + 40 = −60; bob 100 − 40 = +60.
    expect(foldPaymentNet(["alice", "bob"], [{
      kind: "payment",
      payerUserId: "alice",
      receiverUserId: "bob",
      amountInr: 40,
      status: "confirmed",
    }])).toEqual({ alice: 40, bob: -40 });
  });

  it("T-U5: a confirmed reversal applies the opposite payment effect", () => {
    // §2.3 L6: reversing alice→bob ₹40 applies alice −40 and bob +40.
    expect(foldPaymentNet(["alice", "bob"], [{
      kind: "reversal",
      payerUserId: "alice",
      receiverUserId: "bob",
      amountInr: 40,
      status: "confirmed",
    }])).toEqual({ alice: -40, bob: 40 });
  });

  it("T-U6: pending, disputed, and cancelled payments contribute zero", () => {
    // §0 S3 and §2.3: only confirmed rows affect the ledger.
    const statuses = ["pending", "disputed", "cancelled"] as const;
    expect(foldPaymentNet(["alice", "bob"], statuses.map((status) => ({
      kind: "payment" as const,
      payerUserId: "alice",
      receiverUserId: "bob",
      amountInr: 75,
      status,
    })))).toEqual({ alice: 0, bob: 0 });
  });

  it("T-U7: a partial payment leaves the stated remainder", () => {
    // §2.5 worked example: alice owes bob ₹100; alice pays ₹40; ₹100 − ₹40 = ₹60 remains.
    const result = buildDuesLedger({
      participantIds: ["alice", "bob"],
      gameweekVersions: [],
      resultMovements: [movement("alice", -100), movement("bob", 100)],
      transferMovements: [transfer("alice", "bob", 100)],
      payments: [{ kind: "payment", payerUserId: "alice", receiverUserId: "bob", amountInr: 40, status: "confirmed" }],
    });
    expect(result.status === "clean" ? result.netByUser : null).toEqual({ alice: -60, bob: 60 });
  });

  it("T-U8: an overpayment can cross the payer through zero", () => {
    // §2.5 worked sequence: alice owes bob ₹100.
    // After ₹40: alice −100 + 40 = −60; after another ₹80: −60 + 80 = +20.
    // Bob mirrors it: +100 − 40 − 80 = −20. The overpayment is not blocked.
    const result = buildDuesLedger({
      participantIds: ["alice", "bob"],
      gameweekVersions: [],
      resultMovements: [movement("alice", -100), movement("bob", 100)],
      transferMovements: [transfer("alice", "bob", 100)],
      payments: [
        { kind: "payment", payerUserId: "alice", receiverUserId: "bob", amountInr: 40, status: "confirmed" },
        { kind: "payment", payerUserId: "alice", receiverUserId: "bob", amountInr: 80, status: "confirmed" },
      ],
    });
    expect(result.status === "clean" ? result.netByUser : null).toEqual({ alice: 20, bob: -20 });
  });

  it("T-U9: preserves zero-sum across 1,001 generated integer ledgers", () => {
    // §0 S6–S7 and §2.3 L1–L4: each generated movement is an integer loser→winner transfer,
    // and every confirmed payment is also a two-sided integer movement.
    for (let index = 0; index < 1001; index++) {
      const from = MEMBERS[index % MEMBERS.length];
      const to = MEMBERS[(index + 1) % MEMBERS.length];
      const amount = (index % 97) + 1;
      const gameTransfer = transfer(from, to, amount);
      const gameNet = foldTransferNet(MEMBERS, [gameTransfer]);
      const status = (["pending", "disputed", "cancelled", "confirmed"] as const)[index % 4];
      const result = buildDuesLedger({
        participantIds: MEMBERS,
        gameweekVersions: [],
        resultMovements: MEMBERS.map((userId) => movement(userId, gameNet[userId])),
        transferMovements: [gameTransfer],
        payments: [{ kind: "payment", payerUserId: to, receiverUserId: MEMBERS[(index + 2) % MEMBERS.length], amountInr: (index % 31) + 1, status }],
      });

      expect(result.status).toBe("clean");
      if (result.status === "clean") {
        expect(ledgerSum(result.gameNetByUser)).toBe(0);
        expect(ledgerSum(result.paymentNetByUser)).toBe(0);
        expect(ledgerSum(result.netByUser)).toBe(0);
      }
    }
  });

  it("T-U10: simplifies the combined net once and returns the deterministic debt plan", () => {
    // §2.4 worked example: nets alice −100, bob −50, carol +120, dave +30.
    // First alice pays carol ₹100; then bob pays carol ₹20; finally bob pays dave ₹30.
    const result = buildDuesLedger({
      participantIds: ["alice", "bob", "carol", "dave"],
      gameweekVersions: [],
      resultMovements: [movement("alice", -100), movement("bob", -50), movement("carol", 120), movement("dave", 30)],
      transferMovements: [transfer("alice", "carol", 100), transfer("bob", "carol", 50), transfer("carol", "dave", 30)],
      payments: [],
    });
    const expectedPlan = [
      { from: "alice", to: "carol", amount: 100 },
      { from: "bob", to: "carol", amount: 20 },
      { from: "bob", to: "dave", amount: 30 },
    ];

    expect(result.status === "clean" ? result.plan : null).toEqual(expectedPlan);
    expect(simplifySpy).toHaveBeenCalledTimes(1);
    expect(simplifySpy).toHaveBeenCalledWith({ alice: -100, bob: -50, carol: 120, dave: 30 });
  });

  it("T-U11: returns sync_issue for a non-zero or mismatched fold and never simplifies it", () => {
    // §2.6: result fold alice −10, transfer fold alice ₹0. The sums differ, so no plan is valid.
    const result = buildDuesLedger({
      participantIds: ["alice", "bob"],
      gameweekVersions: [],
      resultMovements: [movement("alice", -10)],
      transferMovements: [],
      payments: [],
    });
    expect(result).toMatchObject({ status: "sync_issue", gameNetByUser: { alice: -10, bob: 0 }, transferNetByUser: { alice: 0, bob: 0 } });
    expect(simplifySpy).not.toHaveBeenCalled();
  });

  it("T-U12: result-snapshot and non-reversed transfer folds agree", () => {
    // §2.2: WC alice→bob ₹60 and PL bob→carol ₹25 produce the same member nets in both folds.
    const transfers = [transfer("alice", "bob", 60), transfer("bob", "carol", 25)];
    expect(foldGameNet(MEMBERS, [movement("alice", -60), movement("bob", 60), movement("bob", -25), movement("carol", 25)])).toEqual(
      foldTransferNet(MEMBERS, [...transfers, { ...transfer("alice", "carol", 999), reversed: true }]),
    );
  });

  it("§2.6 keeps a stable, key-sorted parity fingerprint and the combined-loader alias", () => {
    // §2.6: the fingerprint is a durable issue detail, not a viewer-specific plan.
    expect(duesDetailFingerprint({ transfers: { bob: 0, alice: 0 }, game: { bob: 0, alice: -10 } })).toBe(
      '{"game":{"alice":-10,"bob":0},"transfers":{"alice":0,"bob":0}}',
    );
    expect(buildCombinedDuesLedger).toBe(buildDuesLedger);
  });

  it("T-U46: dirty settled input returns recalculating before any plan", () => {
    // §2.0: input_version 3 > settled_version 2, so the ledger stops before money folds.
    const result = buildDuesLedger({
      participantIds: MEMBERS,
      gameweekVersions: [{ inputVersion: 3, settledVersion: 2 }],
      resultMovements: [movement("alice", -100), movement("bob", 100)],
      transferMovements: [transfer("alice", "bob", 100)],
      payments: [],
    });
    expect(result).toEqual({ status: "recalculating", reason: "dirty_gameweek" });
    expect(simplifySpy).not.toHaveBeenCalled();
  });

  it("T-U47: dirty void input with no entry-result rows is still recalculating", () => {
    // §2.0: settled_version null means no settled result; input_version 1 is still dirty.
    const result = buildDuesLedger({
      participantIds: MEMBERS,
      gameweekVersions: [{ inputVersion: 1, settledVersion: null }],
      resultMovements: [],
      transferMovements: [],
      payments: [],
    });
    expect(result).toEqual({ status: "recalculating", reason: "dirty_gameweek" });
    expect(simplifySpy).not.toHaveBeenCalled();
  });

  it("T-U48: a World Cup-only ledger has no gameweek dirtiness and keeps its plan", () => {
    // §2.0: a WC-only ledger has no gameweek contests, so the version list is empty and clean.
    // Hand fold: alice −50 + bob ₹50 = ₹0; the only plan row is alice paying bob ₹50.
    expect(isDuesLedgerDirty([])).toBe(false);
    const result = buildDuesLedger({
      participantIds: ["alice", "bob"],
      gameweekVersions: [],
      resultMovements: [movement("alice", -50), movement("bob", 50)],
      transferMovements: [transfer("alice", "bob", 50)],
      payments: [],
    });
    expect(result.status === "clean" ? result.plan : null).toEqual([{ from: "alice", to: "bob", amount: 50 }]);
  });
});
