import { describe, expect, it } from "vitest";
import {
  comparePaymentAmount,
  confirmationRequirements,
  derivePaymentStatus,
  isTerminalPaymentStatus,
  paymentAdjustment,
  requiredConfirmers,
  type PaymentFacts,
} from "../../lib/payment-state";

const thirdPartyFacts: PaymentFacts = {
  payerUserId: "alice",
  receiverUserId: "bob",
  amountInr: 75,
  loggedBy: "carol",
  requiredPayerConfirmation: true,
  requiredReceiverConfirmation: true,
};

describe("payment-state — §1.5 and §5 payment lifecycle", () => {
  it("T-U13: a payer logger requires the receiver to confirm", () => {
    // §1.7 CF1: the payer's own log is asserted by the payer, so only the receiver is required.
    expect(confirmationRequirements("alice", "bob", "alice")).toEqual({
      requiredPayerConfirmation: false,
      requiredReceiverConfirmation: true,
    });
    expect(requiredConfirmers({ ...thirdPartyFacts, loggedBy: "alice", requiredPayerConfirmation: false })).toEqual(["bob"]);
  });

  it("T-U14: a receiver logger requires the payer to confirm", () => {
    // §1.7 CF2: the receiver's own log is asserted by the receiver, so only the payer is required.
    expect(confirmationRequirements("alice", "bob", "bob")).toEqual({
      requiredPayerConfirmation: true,
      requiredReceiverConfirmation: false,
    });
    expect(requiredConfirmers({ ...thirdPartyFacts, loggedBy: "bob", requiredReceiverConfirmation: false })).toEqual(["alice"]);
  });

  it("T-U15: a third-party logger requires both financial parties", () => {
    // §1.7 CF3: neither party made the log, so both must answer.
    expect(confirmationRequirements("alice", "bob", "carol")).toEqual({
      requiredPayerConfirmation: true,
      requiredReceiverConfirmation: true,
    });
    expect(requiredConfirmers(thirdPartyFacts)).toEqual(["alice", "bob"]);
  });

  it("T-U16: the first of two confirmations leaves the payment pending", () => {
    // §2.3: before both required actors confirm, the payment contributes zero.
    expect(derivePaymentStatus(thirdPartyFacts, [{ actorUserId: "alice", action: "confirm" }])).toBe("pending");
  });

  it("T-U17: a dispute wins over an incomplete confirmation set", () => {
    // §4.1 DS5 and §5.3 CC9: one current dispute keeps the record out of the balance.
    expect(derivePaymentStatus(thirdPartyFacts, [
      { actorUserId: "alice", action: "confirm" },
      { actorUserId: "bob", action: "dispute" },
    ])).toBe("disputed");
  });

  it("T-U18: a later confirmation resolves a prior dispute", () => {
    // Confirmation events are append-only; the latest stance for bob is confirm.
    // Hand state: alice confirms, bob disputes, bob later confirms → both latest stances confirm.
    expect(derivePaymentStatus(thirdPartyFacts, [
      { actorUserId: "alice", action: "confirm" },
      { actorUserId: "bob", action: "dispute" },
      { actorUserId: "bob", action: "confirm" },
    ])).toBe("confirmed");
  });

  it("T-U19: confirmed and cancelled statuses are terminal", () => {
    // §4.3: a terminal payment cannot receive another normal lifecycle response.
    expect(isTerminalPaymentStatus("confirmed")).toBe(true);
    expect(isTerminalPaymentStatus("cancelled")).toBe(true);
    expect(isTerminalPaymentStatus("pending")).toBe(false);
    expect(isTerminalPaymentStatus("disputed")).toBe(false);
  });

  it("T-U20: reversal links to the original payment by applying the opposite effect", () => {
    // §1.5 and L6: original alice→bob ₹75 is alice +75 / bob −75;
    // reversal of that same pair is alice −75 / bob +75.
    expect(paymentAdjustment("confirmed", "alice", "bob", 75)).toEqual(new Map([
      ["alice", 75],
      ["bob", -75],
    ]));
    expect(paymentAdjustment("confirmed", "alice", "bob", -75)).toEqual(new Map([
      ["alice", -75],
      ["bob", 75],
    ]));
  });

  it("T-U21: a confirmed payment followed by its confirmed reversal restores both balances", () => {
    // §2.3 L6 worked example: alice −100/bob +100, then payment ₹75 gives −25/+25,
    // then reversal gives −25−75 = −100 and +25+75 = +100.
    const afterPayment = new Map([
      ["alice", -25],
      ["bob", 25],
    ]);
    const reversal = paymentAdjustment("confirmed", "alice", "bob", -75);
    for (const [userId, amount] of reversal) afterPayment.set(userId, (afterPayment.get(userId) ?? 0) + amount);
    expect(afterPayment).toEqual(new Map([
      ["alice", -100],
      ["bob", 100],
    ]));
  });

  it("§2.5 amount comparison keeps partial, exact, and overpayment distinct", () => {
    // With a ₹100 suggestion, ₹40 leaves ₹60, ₹100 clears it, and ₹120 is ₹20 over.
    expect(comparePaymentAmount(40, 100)).toBe("partial");
    expect(comparePaymentAmount(100, 100)).toBe("exact");
    expect(comparePaymentAmount(120, 100)).toBe("overpayment");
  });

});
