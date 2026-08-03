import Link from "next/link";
import { PAYMENT_COPY } from "@/lib/payment-copy";
import type { DuesPendingPayment } from "@/lib/dues-view";
import { PHASE5_UI_COPY } from "@/lib/payment-copy";

export function PendingPaymentCard({ payment, names }: { payment: DuesPendingPayment; names: ReadonlyMap<string, string> }) {
  const payer = names.get(payment.payerUserId) ?? PHASE5_UI_COPY.player;
  const receiver = names.get(payment.receiverUserId) ?? PHASE5_UI_COPY.player;
  return <Link href={`/payments/${payment.id}`} className="block rounded-card border border-cs2-amber-line bg-cs2-amber-soft p-4">
    <p className="text-[13px] font-bold">{payer} → {receiver} · ₹{payment.amountInr.toLocaleString("en-IN")}</p>
    <p className="mt-1 text-[12px] text-cs2-amber">{payment.status === "disputed" ? PAYMENT_COPY.disputed : payment.viewerMustAnswer ? PAYMENT_COPY.confirm : PAYMENT_COPY.waitingOne(names.get(payment.waitingFor[0]) ?? "player")}</p>
  </Link>;
}
