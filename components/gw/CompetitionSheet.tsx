import Link from "next/link";
import { ARCHIVE_COPY } from "@/lib/payment-copy";
import type { CompetitionSheetDTO } from "@/lib/competition-sheet";

export function CompetitionSheet({ dto }: { dto: CompetitionSheetDTO }) {
  if (!dto.items.length) return null;
  return (
    <details className="relative ml-auto">
      <summary className="cursor-pointer list-none rounded-pill border border-cs2-line bg-cs2-paper px-2.5 py-1 text-[10px] font-bold text-cs2-ink-3">
        {dto.items.find((item) => item.participationStatus === "active")?.name ?? ARCHIVE_COPY.plReturn}
      </summary>
      <div className="absolute right-0 top-9 z-20 w-64 rounded-cs2-md border border-cs2-line bg-cs2-paper p-2 shadow-lg">
        {dto.items.map((item) => item.href ? (
          <Link key={item.competitionId} href={item.href} className="block rounded-cs2-sm px-3 py-2 text-[12px] font-semibold hover:bg-cs2-line-2">
            <span>{item.name}</span>
            {item.participationStatus === "archived" ? <span className="ml-2 text-[9px] font-bold text-cs2-amber">{ARCHIVE_COPY.badge}</span> : null}
          </Link>
        ) : (
          <div key={item.competitionId} className="px-3 py-2 text-[12px] font-semibold text-cs2-ink-3">
            {item.name} <span className="ml-1 text-[9px] font-bold text-cs2-amber">{ARCHIVE_COPY.badge}</span>
          </div>
        ))}
      </div>
    </details>
  );
}
