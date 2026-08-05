import { C50, GW_UI_COPY, moneyCopy } from "@/lib/gw-copy";
import type { GameweekViewDTO } from "@/lib/gw-view";
import { TableStandard, type TableStandardRow } from "@/components/TableStandard";

export function Standings({
  rows,
  showMoney,
}: {
  rows: GameweekViewDTO["standings"];
  showMoney: boolean;
}) {
  if (!rows.length) return null;
  const columns = [
    { key: "player", label: GW_UI_COPY.name, basis: 178, grow: 1 },
    { key: "points", label: GW_UI_COPY.points, basis: 56, align: "center" as const, numeric: true },
    { key: "exacts", label: GW_UI_COPY.exacts, basis: 58, align: "center" as const, numeric: true },
    ...(showMoney ? [{ key: "net", label: GW_UI_COPY.net, basis: 72, align: "right" as const, numeric: true }] : []),
  ];
  const tableRows: TableStandardRow[] = rows.map((row) => ({
    key: row.userId,
    tone: row.isViewer ? "viewer" : "default",
    cells: [
      <span key="player" className="flex min-w-0 items-center gap-2">
        <span className="w-5 shrink-0 font-mono text-[11px] text-cs2-ink-3 tabular">{row.rank ?? "—"}</span>
        <span className="truncate font-bold">
          {row.name}
          {row.status === "invalid" ? <span className="ml-1 text-[10px] font-semibold text-cs2-red">{C50}</span> : null}
        </span>
      </span>,
      row.points ?? "—",
      row.exacts ?? "—",
      ...(showMoney ? [row.netInr != null ? moneyCopy(row.netInr) : "—"] : []),
    ],
  }));
  return <div className="mt-5"><TableStandard ariaLabel={GW_UI_COPY.currentStanding} columns={columns} rows={tableRows} /></div>;
}
