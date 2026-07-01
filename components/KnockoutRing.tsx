"use client";

// The radial bracket SVG. Renders from the pure geometry in lib/knockout (single
// source shared with the server SVG-string generator). Live mode fills a slot only
// when its match is final; My Picks overlays the viewer's picks (read-only here —
// interactivity lands in KnockoutCircle, Phase 3). Tap/enter a node to trace its road
// to the final: dimming is done via a CSS class on the <svg> root (no re-render of the
// ~120 elements). Draw-on entrance fires when .in-view lands (see globals kc-* + motion).

import { useReveal } from "./motion";
import { geometry, links, GEO, chipColor, pathToFinal, parseKey, RING_LABEL, type SlotKey } from "@/lib/knockout";
import type { KnockoutView } from "@/lib/knockout-data";

export type BracketMode = "live" | "picks";

const NODES = geometry();
const LINES = links();
const CHAMP: SlotKey = "5:0";

interface NodeVisual {
  fill: string;
  stroke: string;
  strokeW: number;
  dashed: boolean;
  label: string;
  flagUrl: string | null;
  txt: string;
}

function visualFor(view: KnockoutView, mode: BracketMode, ring: number, idx: number): NodeVisual {
  const k = `${ring}:${idx}`;
  const sv = view.slots.find((s) => s.slot === k) ?? null;
  const base: NodeVisual = { fill: "transparent", stroke: "rgba(255,255,255,.13)", strokeW: 1.3, dashed: true, label: "", flagUrl: null, txt: "#9fb0bd" };

  if (ring === 0) {
    if (!sv?.team) return base; // TBD entrant
    return { fill: chipColor(sv.team.code) + "26", stroke: chipColor(sv.team.code) + "88", strokeW: 1.2, dashed: false, label: sv.team.code, flagUrl: null, txt: "#cfd8df" };
  }

  const resultTeamId = view.results[k] ?? null;
  const pickTeamId = view.myPicks[k];

  if (mode === "live") {
    if (sv?.finished && sv.team) {
      return { fill: chipColor(sv.team.code), stroke: "#ffffff22", strokeW: ring === 5 ? 2.6 : 1.3, dashed: false, label: sv.team.code, flagUrl: ring >= 3 ? sv.team.flagUrl : null, txt: "#fff" };
    }
    // not final → empty slot (no live indicators in Live mode, per design)
    return { ...base, stroke: ring === 5 ? "#F2C94C" : base.stroke, strokeW: ring === 5 ? 2.4 : base.strokeW, label: ring === 5 ? "?" : "", txt: ring === 5 ? "#F2C94C" : base.txt };
  }

  // picks mode (read-only in Phase 2)
  if (resultTeamId) {
    const t = view.teams[resultTeamId];
    const correct = pickTeamId ? pickTeamId === resultTeamId : null;
    const stroke = view.locked && correct != null ? (correct ? "#16A34A" : "#EF4444") : "rgba(255,255,255,.55)";
    return { fill: chipColor(t?.code), stroke, strokeW: 1.3, dashed: false, label: t?.code ?? "", flagUrl: ring >= 3 ? (t?.flagUrl ?? null) : null, txt: "#fff" };
  }
  if (pickTeamId) {
    const t = view.teams[pickTeamId];
    return { fill: chipColor(t?.code), stroke: "#F2C94C", strokeW: 2, dashed: false, label: t?.code ?? "", flagUrl: ring >= 3 ? (t?.flagUrl ?? null) : null, txt: "#fff" };
  }
  return { ...base, stroke: ring === 5 ? "#F2C94C" : base.stroke, label: ring === 5 ? "?" : "", txt: ring === 5 ? "#F2C94C" : base.txt };
}

