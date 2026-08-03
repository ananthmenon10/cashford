"use client";

// Client controller for /bracket: mode toggle (Live | My Picks), node selection
// (road-to-final highlight), and — in My Picks — the interactive builder: tap a filled
// team to advance it one round (pure promote()), gate on the sibling, re-pick clears
// downstream, complete the bracket to Lock. Picks persist via server actions; the ring
// reads the "effective" map = auto-locked results ∪ the viewer's picks.
//
// Layout: the ring gets the room (full width, bigger flags); the info/action panel is a
// single collapsible drawer under it, minimised by default and auto-opened when a node
// is selected. Colours use the app theme tokens so light + dark both read correctly.

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { KnockoutRing, type BracketMode, type PickState } from "./KnockoutRing";
import {
  RING_LABEL,
  parseKey,
  key,
  at,
  promote,
  autoPicks,
  completeBracket,
  score,
  pathToFinal,
  type SlotKey,
  type Picks,
} from "@/lib/knockout";
import type { KnockoutView } from "@/lib/knockout-data";
import { BRACKET_COPY } from "@/lib/bracket-copy";
import { applyKnockoutPromote, resetKnockoutBracket, lockKnockoutBracket, unlockKnockoutBracket } from "@/app/bracket/actions";
import { KnockoutShare } from "./KnockoutShare";

