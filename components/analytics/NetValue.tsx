import { inr } from "@/components/ui";

export function NetValue({ net }: { net: number | "suppressed" | null }) {
  if (net === "suppressed") return <span className="text-cs2-ink-3">···</span>;
  if (net == null) return <span className="text-cs2-ink-3">—</span>;
  return (
    <span className={net < 0 ? "text-cs2-red" : net > 0 ? "text-cs2-green" : "text-cs2-ink-3"}>
      {inr(net)}
    </span>
  );
}
