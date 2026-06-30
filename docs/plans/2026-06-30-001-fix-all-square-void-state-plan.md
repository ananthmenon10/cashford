---
title: 'fix: distinct "All Square" state for no-separation voids (not "VOID — not enough players")'
type: fix
status: active
date: 2026-06-30
---

# 🐛 Distinct "All Square" state when nobody can be separated

## Overview

When 2+ players enter a contest but the settlement engine can't separate a winner (everyone
made effectively the same call), the contest is voided with reason **`no_separation`** — stakes
returned, everyone net 0. That is a **legitimate, even fun outcome** ("we all called it the
same"), not a participation failure. But every settled-result surface currently renders it as
**"VOID — not enough players entered"** and **hides the prediction reveal**, so players see a
wrong, deflating message and can't see what anyone predicted.

This fixes the **display only**. The money/settlement is unchanged and stays golden-tested; we
surface the distinction the data *already records* (`contests.void_reason`) as a separate
presentation state labelled **"ALL SQUARE"**, and we show the reveal grid for it.

## Problem Statement (verified against prod)

Reported: KK Bois — **Netherlands v Morocco** shows "VOID" + "Not enough players entered", and
participants can't see each other's picks.

Confirmed in the shared DB:

| contest | status | void_reason | result | entrants | members | picks |
|---|---|---|---|---|---|---|
| NED v MAR (KK Bois) | `void` | **`no_separation`** | 1–1 | 2 | 4 | both predicted **2–1** |

Both entrants predicted the identical scoreline (2–1), the match finished 1–1 — they both
missed the outcome but **tied each other**, so there was no one to win from / lose to. The
message "not enough players entered" is factually false (2 entered).

This is **recurring, not a one-off** — across all leagues right now:
- **`no_separation`: 11 contests**
- `insufficient_entries`: 28 contests

### Root cause — the distinction exists in data, but is discarded at render time

`lib/settlement.ts` already returns two void reasons (`settlement.ts:28`, `:64`, `:78`):
- `insufficient_entries` — genuinely `< 2` valid entries (`settle()` N<2 guard).
- `no_separation` — `≥ 2` entries, but the layered scoreline tiebreak can't separate the field
  (`winners.length === N`).

`lib/match-board.ts:143-145` already phrases them differently for the *live* board
("Too level to separate — no winner, everyone gets their stake back."). But the three **settled**
surfaces hardcode the `insufficient_entries` story and ignore `void_reason` entirely:

```text
app/leagues/[slug]/m/[id]/page.tsx:327-328   "Contest void — not enough players entered."  + NO reveal grid
components/ui.tsx:14                          StatusBadge → label "VOID"  (both reasons)
components/MatchCard.tsx:228-233              "Voided — not enough players entered · stakes returned"
```

Worse, on the match screen the reveal `rows` are **already loaded** (`m/[id]/page.tsx:145-186`,
since the contest is `revealed`) — the void branch just doesn't render them.

## Decisions (confirmed with user)

- **Label:** **"ALL SQUARE"** (badge + headline) for `no_separation`. `insufficient_entries`
  keeps **"VOID"**.
- **Scope:** **presentation-only**. DB `contests.status` stays `void`; the new look is driven by
  the existing `void_reason`. **No** new `ContestStatus`, **no** new `CardState`, **no**
  settlement/state-machine change. (Rejected: a real `tied` state threaded through the whole
  `CardState` machine — wider blast radius, exhaustive-map + state-test churn, zero behavioral
  gain.)
- **Reveal:** `no_separation` **shows** the prediction reveal grid (everyone's pick, all "push").
  `insufficient_entries` does **not** (there are <2 picks — nothing to compare).

## Proposed Solution

A single pure copy helper is the source of truth; each surface reads from it so the badge, card,
and match screen never drift.

### Render decision (per surface)

```text
contest.status === "void"
        │
        ├─ void_reason === "no_separation"  → badge "ALL SQUARE" · show reveal grid (settled) · "All square" copy
        └─ else (insufficient_entries/null) → badge "VOID"       · no reveal              · "Contest void" copy
```

## Technical Considerations

- **Copy accuracy nuance — do NOT claim "every prediction matched."** `no_separation` means the
  *layered* key tied for all N (`settlement.ts:41-47`), which is *usually* identical scorelines
  but **not always**: e.g. at actual 1–1, picks `2–0` and `0–2` both key to `[1,2,2,0]` and tie
  without being identical. So the generic blurb must be "too level to separate a winner." The
  match screen *may* enrich to "You all called it H–A" **only** when the revealed picks are
  byte-identical (it already has every pick loaded) — see Change 3.
- `lib/contest-copy.ts` must be **universal** (no I/O, no server-only imports) — it's imported by
  both server pages and the client-bundled `MatchCard`/`MatchFeedCard`. (Same constraint
  `lib/match-board.ts:2` documents.)
- The match screen's reveal grid (`RevealGrid`, `settled`) already renders `result: "void"` as
  "push" (`RevealGrid.tsx:34`), so showing it for `no_separation` Just Works — every row shows
  the pick + "push".
- **RLS:** others' picks are only visible post-lock. A void contest is always past-lock, so the
  RLS-scoped `predictions` read at `m/[id]/page.tsx:149` returns all entrants → the reveal is
  populated. (Verify in QC.)

## System-Wide Impact

- **Interaction graph:** display-only. No callback/trigger/cron path touched. `settle()` →
  `settleFinishedContests` (`lib/settle-contest.ts:73-74`) still writes `status:"void",
  void_reason:"no_separation"` exactly as today; we only *read* that column in more places.
- **Error propagation:** none — pure helper + JSX branches. Unknown/null `void_reason` falls
  through to the safe "VOID" branch (`voidPresentation` default).
- **State lifecycle risks:** none — no writes, no migration, no schema change.
- **API surface parity:** the three `StatusBadge` call sites (`m/[id]/page.tsx:286`,
  `MatchCard.tsx:98`, `MatchFeedCard.tsx:128`) are the full set — all addressed (feed is Change
  5, lower priority).

---

## Change 1 — `lib/contest-copy.ts` (NEW, pure, universal)

```ts
// Presentation copy for void contests — single source of truth so the badge, the league card,
// and the match screen never drift. The MONEY is identical for both void reasons (stakes
// returned, everyone net 0); only the STORY differs. Universal: no I/O, no server-only imports.

export type VoidReason = "insufficient_entries" | "no_separation" | null | undefined;

export interface VoidPresentation {
  badge: string;       // StatusBadge pill label
  cardLine: string;    // one-liner on the league MatchCard
  title: string;       // match-screen headline
  blurb: string;       // match-screen sub-copy
  showReveal: boolean; // whether to show everyone's picks
  tone: "neutral" | "muted"; // styling discriminant (all-square reads positive; void reads muted)
}

export function voidPresentation(reason: VoidReason): VoidPresentation {
  if (reason === "no_separation") {
    return {
      badge: "ALL SQUARE",
      cardLine: "All square — too level to separate · stakes returned",
      title: "All square",
      blurb: "Too level to separate a winner — everyone gets their stake back.",
      showReveal: true,
      tone: "neutral",
    };
  }
  // insufficient_entries (and any unknown/null) — a genuine no-contest
  return {
    badge: "VOID",
    cardLine: "Voided — not enough players entered · stakes returned",
    title: "Contest void",
    blurb: "Not enough players entered — stakes are returned.",
    showReveal: false,
    tone: "muted",
  };
}
```

## Change 2 — `components/ui.tsx` (StatusBadge reads the reason)

`StatusBadge` currently keys label purely on `CardState` (`ui.tsx:18-19`). Make `void` defer to
the helper:

```tsx
import { voidPresentation, type VoidReason } from "@/lib/contest-copy";

export function StatusBadge({ state, voidReason }: { state: CardState; voidReason?: VoidReason }) {
  const b = BADGE[state] ?? BADGE.locked;
  const label = state === "void" ? voidPresentation(voidReason).badge : b.label;
  // ALL SQUARE reads as a completed result, not a failure → mint pill (like SETTLED) instead of grey.
  const cls = state === "void" && voidReason === "no_separation"
    ? "text-primary-press bg-mint"
    : b.cls;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-pill px-2.5 py-1 text-[10px] font-bold tracking-[.06em] ${cls}`}>
      {b.pulse && <span className="h-1.5 w-1.5 rounded-full bg-white animate-live-pulse" />}
      {label}
    </span>
  );
}
```
- `voidReason` is optional → every existing caller that omits it (non-void states) is unchanged.
- The mint tint is a styling choice — confirm legibility in QC; fall back to `b.cls` (grey) if it
  reads too "win-like".

## Change 3 — `app/leagues/[slug]/m/[id]/page.tsx` (the screen the user hit)

1. **Select the reason** (`page.tsx:46-47`): add `void_reason` to the contests select:
   ```ts
   .select("id, league_id, fixture_id, status, void_reason, lock_at, stake_inr, is_knockout, fixtures(...)")
   ```
   and to `FixtureRow`'s sibling — actually `void_reason` is on `contests`, so read `c.void_reason`.

2. **Pass the reason to the header badge** (`page.tsx:286`):
   ```tsx
   <span className="ml-auto"><StatusBadge state={state} voidReason={c.void_reason as VoidReason} /></span>
   ```

3. **Replace the hardcoded void branch** (`page.tsx:327-328`) with a reason-aware block that
   shows the reveal for `no_separation`:
   ```tsx
   ) : state === "void" ? (() => {
       const vp = voidPresentation(c.void_reason as VoidReason);
       // Enrich ONLY when every revealed pick is byte-identical (we already have all picks in `rows`).
       const picked = rows.filter((r) => r.pickLabel !== "—");
       const identical =
         vp.showReveal && picked.length > 1 &&
         new Set(picked.map((r) => `${r.pickLabel}-${r.predHome}-${r.predAway}`)).size === 1;
       const title = identical
         ? `All square — everyone called it ${picked[0].predHome}–${picked[0].predAway}`
         : vp.title;
       return (
         <div className="flex flex-col gap-3">
           <div className="rounded-card border border-border bg-surface p-5 text-center">
             <div className="text-base font-extrabold text-push">{title}</div>
             <div className="mt-1 text-[13px] text-muted">{vp.blurb}</div>
           </div>
           {vp.showReveal && <RevealGrid rows={rows} settled />}
         </div>
       );
     })()
   ) : state === "cancelled" ? (
   ```
   - For `insufficient_entries`: `showReveal` is false → same single-card message as before (now
     sourced from the helper), no grid.
   - `rows` is already built at `page.tsx:145-186`; no new query.

4. Import: `import { voidPresentation, type VoidReason } from "@/lib/contest-copy";`

## Change 4 — `components/MatchCard.tsx` + `app/leagues/[slug]/page.tsx` (league list card)

1. **`MatchCard.tsx` `CardData`** (`MatchCard.tsx:16`): add `voidReason?: VoidReason;`.
2. **`MatchCard.tsx` badge** (`:98`): `<StatusBadge state={d.state} voidReason={d.voidReason} />`.
3. **`MatchCard.tsx` void case** (`:228-233`): source the line from the helper:
   ```tsx
   case "void": {
     const vp = voidPresentation(d.voidReason);
     return (
       <div className="rounded-control bg-subtle px-3.5 py-3 text-center text-[13px] font-semibold text-muted">
         {vp.cardLine}
       </div>
     );
   }
   ```
4. **`app/leagues/[slug]/page.tsx`** — select + populate:
   - `:30` add `void_reason` to the contests select.
   - where `CardData` is assembled (`:76`+): add `voidReason: c.void_reason as VoidReason,`.

## Change 5 — `components/MatchFeedCard.tsx` (home cross-league feed) — IMPLEMENTED (premise corrected)

**Correction after reading the code:** the home feed does **not** show a "VOID" badge to fix.
`StatusBadge` only renders on *upcoming* cards (`MatchFeedCard.tsx:181`); a void fixture routes to
the results `CompactRow`, which renders a dimmed score row with `state=undefined` (no badge) and
no wrong copy. So there was no correctness bug here — but an all-square fixture got *no story* on
the feed (bare "Netherlands 1–1 Morocco · —"), inconsistent with the new league card.

What was actually done (positive enhancement, not a badge fix):
- Added `voidReason` to `FeedEntry` (`lib/match-feed.ts`); selected `void_reason` in
  `lib/home-matches.ts` and set it on each entry (+ test factory default `voidReason: null`).
- `CompactRow` (results): when **every** of the viewer's leagues for the fixture voided with
  `no_separation`, show an **"All square"** mint pill + "· stakes returned" instead of "—". Mixed
  reasons / genuine voids / sat-out keep the existing "—" behaviour.
- The feed remains a roll-up (no per-player picks); the full reveal lives on the match screen.

## Acceptance Criteria

- [ ] KK Bois NED v MAR match screen shows **"All square"** (or "All square — everyone called it
      2–1"), the blurb, and a **reveal grid** with both players' 2–1 + "push". No "not enough
      players" text.
- [ ] Its badge reads **"ALL SQUARE"**, not "VOID".
- [ ] The KK Bois league-list card for that fixture reads "All square — too level to separate ·
      stakes returned" with an "ALL SQUARE" badge.
- [ ] A genuine `insufficient_entries` contest is **unchanged**: "VOID" badge, "not enough
      players entered" copy, no reveal grid.
- [ ] No settlement/scoring change: `npm test` settlement + state golden tests pass untouched.
- [ ] (Change 5, if included) home feed badge reads "ALL SQUARE" only when every void sibling is
      `no_separation`, else "VOID".

## Edge cases & defaults

- **Mirror-tie (not identical):** picks `2–0` and `0–2` at actual 1–1 → `no_separation` but not
  identical → headline falls back to generic "All square"; the reveal grid shows the differing
  picks. (Handled by the `identical` guard in Change 3.)
- **Unknown / null `void_reason`** (legacy rows) → safe default "VOID" branch.
- **Non-entrant viewer** of an all-square contest → still sees "All square" + the reveal of those
  who did predict.
- **`insufficient_entries` with exactly 1 pick** → no reveal (consistent with today). Out of
  scope to show the lone pick.

## Out of scope (don't touch)

- `lib/settlement.ts`, `lib/settle-contest.ts`, scoring/golden tests — the money is correct
  (stakes returned). We only relabel.
- `lib/contest-state.ts` `CardState` machine, `tabForState`, `deriveCardState` — unchanged
  (all-square stays `CardState "void"`, still grouped into "Done"/"past").
- Whether `no_separation` *should* return stakes vs roll over — not raised; settlement stays.

## Verification

1. `npm run typecheck` — clean (new optional `voidReason` prop; `c.void_reason` typing).
2. `npm run build` — succeeds.
3. `npm test` / `npx vitest run` — settlement + contest-state golden tests unaffected; add
   `lib/contest-copy.test.ts` (2 cases: `no_separation` → "ALL SQUARE" + `showReveal`;
   `insufficient_entries`/null → "VOID" + no reveal).
4. UI walk on the **real** KK Bois NED v MAR contest — **read-only** (`/chrome`, logged-in
   session; this is a real league so **view only, never write a pick**):
   - match screen: "All square" headline + reveal grid + "ALL SQUARE" badge;
   - league list: card line + badge correct;
   - confirm a known `insufficient_entries` contest still reads "VOID".
   `chrome-devtools-axi` can't reach the logged-in session, so QC here needs the real browser.

## Deploy (gated — only on user's go-ahead)

`node scripts/stamp-version.mjs` (→ next vNN, commits `lib/version.ts`), then commit the touched
tracked files **explicitly** (no `git add .`), `git push origin main` → Vercel auto-deploys
(bom1). Do not commit/push until asked.

## Sources & References

- Settlement reasons: `lib/settlement.ts:28,64,78`; void write: `lib/settle-contest.ts:73-74`.
- Correct copy already on the live board: `lib/match-board.ts:143-145`.
- Broken surfaces: `app/leagues/[slug]/m/[id]/page.tsx:327-328`, `components/ui.tsx:14`,
  `components/MatchCard.tsx:228-233`.
- Reveal grid handles void→"push": `components/RevealGrid.tsx:34`.
- Badge call sites: `m/[id]/page.tsx:286`, `MatchCard.tsx:98`, `MatchFeedCard.tsx:128`.
- Prod confirmation: KK Bois NED v MAR contest `0ae167b6-…981c03`, `void_reason=no_separation`,
  2 entrants both 2–1, FT 1–1; 11 `no_separation` voids tournament-wide.
