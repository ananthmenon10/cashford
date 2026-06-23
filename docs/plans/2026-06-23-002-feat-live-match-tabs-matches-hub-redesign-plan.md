---
title: "feat: Live Match winnings + What-if tabs, then Matches-hub accordion redesign"
type: feat
status: active
date: 2026-06-23
origin: ~/Downloads/Matches + Live Match - Final.dc.html  # design-code handoff (the spec)
---

# Live Match "Live winnings" + "What if" tabs, then the Matches-hub accordion redesign

## Enhancement summary (deepened 2026-06-23)

Reviewed by 7 parallel agents (correctness, TypeScript, architecture, simplicity, security, testing,
Next.js-15/React-19 docs). Key changes folded into the plan below:

- **CRITICAL — knockout advancer guard.** `settlement.ts:34` silently returns `"away"` when
  `advancer` is `undefined`. `buildBoard` must **never** call `settle()` for a knockout without a
  determined advancer: decisive score → advancer = leading side; level (home===away) → short-circuit
  to `status:"undecided"` (no `settle()` call). Enforced in code, not just prose.
- **CRITICAL — knockout ET/penalties divergence.** A knockout that finished level in regulation but
  was decided by extra-time/penalties (e.g. 0–0 AET, advancer=home) has a real stored winner, yet
  `buildBoard` at 0–0 returns "undecided". This breaks the "delta 0 at the final score" promise for
  the What-if tab and would contradict the (authoritative, stored) Results tab. Fix: the settled
  What-if baseline accepts the **real stored advancer** as an override so it reproduces the stored
  result; the live disclaimer reads "based on the live X–Y (regulation)"; the `delta 0` criterion is
  scoped to non-level-regulation outcomes.
- **Simplify — no new `MatchBoard` component.** Reuse the existing `RevealGrid` for every board
  (live / locked / settled / the What-if "everyone" list); render the disclaimer + pot footer as a
  thin wrapper. Map `BoardPlayer[]` → `RevealRow[]` at the call site. (`RevealGrid` has no server-only
  imports, so it is safe inside the client `WhatIf` too.)
