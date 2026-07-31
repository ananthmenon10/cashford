import { C60, correctionCopy, type SettleCause } from "@/lib/gw-copy";

export function RecalculatingNote({ cause }: { cause?: SettleCause }) {
  const detail = correctionCopy(cause ?? null);
  return (
    <div className="rounded-cs2-md border border-cs2-amber-line bg-cs2-amber-soft p-4 text-cs2-amber">
      <p className="text-[13px] font-bold">{C60}</p>
      {detail ? <p className="mt-1 text-[12px]">{detail}</p> : null}
    </div>
  );
}
