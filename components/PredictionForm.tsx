"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { submitPrediction } from "@/app/leagues/[slug]/m/[id]/actions";
import { Countdown } from "./LocalTime";

type Outcome = "home" | "draw" | "away";

export function PredictionForm({
  contestId, slug, isKnockout, homeLabel, awayLabel, homeShort, awayShort, lockIso, stake, initial,
}: {
  contestId: string; slug: string; isKnockout: boolean;
  homeLabel: string; awayLabel: string; homeShort?: string | null; awayShort?: string | null;
  lockIso: string; stake: number;
  initial?: { outcome: Outcome; predHome: number; predAway: number } | null;
}) {
  const router = useRouter();
  const [outcome, setOutcome] = useState<Outcome | null>(initial?.outcome ?? null);
  const [h, setH] = useState(initial?.predHome ?? 1);
  const [a, setA] = useState(initial?.predAway ?? 1);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const opts: { v: Outcome; label: string }[] = isKnockout
    ? [{ v: "home", label: homeShort || homeLabel }, { v: "away", label: awayShort || awayLabel }]
    : [{ v: "home", label: homeShort || homeLabel }, { v: "draw", label: "Draw" }, { v: "away", label: awayShort || awayLabel }];

  const submit = () => {
    if (!outcome) { setError("Pick a result first."); return; }
    setError(null);
    start(async () => {
      const r = await submitPrediction({ contestId, slug, outcome, predHome: h, predAway: a });
      if (r.error) setError(r.error);
      else router.push(`/leagues/${slug}`);
    });
  };

  return (
    <div className="rounded-card border border-border bg-surface p-4 shadow-[0_2px_8px_rgba(15,23,42,.04)]">
      <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted">Your prediction</div>

      {/* OutcomeSelector */}
      <div className="mb-4 flex gap-1 rounded-control bg-subtle p-1">
        {opts.map((o) => (
          <button
            key={o.v}
            onClick={() => setOutcome(o.v)}
            className={`flex-1 rounded-[9px] py-2.5 text-[14px] font-bold ${
              outcome === o.v ? "bg-primary text-white shadow-[0_1px_4px_rgba(21,166,106,.3)]" : "text-muted"
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>

      {/* ScoreStepper */}
      <div className="flex justify-center gap-6">
        {[{ lbl: homeLabel, val: h, set: setH }, { lbl: awayLabel, val: a, set: setA }].map((s, i) => (
          <div key={i} className="text-center">
            <div className="flex items-center gap-3">
              <button onClick={() => s.set(Math.max(0, s.val - 1))} className="h-10 w-10 rounded-control border border-border text-xl font-bold">−</button>
              <span className="w-9 text-center font-mono text-[34px] font-bold tabular">{s.val}</span>
              <button onClick={() => s.set(Math.min(20, s.val + 1))} className="h-10 w-10 rounded-control bg-primary text-xl font-bold text-white">+</button>
            </div>
            <div className="mt-2 text-[12px] font-semibold text-muted">{s.lbl}</div>
          </div>
        ))}
      </div>

      <div className="mt-4 flex items-center justify-between">
        <span className="rounded-pill bg-subtle px-3 py-1.5 text-[12px] font-semibold text-label">
          Stake <span className="font-mono text-fg">₹{stake}</span>
        </span>
        <span className="rounded-pill bg-amber-bg px-3 py-1.5 font-mono text-[12px] font-semibold text-amber-fg">
          <Countdown iso={lockIso} />
        </span>
      </div>

      {error && (
        <div className="mt-3 flex items-center gap-1.5 text-xs font-semibold text-loss">
          <span className="flex h-3.5 w-3.5 items-center justify-center rounded-full bg-loss text-[10px] font-extrabold text-white">!</span>
          {error}
        </div>
      )}

      <button
        onClick={submit}
        disabled={pending}
        className="mt-3 w-full rounded-control bg-primary py-3.5 text-[15px] font-bold text-white shadow-[0_2px_8px_rgba(21,166,106,.3)] disabled:opacity-50"
      >
        {pending ? "Saving…" : initial ? "Update pick" : "Lock in pick"}
      </button>
    </div>
  );
}
