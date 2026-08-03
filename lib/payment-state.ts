export type PaymentStatus = "pending" | "disputed" | "confirmed" | "cancelled";
export type PaymentAction = "confirm" | "dispute" | "cancel";

export type PaymentFacts = {
  kind?: "payment" | "reversal";
  payerUserId: string;
  receiverUserId: string;
  amountInr: number;
  loggedBy: string;
  requiredPayerConfirmation: boolean;
  requiredReceiverConfirmation: boolean;
};

export type ConfirmationStance = "confirm" | "dispute";
export type ConfirmationEvent = {
  actorUserId: string;
  action: "confirm" | "dispute";
  createdAt?: string;
};

export function requiredConfirmers(facts: PaymentFacts): string[] {
  return [
    ...(facts.requiredPayerConfirmation ? [facts.payerUserId] : []),
    ...(facts.requiredReceiverConfirmation ? [facts.receiverUserId] : []),
  ];
}

export function confirmationRequirements(
  payerUserId: string,
  receiverUserId: string,
  loggedBy: string,
) {
  return {
    requiredPayerConfirmation: loggedBy !== payerUserId,
    requiredReceiverConfirmation: loggedBy !== receiverUserId,
  };
}

export function derivePaymentStatus(
  facts: PaymentFacts,
  events: readonly ConfirmationEvent[],
): PaymentStatus {
  const latest = new Map<string, ConfirmationStance>();
  for (const event of events) {
    if (event.action === "confirm" || event.action === "dispute") {
      latest.set(event.actorUserId, event.action);
    }
  }
  const actors = requiredConfirmers(facts);
  if (actors.some((actor) => latest.get(actor) === "dispute")) return "disputed";
  if (actors.length > 0 && actors.every((actor) => latest.get(actor) === "confirm")) {
    return "confirmed";
  }
  return "pending";
}

export function paymentAdjustment(
  status: PaymentStatus,
  payerUserId: string,
  receiverUserId: string,
  amountInr: number,
): Map<string, number> {
  const adjustment = new Map<string, number>([
    [payerUserId, 0],
    [receiverUserId, 0],
  ]);
  if (status !== "confirmed") return adjustment;
  const sign = amountInr * (payerUserId === receiverUserId ? 0 : 1);
  adjustment.set(payerUserId, sign);
  adjustment.set(receiverUserId, -sign);
  return adjustment;
}

export function isTerminalPaymentStatus(status: PaymentStatus): boolean {
  return status === "confirmed" || status === "cancelled";
}

export type PaymentComparison = "partial" | "exact" | "overpayment";

export function comparePaymentAmount(amountInr: number, suggestedInr: number): PaymentComparison {
  if (amountInr < suggestedInr) return "partial";
  if (amountInr > suggestedInr) return "overpayment";
  return "exact";
}
