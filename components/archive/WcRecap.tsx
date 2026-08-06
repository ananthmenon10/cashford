import type { WcArchiveStanding } from "@/lib/wc-archive";
import { wcNetLine } from "@/lib/wc-archive";
import { ARCHIVE_COPY, PHASE5_UI_COPY } from "@/lib/payment-copy";

export function WcRecap({
  row,
  mineIsLate,
}: {
  row: WcArchiveStanding | null;
  mineIsLate?: boolean;
}) {
  if (mineIsLate) {
    return (
      <section className="mt-4 rounded-card border border-border bg-surface p-4 text-[13px]">
        <h2 className="font-extrabold">{PHASE5_UI_COPY.yourWorldCup}</h2>
        <p className="mt-2 text-muted">{ARCHIVE_COPY.lateMember}</p>
      </section>
    );
  }
  if (!row) return null;
  if (row.entriesCount === 0) {
    return (
      <section className="mt-4 rounded-card border border-border bg-surface p-4 text-[13px]">
        <h2 className="font-extrabold">{PHASE5_UI_COPY.yourWorldCup}</h2>
        <p className="mt-2 text-muted">{ARCHIVE_COPY.noEntries}</p>
      </section>
    );
  }
  return (
    <section className="mt-4 rounded-card border border-border bg-surface p-4 text-[13px]">
      <h2 className="font-extrabold">{PHASE5_UI_COPY.yourWorldCup}</h2>
      <p className="mt-2">{PHASE5_UI_COPY.finish(row.finish, row.correct, row.exact)}</p>
      <p className="mt-1 font-mono font-bold">{wcNetLine(row.unavailable ? null : row.netInr)}</p>
    </section>
  );
}