export function KnockoutCircle({ view, readOnly = false }: { view: KnockoutView; readOnly?: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [mode, setMode] = useState<BracketMode>(readOnly ? "picks" : view.locked ? "picks" : "live");
  const [selected, setSelected] = useState<SlotKey | null>(null);
  const [userPicks, setUserPicks] = useState<Picks>(view.myPicks);
  const [hint, setHint] = useState<SlotKey | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState(false); // info/action drawer starts minimised
  const modeIdx = mode === "live" ? 0 : 1;

  // Re-sync client picks with the server whenever it changes (after router.refresh from
  // reset/edit/lock or a failed write). Without this, useState keeps the mount value, so
  // Reset appeared to do nothing and a stale-full client could show "31/31" while the
  // server bracket was actually incomplete. Keyed on content so optimistic taps aren't
  // clobbered mid-flight (view.myPicks only changes on an actual refresh).
  const serverPicksKey = JSON.stringify(view.myPicks);
  useEffect(() => {
    setUserPicks(view.myPicks);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverPicksKey]);

  // Selecting a node is a request to read its detail — open the drawer to show it.
  useEffect(() => {
    if (selected) setOpen(true);
  }, [selected]);

  const auto = useMemo(() => autoPicks(view.results), [view.results]);
  const effective: Picks = useMemo(() => ({ ...auto, ...userPicks }), [auto, userPicks]);
  const made = useMemo(() => Object.keys(effective).filter((k) => /^[1-5]:/.test(k)).length, [effective]);
  const complete = completeBracket(effective);
  const sc = score(userPicks, view.results);
  const champ = effective["5:0"] ? view.teams[effective["5:0"]] : null;
  // First-run nudge on My Picks: shown until the viewer makes their first prediction.
  const noPicksYet = mode === "picks" && !view.locked && Object.keys(userPicks).length === 0;

  const onPromote = (ring: number, idx: number) => {
    if (readOnly) return;
    if (view.locked) return;
    const team = at(effective, view.field, ring, idx);
    if (!team) return;
    setOpen(true); // tapping a flag reveals the drawer, so the Lock button is discoverable
    const r = promote(effective, view.field, view.results, ring, idx);
    if (r.hint) {
      setHint(r.hint);
      setTimeout(() => setHint((h) => (h === r.hint ? null : h)), 1700);
      return;
    }
    if (r.noop) return;
    const parentSlot = key(ring + 1, Math.floor(idx / 2));
    const clearSlots = pathToFinal(parentSlot).slice(1); // ancestors above the parent
    setHint(null);
    setSelected(null);
    setUserPicks((prev) => {
      const n = { ...prev, [parentSlot]: team };
      for (const c of clearSlots) delete n[c];
      return n;
    });
    setErr(null);
    startTransition(async () => {
      const res = await applyKnockoutPromote({ slotKey: parentSlot, teamId: team, clearSlots });
      if (!res.ok) {
        setErr(res.error);
        router.refresh(); // re-sync from the server on failure
      }
    });
  };

  const onSelectNode = (slot: SlotKey | null) => setSelected(slot);

  const onReset = () => {
    setUserPicks({}); // clear immediately (server delete + refresh re-syncs the baseline)
    setSelected(null);
    setHint(null);
    doAction(resetKnockoutBracket);
  };

  const doAction = (fn: () => Promise<{ ok: boolean; error?: string }>) =>
    startTransition(async () => {
      setErr(null);
      const res = await fn();
      if (!res.ok && res.error) setErr(res.error);
      router.refresh();
    });

  const pickState: PickState = { effective, userPicks, field: view.field, results: view.results, hint, locked: view.locked };

  const seg = (m: BracketMode, label: string, i: number) => (
    <button
      key={m}
      onClick={() => {
        setMode(m);
        setSelected(null);
      }}
      className="relative z-10 flex-1 rounded-[9px] py-2 text-[12.5px] font-extrabold transition-colors"
      style={{ color: modeIdx === i ? "#fff" : "var(--color-muted)" }}
      aria-pressed={modeIdx === i}
    >
      {label}
    </button>
  );

  // The minimised bar summarises the panel it hides, so the ring can own the screen.
  const summary = selected
    ? { label: RING_LABEL[parseKey(selected)[0]], value: selectedName(view, mode, effective, selected), ready: false }
    : mode === "live"
      ? { label: BRACKET_COPY.officialResults, value: `${view.decided}/${view.total} decided`, ready: false }
      : view.locked
        ? { label: BRACKET_COPY.bracketLocked, value: champ?.name ?? "—", ready: false }
        : { label: BRACKET_COPY.yourBracket, value: `${made}/${view.total} built`, ready: complete };

  return (
    <div className="flex flex-col gap-3">
      {!readOnly ? <div className="relative mx-3 flex gap-1 rounded-[11px] p-1" style={{ background: "var(--kc-track)" }}>
        <div
          className="pointer-events-none absolute bottom-1 top-1 rounded-[9px]"
          style={{ left: 4, width: "calc(50% - 6px)", background: "#15A66A", transform: `translateX(${modeIdx * 100}%)`, transition: "transform .2s var(--cf-ease)" }}
        />
        {seg("live", BRACKET_COPY.liveBracket, 0)}
        {seg("picks", BRACKET_COPY.myPicks, 1)}
      </div> : null}

      {!readOnly && noPicksYet && (
        <div
          className="mx-3 flex items-center justify-center gap-1.5 rounded-[10px] px-3 py-2 text-center text-[12px] font-semibold"
          style={{ background: "rgba(21,166,106,.12)", color: "#15A66A" }}
        >
          <span aria-hidden>👆</span> {BRACKET_COPY.firstPickHint}
        </div>
      )}

      {/* The visualization gets maximum room — full width up to a comfortable cap. */}
      <div className="mx-auto w-full px-3" style={{ maxWidth: 460 }}>
        <KnockoutRing view={view} mode={mode} selected={selected} onSelect={onSelectNode} pick={mode === "picks" ? pickState : undefined} onPromote={onPromote} />
      </div>

      {/* Collapsible info / action drawer. */}
      <div className="mx-3 overflow-hidden rounded-[14px] border bg-surface" style={{ borderColor: "var(--color-border)" }}>
        <button
          onClick={() => setOpen((o) => !o)}
          className="flex w-full items-center gap-2 px-4 py-2.5 text-left"
          aria-expanded={open}
        >
          <span className="shrink-0 font-mono text-[10px] font-bold uppercase tracking-[.08em] text-muted">{summary.label}</span>
          <span className="min-w-0 flex-1 truncate text-[12.5px] font-bold text-fg">{summary.value}</span>
          {summary.ready && !open && (
            <span className="shrink-0 rounded-full px-2 py-0.5 text-[9.5px] font-extrabold" style={{ background: "rgba(21,166,106,.18)", color: "#22C55E" }}>
              {BRACKET_COPY.ready}
            </span>
          )}
          <Chevron open={open} />
        </button>

        {open && (
          <div className="border-t px-4 pb-4 pt-3.5" style={{ borderColor: "var(--color-border)" }}>
            {selected ? (
              <SelectedDetail view={view} mode={mode} slot={selected} effective={effective} userPicks={userPicks} />
            ) : mode === "live" ? (
              <LivePanel view={view} />
            ) : readOnly ? (
              <div className="text-[11px] text-muted">{view.decided}/{view.total}</div>
            ) : view.locked ? (
              <LockedPanel view={view} score={sc} effective={effective} pending={pending} onEdit={() => doAction(unlockKnockoutBracket)} />
            ) : (
              <BuildPanel made={made} total={view.total} hint={hint} complete={complete} pending={pending} err={err} onReset={onReset} onLock={() => doAction(lockKnockoutBracket)} />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// Team name for a given slot (mirrors SelectedDetail's resolution) — used on the minimised bar.
function selectedName(view: KnockoutView, mode: BracketMode, effective: Picks, slot: SlotKey): string {
  const sv = view.slots.find((s) => s.slot === slot);
  const teamId = mode === "picks" ? effective[slot] : sv?.team?.id ?? null;
  return teamId ? view.teams[teamId]?.name ?? "To be decided" : "To be decided";
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-muted" style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform .2s var(--cf-ease)" }} aria-hidden="true">
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

function LivePanel({ view }: { view: KnockoutView }) {
  return (
    <div>
      <div className="flex items-baseline gap-2">
        <span className="font-mono text-[26px] font-extrabold text-fg">{view.decided} / {view.total}</span>
        <span className="text-[12px] font-bold text-muted">{BRACKET_COPY.matchesDecided}</span>
      </div>
      <div className="mt-2 text-[11px] leading-[1.45] text-muted">
        {BRACKET_COPY.livePanelNote}
      </div>
    </div>
  );
}

function BuildPanel({ made, total, hint, complete, pending, err, onReset, onLock }: { made: number; total: number; hint: SlotKey | null; complete: boolean; pending: boolean; err: string | null; onReset: () => void; onLock: () => void }) {
  const pct = Math.round((made / total) * 100);
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <div className="font-mono text-[11px] font-bold tracking-[.08em] text-muted">{BRACKET_COPY.buildYourBracket}</div>
        <span className="font-mono text-[12px] font-extrabold text-fg">{made}/{total}</span>
      </div>
      <div className="my-2 h-1.5 overflow-hidden rounded-full" style={{ background: "var(--kc-track)" }}>
        <div style={{ height: "100%", width: `${pct}%`, background: "linear-gradient(90deg,#15A66A,#22C55E)", transition: "width .3s" }} />
      </div>
      <div className="mb-2 text-[11px] leading-[1.4]" style={{ color: hint ? "#F2C94C" : "var(--color-muted)", minHeight: 30 }}>
        {hint ? BRACKET_COPY.otherMatchFirst : BRACKET_COPY.promoteTeam}
      </div>
      <div className="mb-2.5 flex flex-wrap gap-3 text-[10px] text-muted">
        <Legend color="#F2C94C" label={BRACKET_COPY.yourPick} />
        <Legend color="var(--kc-result-stroke)" label={BRACKET_COPY.resultLockedIn} />
        <Legend color="#F2C94C" dashed label={BRACKET_COPY.pickNext} />
      </div>
      {err && <div className="mb-2 text-[11px] font-semibold" style={{ color: "#EF4444" }}>{err}</div>}
      <div className="flex gap-2">
        <button onClick={onReset} disabled={pending} className="rounded-[9px] border px-3.5 py-2.5 text-[12px] font-bold text-muted" style={{ borderColor: "var(--color-border)" }}>{BRACKET_COPY.reset}</button>
        <button
          onClick={onLock}
          disabled={pending || !complete}
          className="flex-1 rounded-[9px] py-2.5 text-[13px] font-extrabold"
          style={{ background: complete ? "#15A66A" : "var(--kc-track)", color: complete ? "#fff" : "var(--color-muted)", boxShadow: complete ? "0 4px 14px rgba(21,166,106,.4)" : "none" }}
        >
          {complete ? BRACKET_COPY.lockIn : BRACKET_COPY.completeToLock}
        </button>
      </div>
    </div>
  );
}

function LockedPanel({ view, score, effective, pending, onEdit }: { view: KnockoutView; score: { correct: number; decided: number }; effective: Picks; pending: boolean; onEdit: () => void }) {
  const champId = effective["5:0"];
  const champ = champId ? view.teams[champId] : null;
  return (
    <div>
      <div className="font-mono text-[11px] font-bold tracking-[.08em] text-muted">{BRACKET_COPY.bracketLockedHeading}</div>
      <div className="my-2.5 flex items-center gap-2.5">
        <span className="grid h-9 w-9 place-items-center rounded-full font-mono text-[12px] font-extrabold text-white" style={{ background: champ ? "#15A66A" : "var(--kc-track)", boxShadow: "0 0 0 2px rgba(242,201,76,.5)" }}>{champ?.code ?? "?"}</span>
        <div>
          <div className="font-mono text-[9px] font-bold tracking-[.14em]" style={{ color: "#F2C94C" }}>{BRACKET_COPY.yourChampion}</div>
          <div className="text-[16px] font-extrabold text-fg">{champ?.name ?? "—"}</div>
        </div>
        <span className="ml-auto text-[20px]">🏆</span>
      </div>
      <div className="mb-3 text-[10.5px] leading-[1.4] text-muted">
        {score.decided > 0 ? BRACKET_COPY.scoreSoFar(score.correct, score.decided) : BRACKET_COPY.noPredictedMatches} · {BRACKET_COPY.scoreLive}
      </div>
      <button onClick={onEdit} disabled={pending} className="rounded-[9px] border px-3.5 py-2.5 text-[12px] font-bold text-muted" style={{ borderColor: "var(--color-border)" }}>{BRACKET_COPY.edit}</button>
      {view.shareToken && <KnockoutShare shareToken={view.shareToken} championName={champ?.name ?? ""} accuracy={score.decided > 0 ? `${score.correct}/${score.decided} correct` : ""} />}
    </div>
  );
}

function Legend({ color, dashed, label }: { color: string; dashed?: boolean; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ border: `2px ${dashed ? "dashed" : "solid"} ${color}`, boxSizing: "border-box" }} />
      {label}
    </span>
  );
}

function SelectedDetail({ view, mode, slot, effective, userPicks }: { view: KnockoutView; mode: BracketMode; slot: SlotKey; effective: Picks; userPicks: Picks }) {
  const [ring] = parseKey(slot);
  const sv = view.slots.find((s) => s.slot === slot);
  const resultId = view.results[slot] ?? null;
  const teamId = mode === "picks" ? effective[slot] : sv?.team?.id ?? null;
  const team = teamId ? view.teams[teamId] : null;

  let status: string = BRACKET_COPY.awaitingResult;
  let scol = "var(--color-muted)";
  if (ring === 0) status = BRACKET_COPY.inTheDraw;
  else if (mode === "picks") {
    if (resultId) {
      const ok = userPicks[slot] ? userPicks[slot] === resultId : null;
      status = ok == null ? BRACKET_COPY.resultIn : ok ? BRACKET_COPY.pickAdvanced : BRACKET_COPY.knockedOut;
      scol = ok == null ? "var(--color-muted)" : ok ? "#16A34A" : "#EF4444";
    } else if (userPicks[slot]) status = BRACKET_COPY.pickStillAlive;
    else status = BRACKET_COPY.pickThisNext;
  } else status = sv?.finished ? BRACKET_COPY.advanced : BRACKET_COPY.awaitingResult;

  return (
    <div>
      <div className="font-mono text-[10px] font-bold uppercase tracking-[.1em] text-muted">{RING_LABEL[ring]}</div>
      <div className="mt-2 flex items-center gap-2.5">
        <span className="grid h-8 w-8 place-items-center rounded-full font-mono text-[11px] font-extrabold text-white" style={{ background: team ? "#15A66A" : "var(--kc-track)" }}>{team?.code ?? "?"}</span>
        <div>
        <div className="text-[15px] font-extrabold text-fg">{team?.name ?? BRACKET_COPY.toBeDecided}</div>
          <div className="mt-0.5 text-[11.5px] font-bold" style={{ color: scol }}>{status}</div>
        </div>
      </div>
      <div className="mt-2.5 text-[10.5px] text-muted">{ring < 5 ? BRACKET_COPY.highlightedRoad : BRACKET_COPY.championCup}</div>
    </div>
  );
}
