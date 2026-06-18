import { Avatar, inr } from "./ui";

export interface RevealRow {
  userId: string;
  name: string;
  isMe: boolean;
  pickLabel: string; // e.g. "ESP" / "Draw" / "GER"
  predHome: number;
  predAway: number;
  result?: "win" | "loss" | "push" | "not_entered" | "void" | null;
  net?: number | null;
  winner?: boolean; // highlight row
}

export function RevealGrid({ rows, settled }: { rows: RevealRow[]; settled: boolean }) {
  return (
    <div className="rounded-card border border-border bg-surface p-2 shadow-[0_2px_8px_rgba(15,23,42,.04)]">
      {rows.map((r) => (
        <div
          key={r.userId}
          className={`flex items-center gap-2.5 rounded-control px-2.5 py-2.5 ${r.winner ? "bg-mint" : ""}`}
        >
          <Avatar label={r.name} size={28} />
          <span className={`text-[14px] ${r.isMe ? "font-bold" : "font-semibold"}`}>{r.name}</span>
          {r.isMe && <span className="rounded-pill bg-white px-1.5 py-0.5 text-[10px] font-bold text-primary-press">YOU</span>}
          <span className="ml-auto rounded-pill bg-subtle px-2 py-1 text-[11px] font-bold text-label">{r.pickLabel}</span>
          <span className="w-9 text-center font-mono text-[13px] font-bold tabular">{r.predHome}–{r.predAway}</span>
          {settled && (
            <span
              className={`w-12 text-right font-mono text-[13px] font-bold tabular ${
                r.result === "win" ? "text-win" : r.result === "loss" ? "text-loss" : "text-push"
              }`}
            >
              {r.result === "not_entered" ? "—" : r.result === "push" || r.result === "void" ? "push" : inr(r.net ?? 0)}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
