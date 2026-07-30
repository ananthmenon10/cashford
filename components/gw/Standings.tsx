import { C50, GW_UI_COPY, moneyCopy } from "@/lib/gw-copy";
import type { GameweekViewDTO } from "@/lib/gw-view";

export function Standings({
  rows,
  showMoney,
}: {
  rows: GameweekViewDTO["standings"];
  showMoney: boolean;
}) {
  if (!rows.length) return null;
  return (
    <div className="mt-5 overflow-hidden rounded-cs2-md border border-cs2-line bg-cs2-paper">
      <div className="grid grid-cols-[34px_1fr_56px_58px_72px] border-b border-cs2-line-2 px-3 py-2 text-[10px] font-extrabold uppercase tracking-[.08em] text-cs2-ink-3">
        <span>{GW_UI_COPY.rank}</span>
        <span>{GW_UI_COPY.name}</span>
        <span className="text-right">{GW_UI_COPY.points}</span>
        <span className="text-right">{GW_UI_COPY.exacts}</span>
        <span className="text-right">{showMoney ? GW_UI_COPY.net : null}</span>
      </div>
      {rows.map((row) => (
        <div
          key={row.userId}
          className={`grid grid-cols-[34px_1fr_56px_58px_72px] items-center border-b border-cs2-line-2 px-3 py-3 text-[13px] last:border-b-0 ${
            row.isViewer ? "bg-cs2-green-soft" : ""
          }`}
        >
          <span className="font-mono text-cs2-ink-3 tabular">{row.rank ?? "—"}</span>
          <span className="truncate font-bold">
            {row.name}
            {row.status === "invalid" ? (
              <span className="ml-1 text-[10px] font-semibold text-cs2-red">{C50}</span>
            ) : null}
          </span>
          <span className="text-right font-mono font-bold tabular">{row.points ?? "—"}</span>
          <span className="text-right font-mono tabular">{row.exacts ?? "—"}</span>
          <span className="text-right font-mono font-bold tabular">
            {showMoney && row.netInr != null ? moneyCopy(row.netInr) : null}
          </span>
        </div>
      ))}
    </div>
  );
}
