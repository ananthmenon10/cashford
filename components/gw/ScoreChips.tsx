import { chipsForFixture, type ScoreChip } from "@/lib/model-chips";
import type { ScoreProb } from "@/lib/odds-model";

export function ScoreChips({
  topScores,
  onPick,
}: {
  topScores: readonly ScoreProb[];
  onPick?: (chip: ScoreChip) => void;
}) {
  const chips = chipsForFixture(topScores);
  return (
    <div className="flex flex-wrap gap-2">
      {chips.map((chip) => (
        <button
          type="button"
          key={`${chip.home}:${chip.away}`}
          onClick={() => onPick?.(chip)}
          className="rounded-cs2-sm border border-cs2-line bg-cs2-paper px-2.5 py-1 font-mono text-[11px] font-bold tabular"
        >
          {chip.label}
        </button>
      ))}
    </div>
  );
}
