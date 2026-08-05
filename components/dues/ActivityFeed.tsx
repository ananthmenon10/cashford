import { PAYMENT_COPY, PHASE5_UI_COPY } from "@/lib/payment-copy";
import type { DuesActivityItem } from "@/lib/dues-activity";
import { PaymentDetailLink } from "@/components/dues/PaymentDetailLink";
import { LocalTime } from "@/components/LocalTime";

export function ActivityFeed({ items, names }: { items: readonly DuesActivityItem[]; names: ReadonlyMap<string, string> }) {
  if (!items.length) return null;
  return (
    <section className="mt-6">
      <h2 className="text-[12px] font-semibold uppercase tracking-wide text-muted">{PHASE5_UI_COPY.activity}</h2>
      <div className="mt-2 divide-y divide-border rounded-card border border-border bg-surface px-4">
        {items.map((item) => {
          const payer = names.get(item.payerUserId ?? "") ?? PHASE5_UI_COPY.player;
          const receiver = names.get(item.receiverUserId ?? "") ?? PHASE5_UI_COPY.player;
          const label = item.kind === "payment"
            ? PHASE5_UI_COPY.paid(payer, receiver)
            : item.kind === "reversal"
              ? PAYMENT_COPY.reversalFeed(item.note ?? PHASE5_UI_COPY.player)
              : PHASE5_UI_COPY.arrow(payer, receiver);
          const row = <div className="py-3 text-[12px]"><div className="flex items-center justify-between gap-3"><span className="font-semibold">{label}</span><span className="font-mono font-bold">₹{item.amountInr.toLocaleString("en-IN")}</span></div><p className="mt-1 text-[10px] text-muted">{item.status ?? item.kind.replace("_", " ")}{item.reversedByPaymentId ? ` · ${PHASE5_UI_COPY.reversed}` : ""}{" · "}<LocalTime iso={item.loggedAt} relative={false} /></p></div>;
          return item.kind === "payment" || item.kind === "reversal"
            ? <PaymentDetailLink key={item.id} paymentId={item.id}>{row}</PaymentDetailLink>
            : <div key={item.id}>{row}</div>;
        })}
      </div>
    </section>
  );
}
