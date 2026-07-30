import { C5, C5b, GW_UI_COPY } from "@/lib/gw-copy";

export function PotSummary({
  stakeInr,
  potInr,
  entered,
  eligible,
  contestStatus,
  deadlineAt,
  now,
}: {
  stakeInr: number;
  potInr: number;
  entered: number;
  eligible: number;
  contestStatus: string;
  deadlineAt: string;
  now: number;
}) {
  const locked = contestStatus !== "open";
  if (!locked && now >= new Date(deadlineAt).getTime()) return null;

  return (
    <div className="mt-4 grid grid-cols-2 overflow-hidden rounded-cs2-md border border-cs2-line-2 bg-cs2-paper">
      <div className="p-3">
        <div className="text-[10px] font-extrabold uppercase tracking-[.1em] text-cs2-ink-3">
          {GW_UI_COPY.ante}
        </div>
        <div className="mt-1 font-mono text-[16px] font-bold tabular">
          ₹{stakeInr.toLocaleString("en-IN")}
        </div>
      </div>
      <div className="border-l border-cs2-line-2 p-3">
        <div className="text-[10px] font-extrabold uppercase tracking-[.1em] text-cs2-ink-3">
          {GW_UI_COPY.pot}
        </div>
        <div className="mt-1 font-mono text-[13px] font-bold tabular text-cs2-green">
          {locked
            ? C5b(potInr, entered, eligible)
            : C5(potInr, entered, eligible)}
        </div>
      </div>
    </div>
  );
}