- **Simplify — `MatchTabs` → `labels: string[]` + `panels: ReactNode[]`** (drop the `footer` prop;
  move the Predict screen's "Form · H2H →" CTA into the predict panel itself). Removes accidental
  2-tab rigidity at zero added cost.
- **Security — `notentered` exclusion is mandatory.** The new tabs render only when the viewer has a
  prediction (`state !== "notentered"`), so a non-entrant member never ships all entrants' picks to
  the client. Client payload uses an **opaque id** (not the auth `userId`) for non-self rows.
- **Types — reuse the engine's unions.** `BoardPlayer.result` = `settlement.ResultKind`; name a
  distinct `BoardStatus = "settled"|"void"|"undecided"`; `match-board.ts`/`settlement.ts` carry a
  "universal, no server-only imports" comment; replace the `as any` fixture cast (`page.tsx:36`) with
  a typed `FixtureRow`; render logic branches on `status`/`branch`, never on the prose string.
- **Testing — add the cross-module invariant.** A property test asserting `buildBoard` net ≡
  `settle()` net (and `pot` ≡ Σ transfers) for the same input, reusing settlement's own golden
  fixtures — the one test that guarantees no money is ever mis-displayed. Plus explicit
  knockout-undecided (net all 0, `settle()` not called) and me-first tie-break cases.
- **Framework — no `useMemo`/`useTransition`** on the per-tap recompute (5 rows, microseconds);
  `router.refresh()` already preserves the client stepper state; verify no `CountUp` hydration
  warnings; new amber/gold tokens go in `@theme` + `html.dark` (no raw hex).
- **Settling state** gets a distinct "settlement in progress" treatment (not treated as `live`) to
  avoid a brief "too level to call" flash while the cron resolves a penalty winner.

## Overview

Design handoff **`Matches + Live Match - Final.dc.html`** (Jun 23, same `.dc.html` format as the
motion handoff) specifies two screens. The settlement engine from `lib/settlement.ts` is **inlined
verbatim** in the prototype — identical branch logic, layered scoreline tiebreak, and `Σ(net)=0`
invariant — so the build **reuses `lib/settlement.ts` directly and never re-implements the money.**

Two builds, in this order (confirmed):

- **Phase 1 — Live Match detail (`/leagues/[slug]/m/[id]`): two new tabs.** "Live winnings" (the
  pool settled at the *current live score*) and "What if" (an interactive scoreline simulator that
  re-runs `settle()` on every tap). The novel, self-contained, high-value feature. Built first
  because the hub's hero ultimately points *into* it.
- **Phase 2 — Matches hub tab (`MatchesTab.tsx`) redesign.** Accordion live hero with per-league
  P&L, a restyled gold "picks due" banner, and the expandable Next-24h cards aligned to the design.

### Confirmed scope decisions (this session)

1. **Order:** Detail screen first, then hub.
2. **Tab visibility:** the new tabs appear wherever **picks are revealed** — `locked`, `live`,
   `settling`, and settled (`won`/`lost`/`push`). The first tab is **state-adaptive** (provisional
   while live, final once settled, "pending kickoff" while locked); "What if" works in all of them.
   They do **not** appear on `open_*` states (picks are hidden pre-lock by RLS) — those keep the
   existing Predict / Full-insight tabs.
3. **Knockout What-if:** a decisive hypothetical/live score auto-sets the advancer to the leading
   side and settles normally; a **level** score shows "too level to call — would go to extra time"
   and does not settle. Mirrors the existing live-knockout `null` precedent in
   `lib/home-matches.ts:119-147`.

---

## Problem statement

During a live match the detail page (`app/leagues/[slug]/m/[id]/page.tsx:220-232`) shows only a bare
`RevealGrid` (everyone's revealed picks) plus a "You win ₹X" headline once settled. There is **no
provisional P&L** while the match is in play and **no way to explore "what happens if it ends X–Y."**
The settle logic that would answer both already exists, pure and tested — it is simply not surfaced
to the viewer mid-match.

On the hub, the cross-league live rollup (`HubLiveCard`, `MatchesTab.tsx:90-133`) collapses every
league's P&L into a **single** number and links only to the *first* league
(`matchHref(g.leagues[0])`), so a user in three leagues can't see or jump to each league's live
position. The data layer computes per-league `settle()` already but throws away everything except
the sum (`lib/home-matches.ts:119-147`).

---

## Current state (researched — file:line)

### The engine (reuse, don't touch)
- `lib/settlement.ts:62` — `export function settle(preds: Prediction[], actual: Actual, stake: number): Settlement`.
  **Pure, no side effects, no DB.** Input `Prediction { userId, outcome: "home"|"draw"|"away", predHome, predAway }`;
  `Actual { isKnockout, ftHome, ftAway, advancer? }`; returns
  `Settlement { status: "settled"|"void", voidReason?, results: PlayerResult[], transfers }` where
  `PlayerResult { userId, result: "win"|"loss"|"push"|"void", net }` (`settlement.ts:23-31`).
  Branches: outcome-split (`:70`), layered scoreline tiebreak (`:73-78`), void on `<2` entries
  (`:64`) or `no_separation` (`:78`). 19 golden tests (`settlement.test.ts`, `settlement.dataset.test.ts`).
- `lib/settle-contest.ts:28` — `settleContest()` is the **only** writer: claims `locked→settling`,
  reads picks/score, calls `settle()`, persists `contest_results` + `transfers`. **Phase 1 must not
  change this path** — the new tabs are read-only views over the same `settle()`.

### Match detail page
- `app/leagues/[slug]/m/[id]/page.tsx:25` — RSC. Fetches contest+fixture (`:32-36`), the viewer's
  pick/result (`:49-52`), derives `state` via `deriveCardState` (`:56-61`).
- `revealed = c.status !== "open" || lock_at <= now` (`page.tsx:55`) — RLS exposes **all** entrants'
  picks once locked; the page already fetches them for `RevealGrid` (`:130-154`). This is the gate
  the new tabs piggyback on (picks are only sent to the client when revealed).
- `state === "open_*"` → `<MatchTabs predict insight>` (`:188-211`). Non-open revealed states →
  headline + `<RevealGrid rows settled>` (`:220-232`). `tbd`/`void`/`cancelled` → placeholders.
- `AutoRefresh seconds={20}` already mounted for `live`/`settling` (`page.tsx:171`) — the
  provisional board re-renders every 20s for free.
- `components/MatchTabs.tsx` — client ARIA 2-tab shell, **hardcoded** to `["Predict","Full insight"]`
  with a Predict-specific footer CTA (`:9, :59-67`).
- `components/RevealGrid.tsx:15` — server component: `Avatar`, name, `YOU`, pick pill, `predHome–predAway`,
  and **stored** net when `settled`. Renders authoritative `net_inr`, not a recomputation.
- `components/PredictionForm.tsx:174-186` — the `−`/value/`+` score stepper (the visual to mirror in
  What-if); `clampScore` = 0..20 (`:10`).
- `components/FixtureHeader.tsx` — live-score header (`FixtureHeaderData`, `:11-24`); already renders
  `ftHome–ftAway` + a live pill. No stake/player-count line today.

### State machine
- `lib/contest-state.ts:34` — `deriveCardState`; states `open_nopick|open_picked|tbd|locked|live|settling|won|lost|push|notentered|void|cancelled` (`:7-19`).
- `liveLabel(statusDetail, minute)` (`:65`) → "45'" / "HT" / "Pens" etc.

### Hub data layer
- `lib/home-matches.ts:18` — `loadMatchesView(supabase, admin, userId): Promise<MatchesView>`.
- `MatchesView { live, upcoming, past, provisionalByFixture: Record<fixtureId, number|null>, picksDue }`
  (`lib/match-feed.ts`). `provisionalByFixture` is the **aggregate** per fixture only.
- `lib/home-matches.ts:119-147` — already loops live leagues, calls `settle()` per league, but
  **sums** the viewer's net; per-league nets are discarded.
- `FeedEntry { fixtureId, contestId, leagueId, leagueName, leagueSlug, state, stake, pick, net, joined, members }`
  and `MatchGroup { fixture, leagues: FeedEntry[], leagueCount, ... settledNet, ... }` (`match-feed.ts`).
- `components/MatchFeedCard.tsx` — `CardShell` (`:90`) already toggles multi-league expansion into
  `PerLeagueRows` (`:58-87`) with per-league "Pick →"/"Edit →"/settled-net. `matchHref(e)` (`:1`).
- `components/MatchesTab.tsx:90-133` `HubLiveCard`; `:243-259` the picks-due nudge pill; subtabs
  `Next 24h`/`Results` (`:207-219`), `Timeline` + dots (`:61-88`, `:47-59`).

### Live scoring & data model
- Live score arrives via ESPN `pollScores` (cron + page `after()`, `page.tsx:28`); fixture columns
  `ft_home, ft_away, minute, status_detail, status, advancer_team_id` (`page.tsx:33`).
- `contests` (one per league per fixture): `stake_inr, is_knockout, fixture_id, league_id, status, lock_at`.
- `predictions`: `contest_id, user_id, outcome, pred_home, pred_away`. `lock_at = kickoff_at`.

---

## Architecture

```
                          lib/settlement.ts  settle()  ── PURE, the single money source
                                   ▲                         (universal: server + client bundle)
                ┌──────────────────┼───────────────────────────┐
                │                  │                            │
   lib/settle-contest.ts   lib/match-board.ts (NEW, pure)   (no other callers)
   (cron writer, untouched) buildBoard(players, score, opts)→BoardVM
                                   ▲                ▲
                 server-render     │                │  client (interactive, imports buildBoard only)
   board = RevealGrid (REUSED) +   │                │  components/WhatIf.tsx
   disclaimer/pot wrapper          │                │  (steppers + chips re-run buildBoard → RevealGrid)
                                   │                │
                          app/leagues/[slug]/m/[id]/page.tsx
                  (revealed && entered && !open → <MatchTabs labels panels/>)
```

**Phase 1 adds zero DB writes and no migration.** Both tabs are read-only computations over picks
the page already fetches. **Phase 2 adds one in-memory field** to `FeedEntry` (per-league
provisional) — still no migration.

---

## PHASE 1 — Live Match: "Live winnings" + "What if"

### Unit 1.1 — `lib/match-board.ts` (NEW, pure, unit-tested)

The presenter that wraps `settle()` into a view-model for any score (live, hypothetical, or final).
React port of the prototype's `vm(h,a)` (design lines 234-249), money delegated to the real engine.

```ts
// lib/match-board.ts
// UNIVERSAL, pure — no I/O, no server-only imports (safe in server AND client bundles).
// Money lives in lib/settlement.ts; this file only shapes a view-model. Keep it import-clean.
import { settle, type Outcome, type ResultKind } from "@/lib/settlement";

export interface PlayerPick {
  id: string;          // opaque + stable; server passes userId, CLIENT payload passes an opaque token (never the auth UUID)
  name: string; isMe: boolean;
  outcome: Outcome; predHome: number; predAway: number;
}
export interface BoardPlayer extends PlayerPick {
  net: number; result: ResultKind; pickLabel: string; // result reuses the engine union; pickLabel = "BRA 2–1"
}
export type BoardBranch = "split" | "closest-all" | "closest-none" | "void" | "undecided";
export type BoardStatus = "settled" | "void" | "undecided"; // NOT settlement.Settlement["status"] — "undecided" is board-only (no settle() call)
export interface BoardVM {
  status: BoardStatus;        // void = <2 players or no_separation; undecided = level knockout
  rows: BoardPlayer[];        // net desc, isMe first on ties, then id asc (deterministic)
  you: BoardPlayer | null;
  winnerNames: string;        // "you & Dev"  (winners[] is NOT exposed — derive the string here)
  branch: BoardBranch;        // control-flow discriminant for styling (reason-card bg, icon)
  reason: string; reasonIcon: string; // DISPLAY ONLY — never branch rendering logic on these strings
  outcomeShort: string;       // "BRA WIN" | "DRAW" | "ARG WIN" (team shorts)
  pot: number;                // = Σ settle().transfers.amount  (do NOT re-derive as #losers×stake)
  ahead: number; behind: number; // #(net>0) / #(net<0)
}

export function buildBoard(
  players: PlayerPick[],
  score: { home: number; away: number },
  opts: {
    isKnockout: boolean; stake: number; homeShort: string; awayShort: string; meId: string;
    advancerOverride?: "home" | "away"; // settled knockouts pass the REAL stored advancer (ET/pens)
  },
): BoardVM
```

Rules (correctness-critical — `settle()` does NOT defend these for us):
- **Knockout advancer guard (decision 3) — load-bearing.** `settlement.ts:34` silently returns
  `"away"` when `advancer` is `undefined`, so `buildBoard` must **resolve the advancer before any
  `settle()` call**: `advancerOverride ?? (home>away ? "home" : home<away ? "away" : null)`. If it
  resolves to `null` (level, no override) → **short-circuit**: return `status:"undecided"`, **never
  call `settle()`**, `rows` with `net:0`, reason = "Too level to call — a knockout would go to extra
  time. No result yet." Only call `settle()` with a concrete `"home"|"away"` advancer.
- **`advancerOverride`** lets a *settled* knockout decided by ET/penalties (real `advancer_team_id`,
  but a level 90' score) reproduce the stored result instead of showing "undecided" — see Unit 1.5
  baseline. Live/locked never pass it (the real advancer isn't known yet).
- Non-entered players are excluded **by the caller** before `buildBoard` (see 1.5); `PlayerPick.outcome`
  is always a valid `Outcome`. A malformed/empty outcome reaching `settle()` would be mis-graded.
- Map `settle()` `results` → `BoardPlayer.net/result`; sort net desc, `isMe` first on tie, then `id` asc.
- `pot = Σ settle().transfers.amount`; `ahead = #(net>0)`, `behind = #(net<0)`. (A tiebreak winner who
  nets ₹0 via integer division is `result:"push"`, counted in neither — acceptable; documented in tests.)
- Reason prose = the four-branch copy from design lines 244-247, parameterised by `winnerNames` and the
  outcome phrase. **Prose lives here; money lives in settle(); styling branches on `branch`/`status`.**

### Unit 1.2 — `lib/match-board.test.ts` (NEW)
Vitest. The 19 golden tests own the **money**; this file owns the **VM mapping + the new knockout/
undecided logic + the cross-module invariant.** Do not re-test settle()'s arithmetic.

- **P1 — cross-module invariant (the test that guarantees no money is mis-displayed):** for 2–3 of
  settlement's own fixtures (a 1-winner, a multi-winner floor/remainder, a 2-winner case), call
  `settle()` and `buildBoard()` on identical input and assert `boardRow.net === settle().results[id].net`
  for **every** id, and `vm.pot === Σ settle().transfers.amount`.
- **P2 — knockout-undecided (new logic, no settle() parallel):** (a) level score, mixed home/draw/away
  → `status:"undecided"`, `rows.every(r => r.net === 0)`, reason includes "extra time"; (b) level score,
  **all picked the same outcome** → still `"undecided"` (NOT `settle()`'s `no_separation` void — confirms
  the short-circuit fires first). (c) decisive knockout score → settles with the leading-side advancer;
  `advancerOverride` reproduces a stored ET/pens result at a level score.
- **P3 — me-first tie-break:** two players tied on net where `meId` sorts alphabetically **last** by id
  → assert `rows[0].isMe === true`. (Otherwise me-first is untestable noise.)
- **P4 — you.net sign:** `meId` as a loser → `you.net < 0, result:"loss"`; as a winner → `> 0, "win"`.
- **P5 — winnerNames wiring:** `meId` among winners → contains "you"; not a winner → does not.
- void: `<2` players → `status:"void"`; `no_separation` (all identical, non-knockout) → `"void"`.
- `N=2` (the minimum non-void) → `ahead:1, behind:1, pot:stake`. `outcomeShort` per outcome.

### Unit 1.3 — Board panel: REUSE `RevealGrid` (no new component)
`RevealGrid` (`components/RevealGrid.tsx`) already renders exactly the row shape we need — Avatar, name,
YOU pill, pickLabel, `predHome–predAway`, and a conditional net column (`settled` flag hides it). It has
no server-only imports, so it is also safe to render inside the client `WhatIf`. **Do not build a
`MatchBoard` component.** Instead, on the page, render the board as a thin wrapper around `RevealGrid`:

```tsx
// inline on page.tsx (server) — map BoardPlayer[] → RevealRow[]
const boardRows: RevealRow[] = (variant === "settled" ? rows /* existing stored rows */ :
  liveVm!.rows.map(p => ({ userId: p.id, name: p.name, isMe: p.isMe, pickLabel: shortLabel(p),
                           predHome: p.predHome, predAway: p.predAway, result: p.result, net: p.net,
                           winner: p.net > 0 })));
// variant="live": gold provisional strip above + "₹{pot} in the pot · {ahead} ahead · {behind} behind"
//   footer + a "Play out a result · What if →" affordance (rendered in the predict-equivalent panel,
//   not as a MatchTabs footer prop). Disclaimer copy: "Provisional — based on the live {h}–{a}
//   (regulation). Winnings settle at full time and move with every goal."
// variant="locked": <RevealGrid rows={picksOnly} settled={false}/> + "Standings appear once the match
//   kicks off." (NO buildBoard call — see null-safety in 1.5.)
// variant="settled": the EXISTING headline + <RevealGrid rows settled/> (authoritative stored net).
```

Live nets use `<CountUp kind="inr">` so they re-roll as the score changes across the 20s refresh.

### Unit 1.4 — `components/WhatIf.tsx` (NEW, client component)
Interactive simulator. Imports **only `buildBoard`** (never `settle()` directly — one client entry point
into the engine). Plain recompute-in-render — **no `useMemo`/`useTransition`** (5 rows, microseconds;
React 19 adds no pressure here).

```tsx
// components/WhatIf.tsx  ("use client")
export function WhatIf({ players, stake, isKnockout, homeShort, awayShort, meId, baseline }: {
  players: PlayerPick[];          // opaque ids only — NO auth UUIDs for non-self rows
  stake: number; isKnockout: boolean; homeShort: string; awayShort: string; meId: string;
  baseline: { score: { home: number; away: number }; youNet: number;
              advancerOverride?: "home" | "away" } | null; // live → live score; settled → final + real advancer; locked → null
})
```

State `{ h, a }`, init `baseline?.score ?? { home: 0, away: 0 }`. Each change → `buildBoard(players,
{home:h,away:a}, {isKnockout, stake, homeShort, awayShort, meId, advancerOverride: baseline?.advancerOverride})`,
then render:
- **Score steppers** — `−`/value/`+`, **clamp 0..20** (matches `PredictionForm.tsx:10` so any real
  saved pick is reproducible → delta 0 holds; the design's 0..9 was demo-only). Inline the stepper
  visual from `PredictionForm.tsx:174-186` (don't touch PredictionForm — Rule 3).
- **Outcome chip** `vm.outcomeShort`; **quick-pick chips** `[1-0,2-1,2-0,1-1,0-0,0-1,1-2]` (design `:273`).
- **Reason card** — `vm.reasonIcon` + `vm.reason`; bg chosen by `vm.branch` (gold for closest, neutral
  for split). **Never branch on the prose string.**
- **"YOU'D WIN/LOSE/BREAK EVEN ₹X"** card from `vm.you.net`; delta line `baseline ? "vs {live|final}
  ▲/▼ ₹{|you.net − baseline.youNet|}" : —`. `baseline.youNet` is a `number` (page passes `?? 0`).
- **"EVERYONE · IF IT FINISHES {h}–{a}"** board — reuse `RevealGrid` with `vm.rows` mapped to `RevealRow`.
- `vm.status === "undecided"` → hide payouts, show the "too level" reason only.
- **No DB writes, no router calls, no action import.** This is the one component that must never reach
  `submitPrediction`.

### Unit 1.5 — Tab shell + page wiring

**Generalise `MatchTabs.tsx` to arrays** (drop the named props and the speculative `footer` prop; the
keyboard modulo becomes `% labels.length`). Keep the ARIA pattern, `useId`, `hidden` toggle, and the
hydration-safe default (`useState(0)`, no `window`/`localStorage` read) **unchanged**:

```tsx
export function MatchTabs({ labels, panels }: { labels: string[]; panels: ReactNode[] })
```
- Predict call site (`page.tsx:188`) → `labels={["Predict","Full insight"]}`; the "Form · H2H →"
  shortcut moves **into the predict panel content** (so the shell stays content-agnostic).
- Live screen → `labels={[variant==="live"?"Live winnings":variant==="locked"?"Standings":"Results","What if"]}`,
  `panels={[<board panel>, <WhatIf/>]}`, default tab 0.

**`page.tsx` branch** — replace the non-open `else` (`:220-232`). The gate is **`revealed && entered`**:

```tsx
// FIRST: type the fixture (replace the `as any` at page.tsx:36):
interface FixtureRow { external_id: number|null; round: string; group_label: string|null;
  home_label: string; away_label: string; home_team_id: string|null; away_team_id: string|null;
  kickoff_at: string; status: string; status_detail: string|null;
  ft_home: number|null; ft_away: number|null; minute: number|null; venue: string|null;
  advancer_team_id: string|null; }
const f = (Array.isArray(c.fixtures) ? c.fixtures[0] : c.fixtures) as FixtureRow;

const entered = state !== "notentered";          // viewer has a prediction
const showLiveTabs = revealed && entered &&
  ["locked","live","settling","won","lost","push"].includes(state);   // EXCLUDES open_*, tbd, void, cancelled, notentered

// players: built from the EXISTING rows fetch (:130-154), via the RLS-scoped client only — never admin.
// id is an OPAQUE token (index), not the auth userId, for non-self rows.
const players: PlayerPick[] = rows.filter(r => r.pickLabel !== "—")
  .map((r, i) => ({ id: r.isMe ? "me" : `p${i}`, name: r.name, isMe: r.isMe,
                    outcome: outcomeOf(r), predHome: r.predHome, predAway: r.predAway }));

const liveScore = f.ft_home != null && f.ft_away != null ? { home: f.ft_home, away: f.ft_away } : null;
const variant = (state === "live") ? "live" : state === "settling" ? "settling"
              : state === "locked" ? "locked" : "settled";
// buildBoard ONLY when there's a usable score AND enough players (≥2). null otherwise (locked / 10s skew).
const liveVm = (variant === "live" && liveScore && players.length >= 2)
  ? buildBoard(players, liveScore, opts) : null;
```

Then render the tabs (board panel per Unit 1.3; settled = stored `RevealGrid`). **`settling`** is its
own variant: render the board with a "Settlement in progress…" note rather than a live recompute
(prevents a "too level" flash while the cron resolves a penalty winner). The settled What-if baseline
passes the **real** advancer: `advancerOverride = f.advancer_team_id === f.home_team_id ? "home" : "away"`
(only for knockouts) so stepping to the final score reproduces the stored net.

Guardrails (state explicitly — none are type-enforced):
- **`notentered`/`void`/`cancelled`/`tbd` keep today's placeholders** — the new tabs never render for them.
- **Picks come from the RLS-scoped client only** (`page.tsx:133-137`), never the service-role/admin client.
- **Client payload carries no auth UUIDs** for other players (opaque `p{i}`); only `isMe` distinguishes self.
- **10s RLS skew:** RLS reveals others' picks at `lock_at <= now()-10s` (migration), but `revealed`
  (`page.tsx:55`) has no margin → for ≤10s post-lock `players` may hold only the viewer's row →
  `buildBoard` would be `<2` → board shows "Standings appear shortly," not a broken/empty payout.

### Unit 1.6 — Header meta line
Add "Group X · ₹{stake} stake · {N} players" beneath `FixtureHeader` on `page.tsx` (N = `players.length`).
Render it on the page (don't widen `FixtureHeader`'s contract). Design `:133`.

### Phase 1 verification
- `npm run typecheck`, `npm run build`, `npx vitest run` (new `match-board.test.ts` incl. the P1
  cross-module invariant + existing 19 settle golden tests green).
- **Framework checks:** confirm `buildBoard` recompute needs no `useMemo`; `AutoRefresh` uses
  `router.refresh()` (preserves the What-if stepper state — do NOT switch to reload); check the browser
  console for **`CountUp` hydration warnings** on the live board after the first refresh (mount-then-
  animate or `suppressHydrationWarning`); new amber/gold tokens in `@theme` + `html.dark` (no raw hex —
  check `docs/design/Cashford System.dc.html §07`).
- Browser QC (logged-in `/chrome`): a **revealed** contest. If no real WC match is live, QC What-if on
  a `settled` and a `locked` contest, and seed a live fixture via the untracked `scripts/qa-live.mjs`
  for the provisional path. Verify: live P&L ≡ `settle()` at the live score; **on the What-if tab**,
  stepping to the live/final score reproduces it (delta 0) — test this against a **settled, decisive**
  contest where the real advancer is known (level-regulation knockouts are exempt by design); a live
  knockout where one side leads can invert the whole winner set on a goal (provisional, expected);
  reduced-motion + dark mode render correctly.

---

## PHASE 2 — Matches hub redesign

### Unit 2.1 — per-league provisional in the data layer
`lib/home-matches.ts:119-147` already calls `settle()` per live league (via the **RLS-scoped** client
over picks RLS already returned — not the admin client). Stop discarding the per-league net: write
each league's provisional onto its `FeedEntry`.

```ts
// lib/match-feed.ts — FeedEntry gains:
// non-null only for state==="live"; populated by home-matches.ts, NOT by match-feed.ts's pure core.
provisional: number | null;   // viewer's provisional net in THIS league at the live score; null if uncomputable
```
Keep `provisionalByFixture` (consumed by `HubLiveCard`/alert). **Null-propagation rule (make explicit):**
the fixture-level value = sum of the per-league `provisional`s **treating `null` as "exclude"** (a
league with `<2` entrants contributes nothing); if **all** are null, the fixture value is `null`. No
migration (in-memory shape only).

### Unit 2.2 — `components/HubLiveHero.tsx` (NEW, client) — accordion hero
Replaces `HubLiveCard` for live groups. Collapsed = today's content (score rows + "Your picks ·
{aggregate} on track" + "{leagueCount} leagues ▾"). Expanded (when `leagueCount > 1`) = per-league
rows: `league name · pick · {provisional} net pill · ›`, each a `<Link href={matchHref(entry)}>` into
**that** league's live match (design `:48-55`). `leagueCount === 1` → no chevron, whole card links.
Reuse the motion conventions already shipped (`cf-press`, chevron rotate via the `chev()` pattern;
`<CountUp kind="inr">` for the nets).

### Unit 2.3 — gold "picks due" banner (restyle)
Restyle `MatchesTab.tsx:243-259` into the design's gold card (design `:60`): "**{count} picks due** /
Earliest locks in {Countdown} / Predict →". Same `picksDue { count, earliestLockIso }` data; link to
the earliest-due contest (or the Next-24h subtab). Re-tokenize the gold to `var(--color-amber-bg/fg)`.

### Unit 2.4 — Next-24h cards (NARROW restyle — most of this already exists)
**Do NOT rewrite `MatchFeedCard`, `CardShell`, or `PerLeagueRows`.** The review confirmed the
collapsed "Locks in {Countdown}" + "in N leagues ▾" pills (`UpcomingFull` ~`:177-180`), the per-league
"Pick →"/"Edit →" expansion (`PerLeagueRows` + `CardShell`, `:58-117`), and single-league whole-card
links (`:103-107`) **already exist**. Rebuilding them risks regressing the expand/collapse + pick-rollup
logic. The only genuinely new work:
- **Timeline dot styling** — gold-with-ring when `needsPick`, grey when picked (`MatchesTab.tsx:47-59`):
  CSS token tweak to match the design's ring (design `:73,:95`).
- **Optional** `TODAY` → `TONIGHT` label rename (design) — flag, don't block.
- Any green "Make pick ▾" CTA alignment is a class change on the existing unpicked-open branch, not new structure.

Estimate: ~10 lines changed. If a card affordance looks off, restyle the existing branch — don't add one.

### Phase 2 verification
- typecheck/build/vitest. The provisional math is `settle()` (already tested); `loadMatchesView` is
  Supabase-coupled (no unit seam) — rely on settle tests + browser QC (light/dark, 360/480px):
  hero expands to per-league rows; each row opens the correct league's live match; per-league nets
  sum to the hero aggregate; gold banner + Next-24h Pick/Edit affordances render and navigate.

---

## System-wide impact

- **Interaction graph:** `page.tsx` (RSC) → `buildBoard` (pure) → server-render `MatchBoard`;
  `AutoRefresh(20s)` re-fetches live score → board re-renders. `WhatIf` is client-only, recompute on
  tap, **no** server round-trip, **no** action call. `settle()` has no callbacks/DB. The cron
  settle path (`settle-contest.ts`) is **untouched**.
- **API-surface parity:** the only `settle()` callers become `settle-contest.ts` (writes, authoritative)
  and `buildBoard` (read-only view). Same engine, same result for the same input → the live/what-if
  numbers will match the eventual settlement at the final score (modulo the real advancer, which
  settled state takes from the stored result, not a recompute).
- **Error/empty paths:** `<2` revealed entrants → `buildBoard` → `status:"void"` ("not enough players").
  Locked/no score → picks-only board. Level knockout → `"undecided"`.
- **State lifecycle:** read-only; no orphaned rows, no caches.
- **Privacy/RLS:** picks reach the client only via the existing `revealed` gate; the new tabs render
  only for revealed, non-open states — never pre-lock.

## Acceptance criteria

### Phase 1
- [ ] `lib/match-board.ts` `buildBoard()` reuses `lib/settlement.ts` (no duplicated money logic);
      `match-board.test.ts` green incl. the **P1 cross-module invariant** (buildBoard net ≡ settle()
      net, pot ≡ Σ transfers), knockout-undecided (net all 0, settle() not called), and me-first tie-break.
- [ ] On a `live` contest: the board shows each player's pick + provisional net at the live score,
      "₹{pot} in the pot · {ahead} ahead · {behind} behind", and the "(regulation)" provisional
      disclaimer; nets ≡ `settle()` at that score and update on the 20s `router.refresh()`.
- [ ] A "What if" tab (steppers clamp 0..20 + 7 quick-pick chips) re-runs `buildBoard` on every change
      (no `useMemo`), showing the branch-reason explainer, "YOU'D WIN/LOSE ₹X · vs {live|final} ▲/▼ ₹Y",
      and an everyone-board. Stepping to the live/final score reproduces it (**delta 0**) for
      non-knockout and **decisive** knockout outcomes (level-regulation knockouts are exempt and use
      `advancerOverride` to reproduce the stored result).
- [ ] Tabs appear for `locked` (Standings, no nets) / `live` (Live winnings) / `settling` (Settlement
      in progress) / settled (Results = authoritative stored board). `open_*`, `tbd`, `void`,
      `cancelled`, **and `notentered`** behave exactly as today (new tabs never render for them).
- [ ] Knockout: decisive → leading side advances; level → "too level to call," no payout, `settle()`
      never called with an undefined advancer.
- [ ] Client payload contains **no auth UUIDs** for other players (opaque ids); picks sourced from the
      RLS-scoped client only; `WhatIf` imports only `buildBoard` and calls no action.
- [ ] No new DB writes, no migration; `MatchTabs` generalised to `string[]`/`ReactNode[]` without
      regressing the Predict screen; no `CountUp` hydration warnings on the live board.

### Phase 2
- [ ] `FeedEntry.provisional` populated per league; per-league nets sum to the hero aggregate.
- [ ] The live hero expands (when in >1 league) to per-league rows that each open that league's live
      match; gold picks-due banner and Next-24h Pick/Edit affordances render and navigate.
- [ ] Light + dark + 360/480px verified; all design hex re-tokenized to semantic vars.

## Decisions resolved during deepening (build to these)
- **No `MatchBoard` component** — reuse `RevealGrid` for every board (live/locked/settled + the
  What-if everyone list); the disclaimer + pot footer are a thin wrapper. Map `BoardPlayer[]` →
  `RevealRow[]` at the call site.
- **`MatchTabs` → `labels: string[]` + `panels: ReactNode[]`**, no `footer` prop; the Predict screen's
  "Form · H2H →" CTA moves into the predict panel content.
- **Score stepper inlined** in `WhatIf` (Rule 3 — don't touch `PredictionForm`), **clamp 0..20** to
  match the prediction range so delta-0 reproduction holds for any real saved pick.
- **`BoardVM`** drops `winners[]` (derive `winnerNames`); keeps `branch` (drives reason-card styling).
- **First-tab label** is variant-driven ("Live winnings" / "Standings" / "Results" / settling note).

## Out of scope (don't touch)
- `lib/settlement.ts` (add only a one-line "universal module" comment so a future `server-only`
  annotation doesn't break the `WhatIf` client path), `lib/settle-contest.ts`, the cron tick, RLS,
  ESPN polling, `fixture_insights`.
- The Predict / Full-insight tabs and the `open_*` flow.
- `MatchFeedCard` / `CardShell` / `PerLeagueRows` internals (Phase 2 is a CSS-token restyle only).
- Any DB schema change (both phases are compute/presentation only).
- The no-live `NextUpCard` hub state (design only specifies the live hero).
- **Per-user provisional caching.** The per-league `settle()` loop in `home-matches.ts:119-147` runs
  per home-tab render; fine at friend-group scale. If concurrent home-tab load ever grows (~50+),
  a `(userId, fixtureId, scoreHash)` cache is the future seam — explicitly deferred, not forgotten.

## Deploy (gated — only on the user's go-ahead)
Established Cashford flow: build locally → `npm run typecheck && npm run build && npx vitest run`
green → `node scripts/stamp-version.mjs` (commit `lib/version.ts`) → deploy to
`cashford-staging.vercel.app` and self-test in the logged-in browser **before** asking for QC. Push
to `main` only after sign-off (auto-deploys prod). Do not commit/push until asked; never `git add .`.

## Sources & references
- **Origin (the spec):** `~/Downloads/Matches + Live Match - Final.dc.html` — inlined `settle()`
  (lines 213-233) ≡ `lib/settlement.ts:62`; `vm()` view-model (`:234-249`); Live-winnings board
  (`:138-149`); What-if board (`:153-179`); accordion hero (`:41-57`); expandable cards (`:71-116`).
- Engine: `lib/settlement.ts:62`. Writer (untouched): `lib/settle-contest.ts:28`.
- Detail page: `app/leagues/[slug]/m/[id]/page.tsx:55,130-154,188-232`. Tabs: `components/MatchTabs.tsx`.
- Board precedent: `components/RevealGrid.tsx:15`. Stepper: `components/PredictionForm.tsx:174-186`.
- State: `lib/contest-state.ts:34,65`. Hub data: `lib/home-matches.ts:18,119-147`; `lib/match-feed.ts`
  `FeedEntry`/`MatchGroup`/`MatchesView`. Hub UI: `components/MatchesTab.tsx:47-133,243-259`;
  `components/MatchFeedCard.tsx:58-118`.
- Related plans: predict-screen tabbed insights `docs/plans/2026-06-20-003-...`; motion system
  `docs/plans/2026-06-23-001-...` (reuse `CountUp`/`cf-press`/chevron conventions).
