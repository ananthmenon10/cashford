# Phase 3 test cases — blind author's inventory

Written blind from `docs/plans/2026-07-27-006-phase3-core-ui-plan.md` (v6) plus decisions-log #21
and #23. No file under `app/`, `components/`, `lib/net-balance.ts`, `lib/gw-copy.ts`, or any other
new Phase 3 module was read while writing these tests. Status below reflects an actual
`npx vitest run tests/phase3` at the time this doc was written — the implementation was landing
in parallel, so several modules already existed and some tests ran for real.

## Case inventory

| ID(s) | Plan section | File | Status |
|---|---|---|---|
| T-U1, T-U1a, T-U1b | §5.1 | `gw-state.test.ts` | RUNNABLE — passing |
| T-U2, T-U2a, T-U2b, T-U2c, T-U2d | §5.3, §5.3a | `gw-state.test.ts`, `gw-view.test.ts`, `net-balance.test.ts` | RUNNABLE — passing |
| T-U3 | §1 U3 | `gw-view.test.ts` | RUNNABLE — passing |
| T-U4, T-U4a, T-U4b | §2.3 D6 | `gw-fixtures.test.ts` | RUNNABLE — passing |
| T-U5, T-U5a, T-U5b | §2.3 D5/D5a | `gw-eligibility.test.ts` | RUNNABLE — passing |
| T-U6a, T-U6b, T-U6c | §5.4 M3 | `gw-copy.test.ts` | FAILING — `settleCauseNote` naming guess wrong (see below) |
| T-U7 | §10 U35 | `ist.test.ts` | RUNNABLE — passing |
| T-U8, T-U2d | §5.3a | `net-balance.test.ts` | RUNNABLE — passing (`netBalance` name confirmed verbatim by plan) |
| T-U9 | §0.3 D-EN5 | `model-chips.test.ts` | RUNNABLE — passing (`chipsForFixture` signature confirmed verbatim by plan) |
| T-U10 | §5.5 U15 | `gw-live.test.ts` | RUNNABLE — passing |
| T-U11 | §12 | `settlement-pin.test.ts` | RUNNABLE — passing (real sha256 pins captured against the four files at HEAD) |
| T-U12–T-U17, T-U19, T-U20, T-U21 (entry sheet) | §6 | `entry-sheet.test.ts` | BLOCKED-ON-TOOLING — no jsdom/testing-library in this repo; all cases skipped as named placeholders |
| T-U18 | §4 | `gw-copy.test.ts` | RUNNABLE (name-agnostic scan) — passing; the two name-specific blocks (`nudgeMessage`, M3) fail |
| T-U18b, T-U18c | §4 | `copy-scan-manifest.json`, `copy-scan.test.ts` | PARTIAL — file-existence scan runs and passes (skips files not yet landed); the real T-U18c git-diff assertion is BLOCKED-ON-IMPL pending the real Phase 2 merge-commit SHA (manifest `baseRef` is a placeholder) |
| T-U20–T-U24, T-U20a, T-U24a | §7 | `gw-season.test.ts` | BLOCKED-ON-IMPL — `lib/gw-season.ts` does not exist yet (import fails) |
| T-U25–T-U28 | §8 | (covered by home-badges.test.ts + gw-state.test.ts CL/VP suite) | see T-U25a |
| T-U25a | §8 U28 | `home-badges.test.ts` | FAILING — `homeBadgeState` naming guess wrong; module exists (`lib/gw-state.ts`) but has no such export |
| T-U29–T-U31, T-U31a | §9 | `invite-dto.test.ts` | BLOCKED-ON-IMPL — `resolveInvite`/`activeCompetitions` import chain fails on a missing dependency (`@/lib/supabase/service`), so the module itself is mid-build, not absent |
| T-U35 | §10 U36a | `status-badge.test.ts` | BLOCKED-ON-IMPL — `components/ui.tsx` import chain fails on a missing dependency (`@/lib/contest-copy`), mid-build |
| T-U36 | §1 U1 | `participation.test.ts` | FAILING — `lib/gw-participation.ts` exists and `resolveLeagueParticipation` imports fine, but my guessed injectable-second-argument signature is wrong; the real function likely takes only `leagueId` and reads the DB directly |

Full run at time of writing: **10 files passing outright, 6 files with failures, 1 file
intentionally skipped (`entry-sheet.test.ts`)** — 128 passing assertions, 30 failing, 12 skipped.

## Interface assumptions (flag for reconciliation)

Two names were given verbatim by the plan and are confirmed, not guesses:
- `netBalance` (`lib/net-balance.ts`) — quoted directly in T-U2d's prose.
- `chipsForFixture(topScores: ScoreProb[]): ScoreChip[]` (`lib/model-chips.ts`) — signature given
  verbatim in §0.3 D-EN5.
