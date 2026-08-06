import type { WcArchiveStanding } from "@/lib/wc-archive";
import { wcNetLabel } from "@/lib/wc-archive";
import { ARCHIVE_COPY, PHASE5_UI_COPY } from "@/lib/payment-copy";

export function WcFinalStandings({
  rows,
  lateMembers,
}: {
  rows: readonly WcArchiveStanding[];
  lateMembers?: readonly { userId: string; name: string }[];
}) {
  return (
    <section className="mt-5 rounded-card border border-border bg-surface p-4">
      <h2 className="text-lg font-extrabold">{ARCHIVE_COPY.standings}</h2>
      <div className="mt-3 grid grid-cols-[1fr_42px_42px_64px] border-b border-border pb-2 text-[10px] font-bold text-muted">
        <span>{PHASE5_UI_COPY.player}</span>
        <span className="text-right">{PHASE5_UI_COPY.correct}</span>
        <span className="text-right">{PHASE5_UI_COPY.exact}</span>
        <span className="text-right">{PHASE5_UI_COPY.netRupees}</span>
      </div>
      {rows.map((row) => (
        <div key={row.userId} className="grid grid-cols-[1fr_42px_42px_64px] border-b border-border py-2.5 text-[12px] last:border-0">
          <span className="font-semibold">
            {row.name}
            {row.isPastMember ? <small className="ml-1 text-[10px] font-normal text-muted">{PHASE5_UI_COPY.pastMember}</small> : null}
            {row.unavailable ? <small className="ml-1 block text-[10px] font-normal text-muted">{ARCHIVE_COPY.resultUnavailable}</small> : null}
          </span>
          <span className="text-right">{row.correct}</span>
          <span className="text-right">{row.exact}</span>
          <span className="text-right font-mono font-bold">{row.unavailable ? "—" : wcNetLabel(row.netInr)}</span>
        </div>
      ))}
      {(lateMembers ?? []).map((member) => (
        <div key={member.userId} className="grid grid-cols-[1fr_42px_42px_64px] border-b border-border py-2.5 text-[12px] last:border-0">
          <span className="font-semibold">
            {member.name}
            <small className="ml-1 block text-[10px] font-normal text-muted">{ARCHIVE_COPY.lateMember}</small>
          </span>
          <span className="text-right">—</span>
          <span className="text-right">—</span>
          <span className="text-right font-mono font-bold">—</span>
        </div>
      ))}
    </section>
  );
}
