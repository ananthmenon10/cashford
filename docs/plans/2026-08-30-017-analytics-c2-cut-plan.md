# Plan 017 — Analytics C2, cut to what 2 settled gameweeks can feed

## Why
The analytics canon (docs/design/Analytics Tab - Final.dc.html, throwaway/analytics-v5-merged.html)
is fully designed but modules 03/04/06 and two C2 clauses are unbuilt. Two gameweeks are settled.
Build only what shows real numbers at that depth; defer what stays null.

## Build (all designed, all data-fed at 2 settled GWs)
1. **Module 04 — Weekly labels.** Canon spec in docs/plans/2026-08-11-010-analytics-backlog-plan.md
   §"Module 04" (lines ~941-961): latest settled gameweek, four labels (Oracle, Nearly, The Crowd,
   Maverick), explicit bar + unique winner per label, `awarded: null` with a reason on ties/empties
   (a designed state), entrants from `SeasonPickCorpus.gameweeks[].entrantIds`, never today's
   member list. Builder `buildWeeklyLabels(corpusForGameweek)`.
2. **Module 05 clause — biggest swing.** Largest single-fixture `pts` gap between viewer and rival,
   read from `perFixture`, window = the module's existing shared-settled-gameweek intersection.
3. **My-form sparkline / net trend.** Canon Option A frame (throwaway/analytics-v5-merged.html has
   the frame). Two points at 2 GWs is thin but honest; render from settled gameweeks only.

## Defer (would be null/hidden even with 2 complete GWs)
- **Module 06 — Club reads**: canon threshold is ≥5 settled picks per club; a club accrues ≤2
  picks in 2 GWs (one fixture per GW, pick counts for both teams), so the module hides entirely
  until roughly GW5. Revisit then; spec is ready in plan 010 lines ~963-975.
- **Module 03 — Receipts**: blocked on the Share flow, which neither exists nor has a design.

## Constraints
- Perf: reuse the existing corpus/loaders; no second corpus fetch. Respect the §C.1 boundary
  (stored verdicts for scoring facts; prediction-shaped math allowed for margins/modes).
- Fixture keys are `(gwNumber, fixtureId)` end-to-end (Terra's C1 blocker — don't regress it).
- Rivalry must not contradict the Season tab (pairwise tiebreak chain points → exacts → goal_error).
- Untouchable: lib/settlement.ts, lib/settle-contest.ts, lib/gameweek-settle.ts, lib/gameweek-points.ts.
- Tests: builder unit tests first (ties, empties, void-excluded gameweeks); expect suite ≥1199 green.
- Rebase on whatever the query-diet pass changed in lib/gw-season.ts / lib/gw-home.ts /
  analyticsVisible before starting.

## Verify
`npm run typecheck` · `npx vitest run` · `npm run build`; staging deploy for Ananth's logged-in QC.
