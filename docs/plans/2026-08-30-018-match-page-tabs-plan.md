# Plan 018 — Match page as tabs (S1) + lineups, player stats, shot map

## Why
Plan 015 shipped the data plumbing for lineups, player stats, and shots but left them hidden.
The design round is done and Ananth picked:
- **Structure S1** — FotMob-style tabs (docs/design/throwaway/match-page-structure-options.html, frame S1).
- **A1** lineups — two mini-pitches with formation-derived pins (match-lineups-variants.html).
- **B5 + B7** player stats — B7 top-performer spotlights lead, B5 FPL-style event ledger follows
  (match-player-stats-variants.html). Compare bars from B7 optional; cut if they crowd mobile.
- **C blend** shot map — C1 mirrored single pitch + C2's cumulative-xG race graph + C4's outcome
  ledger detail (match-shotmap-variants.html).
The single-scroll page is already long post-match; tabs keep the Cashford layer (calls, room,
what-if) first without burying the new football content.

## Shape of the change

### 1. Tab shell (components/Phase4MatchDetailPage.tsx + new client component)
`app/m/[fixtureId]/page.tsx` stays a server component. New `components/matches/MatchTabs.tsx`
(`"use client"`) receives the already-serializable `MatchDetailView` slices and owns tab state.
- Sticky compact bar: score/status line + tab chips, pinned under the page top on scroll
  (S1 frame is canon for the look; cs2 tokens).
- Tab in the URL: `?tab=` alongside the existing `?league=` param, written with
  `history.replaceState` (no server round-trip, back button keeps the match page). Unknown or
  missing value → Overview.
- A tab renders only when its block has data; with no data beyond Overview, no tab bar at all
  (pre-match with no insights, TBD knockout fixtures).

Tab sets by state:
- **pre**: Overview (calls · what-if · race link · room) | Insights (existing Odds/Form/H2H/
  Table/TeamNews modules, unchanged) — plus Lineups if ESPN posts XIs before kickoff.
- **live**: Overview (Cashford layer + timeline) | Lineups | Stats (team stats) | Plays (commentary).
- **post**: Overview (Cashford layer + retrospective + timeline) | Lineups | Stats (team stats +
  player stats blocks) | Shots | Plays.
Timeline stays on Overview in live/post — it is the "what happened" spine and pairs with the
what-if line. Existing xG total + ratings modules move into the Shots and Stats tabs
(XgModule under Shots next to the race graph; RatingsModule under Stats — it already hides
itself when the feed is null, which it currently always is).

### 2. Typed boundary (lib/match-detail.ts)
The view already carries `playerStats`, `lineups`, `shotMap` as `unknown` payloads. Add coerce
functions next to the existing ones (`coerceTimeline`, `coerceTeamStats`) and type the view:
- `coerceLineups` → `{ formation: string; players: { name: string; shirt: number | null }[] }`
  per side; null unless both XIs parse with ≥7 players each.
- `coercePlayerStats` → rows `{ name, team, goals, assists, totalShots, shotsOnTarget, saves,
  goalsConceded, yellowCards, redCards }`. **rating is null on every real row — drop it at the
  boundary; nothing downstream may read it.**
- `coerceShots` → `{ x, y, xg, minute, player, team, result }`, x/y clamped to 0–1, xg ≥ 0.
Golden sample: the TOT–NEW fixture payload already saved at
docs/design/throwaway/match-blocks-sample-data.json — unit-test the coercers against it.

### 3. Derived stats (new lib/match-blocks.ts, pure + tested)
- `playerXg(shots)` — per-player xG by summing that player's shots (Wissa 0.115+0.507=0.62 in
  the golden fixture). Feeds B7 spotlights and B5's Danger category.
- `xgRace(shots)` — per-team cumulative xG series by minute for the C2 graph, including the
  final combined total.
- `spotlights(rows, shots)` — picks B7's top performers (goals, then assists, then xG, then
  keeper saves) with tie rules pinned in tests.
- `eventLedger(rows)` — B5 categories (Goals, Assists, Cards, Keeper, Danger) as
  home/away name+count pairs, contributors only. **No defensive-contribution category — ESPN
  gives no tackles/CBI/recoveries; don't fake one.**

### 4. New render components (components/matches/)
- `LineupsBlock.tsx` — A1: two mini-pitches, rows derived from the formation string, pin =
  shirt number + surname. Formation string it can't parse → fall back to 1-row-per-line split
  by count, never crash.
- `PlayerStatsBlock.tsx` — B7 spotlight cards then B5 ledger.
- `ShotsBlock.tsx` — C1 SVG pitch (away shots mirrored x'=1−x; keep the coordinate-assumption
  comment from the throwaway), dot size = xG, color = result; C2 race graph; C4 outcome ledger
  (tap/da click a shot → detail row). SVG inline, no chart lib.
All three read only typed view slices; the throwaway files are the visual canon (cs2 tokens,
Hanken Grotesk / Geist Mono, light + dark).

### 5. Copy
New strings go in lib/match-copy.ts like everything else on this page.

## Defer / out of scope
- Momentum + predicted XI (columns exist, never populated — provider path is a separate
  investigation).
- Player ratings anywhere (null in feed).
- B7 team-compare bars if they don't fit 480px cleanly — log the cut in implementation-notes.md.
- Matches list / home tab untouched.

## Constraints
- Untouchable: lib/settlement.ts, lib/settle-contest.ts, lib/gameweek-settle.ts,
  lib/gameweek-points.ts.
- No new Supabase queries — everything renders from the view `buildMatchDetailView` already
  returns. `lib/match-detail.ts` changes are coercion + typing only; no fetch changes.
- Keep the Sourced stale/ok badges working on the new blocks like the existing modules.
- Room reveal rules and deep links (`?league=`) must survive the tab shell; `?tab=` composes
  with them.
- Mobile-first: 560px container stays; tabs must work at 360px.

## Verify
`npm run typecheck` · `npx vitest run` (new tests for coercers + match-blocks builders; suite
stays green) · `npm run build`. Then staging deploy and Ananth's logged-in QC on the TOT–NEW
fixture (post state) plus one pre-kickoff fixture (Insights tab, no Shots/Stats tabs) and one
TBD fixture (no tab bar). No prod push until he says ship.
