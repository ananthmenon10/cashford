"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { submitPrediction, type MirrorResult } from "@/app/leagues/[slug]/m/[id]/actions";
import { Countdown } from "./LocalTime";
import { defaultCheckedTargets, samePick, type OtherLeague, type PickShape } from "@/lib/cross-league";
import { deriveOutcomeFromScore, predictionConsistencyError, type Outcome } from "@/lib/prediction-validation";

const clampScore = (value: number) => Math.max(0, Math.min(20, value));

type ScoreSide = "home" | "away";

// Slim slice of the match insights the form renders inline (chips + over/under). Null when odds
// aren't available — the form then behaves exactly as before.
export type PredictInsights = {
  oddsAvailable: boolean;
  topScores: { h: number; a: number; p: number }[];
  totalLine: number | null;
  pOver: number | null;
};

export function PredictionForm({
  contestId, slug, isKnockout, homeLabel, awayLabel, homeShort, awayShort, lockIso, stake, initial,
  otherLeagues = [], prefillFrom = null, insights = null,
}: {
  contestId: string; slug: string; isKnockout: boolean;
  homeLabel: string; awayLabel: string; homeShort?: string | null; awayShort?: string | null;
  lockIso: string; stake: number;
  initial?: { outcome: Outcome; predHome: number; predAway: number } | null;
  otherLeagues?: OtherLeague[];
  prefillFrom?: (PickShape & { leagueName: string }) | null;
  insights?: PredictInsights | null;
}) {
  const router = useRouter();
  const [outcome, setOutcome] = useState<Outcome | null>(initial?.outcome ?? null);
  const [h, setH] = useState(initial?.predHome ?? 1);
  const [a, setA] = useState(initial?.predAway ?? 1);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<MirrorResult[] | null>(null);
  const [pending, start] = useTransition();

  // Opt-in overwrite: eligible siblings with no pick (or one matching my pick here) start checked;
  // a different existing pick starts unchecked. Computed once at mount from server data.
  const [applyTo, setApplyTo] = useState<Set<string>>(
    () => new Set(defaultCheckedTargets(otherLeagues, initial ?? null)),
  );

  const homeName = homeShort || homeLabel;
  const awayName = awayShort || awayLabel;
  const opts: { v: Outcome; label: string }[] = isKnockout
    ? [{ v: "home", label: `${homeName} advances` }, { v: "away", label: `${awayName} advances` }]
    : [{ v: "home", label: homeName }, { v: "draw", label: "Draw" }, { v: "away", label: awayName }];

  const labelFor = (o: Outcome) => (o === "home" ? homeShort || "Home" : o === "away" ? awayShort || "Away" : "Draw");
  const pickText = (p: PickShape) => `${labelFor(p.outcome)} ${p.predHome}–${p.predAway}`;
  const livePick: PickShape | null = outcome ? { outcome, predHome: h, predAway: a } : null;
  const resultBy = new Map((results ?? []).map((r) => [r.contestId, r]));
  const showPrefill = prefillFrom && !initial && !outcome; // only when this league has no pick & untouched

  const toggle = (id: string) =>
    setApplyTo((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const chooseOutcome = (next: Outcome) => {
    setError(null);
    setOutcome(next);

    if (!isKnockout) {
      if (next === "home" && h <= a) {
        if (a < 20) setH(a + 1);
        else { setH(20); setA(19); }
      } else if (next === "away" && a <= h) {
        if (h < 20) setA(h + 1);
        else { setH(19); setA(20); }
      } else if (next === "draw") {
        const level = Math.max(h, a);
        setH(level);
        setA(level);
      }
      return;
    }

    // Knockout outcome means selected advancer. A level 90-minute scoreline is valid.
    if (next === "home" && h < a) setH(a);
    if (next === "away" && a < h) setA(h);
  };

  const updateScore = (side: ScoreSide, nextValue: number) => {
    const value = clampScore(nextValue);
    const nextH = side === "home" ? value : h;
    const nextA = side === "away" ? value : a;

    setError(null);
    setH(nextH);
    setA(nextA);

    if (!isKnockout) {
      setOutcome(deriveOutcomeFromScore(nextH, nextA));
      return;
    }

    if (nextH > nextA) setOutcome("home");
    else if (nextA > nextH) setOutcome("away");
    else setOutcome((prev) => (prev === "home" || prev === "away" ? prev : null));
  };

  const usePrefill = () => {
    if (!prefillFrom) return;
    setError(null);
    setOutcome(prefillFrom.outcome);
    setH(prefillFrom.predHome);
    setA(prefillFrom.predAway);
  };

  // Tap a likely-score chip → set the whole pick atomically (one render, no stale-closure double
  // setState). Only offered for non-knockout matches, where the score fully derives the outcome.
  const applyChip = (ch: number, ca: number) => {
    setError(null);
    setH(ch);
    setA(ca);
    setOutcome(deriveOutcomeFromScore(ch, ca));
  };
  const showChips = !isKnockout && !!insights?.oddsAvailable && (insights?.topScores.length ?? 0) > 0;
  const showOverUnder = !!insights?.oddsAvailable && insights?.totalLine != null;
  const leansHigh = (insights?.pOver ?? 0) >= 0.5;

  const submit = () => {
    if (!outcome) { setError("Pick a result first."); return; }
    const consistencyError = predictionConsistencyError({ isKnockout, outcome, predHome: h, predAway: a });
    if (consistencyError) { setError(consistencyError); return; }
    setError(null); setResults(null);
    start(async () => {
      const r = await submitPrediction({ contestId, slug, outcome, predHome: h, predAway: a, alsoTargets: [...applyTo] });
      if (r.error) { setError(r.error); return; }
      const m = r.mirrored ?? [];
      if (m.every((x) => x.ok)) { router.push(`/leagues/${slug}`); return; }
      // Partial success: stay, show per-target result, keep only failed targets checked for retry.
      setResults(m);
      setApplyTo(new Set(m.filter((x) => !x.ok).map((x) => x.contestId)));
    });
  };

  return (
    <div className="rounded-card border border-border bg-surface p-4 shadow-[0_2px_8px_rgba(15,23,42,.04)]">
      <div className="mb-2 text-[11px] font-semibold text-muted">Who wins?</div>

      {showPrefill && (
        <button onClick={usePrefill}
          disabled={pending}
          className="mb-3 flex w-full items-center justify-between gap-2 rounded-control border border-border bg-subtle px-3 py-2 text-left">
          <span className="text-[12px] font-semibold text-label">
            Copy your {prefillFrom!.leagueName} pick: {labelFor(prefillFrom!.outcome)} {prefillFrom!.predHome}–{prefillFrom!.predAway}
          </span>
          <span className="text-[12px] font-bold text-primary">Use</span>
        </button>
      )}

      {/* OutcomeSelector */}
      <div className="mb-4 flex gap-1 rounded-control bg-subtle p-1">
        {opts.map((o) => (
          <button
            key={o.v}
            onClick={() => chooseOutcome(o.v)}
            disabled={pending}
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
        {[{ side: "home" as const, lbl: homeLabel, val: h }, { side: "away" as const, lbl: awayLabel, val: a }].map((s) => (
          <div key={s.side} className="text-center">
            <div className="flex items-center gap-3">
              <button onClick={() => updateScore(s.side, s.val - 1)} disabled={pending} className="h-10 w-10 rounded-control border border-border text-xl font-bold disabled:opacity-50">−</button>
              <span className="w-9 text-center font-mono text-[34px] font-bold tabular">{s.val}</span>
              <button onClick={() => updateScore(s.side, s.val + 1)} disabled={pending} className="h-10 w-10 rounded-control bg-primary text-xl font-bold text-white disabled:opacity-50">+</button>
            </div>
            <div className="mt-2 text-[12px] font-semibold text-muted">{s.lbl}</div>
          </div>
        ))}
      </div>

      {/* Likely-score chips (non-knockout, odds available) — model estimate, tap to fill */}
      {showChips && (
        <div className="mt-4">
          <div className="mb-2 text-[11px] font-semibold text-muted">Or tap a likely score · model estimate</div>
          <div className="flex flex-wrap gap-1.5">
            {insights!.topScores.map((s, i) => {
              const active = s.h === h && s.a === a;
              return (
                <button
                  key={i}
                  type="button"
                  disabled={pending}
                  onClick={() => applyChip(s.h, s.a)}
                  aria-pressed={active}
                  className={`flex items-center gap-1.5 rounded-[10px] border px-2.5 py-1.5 ${
                    active ? "border-[1.5px] border-primary bg-mint" : "border-border bg-surface"
                  }`}
                >
                  {active && <span className="text-[11px] font-bold text-primary-press">✓</span>}
                  <span className={`font-mono text-[13px] font-bold ${active ? "text-primary-press" : "text-fg"}`}>
                    {s.h}–{s.a}
                  </span>
                  <span className={`text-[10px] font-semibold ${active ? "text-primary" : "text-muted"}`}>
                    {Math.round(s.p * 100)}%
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Over/under read — from the de-vigged total */}
      {showOverUnder && (
        <div className="mt-4 flex items-center justify-between rounded-control border border-border bg-subtle px-3 py-2.5">
          <span className="text-[12px] font-semibold text-label">
            Total goals · {leansHigh ? "leans high-scoring" : "leans low-scoring"}
          </span>
          <span
            className={`rounded-pill px-2.5 py-1 font-mono text-[12px] font-bold ${
              leansHigh ? "bg-mint text-primary-press" : "border border-border bg-surface text-label"
            }`}
          >
            {leansHigh ? "Over" : "Under"} {insights!.totalLine}
          </span>
        </div>
      )}

      {/* Also save to (other leagues) */}
      {otherLeagues.length > 0 && (
        <div className="mt-4 border-t border-border pt-3">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted">Also save to</div>
          <div className="flex flex-col gap-1.5">
            {otherLeagues.map((l) => {
              const res = resultBy.get(l.contestId);
              const replaces = l.existingPick && !samePick(l.existingPick, livePick) ? `Replaces ${pickText(l.existingPick)}` : null;
              return (
                <label key={l.contestId}
                  className={`flex items-center gap-2.5 rounded-control border px-3 py-2 ${
                    l.eligible ? "border-border" : "border-dashed border-border opacity-60"} ${l.eligible && !pending ? "cursor-pointer" : ""}`}>
                  <input type="checkbox" className="h-4 w-4 accent-primary"
                    disabled={!l.eligible || pending} checked={applyTo.has(l.contestId)} onChange={() => toggle(l.contestId)} />
                  <span className="flex-1 text-[13px] font-semibold">{l.leagueName}</span>
                  {res ? (
                    <span className={`text-[12px] font-semibold ${res.ok ? "text-win" : "text-loss"}`}>
                      {res.ok ? "✓ Saved" : res.reason === "locked" ? "🔒 Locked" : "Failed"}
                    </span>
                  ) : !l.eligible ? (
                    <span className="text-[12px] text-muted">🔒 Locked</span>
                  ) : replaces ? (
                    <span className="text-[12px] font-medium text-amber-fg">{replaces}</span>
                  ) : !l.existingPick ? (
                    <span className="text-[12px] text-muted">No pick yet</span>
                  ) : null}
                </label>
              );
            })}
          </div>
        </div>
      )}

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

      {results && (
        <div className="mt-3 text-[12px] font-semibold text-label">
          Saved here ✓ — some leagues need another try (see above).
        </div>
      )}

      <button
        onClick={submit}
        disabled={pending}
        className="mt-3 w-full rounded-control bg-primary py-3.5 text-[15px] font-bold text-white shadow-[0_2px_8px_rgba(21,166,106,.3)] disabled:opacity-50"
      >
        {pending ? "Saving…" : results ? "Retry" : initial ? "Update pick" : "Lock in pick"}
      </button>

      {results && (
        <button onClick={() => router.push(`/leagues/${slug}`)} disabled={pending}
          className="mt-2 w-full text-center text-[13px] font-semibold text-muted">
          Done — go to league
        </button>
      )}
    </div>
  );
}
