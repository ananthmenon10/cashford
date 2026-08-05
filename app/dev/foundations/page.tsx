import { LocalTime } from "@/components/LocalTime";
import {
  ENTRY_STATUS_COPY,
  FOUNDATIONS_COPY,
  type EntryStatusKey,
} from "@/lib/gw-copy";
import {
  TableStandard,
  type TableStandardColumn,
  type TableStandardRow,
} from "@/components/TableStandard";

const REFERENCE_NOW = "2026-08-17T10:00:00.000Z";

const DATETIME_CASES = [
  { label: "Today", iso: "2026-08-17T14:00:00.000Z" },
  { label: "Tomorrow", iso: "2026-08-18T14:00:00.000Z" },
  { label: "Past", iso: "2026-08-14T14:00:00.000Z" },
  { label: "Midnight edge", iso: "2026-08-18T00:00:00.000Z" },
] as const;

const TABLE_COLUMNS: readonly TableStandardColumn[] = [
  { key: "player", label: "Player", basis: 178, grow: 1 },
  { key: "points", label: "Pts", basis: 48, align: "center", numeric: true },
  { key: "entered", label: "In", basis: 48, align: "center", numeric: true },
  { key: "net", label: "Net", basis: 64, align: "center", numeric: true },
  { key: "form", label: "Form", basis: 64, align: "center", numeric: true },
  { key: "recent", label: "Last five", basis: 82, align: "center", numeric: true },
];

const TABLE_ROWS: readonly TableStandardRow[] = Array.from({ length: 20 }, (_, index) => ({
  key: `player-${index + 1}`,
  tone: index === 3 ? "viewer" : index === 6 ? "live" : "default",
  liveLabel: index === 6 ? "LIVE 64′" : undefined,
  cells: [
    `Player ${index + 1}`,
    42 - index,
    6 - (index % 3),
    index % 4 === 0 ? "+₹480" : index % 4 === 1 ? "−₹100" : "₹0",
    `${Math.max(1, 12 - (index % 7))}`,
    index % 2 === 0 ? "W W L W W" : "L W W L W",
  ],
}));

const STATUS_ROWS = Object.entries(ENTRY_STATUS_COPY) as [
  EntryStatusKey,
  string,
][];

export default function FoundationsPage() {
  return (
    <main className="min-h-screen bg-cs2-canvas px-4 py-6 text-cs2-ink">
      <div className="mx-auto max-w-[720px] space-y-6">
        <header>
          <p className="text-[10px] font-extrabold uppercase tracking-[.12em] text-cs2-green">
            {FOUNDATIONS_COPY.eyebrow}
          </p>
          <h1 className="mt-1 text-2xl font-extrabold tracking-[-.02em]">
            {FOUNDATIONS_COPY.title}
          </h1>
        </header>

        <section className="rounded-cs2-lg border border-cs2-line bg-cs2-paper p-4">
          <h2 className="text-[15px] font-extrabold">{FOUNDATIONS_COPY.datetime}</h2>
          <p className="mt-1 text-[12px] text-cs2-ink-3">
            {FOUNDATIONS_COPY.datetimeNote}
          </p>
          <div className="mt-4 divide-y divide-cs2-line-2">
            {DATETIME_CASES.map((item) => (
              <div key={item.label} className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0">
                <span className="text-[12px] font-semibold text-cs2-ink-2">{item.label}</span>
                <LocalTime iso={item.iso} now={REFERENCE_NOW} className="text-right font-mono text-[12px]" />
              </div>
            ))}
          </div>
        </section>

        <section>
          <h2 className="mb-1 text-[15px] font-extrabold">{FOUNDATIONS_COPY.table}</h2>
          <p className="mb-3 text-[12px] text-cs2-ink-3">
            {FOUNDATIONS_COPY.tableNote}
          </p>
          <TableStandard ariaLabel={FOUNDATIONS_COPY.tableAriaLabel} columns={TABLE_COLUMNS} rows={TABLE_ROWS} />
        </section>

        <section className="rounded-cs2-lg border border-cs2-line bg-cs2-paper p-4">
          <h2 className="text-[15px] font-extrabold">{FOUNDATIONS_COPY.entryStatus}</h2>
          <div className="mt-3 divide-y divide-cs2-line-2">
            {STATUS_ROWS.map(([key, copy]) => (
              <div key={key} className="flex items-start justify-between gap-4 py-3 first:pt-0 last:pb-0">
                <span className="font-mono text-[10px] text-cs2-ink-3">{key}</span>
                <span className="text-right text-[12px] font-semibold text-cs2-ink-2">{copy}</span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
