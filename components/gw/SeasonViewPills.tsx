import Link from "next/link";
import { PHASE5_UI_COPY } from "@/lib/payment-copy";

export function SeasonViewPills({ slug, view, gw }: { slug: string; view: "table" | "gameweeks"; gw?: string }) {
  const context = gw && /^\d+$/.test(gw) ? `&gw=${encodeURIComponent(gw)}` : "";
  const href = (next: "table" | "gameweeks") =>
    `/leagues/${slug}/season?view=${next}${context}`;
  return (
    <nav className="mb-4 grid grid-cols-2 rounded-cs2-sm bg-cs2-line-2 p-1" aria-label={PHASE5_UI_COPY.seasonView}>
      {(["table", "gameweeks"] as const).map((item) => (
        <Link
          key={item}
          href={href(item)}
          aria-current={view === item ? "page" : undefined}
          className={`rounded-cs2-sm px-3 py-2 text-center text-[12px] font-bold ${view === item ? "bg-cs2-paper text-cs2-ink" : "text-cs2-ink-3"}`}
        >
          {item === "table" ? PHASE5_UI_COPY.table : PHASE5_UI_COPY.gameweeks}
        </Link>
      ))}
    </nav>
  );
}
