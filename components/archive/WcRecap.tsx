import type { WcArchiveStanding } from "@/lib/wc-archive";
import { PHASE5_UI_COPY } from "@/lib/payment-copy";

export function WcRecap({ row }: { row: WcArchiveStanding | null }) {
  return row ? <section className="mt-4 rounded-card border border-border bg-surface p-4 text-[13px]"><h2 className="font-extrabold">{PHASE5_UI_COPY.yourWorldCup}</h2><p className="mt-2">{PHASE5_UI_COPY.finish(row.finish, row.correct, row.exact)}</p><p className="mt-1 font-mono font-bold">{PHASE5_UI_COPY.netRupees}{(row.netInr ?? 0).toLocaleString("en-IN")}</p></section> : null;
}