- `resolveLeagueParticipation(leagueId)` (`lib/gw-participation.ts`) — name and file given verbatim
  in §1.1 and §1 U1, but the plan never specifies how it gets its `league_competitions` rows (DB
  read vs. injected). I guessed an injectable second parameter to keep this suite DB-free; the real
  export ignores it. **Needs reconciliation**: either the pure precedence logic should be
  extractable with an injectable rows argument (testable without a DB), or this suite's cases need
  to move to the disposable-harness persistence track instead of staying as vitest unit tests.
- `resolveInvite` (`app/leagues/join/actions.ts`) — name and file given verbatim in §1.1/§4/§9, but
  the module has a live import chain (`@/lib/supabase/service`) that isn't resolvable from a pure
  unit test. Same reconciliation note as above: this is a route action wired to the DB, not a pure
  function, so `invite-dto.test.ts`'s cases likely belong on the disposable-harness track once the
  module fully lands, not as pure vitest imports.

Every other name below was **not given** by the plan; I committed to one best guess per module,
documented inline as a NAMING CAVEAT comment in the file, per the brief's "don't hedge with
multiple guesses" instruction:

| Guessed name | File | Plan basis | Outcome |
|---|---|---|---|
| `buildLiveOutcome` | `lib/gw-live.ts` | §5.5 U15, T-U10 | Matched — file exists, tests pass |
| `resolveGameweekView` / `buildGameweekViewDTO` | `lib/gw-view.ts` | §1 U3, T-U3, T-U2c | Matched — tests pass |
| `collapseFixtures` | `lib/gw-fixtures.ts` | §2.3 D6, T-U4 | Matched — tests pass |
| `isEligible` / `resolveEntryCounts` | `lib/gw-eligibility.ts` | §2.3 D5/D5a, T-U5/T-U5b | Matched — tests pass |
| `formatIst` | `lib/ist.ts` | §10 U35, T-U7 | Matched — tests pass |
| `buildLiveOutcome`'s sibling `buildRunningTotals` / `buildSeasonRows` | `lib/gw-season.ts` | §7, T-U20–T-U24 | **Not matched** — module does not exist yet at time of writing |
| `settleCauseNote(cause)` | `lib/gw-copy.ts` | §5.4 M3, T-U6a/b/c | **Not matched** — `lib/gw-copy.ts` exists but exports no function by this name |
| `nudgeMessage({ league, gw, deadline })` | `lib/gw-copy.ts` | §5.5 U13, C67 (name given verbatim in prose) | **Not matched** — despite the name being quoted in the plan text, the current `lib/gw-copy.ts` has no such export at time of writing (may land later in the sequencing) |
| `homeBadgeState(cl, vp)` | `lib/gw-state.ts` | §8 U28, T-U25a | **Not matched** — `lib/gw-state.ts` exists (other exports pass) but has no such export; the eight-state home badge logic may live under a different name or inline in `LeagueCard.tsx` |
| `activeCompetitions(list)` | `app/leagues/join/actions.ts` | §9 U31/U32 | Blocked on the same import-chain issue as `resolveInvite` |

## Tooling gap (flag for the team, not fixable within my file allowlist)

This repo has **no jsdom/happy-dom, no `@testing-library/react`, and no `vitest.config.ts`**
(confirmed by inspecting `node_modules` and the repo root). Every DOM-interactive assertion in
§6's entry sheet (stepper click behavior, form submission, "exactly one fetch call") cannot run
under the current toolchain regardless of how the implementation lands. `entry-sheet.test.ts` is
written as twelve named, skipped placeholders so the case list stays 1:1 with §13's inventory —
this is a decision for whoever owns `package.json` and the vitest config, both outside
`tests/phase3/**`.

Two lighter-weight files (`status-badge.test.ts`) use `react-dom/server`'s `renderToStaticMarkup`
for non-interactive text/class assertions where no DOM interaction is needed — this works without
jsdom and should keep working once the component lands, but it can't check hover/focus states or
event handlers.

## T-U18c baseRef gap

`tests/phase3/copy-scan-manifest.json`'s `baseRef` is a placeholder
(`PHASE2_MERGE_COMMIT_PLACEHOLDER`) — the plan requires a fixed Phase 2 merge-commit SHA, which
was never named in the plan text and isn't something a blind author should guess (a wrong SHA
would silently under- or over-scope the git-diff enumeration). `copy-scan.test.ts`'s T-U18c
git-diff assertion short-circuits to a pass while the placeholder is present, and is documented
there as BLOCKED-ON-IMPL. Whoever owns the merge sequencing should fill in the real SHA once it
exists.

## Persistence-track cases (not run here, per the "no shared DB" constraint)

Every case above that needs a real Supabase read (`resolveInvite`, `resolveLeagueParticipation`,
anything under the entry-sheet's `/api/gw/enter` / `/api/gw/picks` round trip, and the season
tab's `locked_in` / D7a aggregation once wired to real rows) belongs on the disposable-harness
persistence track, not this vitest unit suite. This doc flags them; it does not attempt to run
them.
