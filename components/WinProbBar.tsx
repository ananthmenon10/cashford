// 1X2 win-probability hero (Predict tab). Server-safe, pure display. Colour is decoration only —
// every value is also labelled in text (team code + %), never colour-only encoding.
// Home = primary green · Draw = grey · Away = blue (tokens --color-draw / --color-away).
export function WinProbBar({
  probs,
  homeShort,
  awayShort,
}: {
  probs: { home: number; draw: number; away: number };
  homeShort: string;
  awayShort: string;
}) {
  const pct = (n: number) => Math.round(n * 100);
  return (
    <div className="rounded-card border border-border bg-surface p-4 shadow-[0_2px_8px_rgba(15,23,42,.04)]">
      <div className="mb-3 text-[11px] font-bold uppercase tracking-[.04em] text-muted">Win probability</div>
      <div
        className="mb-3 flex h-3.5 gap-[3px] overflow-hidden rounded-pill"
        role="img"
        aria-label={`Win probability — ${homeShort} ${pct(probs.home)} percent, Draw ${pct(probs.draw)} percent, ${awayShort} ${pct(probs.away)} percent`}
      >
        <div className="bg-primary" style={{ flex: `0 0 ${pct(probs.home)}%` }} />
        <div className="bg-draw" style={{ flex: `0 0 ${pct(probs.draw)}%` }} />
        <div className="flex-1 bg-away" />
      </div>
      <div className="flex items-start justify-between">
        <ProbCol dot="bg-primary" code={homeShort} pct={pct(probs.home)} align="items-start" />
        <ProbCol dot="bg-draw" code="Draw" pct={pct(probs.draw)} align="items-center" />
        <ProbCol dot="bg-away" code={awayShort} pct={pct(probs.away)} align="items-end" />
      </div>
    </div>
  );
}

function ProbCol({ dot, code, pct, align }: { dot: string; code: string; pct: number; align: string }) {
  return (
    <div className={`flex flex-col gap-1 ${align}`}>
      <div className="flex items-center gap-1.5">
        <span className={`h-2 w-2 rounded-full ${dot}`} />
        <span className="text-[12px] font-semibold text-label">{code}</span>
      </div>
      <span className="font-mono text-[18px] font-bold">{pct}%</span>
    </div>
  );
}
