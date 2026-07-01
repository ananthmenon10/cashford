"use client";

// The radial bracket SVG. Renders from the pure geometry in lib/knockout (single
// source shared with the server SVG-string generator). Live mode fills a slot only
// when its match is final. My Picks renders the effective map (auto-locked results +
// the viewer's picks) and, when unlocked, is interactive (tap a filled team to advance
// it). Tap-to-trace dimming is a CSS class on the <svg> root (no re-render of ~120
// elements). Draw-on entrance fires when .in-view lands (globals kc-* + motion).

import { useReveal } from "./motion";
import {
  geometry,
  links,
  chipColor,
  pathToFinal,
  feedersReady,
  isAutoLocked,
  RING_LABEL,
  type SlotKey,
  type Picks,
  type Results,
} from "@/lib/knockout";
import type { KnockoutView } from "@/lib/knockout-data";

export type BracketMode = "live" | "picks";

const NODES = geometry();
const LINES = links();
const FLAG_INSET = 1.5; // keep the flag fully inside its border ring (no bleed)

export interface PickState {
  effective: Picks; // auto-locked results ∪ user picks (working display map)
  userPicks: Picks; // the viewer's own picks only (for scorecard coloring)
  field: Record<number, string>; // ring-0 idx → entrant teamId
  results: Results;
  hint: SlotKey | null; // slot to pulse (gating nudge)
  locked: boolean;
}

interface NodeVisual {
  fill: string;
  stroke: string;
  strokeW: number;
  dashed: boolean;
  gold: boolean; // gold rotating "pick-next" halo
  label: string;
  flagUrl: string | null;
  txt: string;
}

const EMPTY = (ring: number): NodeVisual => ({
  fill: "transparent",
  stroke: ring === 5 ? "#F2C94C" : "var(--kc-empty)",
  strokeW: ring === 5 ? 2.4 : 1.3,
  dashed: true,
  gold: false,
  label: ring === 5 ? "?" : "",
  flagUrl: null,
  txt: ring === 5 ? "#F2C94C" : "var(--kc-label-faint)",
});

function liveVisual(view: KnockoutView, ring: number, idx: number): NodeVisual {
  const k = `${ring}:${idx}`;
  const sv = view.slots.find((s) => s.slot === k) ?? null;
  if (ring === 0) {
    if (!sv?.team) return EMPTY(0);
    return { fill: chipColor(sv.team.code) + "26", stroke: chipColor(sv.team.code) + "88", strokeW: 1.2, dashed: false, gold: false, label: sv.team.code, flagUrl: sv.team.flagUrl, txt: "var(--kc-label)" };
  }
  if (sv?.finished && sv.team) {
    return { fill: chipColor(sv.team.code), stroke: "var(--kc-line)", strokeW: ring === 5 ? 2.6 : 1.3, dashed: false, gold: false, label: sv.team.code, flagUrl: sv.team.flagUrl, txt: "#fff" };
  }
  return EMPTY(ring);
}

function picksVisual(view: KnockoutView, ps: PickState, ring: number, idx: number): NodeVisual {
  const k = `${ring}:${idx}`;
  if (ring === 0) return liveVisual(view, 0, idx); // entrants same in both modes
  const teamId = ps.effective[k];
  const t = teamId ? view.teams[teamId] : null;
  const isResult = ps.results[k] != null;

  if (teamId && t) {
    if (isResult) {
      // auto-locked result. On a locked scorecard, colour by the user's own pick.
      if (ps.locked && ps.userPicks[k]) {
        const ok = ps.userPicks[k] === ps.results[k];
        return { fill: chipColor(t.code), stroke: ok ? "#16A34A" : "#EF4444", strokeW: 2, dashed: false, gold: false, label: t.code, flagUrl: t.flagUrl, txt: "#fff" };
      }
      return { fill: chipColor(t.code), stroke: "var(--kc-result-stroke)", strokeW: 1.3, dashed: false, gold: false, label: t.code, flagUrl: t.flagUrl, txt: "#fff" };
    }
    // the viewer's pick (still to be played)
    return { fill: chipColor(t.code), stroke: "#F2C94C", strokeW: 2, dashed: false, gold: false, label: t.code, flagUrl: t.flagUrl, txt: "#fff" };
  }
  // empty slot: gold "pick-next" if both feeders are ready, else faint upcoming
  if (!ps.locked && feedersReady(ps.effective, ps.field, ring, idx) && !isAutoLocked(ps.results, ring, idx)) {
    return { ...EMPTY(ring), stroke: "#F2C94C", strokeW: 1.8, gold: ring < 5, label: ring === 5 ? "?" : "?", txt: "#F2C94C" };
  }
  return EMPTY(ring);
}

