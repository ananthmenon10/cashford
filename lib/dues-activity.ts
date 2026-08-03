import type { PaymentStatus } from "./payment-state";

export type DuesActivityItem = {
  id: string;
  kind: "wc_transfer" | "pl_transfer" | "payment" | "reversal";
  loggedAt: string;
  payerUserId?: string;
  receiverUserId?: string;
  amountInr: number;
  status?: PaymentStatus;
  note?: string | null;
  loggedBy?: string;
  reversedByPaymentId?: string;
  reversesPaymentId?: string | null;
};

export function buildDuesActivity(items: readonly DuesActivityItem[]): DuesActivityItem[] {
  const confirmedReversals = new Map<string, string>();
  for (const item of items) {
    if (item.kind === "reversal" && item.status === "confirmed" && item.reversesPaymentId) {
      confirmedReversals.set(item.reversesPaymentId, item.id);
    }
  }
  return [...items].sort((a, b) =>
    new Date(b.loggedAt).getTime() - new Date(a.loggedAt).getTime() || b.id.localeCompare(a.id),
  ).map((item) => ({ ...item, reversedByPaymentId: confirmedReversals.get(item.id) }));
}

