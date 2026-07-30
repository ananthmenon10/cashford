"use client";

import { useState } from "react";
import Link from "next/link";
import {
  C26,
  C60,
  GW_UI_COPY,
  moneyCopy,
} from "@/lib/gw-copy";
import type { SeasonView } from "@/lib/gw-season";

export function SeasonTable({
  slug,
  view,
}: {
  slug: string;
  view: SeasonView;
}) {
  const [pane, setPane] = useState<"history" | "totals">("history");
  return (
    <section>
      <div className="mb-4 grid grid-cols-2 rounded-cs2-sm bg-cs2-line-2 p-1">
        <button
          type="button"
          onClick={() => setPane("history")}
          className={`rounded-cs2-sm px-3 py-2 text-[12px] font-bold ${
            pane === "history" ? "bg-cs2-paper text-cs2-ink" : "text-cs2-ink-3"
          }`}
        >
          {GW_UI_COPY.seasonHistory}
        </button>
        <button
          type="button"
          onClick={() => setPane("totals")}
          className={`rounded-cs2-sm px-3 py-2 text-[12px] font-bold ${
            pane === "totals" ? "bg-cs2-paper text-cs2-ink" : "text-cs2-ink-3"
          }`}
        >
          {GW_UI_COPY.seasonTotals}
        </button>
      </div>

      {pane === "history" ? (
        <div className="space-y-2">
          {view.rows.map((row) => (
            <Link
              key={row.gwNumber}
              href={`/leagues/${slug}?gw=${row.gwNumber}`}
              className="grid grid-cols-[1fr_50px_72px] items-center rounded-cs2-md border border-cs2-line bg-cs2-paper px-4 py-3"
            >
              <div>
                <div className="text-[13px] font-bold">
                  {row.isVoid ? C26(row.gwNumber) : `Gameweek ${row.gwNumber}`}
                </div>
                <div className="mt-0.5 text-[10px] font-semibold uppercase tracking-[.08em] text-cs2-ink-3">
                  {row.status}
                </div>
              </div>
              <span className="text-right font-mono text-[13px] font-bold tabular">
                {row.points ?? "—"}
              </span>
              <span className="text-right font-mono text-[12px] font-bold tabular">
                {row.displayNetInr === "suppressed"
                  ? C60
                  : moneyCopy(row.displayNetInr)}
              </span>
            </Link>
          ))}
        </div>
      ) : (
        <div className="overflow-hidden rounded-cs2-md border border-cs2-line bg-cs2-paper">
          <div className="grid grid-cols-[1fr_44px_44px_66px] border-b border-cs2-line-2 px-3 py-2 text-[9px] font-extrabold uppercase tracking-[.08em] text-cs2-ink-3">
            <span>{GW_UI_COPY.name}</span>
            <span className="text-right">{GW_UI_COPY.points}</span>
            <span className="text-right">{GW_UI_COPY.entered}</span>
            <span className="text-right">{GW_UI_COPY.net}</span>
          </div>
          {view.totals.map((row) => (
            <div
              key={row.userId}
              className={`grid grid-cols-[1fr_44px_44px_66px] items-center border-b border-cs2-line-2 px-3 py-3 text-[12px] last:border-b-0 ${
                row.isViewer ? "bg-cs2-green-soft" : ""
              }`}
            >
              <span className="truncate font-bold">{row.name}</span>
              <span className="text-right font-mono tabular">
                {row.points === "suppressed" ? C60 : row.points}
              </span>
              <span className="text-right font-mono tabular">{row.gameweeksEntered}</span>
              <span className="text-right font-mono font-bold tabular">
                {row.netInr === "suppressed" ? C60 : moneyCopy(row.netInr)}
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
