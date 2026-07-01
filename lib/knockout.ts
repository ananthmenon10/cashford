// Pure core for the Knockout Circle — a radial WC-2026 knockout bracket.
// No I/O; fully unit-tested (lib/knockout.test.ts). See
// docs/plans/2026-07-01-001-feat-knockout-circle-radial-bracket-plan.md.
//
// Model: 6 concentric rings. Ring 0 = the 32 R32 entrants (the fixed field).
// Rings 1..5 = match WINNERS: ring 1 = 16 R32 winners, ring 2 = 8 R16 winners,
// ring 3 = 4 QF winners, ring 4 = 2 SF winners (finalists), ring 5 = the champion.
// A slot at ring L (1..5), index i, holds the winner of the match between its two
// ring-(L-1) children, indices 2i and 2i+1. Slot key = "L:i". The 3rd-place match
// is intentionally NOT part of the circle (31 matches: 16+8+4+2+1).

export type SlotKey = string; // "L:i"

// ---- Geometry (verbatim from the design handoff) ------------------------------
export const GEO = {
  cx: 149,
  cy: 149,
  radii: [137, 110, 84, 58, 32, 0] as const, // distance from centre per ring
  nodeR: [8, 9.5, 11.5, 13.5, 16, 21] as const, // node circle radius per ring
  counts: [32, 16, 8, 4, 2, 1] as const, // nodes per ring
  strokeW: [1.5, 1.5, 1.5, 2, 2.5, 3] as const,
} as const;

export const RINGS = 6; // rings 0..5
export const CIRCLE_MATCHES = 31; // pickable slots (rings 1..5)

// The tournament round whose MATCH produces each ring-L slot (L = 1..5).
export const RING_MATCH_ROUND: Record<number, "r32" | "r16" | "qf" | "sf" | "final"> = {
  1: "r32",
  2: "r16",
  3: "qf",
  4: "sf",
  5: "final",
};

// Human label for a slot at ring L (the round it decides). Ring 0 = the field.
export const RING_LABEL: Record<number, string> = {
  0: "Round of 32",
  1: "Round of 16",
  2: "Quarter-final",
  3: "Semi-final",
  4: "Final",
  5: "Champion",
};

// ---- Slot-key + tree helpers --------------------------------------------------

export function key(ring: number, idx: number): SlotKey {
  return `${ring}:${idx}`;
}

export function parseKey(k: SlotKey): [ring: number, idx: number] {
  const m = /^([0-5]):(\d{1,2})$/.exec(k);
  if (!m) throw new Error(`invalid slot key: ${k}`);
  const ring = Number(m[1]);
  const idx = Number(m[2]);
  if (idx >= GEO.counts[ring]) throw new Error(`slot index out of range: ${k}`);
  return [ring, idx];
}

/** The two child slots feeding slot (ring, idx). Ring 0 has no children. */
export function childrenOf(ring: number, idx: number): [SlotKey, SlotKey] {
  if (ring < 1) throw new Error(`ring ${ring} has no children`);
  return [key(ring - 1, 2 * idx), key(ring - 1, 2 * idx + 1)];
}

/** The parent slot (ring+1). Champion (ring 5) has no parent. */
export function parentOf(ring: number, idx: number): SlotKey | null {
  if (ring >= 5) return null;
  return key(ring + 1, Math.floor(idx / 2));
}

/**
 * The "road to the final": this slot plus every ancestor up to the champion (5:0),
 * inclusive. Drives the tap-to-trace highlight. For "5:0" returns just ["5:0"].
 */
export function pathToFinal(k: SlotKey): SlotKey[] {
  const [ring0, idx0] = parseKey(k);
  const out: SlotKey[] = [];
  let idx = idx0;
  for (let ring = ring0; ring <= 5; ring++) {
    out.push(key(ring, idx));
    idx = Math.floor(idx / 2);
  }
  return out;
}

// ---- Node geometry ------------------------------------------------------------

export interface NodePos {
  slot: SlotKey;
  ring: number;
  idx: number;
  x: number;
  y: number;
  r: number;
}

/**
 * Angle (degrees) of a node's centre. Ring 0 is evenly spaced from -90° (top),
 * clockwise; every higher ring's node sits at the midpoint of its two children —
 * so a ring-L slot points down the middle of its sub-bracket (matches the handoff).
 */
export function angleOf(ring: number, idx: number): number {
  if (ring === 0) return -90 + idx * (360 / GEO.counts[0]);
  return (angleOf(ring - 1, 2 * idx) + angleOf(ring - 1, 2 * idx + 1)) / 2;
}