export function KnockoutRing({
  view,
  mode,
  selected,
  onSelect,
  size = 298,
}: {
  view: KnockoutView;
  mode: BracketMode;
  selected: SlotKey | null;
  onSelect: (slot: SlotKey | null) => void;
  size?: number;
}) {
  const ref = useReveal<SVGSVGElement>();
  const path = selected ? new Set(pathToFinal(selected)) : null;

  // ring index of each parent for line stagger; group lines by parent ring
  return (
    <svg
      ref={ref}
      className="kc-bracket"
      viewBox="0 0 298 298"
      width={size}
      height={size}
      role="group"
      aria-label="World Cup 2026 knockout bracket"
      data-selected={selected ?? undefined}
      style={{ display: "block", maxWidth: "100%" }}
    >
      <defs>
        {NODES.filter((n) => n.ring >= 3).map((n) => (
          <clipPath key={`clip-${n.slot}`} id={`kc-clip-${n.ring}-${n.idx}`}>
            <circle cx={n.x} cy={n.y} r={n.r} />
          </clipPath>
        ))}
      </defs>

      {/* connector lines (draw-on staggered by parent ring) */}
      {LINES.map((l, i) => {
        const on = path && path.has(l.fromSlot) && path.has(l.toSlot);
        return (
          <line
            key={`l-${i}`}
            className="kc-line"
            x1={l.x1}
            y1={l.y1}
            x2={l.x2}
            y2={l.y2}
            pathLength={1}
            stroke={on ? "rgba(21,166,106,.7)" : "rgba(255,255,255,.09)"}
            strokeWidth={on ? 1.8 : 1}
            style={{ ["--kc-ring-i" as string]: String(6 - l.ring) }}
          />
        );
      })}

      {/* nodes */}
      {NODES.map((n) => {
        const v = visualFor(view, mode, n.ring, n.idx);
        const onPath = !path || path.has(n.slot);
        const interactive = v.label !== "" || v.flagUrl != null;
        const teamName = view.slots.find((s) => s.slot === n.slot)?.team?.name;
        const aria = `${RING_LABEL[n.ring]}${teamName ? `, ${teamName}` : v.label ? `, ${v.label}` : ", to be decided"}`;
        return (
          <g
            key={n.slot}
            data-node=""
            {...(onPath && selected ? { "data-node-path": "" } : {})}
            role={interactive ? "button" : "img"}
            aria-label={aria}
            tabIndex={interactive ? 0 : -1}
            onClick={interactive ? () => onSelect(selected === n.slot ? null : n.slot) : undefined}
            onKeyDown={
              interactive
                ? (e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onSelect(selected === n.slot ? null : n.slot);
                    } else if (e.key === "Escape") {
                      onSelect(null);
                    }
                  }
                : undefined
            }
            style={{ cursor: interactive ? "pointer" : "default", outline: "none" }}
          >
            {/* enlarged invisible hit target (>=44pt effective) */}
            {interactive && <circle cx={n.x} cy={n.y} r={Math.max(n.r, 11)} fill="transparent" />}
            <circle
              className="kc-nodefill"
              cx={n.x}
              cy={n.y}
              r={n.r}
              fill={v.flagUrl ? "#0b0f14" : v.fill}
              stroke={v.stroke}
              strokeWidth={v.strokeW}
              strokeDasharray={v.dashed ? "3 3" : undefined}
            />
            {v.flagUrl && (
              <image href={v.flagUrl} x={n.x - n.r} y={n.y - n.r} width={n.r * 2} height={n.r * 2} clipPath={`url(#kc-clip-${n.ring}-${n.idx})`} preserveAspectRatio="xMidYMid slice" />
            )}
            {v.label && !v.flagUrl && (
              <text
                x={n.x}
                y={n.y + 0.3}
                textAnchor="middle"
                dominantBaseline="central"
                fontSize={n.ring === 5 ? 13 : n.ring === 0 ? 6.3 : n.ring + 6.2}
                fontWeight={700}
                fill={v.txt}
                fontFamily="var(--font-geist-mono, monospace)"
                style={{ pointerEvents: "none" }}
              >
                {v.label}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

// (CHAMP referenced to keep the champion slot key handy for callers/tests.)
export { CHAMP as CHAMPION_SLOT };
