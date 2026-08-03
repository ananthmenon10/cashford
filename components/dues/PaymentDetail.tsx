"use client";

import { useState } from "react";
import { PAYMENT_COPY } from "@/lib/payment-copy";

export function PaymentDetail({ payment, viewerId, canReverse }: { payment: { id: string; payerUserId: string; receiverUserId: string; amountInr: number; status: string; loggedBy: string }; viewerId: string; canReverse: boolean }) {
  const [status, setStatus] = useState(payment.status);
  const [reason, setReason] = useState("");
  async function respond(action: "confirm" | "dispute") {
    const response = await fetch(`/api/dues/payments/${payment.id}/response`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, clientRequestId: crypto.randomUUID() }) });
    if (response.ok) setStatus((await response.json()).payment?.status ?? status);
  }
  async function cancel() { const response = await fetch(`/api/dues/payments/${payment.id}/cancel`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ clientRequestId: crypto.randomUUID() }) }); if (response.ok) setStatus("cancelled"); }
  async function reverse() { const response = await fetch(`/api/dues/payments/${payment.id}/reverse`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ reason, clientRequestId: crypto.randomUUID() }) }); if (response.ok) setStatus("pending"); }
  return <div className="rounded-card border border-border bg-surface p-4"><p className="text-[14px] font-bold">₹{payment.amountInr.toLocaleString("en-IN")}</p><p className="mt-1 text-[12px] text-muted">{status}</p>{(status === "pending" || status === "disputed") && (viewerId === payment.payerUserId || viewerId === payment.receiverUserId) ? <div className="mt-4 flex gap-2"><button type="button" onClick={() => respond("confirm")} className="rounded-control bg-primary px-4 py-2 text-[12px] font-bold text-white">{status === "disputed" ? PAYMENT_COPY.confirmAfterDispute : PAYMENT_COPY.confirm}</button><button type="button" onClick={() => respond("dispute")} className="rounded-control border border-border px-4 py-2 text-[12px] font-bold">{PAYMENT_COPY.dispute}</button></div> : null}{(status === "pending" || status === "disputed") && payment.loggedBy === viewerId ? <button type="button" onClick={cancel} className="mt-3 text-[12px] font-bold text-loss">{PAYMENT_COPY.cancel}</button> : null}{status === "confirmed" && canReverse ? <div className="mt-4"><p className="text-[12px] text-muted">{PAYMENT_COPY.reversalIntro}</p><input value={reason} onChange={(event) => setReason(event.target.value)} placeholder={PAYMENT_COPY.reason} className="mt-2 w-full rounded-control border border-border bg-surface p-2.5 text-[12px]" /><button type="button" onClick={reverse} disabled={!reason.trim()} className="mt-2 rounded-control border border-border px-4 py-2 text-[12px] font-bold disabled:opacity-50">{PAYMENT_COPY.reverse}</button></div> : null}</div>;
}