// Round to 3 decimals so coordinates are byte-identical strings across runtimes.
// (Math.cos/sin can differ by a sub-ULP between the Node server and the browser,
// which otherwise causes an SSR hydration mismatch on the many x/y attributes.)
const r3 = (v: number) => Math.round(v * 1000) / 1000;

/** Position of one node. Ring 5 (champion) is the centre. */
export function nodePosition(ring: number, idx: number): { x: number; y: number } {
  if (ring === 5) return { x: GEO.cx, y: GEO.cy };
  const rad = (angleOf(ring, idx) * Math.PI) / 180;
  return {
    x: r3(GEO.cx + GEO.radii[ring] * Math.cos(rad)),
    y: r3(GEO.cy + GEO.radii[ring] * Math.sin(rad)),
  };
}

/** All 63 node positions (rings 0..5), deterministic. */
export function geometry(): NodePos[] {
  const out: NodePos[] = [];
  for (let ring = 0; ring <= 5; ring++) {
    for (let idx = 0; idx < GEO.counts[ring]; idx++) {
      const { x, y } = nodePosition(ring, idx);
      out.push({ slot: key(ring, idx), ring, idx, x, y, r: GEO.nodeR[ring] });
    }
  }
  return out;
}

export interface Link {
  fromSlot: SlotKey;
  toSlot: SlotKey;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  ring: number; // ring of the parent (to)
}

/** Connector lines from each ring-(L-1) child to its ring-L parent (L = 1..5). */
export function links(): Link[] {
  const out: Link[] = [];
  for (let ring = 1; ring <= 5; ring++) {
    for (let idx = 0; idx < GEO.counts[ring]; idx++) {
      const to = nodePosition(ring, idx);
      for (const childKey of childrenOf(ring, idx)) {
        const [cr, ci] = parseKey(childKey);
        const from = nodePosition(cr, ci);
        out.push({ fromSlot: childKey, toSlot: key(ring, idx), x1: from.x, y1: from.y, x2: to.x, y2: to.y, ring });
      }
    }
  }
  return out;
}

// ---- Builder state machine (pure) --------------------------------------------
//
// `picks`  : Record<"L:i", teamId> for rings 1..5 — the USER's picks only.
//            (Auto-locked/finished slots are NEVER persisted here — the RLS write
//            gate forbids writing a pick after kickoff — so `picks` is skill only.)
// `field`  : the 32 ring-0 entrant team ids, in bracket order (index = ring-0 idx).
// `results`: Record<"L:i", teamId | null> — the actual advancer per slot, or null
//            if that match isn't decided yet. Keyed by SLOT (built via the binding).

export type Picks = Record<SlotKey, string>;
export type Results = Record<SlotKey, string | null>;
// Ring-0 entrants by index (0..31). A plain string[] is assignable to this too.
export type FieldMap = Record<number, string>;

/** The team currently occupying a slot: ring 0 = fixed field; rings 1..5 = pick. */
export function at(picks: Picks, field: FieldMap, ring: number, idx: number): string | undefined {
  if (ring === 0) return field[idx];
  return picks[key(ring, idx)];
}

/**
 * Are both feeders of slot (ring, idx) filled, so this slot can be decided?
 * Ring 1's feeders are ring-0 entrants, which always exist → always true.
 */
export function feedersReady(picks: Picks, field: FieldMap, ring: number, idx: number): boolean {
  if (ring < 1) return false;
  if (ring === 1) return field[2 * idx] != null && field[2 * idx + 1] != null;
  return at(picks, field, ring - 1, 2 * idx) != null && at(picks, field, ring - 1, 2 * idx + 1) != null;
}

/** A finished slot is auto-locked (its real result stands; the user can't change it). */
export function isAutoLocked(results: Results, ring: number, idx: number): boolean {
  if (ring < 1) return false;
  return results[key(ring, idx)] != null;
}

export interface PromoteResult {
  picks: Picks;
  /** set when the tap was gated (sibling feeder not decided) — pulse this slot. */
  hint?: SlotKey;
  /** true if the tap changed nothing (already through, gated, or illegal). */
  noop?: boolean;
}

/**
 * One tap = one round of promotion. Advances the team at (ring, idx) into its
 * parent slot, if both feeders are filled and the parent isn't auto-locked.
 * Re-picking clears the whole ancestor chain above the parent (PATH-based, never
 * team-identity based — correctness C-01).
 */