export function KnockoutRing({
  view,
  mode,
  selected,
  onSelect,
  pick,
  onPromote,
}: {
  view: KnockoutView;
  mode: BracketMode;
  selected: SlotKey | null;
  onSelect: (slot: SlotKey | null) => void;
  pick?: PickState; // present in My Picks mode
  onPromote?: (ring: number, idx: number) => void; // present when interactive
}) {
  const ref = useReveal<SVGSVGElement>();
  const path = selected ? new Set(pathToFinal(selected)) : null;
  const interactive = mode === "picks" && !!pick && !pick.locked && !!onPromote;

  const promotable = (ring: number, idx: number): boolean => {
    if (!interactive || !pick || ring > 4) return false;
    const team = ring === 0 ? pick.field[idx] : pick.effective[`${ring}:${idx}`];
    if (!team) return false;
    return !isAutoLocked(pick.results, ring + 1, Math.floor(idx / 2));
  };

  return (
    <svg
      ref={ref}
      className="kc-bracket"
      viewBox="0 0 298 298"
      width="100%"
      role="group"
      aria-label="World Cup 2026 knockout bracket"
      data-selected={selected ?? undefined}
      style={{ display: "block", width: "100%", height: "auto", maxWidth: "100%" }}
    >
      <defs>
        {NODES.map((n) => (
          <clipPath key={`clip-${n.slot}`} id={`kc-clip-${n.ring}-${n.idx}`}>
            <circle cx={n.x} cy={n.y} r={n.r - FLAG_INSET} />
          </clipPath>
        ))}
      </defs>

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
            stroke={on ? "rgba(21,166,106,.7)" : "var(--kc-line)"}
            strokeWidth={on ? 1.8 : 1}
            style={{ ["--kc-ring-i" as string]: String(6 - l.ring) }}
          />
        );
      })}

      {NODES.map((n) => {
        const v = mode === "picks" && pick ? picksVisual(view, pick, n.ring, n.idx) : liveVisual(view, n.ring, n.idx);
        const onPath = !path || path.has(n.slot);
        const canPromote = promotable(n.ring, n.idx);
        const hintPulse = pick?.hint === n.slot;
        const activatable = v.label !== "" || v.flagUrl != null || canPromote;
        const teamName = view.slots.find((s) => s.slot === n.slot)?.team?.name ?? (pick && view.teams[pick.effective[n.slot] ?? ""]?.name);
        const aria = `${RING_LABEL[n.ring]}${teamName ? `, ${teamName}` : v.label && v.label !== "?" ? `, ${v.label}` : ", to be decided"}${canPromote ? ", tap to advance" : ""}`;

        const activate = () => {
          if (canPromote && onPromote) onPromote(n.ring, n.idx);
          else if (activatable) onSelect(selected === n.slot ? null : n.slot);
        };

        return (
          <g
            key={n.slot}
            data-node=""
            {...(onPath && selected ? { "data-node-path": "" } : {})}
            role={activatable ? "button" : "img"}
            aria-label={aria}
            tabIndex={activatable ? 0 : -1}
            onClick={activatable ? activate : undefined}
            onKeyDown={
              activatable
                ? (e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      activate();
                    } else if (e.key === "Escape") onSelect(null);
                  }
                : undefined
            }
            style={{ cursor: activatable ? "pointer" : "default", outline: "none" }}
          >
            {activatable && <circle cx={n.x} cy={n.y} r={Math.max(n.r, 11)} fill="transparent" />}
            {hintPulse && (
              <circle className="kc-pulse" cx={n.x} cy={n.y} r={n.r + 3} fill="none" stroke="#F2C94C" strokeWidth={2} />
            )}
            {v.gold && (
              <circle className="kc-halo" cx={n.x} cy={n.y} r={n.r + 2.6} fill="none" stroke="#F2C94C" strokeWidth={1.3} strokeDasharray="2 3" />
            )}
            {/* fill/backdrop (flag nodes get a dark disc behind the inset flag) */}
            <circle className="kc-nodefill" cx={n.x} cy={n.y} r={n.r} fill={v.flagUrl ? "var(--kc-node-bg)" : v.fill} />
            {v.flagUrl && (
              <image
                href={v.flagUrl}
                x={n.x - (n.r - FLAG_INSET)}
                y={n.y - (n.r - FLAG_INSET)}
                width={(n.r - FLAG_INSET) * 2}
                height={(n.r - FLAG_INSET) * 2}
                clipPath={`url(#kc-clip-${n.ring}-${n.idx})`}
                preserveAspectRatio="xMidYMid slice"
              />
            )}
            {/* border ring drawn ON TOP so it fully contains the flag */}
            <circle
              cx={n.x}
              cy={n.y}
              r={n.r}
              fill="none"
              stroke={v.stroke}
              strokeWidth={v.strokeW}
              strokeDasharray={v.dashed ? "3 3" : undefined}
            />
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
