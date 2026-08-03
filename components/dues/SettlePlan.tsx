import Link from "next/link";
import { DUES_COPY } from "@/lib/payment-copy";
import type { Transfer } from "@/lib/settlement";
import { PAYMENT_COPY, PHASE5_UI_COPY } from "@/lib/payment-copy";

export function SettlePlan({ plan, names, slug, viewerId }: { plan: readonly Transfer[]; names: ReadonlyMap<string, string>; slug: string; viewerId: string }) {
  if (!plan.length) return null;
  return <section className="mt-5"><h2 className="text-[12px] font-semibold uppercase tracking-wide text-muted">{DUES_COPY.settleUp}</h2><p className="mt-1 text-[12px] text-muted">{DUES_COPY.planCount(plan.length)}</p><div className="mt-2 flex flex-col gap-2">{plan.map((row) => (
    <div key={`${row.from}-${row.to}`} className="rounded-card bg-[#FEF2F2] px-4 py-3 dark:bg-[#ef44441f]"><div className="flex items-center justify-between"><span className="text-[13px] font-semibold">{PHASE5_UI_COPY.arrow(names.get(row.from) ?? PHASE5_UI_COPY.player, names.get(row.to) ?? PHASE5_UI_COPY.player)}</span><span className="font-mono text-[14px] font-bold tabular text-loss">₹{row.amount.toLocaleString("en-IN")}</span></div>{row.to === viewerId ? <Link href={`/leagues/${slug}/dues/log?payer=${encodeURIComponent(row.from)}&receiver=${encodeURIComponent(row.to)}&amount=${row.amount}`} className="mt-2 block rounded-control border border-border bg-surface px-3 py-2 text-center text-[12px] font-bold">{PAYMENT_COPY.creditorShortcut(row.amount, names.get(row.from) ?? PHASE5_UI_COPY.player)}</Link> : null}</div>
  ))}</div><p className="mt-2 text-[11px] text-muted">{DUES_COPY.planNote}</p></section>;
}