export function promote(
  picks: Picks,
  field: FieldMap,
  results: Results,
  ring: number,
  idx: number,
): PromoteResult {
  if (ring < 0 || ring > 4) return { picks, noop: true }; // only rings 0..4 promote
  const team = at(picks, field, ring, idx);
  if (!team) return { picks, noop: true }; // nothing to advance

  const pIdx = Math.floor(idx / 2);
  const parentRing = ring + 1;
  // Parent match already final → locked, can't predict it.
  if (isAutoLocked(results, parentRing, pIdx)) return { picks, noop: true };

  // The other feeder of the parent must be filled first.
  const sibIdx = idx ^ 1;
  if (at(picks, field, ring, sibIdx) == null) {
    return { picks, hint: key(ring, sibIdx) };
  }

  const parentKey = key(parentRing, pIdx);
  if (picks[parentKey] === team) return { picks, noop: true }; // already through

  // Set the parent, then clear every ancestor above it along the path (path-based).
  const next: Picks = { ...picks, [parentKey]: team };
  for (const anc of pathToFinal(parentKey)) {
    if (anc !== parentKey) delete next[anc];
  }
  return { picks: next };
}

/**
 * Display-only overlay: the real winner of every finished slot. NEVER persisted
 * (the RLS write gate rejects post-kickoff writes). Skips slots with no advancer
 * yet. `results` only ever contains circle slots (rings 1..5) — the 3rd-place
 * match has no slot, so it can never leak in.
 */
export function autoPicks(results: Results): Picks {
  const out: Picks = {};
  for (const [k, adv] of Object.entries(results)) {
    if (adv == null) continue;
    const [ring] = parseKey(k);
    if (ring >= 1 && ring <= 5) out[k] = adv;
  }
  return out;
}

/** The effective occupant of a slot for validity checks: real result if decided, else the pick. */
function effectiveAt(picks: Picks, field: FieldMap, results: Results, ring: number, idx: number): string | undefined {
  if (ring === 0) return field[idx];
  const res = results[key(ring, idx)];
  return res ?? picks[key(ring, idx)];
}

export interface ValidateResult {
  /** Picks whose feeders resolved so the pick can no longer be reached. */
  stale: Set<SlotKey>;
}

/**
 * A pick at (ring, idx) is stale when its team is not (any longer) a winner of
 * either feeder — e.g. the team the user advanced actually lost earlier. Staleness
 * cascades all the way to the champion (correctness C-04/T04). Callers must pass
 * the POST-autoPicks-merge map so already-finished slots read as their real result.
 */
export function validate(picks: Picks, field: FieldMap, results: Results): ValidateResult {
  const stale = new Set<SlotKey>();
  for (let ring = 1; ring <= 5; ring++) {
    for (let idx = 0; idx < GEO.counts[ring]; idx++) {
      const k = key(ring, idx);
      const team = picks[k];
      if (team == null) continue;
      // A finished (auto-locked) slot is always consistent with reality — skip.
      if (results[k] != null) continue;
      const c0 = childrenOf(ring, idx);
      const [cr, ci0] = parseKey(c0[0]);
      const [, ci1] = parseKey(c0[1]);
      const feederA = stale.has(c0[0]) ? undefined : effectiveAt(picks, field, results, cr, ci0);
      const feederB = stale.has(c0[1]) ? undefined : effectiveAt(picks, field, results, cr, ci1);
      if (team !== feederA && team !== feederB) stale.add(k);
    }
  }
  return { stale };
}

/** Every circle slot (rings 1..5) is filled — the only gate for enabling Lock. */
export function completeBracket(picks: Picks): boolean {
  for (let ring = 1; ring <= 5; ring++) {
    for (let idx = 0; idx < GEO.counts[ring]; idx++) {
      if (picks[key(ring, idx)] == null) return false;
    }
  }
  return true;
}

export interface Score {
  correct: number;
  decided: number;
}

/**
 * Accuracy over the DECIDED matches the user actually predicted. `picks` contains
 * only persisted (pre-kickoff) user picks, so auto-locked games never inflate it.
 * A slot with no pick, or whose match isn't decided, is excluded from both counts.
 */
export function score(picks: Picks, results: Results): Score {
  let correct = 0;
  let decided = 0;
  for (const [k, team] of Object.entries(picks)) {
    const adv = results[k];
    if (adv == null) continue; // not decided → not scored
    decided++;
    if (adv === team) correct++;
  }
  return { correct, decided };
}

// ---- SVG string generator (pure) ---------------------------------------------
//
// Feeds BOTH the on-screen React SVG (via GEO/nodePosition) and, in a later phase,
// a server-rendered image. Emits NO animation (that lives in CSS so reduced-motion
// applies) and NO external <image> refs (self-contained; codes + colours only).

