"use client";

import { useRef, type CSSProperties, type Key, type ReactNode } from "react";

export type TableStandardColumn = {
  key: string;
  label: ReactNode;
  basis: number;
  grow?: number;
  align?: "left" | "center" | "right";
  numeric?: boolean;
};

export type TableStandardRow = {
  key: Key;
  cells: readonly ReactNode[];
  tone?: "default" | "viewer" | "live";
  liveLabel?: string;
};

type RowPaint = {
  backgroundColor: string;
  backgroundImage?: string;
};

function cellAlign(align: TableStandardColumn["align"]): string {
  if (align === "right") return "justify-end text-right";
  if (align === "center") return "justify-center text-center";
  return "justify-start text-left";
}

function rowPaint(tone: TableStandardRow["tone"], index: number): RowPaint {
  const base =
    index % 2 === 0
      ? "var(--color-cs2-paper)"
      : "var(--color-cs2-canvas)";
  const tint =
    tone === "viewer"
      ? "var(--color-cs2-green-soft)"
      : tone === "live"
        ? "var(--color-cs2-live-soft)"
        : null;
  return {
    backgroundColor: base,
    ...(tint
      ? { backgroundImage: `linear-gradient(${tint}, ${tint})` }
      : {}),
  };
}

function Cell({
  column,
  index,
  children,
  header,
  paint,
  last,
  liveLabel,
}: {
  column: TableStandardColumn;
  index: number;
  children: ReactNode;
  header?: boolean;
  paint: RowPaint;
  last: boolean;
  liveLabel?: string;
}) {
  const first = index === 0;
  const style: CSSProperties = {
    flex: `${column.grow ?? 0} 0 ${column.basis}px`,
    ...(first ? paint : {}),
  };
  return (
    <div
      role={header ? "columnheader" : "cell"}
      data-table-cell={index}
      data-table-sticky={first ? "true" : undefined}
      className={`flex min-w-0 shrink-0 items-center ${cellAlign(column.align)} ${
        header
          ? "py-2.5 text-[9px] font-extrabold uppercase tracking-[.1em] text-cs2-ink-3"
          : "py-3 text-[12px] text-cs2-ink-2"
      } ${first ? "sticky left-0 pl-[14px]" : ""} ${last ? "pr-[14px]" : ""} ${
        header ? (first ? "z-[3]" : "") : first ? "z-[1] shadow-[4px_0_8px_rgba(20,23,26,.06)]" : ""
      } ${column.numeric ? "font-mono tabular" : ""}`}
      style={style}
    >
      {children}
      {!header && first && liveLabel ? (
        <span
          data-table-live-indicator
          className="ml-2 inline-flex shrink-0 items-center gap-1 rounded-full border border-cs2-red-line bg-cs2-red-soft px-1.5 py-0.5 font-mono text-[8px] font-bold tracking-[.01em] text-cs2-red"
        >
          <span
            aria-hidden
            className="h-1.5 w-1.5 rounded-full bg-cs2-red shadow-[0_0_0_2px_var(--color-cs2-red-soft)]"
          />
          {liveLabel}
        </span>
      ) : null}
    </div>
  );
}

export function TableStandard({
  ariaLabel,
  columns,
  rows,
  className,
}: {
  ariaLabel: string;
  columns: readonly TableStandardColumn[];
  rows: readonly TableStandardRow[];
  className?: string;
}) {
  const headerScrollRef = useRef<HTMLDivElement>(null);
  const minWidth = columns.reduce((total, column) => total + column.basis, 0);
  if (!columns.length) return null;

  const headerPaint: RowPaint = {
    backgroundColor: "var(--color-cs2-canvas)",
  };

  return (
    <div
      className={`rounded-cs2-lg border border-cs2-line bg-cs2-paper ${className ?? ""}`}
      data-table-standard
    >
      <div role="table" aria-label={ariaLabel}>
        <div
          data-table-sticky-header
          className="sticky top-0 z-[4] bg-cs2-canvas"
        >
          <div
            ref={headerScrollRef}
            className="overflow-x-hidden"
            data-table-header-scroll
          >
            <div
              role="row"
              data-table-header-row
              className="flex min-w-max items-center gap-2 border-b border-cs2-line"
              style={{ minWidth }}
            >
              {columns.map((column, index) => (
                <Cell
                  key={column.key}
                  column={column}
                  index={index}
                  header
                  paint={headerPaint}
                  last={index === columns.length - 1}
                >
                  {column.label}
                </Cell>
              ))}
            </div>
          </div>
        </div>

        <div
          className="overflow-x-auto"
          data-table-scroll
          onScroll={(event) => {
            if (headerScrollRef.current) {
              headerScrollRef.current.scrollLeft = event.currentTarget.scrollLeft;
            }
          }}
        >
          <div className="min-w-max" style={{ minWidth }}>
            {rows.map((row, rowIndex) => {
              const paint = rowPaint(row.tone, rowIndex);
              return (
                <div
                  key={row.key}
                  role="row"
                  data-table-row
                  className={`flex min-w-max items-center gap-2 ${
                    rowIndex < rows.length - 1 ? "border-b border-cs2-line-2" : ""
                  }`}
                  style={paint}
                >
                  {columns.map((column, index) => (
                    <Cell
                      key={column.key}
                      column={column}
                      index={index}
                      paint={paint}
                      last={index === columns.length - 1}
                      liveLabel={row.liveLabel}
                    >
                      {row.cells[index] ?? null}
                    </Cell>
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
