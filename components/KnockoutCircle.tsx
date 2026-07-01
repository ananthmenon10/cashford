"use client";

// Client controller for /bracket: mode toggle (Live | My Picks), node selection
// (road-to-final highlight), and — in My Picks — the interactive builder: tap a filled
// team to advance it one round (pure promote()), gate on the sibling, re-pick clears
// downstream, complete the bracket to Lock. Picks persist via server actions; the ring
// reads the "effective" map = auto-locked results ∪ the viewer's picks.

import { useMemo, useState, useTransition } from "react";
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
  GEO,
  type SlotKey,
  type Picks,
} from "@/lib/knockout";
import type { KnockoutView } from "@/lib/knockout-data";
import { applyKnockoutPromote, resetKnockoutBracket, lockKnockoutBracket, unlockKnockoutBracket } from "@/app/bracket/actions";

const MUT = "#7a8794";
const TXT = "#E7ECEF";

export function KnockoutCircle({ view }: { view: KnockoutView }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [mode, setMode] = useState<BracketMode>(view.locked ? "picks" : "live");
  const [selected, setSelected] = useState<SlotKey | null>(null);
  const [userPicks, setUserPicks] = useState<Picks>(view.myPicks);
  const [hint, setHint] = useState<SlotKey | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const modeIdx = mode === "live" ? 0 : 1;

  const auto = useMemo(() => autoPicks(view.results), [view.results]);
  const effective: Picks = useMemo(() => ({ ...auto, ...userPicks }), [auto, userPicks]);
  const made = useMemo(() => Object.keys(effective).filter((k) => /^[1-5]:/.test(k)).length, [effective]);
  const complete = completeBracket(effective);
  const sc = score(userPicks, view.results);

  const onPromote = (ring: number, idx: number) => {
    if (view.locked) return;
    const team = at(effective, view.field, ring, idx);
    if (!team) return;
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
      style={{ color: modeIdx === i ? "#fff" : MUT }}
      aria-pressed={modeIdx === i}
    >
      {label}
    </button>
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="relative mx-3.5 flex gap-1 rounded-[11px] p-1" style={{ background: "rgba(255,255,255,.05)" }}>
        <div
          className="pointer-events-none absolute bottom-1 top-1 rounded-[9px]"
          style={{ left: 4, width: "calc(50% - 6px)", background: "#15A66A", transform: `translateX(${modeIdx * 100}%)`, transition: "transform .2s var(--cf-ease)" }}
        />
        {seg("live", "Live Bracket", 0)}
        {seg("picks", "My Picks", 1)}
      </div>

      <div className="mx-auto" style={{ width: 298, maxWidth: "100%" }}>
        <KnockoutRing view={view} mode={mode} selected={selected} onSelect={onSelectNode} pick={mode === "picks" ? pickState : undefined} onPromote={onPromote} />
      </div>

      <div className="mx-3.5 rounded-[14px] border p-4" style={{ background: "#11161D", borderColor: "rgba(255,255,255,.08)", minHeight: 96 }}>
        {selected ? (
          <SelectedDetail view={view} mode={mode} slot={selected} effective={effective} userPicks={userPicks} />
        ) : mode === "live" ? (
          <LivePanel view={view} />
        ) : view.locked ? (
          <LockedPanel view={view} score={sc} effective={effective} pending={pending} onEdit={() => doAction(unlockKnockoutBracket)} />
        ) : (
          <BuildPanel made={made} total={view.total} hint={hint} complete={complete} pending={pending} err={err} onReset={() => doAction(resetKnockoutBracket)} onLock={() => doAction(lockKnockoutBracket)} />
        )}
      </div>
    </div>
  );
}

function LivePanel({ view }: { view: KnockoutView }) {
  return (
    <div>
      <div className="font-mono text-[11px] font-bold tracking-[.08em]" style={{ color: MUT }}>OFFICIAL RESULTS</div>
      <div className="mt-1.5 flex items-baseline gap-2">
        <span className="font-mono text-[26px] font-extrabold" style={{ color: TXT }}>{view.decided} / {view.total}</span>
        <span className="text-[12px] font-bold" style={{ color: MUT }}>matches decided</span>
      </div>
      <div className="mt-2 text-[11px] leading-[1.45]" style={{ color: MUT }}>
        The board fills in only when a match is final — no live scores, no clutter. Tap any team to trace its road to the final.
      </div>
    </div>
  );
}