const PALETTE = [
  "#15A66A", "#6366f1", "#F2994A", "#0EA5E9", "#E11D48", "#7C3AED",
  "#0E8455", "#0891B2", "#DB2777", "#2563EB", "#CA8A04", "#16A34A",
];

/** Deterministic fallback colour for a team code (used when no flag/colour). */
export function chipColor(code: string | null | undefined): string {
  if (!code) return "#334155";
  let h = 0;
  for (const c of code) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

export type SlotState = "empty" | "upcoming" | "pick-next" | "user-pick" | "result" | "correct" | "wrong";

export interface SvgSlot {
  code: string | null; // 3-letter code, or null (TBD/unknown → renders a dash)
  state: SlotState;
}

export interface BracketSvgView {
  // one entry per node (rings 0..5); missing entries render as empty/upcoming
  slots: Record<SlotKey, SvgSlot>;
}

export interface BracketSvgOpts {
  size?: number; // px; scales the 298 viewBox
  bg?: string;
}

function esc(s: string): string {
  return s.replace(/[<>&]/g, (c) => (c === "<" ? "&lt;" : c === ">" ? "&gt;" : "&amp;"));
}

/** Pure SVG string for the bracket. Byte-stable for a given view (snapshot-tested). */
export function bracketSvg(view: BracketSvgView, opts: BracketSvgOpts = {}): string {
  const size = opts.size ?? 298;
  const s = size / 298;
  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">`,
  );
  parts.push(`<rect width="${size}" height="${size}" fill="${opts.bg ?? "#0B0F14"}"/>`);

  // connector lines
  for (const l of links()) {
    parts.push(
      `<line x1="${(l.x1 * s).toFixed(2)}" y1="${(l.y1 * s).toFixed(2)}" x2="${(l.x2 * s).toFixed(2)}" y2="${(l.y2 * s).toFixed(2)}" stroke="rgba(255,255,255,.10)" stroke-width="1"/>`,
    );
  }

  // nodes
  for (const n of geometry()) {
    const slot = view.slots[n.slot];
    const cx = (n.x * s).toFixed(2);
    const cy = (n.y * s).toFixed(2);
    const r = (n.r * s).toFixed(2);
    const code = slot?.code ?? null;
    const state = slot?.state ?? (n.ring === 0 ? "empty" : "upcoming");

    let fill = "transparent";
    let stroke = "rgba(255,255,255,.16)";
    let dashed = "";
    if (state === "upcoming" || state === "empty") {
      stroke = "rgba(255,255,255,.13)";
      dashed = ' stroke-dasharray="3 3"';
    } else if (state === "pick-next") {
      stroke = "#F2C94C";
      dashed = ' stroke-dasharray="4 3"';
    } else if (state === "user-pick") {
      fill = chipColor(code);
      stroke = "#F2C94C";
    } else if (state === "result") {
      fill = chipColor(code);
      stroke = "rgba(255,255,255,.55)";
    } else if (state === "correct") {
      fill = chipColor(code);
      stroke = "#16A34A";
    } else if (state === "wrong") {
      fill = chipColor(code);
      stroke = "#EF4444";
    }
    parts.push(`<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}" stroke="${stroke}" stroke-width="1.5"${dashed}/>`);
    if (code) {
      const fs = (n.ring === 0 ? 6.3 : n.ring + 6.2) * s;
      parts.push(
        `<text x="${cx}" y="${(n.y * s + 0.3 * s).toFixed(2)}" text-anchor="middle" dominant-baseline="central" font-size="${fs.toFixed(1)}" font-weight="700" fill="#e6eaf0" font-family="monospace">${esc(code)}</text>`,
      );
    }
  }
  parts.push(`</svg>`);
  return parts.join("");
}

// ---- Fixture → slot binding (pure) --------------------------------------------
//
// The WC-2026 knockout bracket is a fixed draw. We hardcode the 16 Round-of-32
// fixtures (by ESPN external_id) in BRACKET ORDER — ring-1 slot i is R32_ORDER[i], and
// its two ring-0 entrants are that fixture's home/away. This places all 32 flags + the
// full tree immediately (matching the official radial draw). The order was read from
// the official draw and verified against ESPN's already-resolved R16 edges (760502 ←
// {760486,760488}, 760503 ← {760489,760492}, 760504 ← {760487,760490}).
//
// Rings 2..5 bind by ADVANCER-MATCH: a round-N fixture whose two participants equal the
// winners of a slot's two children is placed at that slot (correct + self-correcting as
// matches finish). Slots whose children aren't decided yet get a stable fallback fixture
// (so a pick can persist); results[] stays null for them, so scoring is never affected.

