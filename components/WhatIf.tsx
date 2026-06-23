"use client";

import { useState } from "react";
import { buildBoard, type PlayerPick } from "@/lib/match-board";
import { RevealGrid, type RevealRow } from "@/components/RevealGrid";
import { inr } from "@/components/ui";

// "What if it ends…" — interactive scoreline simulator (plan 2026-06-23-002, Phase 1).
// Re-runs the PURE buildBoard()→settle() on every tap (≤ a handful of rows → no useMemo needed).
// Imports ONLY buildBoard — never settle() directly, never any server action. No DB writes.

const CHIPS: [number, number][] = [[1, 0], [2, 1], [2, 0], [1, 1], [0, 0], [0, 1], [1, 2]];
const clamp = (v: number) => Math.max(0, Math.min(20, v)); // matches PredictionForm range → any saved pick reproduces

export function WhatIf({
  players, stake, isKnockout, homeShort, awayShort, baseline,
}: {
  players: PlayerPick[];
  stake: number;
  isKnockout: boolean;
  homeShort: string;
  awayShort: string;
  // live → live score; settled → final score + real advancer; locked → null (no baseline to compare)
  baseline: { score: { home: number; away: number }; youNet: number; label: "live" | "final"; advancerOverride?: "home" | "away" } | null;
}) {
  const [h, setH] = useState(baseline?.score.home ?? 0);
  const [a, setA] = useState(baseline?.score.away ?? 0);

  const vm = buildBoard(players, { home: h, away: a }, {
    isKnockout, stake, homeShort, awayShort, advancerOverride: baseline?.advancerOverride,
  });
  const undecided = vm.status === "undecided";

  const outcomeChipCls =
    vm.outcomeShort === "DRAW" ? "bg-subtle text-label"
      : vm.outcomeShort.startsWith(homeShort) ? "bg-mint text-primary-press"
        : "bg-subtle text-away";

  const youWin = !undecided && vm.you != null && vm.you.net > 0;
  const youLose = !undecided && vm.you != null && vm.you.net < 0;
  const youVerb = youWin ? "WIN" : youLose ? "LOSE" : "BREAK EVEN";
  const youCardCls = youWin
    ? "bg-[#0E8455] text-white" // pinned solid green (works light + dark, like the won banner)
    : youLose
      ? "bg-[#FEF2F2] text-[#991B1B] dark:bg-[#ef44441f] dark:text-[#fca5a5]"
      : "bg-subtle text-label";

  const delta = baseline && vm.you ? vm.you.net - baseline.youNet : null;
  const deltaLabel = delta == null ? null : delta === 0 ? "no change" : `${delta > 0 ? "▲" : "▼"} ₹${Math.abs(delta).toLocaleString("en-IN")}`;

  const everyoneRows: RevealRow[] = vm.rows.map((p) => ({
    userId: p.id, name: p.name, isMe: p.isMe, pickLabel: p.pickLabel,
    predHome: p.predHome, predAway: p.predAway, result: p.result, net: p.net, winner: p.net > 0,
  }));

  const Stepper = ({ side, label, value }: { side: "h" | "a"; label: string; value: number }) => {
    const set = side === "h" ? setH : setA;
    return (
      <div className="text-center">
        <div className="flex items-center gap-2.5">
          <button type="button" onClick={() => set(clamp(value - 1))}
            className="h-9 w-9 rounded-control border border-border text-xl font-bold text-fg cf-press">−</button>
          <span className="w-7 text-center font-mono text-[30px] font-bold tabular">{value}</span>
          <button type="button" onClick={() => set(clamp(value + 1))}
            className="h-9 w-9 rounded-control bg-primary text-xl font-bold text-white cf-press">+</button>
        </div>
        <div className="mt-1.5 text-[11px] font-bold text-muted">{label}</div>
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-3">
      <div>
        <div className="text-[17px] font-extrabold tracking-[-.01em]">What if it ends…</div>
        <div className="mt-0.5 text-[12px] text-muted">Set a full-time score and see the pool settle.</div>
      </div>

      <div className="rounded-card border border-border bg-surface p-4 shadow-[0_1px_4px_rgba(15,23,42,.03)]">
        <div className="mb-3.5 flex justify-center gap-[18px]">
          <Stepper side="h" label={homeShort} value={h} />
          <Stepper side="a" label={awayShort} value={a} />
        </div>
        <div className="mb-3 flex justify-center">
          <span className={`inline-flex items-center rounded-pill px-3 py-1 text-[11px] font-extrabold tracking-[.06em] ${outcomeChipCls}`}>
            {vm.outcomeShort}
          </span>
        </div>
        <div className="flex flex-wrap justify-center gap-1.5">
          {CHIPS.map(([ch, ca]) => {
            const on = ch === h && ca === a;
            return (
              <button key={`${ch}-${ca}`} type="button" onClick={() => { setH(ch); setA(ca); }} aria-pressed={on}
                className={`rounded-pill px-2.5 py-1.5 font-mono text-[12px] font-bold tabular cf-press ${
                  on ? "border-[1.5px] border-primary bg-mint text-primary-press" : "border border-border bg-surface text-label"
                }`}>
                {ch}–{ca}
              </button>
            );
          })}
        </div>
      </div>

      {/* Branch explainer — bg/icon chosen by vm.branch, never by the prose string */}
      <div className={`flex items-start gap-2.5 rounded-control border p-3 ${
        vm.branch === "closest-all" || vm.branch === "closest-none" || undecided
          ? "border-[#f1dd9e] bg-amber-bg" : "border-border bg-subtle"
      }`}>
        <span className="mt-0.5 text-[14px] leading-none">{vm.reasonIcon}</span>
        <div className="text-[12px] leading-snug text-label">{vm.reason}</div>
      </div>

      {!undecided && (
        <div className={`flex items-end justify-between rounded-card p-3.5 ${youCardCls}`}>
          <div>
            <div className="text-[11px] font-bold tracking-[.04em] opacity-75">YOU'D {youVerb}</div>
            <div className="mt-0.5 font-mono text-[30px] font-bold leading-tight tabular">
              {youWin || youLose ? inr(vm.you!.net) : "₹0"}
            </div>
          </div>
          {deltaLabel && (
            <div className="text-right">
              <div className="text-[10px] opacity-70">vs {baseline!.label} {baseline!.label === "live" ? inr(baseline!.youNet) : ""}</div>
              <div className="font-mono text-[13px] font-bold tabular">{deltaLabel}</div>
            </div>
          )}
        </div>
      )}

      <div className="mt-1 text-[10px] font-extrabold tracking-[.06em] text-muted">
        EVERYONE · IF IT FINISHES {h}–{a}
      </div>
      <RevealGrid rows={everyoneRows} settled={vm.status === "settled"} />
    </div>
  );
}