function BuildPanel({ made, total, hint, complete, pending, err, onReset, onLock }: { made: number; total: number; hint: SlotKey | null; complete: boolean; pending: boolean; err: string | null; onReset: () => void; onLock: () => void }) {
  const pct = Math.round((made / total) * 100);
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <div className="font-mono text-[11px] font-bold tracking-[.08em]" style={{ color: MUT }}>BUILD YOUR BRACKET</div>
        <span className="font-mono text-[12px] font-extrabold" style={{ color: TXT }}>{made}/{total}</span>
      </div>
      <div className="my-2 h-1.5 overflow-hidden rounded-full" style={{ background: "rgba(255,255,255,.08)" }}>
        <div style={{ height: "100%", width: `${pct}%`, background: "linear-gradient(90deg,#15A66A,#22C55E)", transition: "width .3s" }} />
      </div>
      <div className="mb-2 text-[11px] leading-[1.4]" style={{ color: hint ? "#F2C94C" : MUT, minHeight: 30 }}>
        {hint ? "Decide the other match first — that empty slot needs a winner before this round opens." : "Tap a team to send it through. Each tap promotes it one round. Finished games are locked in for you."}
      </div>
      <div className="mb-2.5 flex flex-wrap gap-3 text-[10px]" style={{ color: MUT }}>
        <Legend color="#F2C94C" label="Your pick" />
        <Legend color="rgba(255,255,255,.55)" label="Result locked in" />
        <Legend color="#F2C94C" dashed label="Pick next" />
      </div>
      {err && <div className="mb-2 text-[11px] font-semibold" style={{ color: "#EF4444" }}>{err}</div>}
      <div className="flex gap-2">
        <button onClick={onReset} disabled={pending} className="rounded-[9px] border px-3.5 py-2.5 text-[12px] font-bold" style={{ borderColor: "rgba(255,255,255,.08)", color: MUT }}>Reset</button>
        <button
          onClick={onLock}
          disabled={pending || !complete}
          className="flex-1 rounded-[9px] py-2.5 text-[13px] font-extrabold"
          style={{ background: complete ? "#15A66A" : "rgba(255,255,255,.08)", color: complete ? "#fff" : MUT, boxShadow: complete ? "0 4px 14px rgba(21,166,106,.4)" : "none" }}
        >
          {complete ? "Lock in bracket →" : "Complete the bracket to lock"}
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
      <div className="font-mono text-[11px] font-bold tracking-[.08em]" style={{ color: MUT }}>BRACKET LOCKED</div>
      <div className="my-2.5 flex items-center gap-2.5">
        <span className="grid h-9 w-9 place-items-center rounded-full font-mono text-[12px] font-extrabold text-white" style={{ background: champ ? undefined : "rgba(255,255,255,.08)", boxShadow: "0 0 0 2px rgba(242,201,76,.5)" }}>{champ?.code ?? "?"}</span>
        <div>
          <div className="font-mono text-[9px] font-bold tracking-[.14em]" style={{ color: "#F2C94C" }}>YOUR CHAMPION</div>
          <div className="text-[16px] font-extrabold" style={{ color: TXT }}>{champ?.name ?? "—"}</div>
        </div>
        <span className="ml-auto text-[20px]">🏆</span>
      </div>
      <div className="mb-3 text-[10.5px] leading-[1.4]" style={{ color: MUT }}>
        {score.decided > 0 ? `${score.correct}/${score.decided} correct so far` : "No predicted matches decided yet"} · we'll score them live as each match finishes.
      </div>
      <button onClick={onEdit} disabled={pending} className="rounded-[9px] border px-3.5 py-2.5 text-[12px] font-bold" style={{ borderColor: "rgba(255,255,255,.08)", color: MUT }}>Edit</button>
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

  let status = "Awaiting result";
  let scol = MUT;
  if (ring === 0) status = "In the draw";
  else if (mode === "picks") {
    if (resultId) {
      const ok = userPicks[slot] ? userPicks[slot] === resultId : null;
      status = ok == null ? "Result in" : ok ? "Your pick advanced ✓" : "Knocked out ✗";
      scol = ok == null ? MUT : ok ? "#16A34A" : "#EF4444";
    } else if (userPicks[slot]) status = "Pick still alive";
    else status = "Pick this next";
  } else status = sv?.finished ? "Advanced" : "Awaiting result";

  return (
    <div>
      <div className="font-mono text-[10px] font-bold uppercase tracking-[.1em]" style={{ color: MUT }}>{RING_LABEL[ring]}</div>
      <div className="mt-2 flex items-center gap-2.5">
        <span className="grid h-8 w-8 place-items-center rounded-full font-mono text-[11px] font-extrabold text-white" style={{ background: team ? undefined : "rgba(255,255,255,.08)" }}>{team?.code ?? "?"}</span>
        <div>
          <div className="text-[15px] font-extrabold" style={{ color: TXT }}>{team?.name ?? "To be decided"}</div>
          <div className="mt-0.5 text-[11.5px] font-bold" style={{ color: scol }}>{status}</div>
        </div>
      </div>
      <div className="mt-2.5 text-[10.5px]" style={{ color: MUT }}>{ring < 5 ? "Highlighted: this team's road to the final." : "The champion lifts the cup here."}</div>
    </div>
  );
}