export interface KnockoutFixture {
  externalId: number;
  round: "r32" | "r16" | "qf" | "sf" | "final" | "third" | "group";
  homeTeamId: string | null;
  awayTeamId: string | null;
  homeLabel: string | null;
  awayLabel: string | null;
  advancerTeamId: string | null;
}

// R32 fixtures in bracket order (ring-1 slots 0..15). Consecutive pairs feed each R16,
// etc. (standard binary tree). Derived from the official WC-2026 draw.
export const R32_ORDER: readonly number[] = [
  760489, // Germany v Paraguay
  760492, // France v Sweden
  760486, // South Africa v Canada
  760488, // Netherlands v Morocco
  760496, // Portugal v Croatia
  760497, // Spain v Austria
  760494, // USA v Bosnia
  760493, // Belgium v Senegal
  760501, // Colombia v Ghana
  760498, // Switzerland v Algeria
  760499, // Australia v Egypt
  760500, // Argentina v Cape Verde
  760495, // England v Congo DR
  760491, // Mexico v Ecuador
  760490, // Ivory Coast v Norway
  760487, // Brazil v Japan
];

export interface BracketBinding {
  slotFixtureExternalId: Record<SlotKey, number>; // rings 1..5 → fixture external_id
  ring0TeamId: Record<number, string>; // ring-0 index (0..31) → entrant team id
  pending: SlotKey[]; // slots with no fixture yet (missing from the data)
}

/** Bind KO fixtures to radial slots: static R32 order + advancer-match for upper rounds. Pure. */
export function bindBracket(fixtures: KnockoutFixture[]): BracketBinding {
  const byExt = new Map(fixtures.map((f) => [f.externalId, f]));
  const byRound = (r: string) => fixtures.filter((f) => f.round === r).sort((a, b) => a.externalId - b.externalId);
  const CHILD_ROUND: Record<number, string> = { 2: "r16", 3: "qf", 4: "sf", 5: "final" };

  const slotFixtureExternalId: Record<SlotKey, number> = {};
  const ring0TeamId: Record<number, string> = {};
  const pending: SlotKey[] = [];

  // ring 1 (R32) + ring 0 (entrants) from the static order
  R32_ORDER.forEach((ext, i) => {
    const f = byExt.get(ext);
    if (!f) {
      pending.push(key(1, i));
      return;
    }
    slotFixtureExternalId[key(1, i)] = ext;
    if (f.homeTeamId) ring0TeamId[2 * i] = f.homeTeamId;
    if (f.awayTeamId) ring0TeamId[2 * i + 1] = f.awayTeamId;
  });

  // winner occupying a slot (its bound fixture's advancer), computed bottom-up
  const winnerAt = (ring: number, idx: number): string | undefined => {
    if (ring === 0) return ring0TeamId[idx];
    const ext = slotFixtureExternalId[key(ring, idx)];
    return ext != null ? byExt.get(ext)?.advancerTeamId ?? undefined : undefined;
  };

  // rings 2..5: place each round's fixtures by matching participants to the slot's feeders
  for (let ring = 2; ring <= 5; ring++) {
    const pool = byRound(CHILD_ROUND[ring]);
    const used = new Set<number>();
    // pass 1: advancer-match to the exact slot
    for (let idx = 0; idx < GEO.counts[ring]; idx++) {
      const wA = winnerAt(ring - 1, 2 * idx);
      const wB = winnerAt(ring - 1, 2 * idx + 1);
      if (wA && wB) {
        const m = pool.find(
          (f) => !used.has(f.externalId) && ((f.homeTeamId === wA && f.awayTeamId === wB) || (f.homeTeamId === wB && f.awayTeamId === wA)),
        );
        if (m) {
          slotFixtureExternalId[key(ring, idx)] = m.externalId;
          used.add(m.externalId);
        }
      }
    }
    // pass 2: give remaining slots a stable fallback fixture (for pick persistence)
    const openSlots: number[] = [];
    for (let idx = 0; idx < GEO.counts[ring]; idx++) if (slotFixtureExternalId[key(ring, idx)] == null) openSlots.push(idx);
    const remaining = pool.filter((f) => !used.has(f.externalId));
    openSlots.forEach((idx, k) => {
      if (remaining[k]) slotFixtureExternalId[key(ring, idx)] = remaining[k].externalId;
      else pending.push(key(ring, idx));
    });
  }

  return { slotFixtureExternalId, ring0TeamId, pending };
}
