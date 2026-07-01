"use client";

// Client controller for the /bracket page: mode toggle (Live Bracket | My Picks),
// node selection (road-to-final highlight), and the info panel under the ring.
// Phase 2 ships Live Bracket fully; My Picks renders read-only (official results +
// any picks) — the interactive builder + lock arrive in Phase 3.

import { useState } from "react";
import { KnockoutRing, type BracketMode } from "./KnockoutRing";
import { RING_LABEL, parseKey, type SlotKey } from "@/lib/knockout";
import type { KnockoutView } from "@/lib/knockout-data";

const PANEL = "#11161D";
const LINE = "rgba(255,255,255,.08)";
const MUT = "#7a8794";
const TXT = "#E7ECEF";

export function KnockoutCircle({ view }: { view: KnockoutView }) {
  const [mode, setMode] = useState<BracketMode>("live");
  const [selected, setSelected] = useState<SlotKey | null>(null);
  const modeIdx = mode === "live" ? 0 : 1;

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
      {/* segmented control — green active thumb (explicit; the page is always-dark) */}
      <div className="relative mx-3.5 flex gap-1 rounded-[11px] p-1" style={{ background: "rgba(255,255,255,.05)" }}>
        <div
          className="pointer-events-none absolute bottom-1 top-1 rounded-[9px]"
          style={{
            left: 4,
            width: "calc(50% - 6px)",
            background: "#15A66A",
            transform: `translateX(${modeIdx * 100}%)`,
            transition: "transform .2s var(--cf-ease)",
          }}
        />
        {seg("live", "Live Bracket", 0)}
        {seg("picks", "My Picks", 1)}
      </div>

      {/* the ring */}
      <div className="mx-auto" style={{ width: 298, maxWidth: "100%" }}>
        <KnockoutRing view={view} mode={mode} selected={selected} onSelect={setSelected} />
      </div>

      {/* info panel */}
      <div className="mx-3.5 rounded-[14px] border p-4" style={{ background: PANEL, borderColor: LINE, minHeight: 96 }}>
        {selected ? (
          <SelectedDetail view={view} mode={mode} slot={selected} />
        ) : mode === "live" ? (
          <div>
            <div className="font-mono text-[11px] font-bold tracking-[.08em]" style={{ color: MUT }}>
              OFFICIAL RESULTS
            </div>
            <div className="mt-1.5 flex items-baseline gap-2">
              <span className="font-mono text-[26px] font-extrabold" style={{ color: TXT }}>
                {view.decided} / {view.total}
              </span>
              <span className="text-[12px] font-bold" style={{ color: MUT }}>
                matches decided
              </span>
            </div>
            <div className="mt-2 text-[11px] leading-[1.45]" style={{ color: MUT }}>
              The board fills in only when a match is final — no live scores, no clutter. Tap any team to trace its road to the final.
            </div>
          </div>
        ) : (
          <div>
            <div className="font-mono text-[11px] font-bold tracking-[.08em]" style={{ color: MUT }}>
              MY PICKS
            </div>
            <div className="mt-1.5 text-[13px] font-bold" style={{ color: TXT }}>
              {Object.keys(view.myPicks).length > 0 ? `${Object.keys(view.myPicks).length} picks so far` : "Predict the whole bracket"}
            </div>
            <div className="mt-2 text-[11px] leading-[1.45]" style={{ color: MUT }}>
              Finished games are locked in from the official results. Tap-to-advance picking arrives in the next update.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function SelectedDetail({ view, mode, slot }: { view: KnockoutView; mode: BracketMode; slot: SlotKey }) {
  const [ring] = parseKey(slot);
  const sv = view.slots.find((s) => s.slot === slot);
  const resultId = view.results[slot] ?? null;
  const pickId = view.myPicks[slot];
  const teamId = mode === "picks" ? (resultId ?? pickId) : (sv?.team?.id ?? null);
  const team = teamId ? view.teams[teamId] : null;

  let status = "Awaiting result";
  let scol = MUT;
  if (ring === 0) status = "In the draw";
  else if (mode === "picks") {
    if (resultId) {
      const ok = pickId ? pickId === resultId : null;
      status = ok == null ? "Result in" : ok ? "Your pick advanced ✓" : "Knocked out ✗";
      scol = ok == null ? MUT : ok ? "#16A34A" : "#EF4444";
    } else if (pickId) status = "Pick still alive";
  } else {
    status = sv?.finished ? "Advanced" : "Awaiting result";
  }

  return (
    <div>
      <div className="font-mono text-[10px] font-bold uppercase tracking-[.1em]" style={{ color: MUT }}>
        {RING_LABEL[ring]}
      </div>
      <div className="mt-2 flex items-center gap-2.5">
        <span
          className="grid h-8 w-8 place-items-center rounded-full font-mono text-[11px] font-extrabold text-white"
          style={{ background: team ? undefined : "rgba(255,255,255,.08)" }}
        >
          {team?.code ?? "?"}
        </span>
        <div>
          <div className="text-[15px] font-extrabold" style={{ color: TXT }}>
            {team?.name ?? "To be decided"}
          </div>
          <div className="mt-0.5 text-[11.5px] font-bold" style={{ color: scol }}>
            {status}
          </div>
        </div>
      </div>
      <div className="mt-2.5 text-[10.5px]" style={{ color: MUT }}>
        {ring < 5 ? "Highlighted: this team's road to the final." : "The champion lifts the cup here."}
      </div>
    </div>
  );
}
