"use client";

import { useRef, useState } from "react";
import { logPayment } from "@/app/leagues/[slug]/dues/log/actions";
import { PAYMENT_COPY, PHASE5_UI_COPY } from "@/lib/payment-copy";
import { PaymentDetailLink } from "@/components/dues/PaymentDetailLink";

export function PaymentSheet({ leagueId, participantOptions, initial }: { leagueId: string; participantOptions: { id: string; name: string }[]; initial?: { payerUserId?: string; receiverUserId?: string; amountInr?: number } }) {
  const [payer, setPayer] = useState(initial?.payerUserId ?? "");
  const [receiver, setReceiver] = useState(initial?.receiverUserId ?? "");
  const [amount, setAmount] = useState(initial?.amountInr ? String(initial.amountInr) : "");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const requestId = useRef(crypto.randomUUID());
  const [matchingPaymentIds, setMatchingPaymentIds] = useState<string[]>([]);

  async function submit(acknowledgedIds: string[] | null = null) {
    const isOverride = acknowledgedIds !== null;
    const result = await logPayment({
      leagueId,
      payerUserId: payer,
      receiverUserId: receiver,
      amountInr: Number(amount),
      paidOn: date,
      note,
      clientRequestId: isOverride ? crypto.randomUUID() : requestId.current,
      acknowledgedIds: isOverride ? acknowledgedIds : null,
    });

    if (result.outcome === "matching_existing") {
      const freshIds = result.matchedIds ?? [];
      setMatchingPaymentIds(freshIds);
      setMessage(freshIds.length > 0 ? null : PAYMENT_COPY.matchingChanged);
      return;
    }
    if (result.outcome === "created" || result.outcome === "retry") {
      setMatchingPaymentIds([]);
      setMessage(PHASE5_UI_COPY.saved);
      return;
    }
    setMessage(result.error ?? PAYMENT_COPY.saveFailure);
  }

  return <div className="mt-5 rounded-card border border-border bg-surface p-4">
    <h1 className="text-lg font-extrabold">{PAYMENT_COPY.title}</h1>
    <p className="mt-1 text-[12px] text-muted">{PAYMENT_COPY.intro}</p>
    <div className="mt-4 grid gap-3">
      <label className="text-[12px] font-semibold">{PAYMENT_COPY.payer}<select value={payer} onChange={(event) => setPayer(event.target.value)} className="mt-1 w-full rounded-control border border-border bg-surface p-2.5">{participantOptions.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label>
      <label className="text-[12px] font-semibold">{PAYMENT_COPY.receiver}<select value={receiver} onChange={(event) => setReceiver(event.target.value)} className="mt-1 w-full rounded-control border border-border bg-surface p-2.5">{participantOptions.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label>
      <label className="text-[12px] font-semibold">{PAYMENT_COPY.amount}<input type="number" min="1" value={amount} onChange={(event) => setAmount(event.target.value)} className="mt-1 w-full rounded-control border border-border bg-surface p-2.5" /></label>
      <label className="text-[12px] font-semibold">{PAYMENT_COPY.date}<input type="date" value={date} onChange={(event) => setDate(event.target.value)} className="mt-1 w-full rounded-control border border-border bg-surface p-2.5" /></label>
      <label className="text-[12px] font-semibold">{PAYMENT_COPY.note}<textarea maxLength={240} value={note} onChange={(event) => setNote(event.target.value)} className="mt-1 w-full rounded-control border border-border bg-surface p-2.5" /></label>
      <button type="button" onClick={() => submit()} className="rounded-control bg-primary py-3 text-[13px] font-bold text-white">{PAYMENT_COPY.title}</button>
      {matchingPaymentIds.length > 0 ? <div className="rounded-control border border-border p-3 text-[12px] text-muted">
        <p>{PAYMENT_COPY.matchingPayments(matchingPaymentIds.length)} {matchingPaymentIds.map((paymentId, index) => <span key={paymentId}>{index > 0 ? ", " : ""}<PaymentDetailLink paymentId={paymentId}>{PAYMENT_COPY.existingPayment}</PaymentDetailLink></span>)}</p>
        <button type="button" onClick={() => submit(matchingPaymentIds)} className="mt-2 rounded-control border border-border px-3 py-2 font-bold text-ink">{PAYMENT_COPY.logAnyway}</button>
      </div> : null}
      {message ? <p className="text-[12px] font-semibold text-muted">{message}</p> : null}
    </div>
  </div>;
}
