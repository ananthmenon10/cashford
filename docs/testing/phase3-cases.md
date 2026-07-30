# Phase 3 test cases — blind author's inventory, reconciled after Sol's fix round

Originally written blind from `docs/plans/2026-07-27-006-phase3-core-ui-plan.md` (v6) plus
decisions-log #21 and #23, with no production file read. Sol then implemented Phase 3 for real and
ran a fix-round code review against the blind suite; this doc now reflects the reconciled state —
every canonical name resolved, `npx vitest run` fully green, `npx tsc --noEmit` clean.

## Case inventory (post-reconciliation)

| ID(s) | Plan section | File | Status |
|---|---|---|---|
| T-U1, T-U1a, T-U1b | §5.1 | `gw-state.test.ts` | RUNNABLE — passing |
| T-U2, T-U2a-d | §5.3, §5.3a | `gw-state.test.ts`, `gw-view.test.ts`, `net-balance.test.ts` | RUNNABLE — passing |
| T-U3 | §1 U3 | `gw-view.test.ts` | RUNNABLE — passing |
| T-U4, T-U4a, T-U4b | §2.3 D6 | `gw-fixtures.test.ts` | RUNNABLE — passing. Renamed `collapseFixtures` → `collapseGameweekFixtures`. T-U4b's expected outcome for `active→void→excluded` was corrected from `"void"` to `"active"` — the canonical D6 rule is "active wins regardless of history order," which the blind guess had backwards. Added a full truth-table sweep over every permutation of `{active, void, excluded}` history against a local oracle. |
| T-U5, T-U5a, T-U5b | §2.3 D5/D5a | `gw-eligibility.test.ts` | RUNNABLE — passing. `isEligible` unchanged. `resolveEntryCounts`'s options object now requires `stakeInr` (pot = stake × accepted entrants, not a per-entry stake field) — added to every call. |
| T-U6a, T-U6b, T-U6c | §5.4 M3 | `gw-copy.test.ts` | RUNNABLE — passing. Renamed `settleCauseNote` → `correctionCopy`; behavior unchanged. |
| T-U7 | §10 U35 | `ist.test.ts` | RUNNABLE — passing. Renamed `formatIst` → `formatIstDeadline` (there's also `formatIstCompact`, untested here). |
| T-U8, T-U2d | §5.3a | `net-balance.test.ts` | RUNNABLE — passing (`netBalance` name confirmed verbatim by plan) |
| T-U9 | §0.3 D-EN5 | `model-chips.test.ts` | RUNNABLE — passing. Reshaped the `topScores` input fixture from the guessed `{home, away, prob}` to the real `ScoreProb` shape `{h, a, p}` — the previous version happened to pass by accident (its assertions never inspected field values), so this was a real fix, not a rename. |
| T-U10 | §5.5 U15 | `gw-live.test.ts` | RUNNABLE — passing |
| T-U11 | §12 | `settlement-pin.test.ts` | RUNNABLE — passing (real sha256 pins against the four settlement files at HEAD) |
| T-U12–T-U17, T-U19, T-U20, T-U21, U22 (entry sheet) | §6 | `entry-sheet.test.tsx` | RUNNABLE — passing, 16 real cases. The blind author's "no jsdom/testing-library" tooling gap no longer applies — `vitest.config.ts` (added during implementation) wires jsdom via `environmentMatchGlobs`, and `@testing-library/react`/`jest-dom` are real deps. File renamed `.test.ts` → `.test.tsx` (JSX needs the `.tsx` loader). Includes four fix-round regression cases: **B4** (deadline-passed mapping is keyed on response-body message text via regex, not an HTTP status code — a 400 with that message must still go read-only), **M7** (an unmatched 4xx message surfaces verbatim as `error`, and the reload-retry button appears only when the message itself says "reload"), **M8** (`MirrorPrompt`'s 409 handler produces one error string per target league — a stake-mismatch error for league A must not bleed onto league B's line), **M9** (`MirrorPrompt`'s "Not now" button is disabled only by `pending`, not by `chosen.length` — unchecking every league still leaves it clickable). |
| T-U18 | §4 | `gw-copy.test.ts` | RUNNABLE — passing, both the name-agnostic style scan and the name-specific blocks (all 29 C-ID function exports now invoked with representative args via a `SAMPLE_CALLS` table, plus the module's other builder functions). |
| T-U18b, T-U18c | §4 | `copy-scan-manifest.json`, `copy-scan.test.ts` | RUNNABLE — passing, including the real `git diff <baseRef>...HEAD` candidate-set enumeration (baseRef resolved, see below). Fixed a real scan-coverage bug (B5, see below), not just a rename. |
| T-U20–T-U24, T-U20a, T-U24a | §7 | `gw-season.test.ts` | RUNNABLE — passing |
| T-U25–T-U28 | §8 | (home-badges.test.ts + gw-state.test.ts CL/VP suite) | see T-U25a |
| T-U25a | §8 U28 | `home-badges.test.ts` | RUNNABLE — passing |
| T-U29–T-U31, T-U31a | §9 | `invite-dto.test.ts` | RUNNABLE — passing. The pure `activeCompetitions`/`resolveInvite` moved to `lib/gw-invites.ts` (the async, DB-reading version stayed in `app/leagues/join/actions.ts`) — import path fixed, no assertion changes needed. |
| T-U35 | §10 U36a | `status-badge.test.ts` | RUNNABLE — passing |
| T-U36 | §1 U1 | `participation.test.ts` | RUNNABLE — passing. `resolveLeagueParticipation` takes ONE array argument (no `leagueId` — the caller scopes the query before calling), and each row is the real snake_case `LeagueParticipationRow` shape with a nested `competitions` object. `row()` helper rewritten to build that shape from a flat convenience input. |

**Full run: 40 test files, 505 tests, all passing. `npx tsc --noEmit` clean.**

## Fix-round reconciliation notes

Everything above was either a mechanical rename (blind guess → real export name, behavior
unchanged) or a small options/argument reshape. Two items were genuine logic/coverage corrections,
not renames:

- **B1 (`gw-fixtures.test.ts`, T-U4b)** — the blind guess had the D6 tie-break backwards
  (`active→void→excluded` was asserted to collapse to `"void"`; the real rule is "active wins
  regardless of order"). Fixed, and backed with a full permutation truth table so this class of
  mistake can't silently recur.
- **B5 (`copy-scan.test.ts`)** — `jsxLiteralViolations()` only scanned quoted string literals
  (`/["'\`]([^"'\`\n]{2,})["'\`]/g`), so a bare JSX text node like `<p>Place your bet now.</p>`
  (no surrounding quotes at all) was invisible to the scan. Added a second pass over text sitting
  directly between two tags (`/>([^<>{}]+)</g`), with proof-of-fix cases: a banned word in a bare
  text node is now caught, safe copy in the same position is not flagged, and the original
  quoted-literal case still passes (regression guard).
- **B6 (`copy-scan-manifest.json`)** — `baseRef` was a placeholder
  (`PHASE2_MERGE_COMMIT_PLACEHOLDER`); resolved to `ac419f285b6e848fbe1d8c076edf40b3271a06d8`
  ("feat: Phase 1 foundation + Phase 2 gameweek money engine"), verified to exist via
  `git cat-file -t`. `lib/copy-last-week.ts` was deleted during implementation (M6 — no render slot
  in the Phase 3 plan) — moved from `files` to `excluded` with a note, which also fixes the
  strings-mode file count (4, not 5: `lib/gw-copy.ts`, `lib/ist.ts`,
  `app/leagues/join/actions.ts`, `app/leagues/new/actions.ts`). Added
  `app/leagues/[slug]/manage/page.tsx` and `app/leagues/[slug]/m/[id]/page.tsx` to `files`
  (both carry user copy and were missing from the original candidate set) and
  `app/dev/gameweeks/page.tsx` to `excluded` (dev-only debug tool, no copy governance need).
- **No test file existed for `lib/copy-last-week.ts`** — confirmed by search before removing the
  manifest entry, so no test deletion was needed there, only the manifest fix above.

## Round-2 rework (F10, B5, B6)

- **F10 — strings-mode producer count is three, not four.** The plan's §4 catalogue assumed four
  strings-mode producer files including `lib/copy-last-week.ts`, deleted in the fix round (M6, no
  render slot). The manifest's `strings`-mode entries are now `lib/gw-copy.ts` (the copy module
  itself, self-exempted from violation checks in `stringsLiteralViolations`), `lib/ist.ts`,
  `app/leagues/join/actions.ts`, and `app/leagues/new/actions.ts` — three files actually scanned for
  violations, plus the exempt module. `copy-scan.test.ts` no longer special-cases the deleted file
  (that dead branch was removed as part of the B6 rework below). This note is the reconciliation
  record per the reviewer's F10 finding that the plan's original "four producers" figure is stale.
  No plan edit made — the plan is frozen.
- **B5 (round 2) — copy scan rebuilt to detect in-place copy, not just banned words.** The round-2
  reviewer proved both scan passes previously terminated at a banned-word check and could not catch
  real copy sitting in JSX or in a strings-mode producer. `jsxLiteralViolations` now flags any
  user-visible literal (JSX text node, or `aria-label`/`placeholder`/`title`/`alt` attribute value)
  that isn't in `STRUCTURAL_ALLOW`; `stringsLiteralViolations` flags sentence-shaped literals
  returned or assigned in a strings-mode file. Both reviewer mutations (`<p>Place your picks
  now.</p>`; a strings-mode function returning "The deadline has passed. Set every scoreline to
  continue.") are reproduced as fixtures in `copy-scan.test.ts` and proven to go red under the old
  scan and green (correctly flagged) under the new one; `STRUCTURAL_ALLOW` suppressing `en-IN`/
  `active` is exercised in the same run (previously dead code).
- **B6 (round 2) — T-U18c now enumerates the working tree, not a vacuous committed-range diff.**
  `baseRef` (`ac419f2`) equals HEAD, so the old `git diff <baseRef>...HEAD` was empty and the test
  asserted nothing. Replaced with `git diff --name-only <baseRef>` (working tree vs. base) unioned
  with `git ls-files --others --exclude-standard` (untracked files), filtered to
  `^(app|components)/.*\.tsx?$`. This reproduces the reviewer's independently-computed 31-path
  candidate set exactly. A proof-of-teeth test confirms removing one manifest entry
  (`components/gw/EntrySheet.tsx`) makes the coverage check fail.
- **Manifest coverage gap found by the B6 rework:** `app/login/page.tsx` and `app/login/actions.ts`
  are live working-tree files (return-path field / `safeReturnPath` helper, likely F11) that were
  never in the plan's §4 catalogue and were missing from the manifest entirely. Added to `excluded`
  (not `files`) with a note flagging this as an open scope question for the orchestrator, since both
  carry un-migrated hardcoded copy ("Cashford", "Predict. Settle. Brag.", "Enter your username and
  password.", "Incorrect username or password.") that was never routed through `lib/gw-copy`.

No case in this pass surfaced a genuine test-vs-implementation disagreement that wasn't already
diagnosed as one of the above by Sol's fix-round report — every other change was a pure rename or
argument-shape reconciliation with behavior held constant.

## Round-3 reconciliation (Sol's fix2/fix2b, R-1, F5-F12, C55b/C73-C86)

- **`gw-season.test.ts` (R-1)** — `isGameweekResultDirty`/`netBalance` now take a real
  `{inputVersion, settledVersion}` pair (`lib/net-balance.ts`); the invented `dirty: boolean` field
  is gone. Fixtures rebuilt around a `dirty()` helper (`{inputVersion: 2, settledVersion: 1}`) and a
  `gwRow()` builder carrying a real default (equal, non-dirty) pair. 7/7 green, no behavior change
  to what was asserted.
- **`entry-sheet.test.tsx` (F5-F9, R-4/C55b)** — three stale expectations fixed, all against real
  production behavior read from `lib/gw-copy.ts`'s rule tables and `components/gw/EntrySheet.tsx`/
  `MirrorPrompt.tsx`, not guessed:
  - B4's deadline-passed case now branches on first-save vs. edit-save: first save maps to C55b
    ("...you have no stake in the pot"), edit save still maps to C55 ("...last saved picks stand").
    Both paths now have their own test.
  - M7's premise ("an unmatched message surfaces verbatim") is no longer true — F5 routes every
    message through the C-ID table with a C56 fallback for anything unmatched. Rewrote to assert
    the C56 fallback copy renders (never the raw string), while confirming the aria-invalid fixture
    flag still fires (that match runs on the raw message before mapping, unaffected by F5). Added a
    "please reload"-only variant (item 4): a message that says "reload" but doesn't match a
    reload-flagged rule must NOT show the reload button — proving `reload` is driven by the matched
    rule, not a substring check.
  - M8 expanded from 2 targets/1 mapped error to a 4-target fan-out covering C80 (no pot), C81
    (closed), C82 (not eligible), and C83 (stale source picks), asserting no cross-contamination
    between any pair of lines.
  - New coverage (not stale-fix, net-new per the orchestrator's item-3/4 mandate): mirror branching
    on `targets` presence (absent → top-level banner only, present-with-no-top-error → wholesale
    C79 banner rendered above the per-target list, both visible together), and a 401 in mirror
    showing the sign-in link (with `next` return path) and a disabled retry button.
  - 22/22 green in this file (was 12 skipped placeholders at Phase 3 start, 16 real cases after the
    tooling fix, now 22 after this round).
- **`gw-copy.test.ts` SAMPLE_CALLS** — re-verified live (not from a stale prior report) that C55b and
  C73-C79/C84-C86 are static string exports, already covered by the `staticStrings` collection path,
  not the function-export guard — no new entries needed. C80-C83 (parameterized on `league: string`)
  were already registered correctly.
- **`copy-scan-manifest.json`** — `app/leagues/[slug]/manage/page.tsx` and
  `app/leagues/[slug]/m/[id]/page.tsx` moved from `files` to `excluded`: orchestrator ruling that
  these are legacy World Cup knockout surfaces, outside Phase 3's gameweek-money-engine copy
  contract, same basis as the existing `app/login/*` exclusion. `app/page.tsx`'s copy-scan failure
  resolved independently by Sol's parallel fix2b slice (migrated the 3 flagged literals to
  `C84`-`C86` / `GW_UI_COPY` keys) — no manifest change needed there. `copy-scan.test.ts` is now
  45/45 green on merit (was 42/3 failing).

Exit gates for this round: `npx vitest run` — 40 files, 517 tests, all green. `npx tsc --noEmit` —
clean. `lib/gameweek-db.test.ts` (outside this author's allowlist, checked per the orchestrator's
item 5) — 14/14 green, confirming Sol's report that the `Record<string,number> | "suppressed"`
return-type change on `leagueNetByUser` didn't break its own test file.

## Round-4 hardening (N1-N4, N8 test half, N10, FLAKE)

SHRUNK round: fixed exactly N1, N2, N3, N4, N8 (test half), N10, and the FLAKE item from the
round-3 reviewer's fix list. N5-N7, N9, N11, and SEC-1 were Sol's production items, done in
parallel; not touched here except where a production rename forced a mechanical test update (see
"Fallout from Sol's parallel fixes" below).

### N1 — manifest self-check was a soft skip, not a check

`copy-scan.test.ts`'s per-entry loop used to do `if (!existsSync(full)) { expect(true).toBe(true);
return; }` — a typo'd manifest path passed silently instead of failing. Replaced with a hard
`existsSync` assertion over every `files` and `excluded` entry. Also removed a stale entry
(`lib/copy-last-week.ts` in `excluded`) that no longer exists on disk, which the new check would
otherwise have failed on immediately.

- **Mutation**: rename one real manifest entry to `lib/gw-cpy.ts` (typo).
- **Before fix**: green (soft skip absorbed the miss).
- **After fix**: red — `missingManifestPaths` returns `["lib/gw-cpy.ts"]`.

### N2 — JSX text regex didn't match across newlines

`jsxTextRe`'s negated character class excluded `\n`, so Prettier-wrapped multi-line JSX text (a
real, common shape) was invisible to the scan. Removed `\n` from the exclusion — but that alone
reintroduced false positives: TS generics (`useState<string | null>`) and multi-line ternaries
(`) : card.archived ? (`) can look like a JSX tag boundary once newlines are allowed through. Added
`looksLikeProse()` (sentence-period check anchored to a preceding letter, or ≥60% prose-shaped
words) and gated every multi-line capture on it.

- **Mutation**: reviewer's wrapped `RecalculatingNote`-style text split across three lines.
- **Before fix**: invisible to the scan (0 violations found).
- **After fix**: caught, single violation with the text rejoined.
- **Regression guard**: verified against every real manifest `jsx` file — the LeagueCard ternary
  chains and the `useState<string | null>` generic produce zero false positives under the new gate.

### N3 — only four a11y props were scanned; any prop with sentence-shaped copy should be

`propRe` only matched `aria-label|placeholder|title|alt`. The `EmptyState` component's `copy=`
prop (a full sentence passed as a plain prop, not an a11y attribute) was structurally invisible.
Generalized the prop scan to any `name="value"` pair, gated on `looksLikeProse()` so Tailwind
className strings (long, space-separated, sometimes containing decimals like `py-2.5`) don't false-
positive.

- **Mutation**: `<EmptyState copy="This library has no leagues yet." />`.
- **Before fix**: invisible (prop name not in the hardcoded a11y set).
- **After fix**: caught.
- **Regression guard**: a real long `className` string from production JSX scans clean.

### N4 — strings-mode gate missed template-literal prose and short sentences

Two gaps: (a) any literal containing `${...}` was skipped outright rather than tested on its
literal remainder, so `` `Reload in ${n}s to continue.` `` was invisible; (b) the sentence-shaped
gate required 5+ words, so `"Update your picks now"` (4 words, no period) passed. Fixed by
stripping `${...}` segments before testing the remainder, and lowering the word-count gate to 4.
Verified against every real production strings-mode file (`lib/ist.ts`,
`app/leagues/join/actions.ts`, `app/leagues/new/actions.ts`) to confirm no new false positives at
the lower threshold.

- **Mutation (a)**: template literal mixing interpolation and prose.
- **Before fix**: skipped via the `${` bail-out.
- **After fix**: caught on the stripped literal remainder.
- **Mutation (b)**: `"Update your picks now"`.
- **Before fix**: below the 5-word gate, not flagged.
- **After fix**: flagged (4-word gate).

### N8 (test half) — the three 409 mirror tests mocked the old dead-branch shape, not the real route

The route always emits a top-level `error` field alongside `targets` (never targets-only). The old
client had a `hasTargets && !payload.error` fallback that guessed "nothing was copied" when
`error` was absent — an accident the three 409 tests in `entry-sheet.test.tsx` were mocking around.
Sol's parallel fix removed that fallback (`MirrorPrompt.tsx` now maps `payload.error` directly), so
those three mocks had to add the real `error: "nothing was copied"` field or they'd hit the C56
fallback instead of C79/the per-target list. Updated all three (both M8 tests, plus the F11/F12
wholesale-rejection test, which now also carries a corrected title). Added a fourth, new proof test
pinning the contract in the other direction.

- **Sequencing**: waited for Sol's report at `scratchpad/sol/phase3-fix3-out.txt` (landed 18:49,
  confirmed N8-client done — `MirrorPrompt.tsx:61` maps `payload.error` directly) before touching
  these three tests, per the round's sequencing instruction.
- **Mutation (proof of teeth)**: drop the top-level `error` field from a targets-only 409 body.
- **Before Sol's fix / with the old client**: C79 banner rendered anyway (the accidental fallback).
- **After Sol's fix**: C56 fallback renders instead, no C79 — pinned as its own test
  ("proof of teeth (N8): dropping the route's top-level `error`...").

### N10 — stale allowlist comment, scan failures didn't name the offending path

`STRUCTURAL_ALLOW`'s comment claimed coverage (class names, aria roles, test ids, route paths,
Supabase names) it didn't actually have. Rewrote the comment to describe what the constant really
suppresses. Separately, `T-U18c`'s coverage assertion looped per-candidate with an inline
`expect(...).toBe(true)`, so a failure just said "expected false to be true" with no path in sight.
Replaced with `const uncovered = candidates.filter(...); expect(uncovered).toEqual([])` — a failure
now prints the exact offending path(s).

### FLAKE — MirrorPrompt click flows outran React's act() batching

`MirrorPrompt.submit()` is async (`await fetch(...)` before any `setState`); a bare `fireEvent.click`
only wraps the synchronous portion of the click handler in `act()`, leaving the eventual state
update to land whenever its microtask resolves — a plausible source of cross-test timing races.
Wrapped every MirrorPrompt click (`await act(async () => { fireEvent.click(...) })`, plus a
synchronous `act(() => {...})` for the one non-async M9 test) across all three MirrorPrompt-
rendering describes (M8, F11/F12, M9).

- **50-run tally**: `npx vitest run tests/phase3/entry-sheet.test.tsx` × 50 (fresh process each run)
  — **50/50 runs produced the identical shape** (22 passed / 1 failed — the pre-existing B4/F8
  production bug below, unrelated to MirrorPrompt). **Zero unexpected-shape runs.** No run showed a
  per-target error against the wrong league name — no cross-contamination signal, so no stop-and-
  report was triggered.

### Fallout from Sol's parallel fixes (not part of this round's scope, but blocked `vitest run` green)

Two mechanical updates were required for the exit gate, both flagged in Sol's own report as
"stale test expectations," neither a scope expansion of production logic:

- `gw-copy.test.ts`'s `SAMPLE_CALLS` table was missing an entry for the new `C5b` export (N11) and
  still called `entryErrorCopy` with the retired `firstSave` option key instead of `noEntryAtSave`
  (N6's rename). Added the `C5b` sample and renamed the key — no assertion changed, no coverage
  lost.

### Resolved: the noEntryAtSave hardcode (F8 micro-slice)

`EntrySheet.tsx:115`'s `noEntryAtSave: false` hardcode (flagged above, reported to the orchestrator)
is fixed by Sol's F8 micro-slice: on a first-save deadline failure, `EntrySheet` now sends a second
`GET /api/gw/contest?league=…&gw=…` to confirm entry state before choosing C55b vs. C55, rather than
trusting the page-load `firstSave` flag (which the mirror-race can invalidate between load and
save). `myEntry: null` → C55b; an existing entry, a failed/non-OK GET, or a malformed body → the
neutral, safer C55.

`entry-sheet.test.tsx`'s `B4/F8 regression > first save` test updated to queue the second fetch
mock (`{ myEntry: null }`) after the rejected POST, plus two new variants proving the other two
branches:

- **Mirror-race case**: verification GET finds an existing entry after all → C55 (the truth wins
  over the stale page-load snapshot), not C55b.
- **Verification-fails case**: GET returns 500 → C55 (safe fallback), not C55b — an unknown entry
  state must never claim "you have no stake," since that's the wording that's actively wrong if an
  entry does exist.

All three tests also assert the exact verification URL was called, confirming the round-trip
happened rather than passing by coincidental default. 25/25 green in `entry-sheet.test.tsx` (was 22
before this micro-slice, +3 for the new/updated coverage).

## Tooling note (resolved)

The blind author's original tooling-gap flag ("no jsdom/happy-dom, no `@testing-library/react`, no
`vitest.config.ts`") no longer applies. `vitest.config.ts` now exists (esbuild `jsx: automatic`,
`@` alias, `environment: "node"` by default with jsdom scoped to `entry-sheet.test.tsx` via
`environmentMatchGlobs`), and `@testing-library/react` + `@testing-library/jest-dom` are real
dependencies. `entry-sheet.test.tsx` now contains 16 real render/interaction cases in place of the
12 skipped placeholders it started as.

## Round-4 fix round 5 — copy scan rewritten as an AST walk

Three straight rounds of regex patches to the §4 copy scan (N1-N10, then R4-1/R4-2/R4-8) each lost
ground to a fresh mutation the regex couldn't see. Round-4 review found five more: a Prettier
`{" "}` spacer breaking tag-boundary anchoring, prose sitting after a JSX expression instead of
after a tag, a literal landed on a prop via `copy={"…"}` instead of `="…"`, a ternary/throw/object-
property carrying the literal instead of a bare `return`, and interpolation-stripping regex
(`\$\{[^}]*\}`) breaking on nested braces. Regex matches syntax it can guess at; it can't know what
a node actually is. `tests/phase3/copy-scan-ast.ts` replaces both regex passes with a `typescript`
compiler-API walk over the real JSX/string/template-literal nodes, so "is this prose, and is it
sitting somewhere copy isn't allowed to sit" is answered from tree shape, not token guesses.

**The prose gate (`isProseText`), decided on shape, not a word-count ratio:**

- A sentence-ending period — a letter immediately followed by `.` then whitespace-or-end-of-string
  (this deliberately excludes the decimal point in Tailwind utilities like `py-2.5`, since that's a
  digit before the dot, not a letter) — always reads as copy.
- Absent a period, a string that opens on a capital letter and has two or more plain-English words
  reads as copy too. This catches short imperative CTAs ("Enter your picks", "Update your picks
  now") that have no terminal period and can be as short as two or three words — the word-count
  floor that let these through in the regex era is gone.
- Internal status/error tokens ("not signed in", "inactive", "not authenticated") are lowercase by
  convention and fail the capital-letter test, so no separate denylist is needed for them.

**Where a literal counts as "in a spot copy can't be" (`climbToSinkRole` for strings-mode; direct
JSX/attribute checks for jsx-mode):** for strings-mode files, a candidate literal is reached by
climbing from the literal up through transparent connectors — parens, a ternary's `whenTrue`/
`whenFalse` branch, the right side of `??`/`||`/`&&` — to the nearest node that actually does
something with the value: returns it, throws it, assigns it, or uses it as an object property. A
plain call argument like `console.error("[tag]", err)` is never reached this way (no sink between
the literal and the call), so internal log tags are never candidates in the first place. For
jsx-mode, a literal is a candidate whether it sits as a bare JSX text run, a quoted attribute value,
or a literal boxed in `{}` on either a JSX child or an attribute initializer (unwrapped through
parens/`as`/non-null first) — the brace-boxed case is the one thing the regex era could never see
at all, since both its passes required the matched span to contain no `{`/`}`.

**Mutation set proved caught (round-3 carryover + round-4, all reproduced as fixtures in
`copy-scan.test.ts`):**

| Mutation | Round | Before (regex) | After (AST) |
|---|---|---|---|
| Bare JSX text node, no quotes (`<p>Place your bet now.</p>`) | 3 (B5) | invisible | caught |
| Multi-line Prettier-wrapped JSX text | 4 (N2 carryover) | invisible | caught |
| Non-a11y prop with sentence copy (`copy="…"`) | 4 (N3 carryover) | invisible | caught |
| Template literal mixing interpolation + prose | 4 (N4 carryover) | skipped via `${` bail-out | caught on stripped remainder |
| Short 3-4 word CTA, no period (`"Enter your picks"`) | 4 (N4 carryover) | below word-count gate | caught (capital-letter + 2-word rule) |
| Prettier `{" "}` spacer splitting one sentence into two JsxText runs | 4 (R4) | mis-anchored / merged wrong | each run scanned independently, both caught |
| Prose sitting after a JSX expression, not after a tag (`{count} picks left to set.`) | 4 (R4) | invisible (regex anchored to `>...<`) | caught (JsxText node scan is tag-position-agnostic) |
| Braced string prop (`copy={"This library has no leagues yet."}`) | 4 (R4) | invisible (regex required `="…"`, no braces) | caught (unwrapped JSX-expression literal) |
| Braced template prop with interpolation | 4 (R4) | invisible | caught, interpolation stripped via real template-span structure |
| Object-property literal (`{ ok: false, message: "…" }`) | 4 (R4) | invisible (no `return`) | caught (`climbToSinkRole` → `"property"`) |
| Ternary return, only the true-branch is prose | 4 (R4) | invisible / both branches conflated | caught — only the prose branch flagged, climbing through `ConditionalExpression` |
| `throw new Error("…")` | 4 (R4) | invisible (no `return`) | caught (`climbToSinkRole` → `"thrown"`, unwraps the call/new-expression argument) |
| Multi-line template literal | 4 (R4) | interpolation-stripping regex broke on nested braces | caught, exact text via `head` + `templateSpans` |
| Negative case: plain `console.error(...)` argument | 4 (R4) | n/a (not a targeted mutation, but a needed guard) | correctly NOT flagged — no sink between literal and call |

**False-positive triage:** every real production `jsx`-mode and `strings`-mode file in the manifest
was run through the new detector as a regression gate — zero new false positives at the tightened
prose gate. `STRUCTURAL_ALLOW` (contest/entry/fixture status tokens, `lib/ist.ts`'s
`Intl.DateTimeFormat` option values) still exact-matches and suppresses those, unchanged from the
regex era; it's a business-rule allowlist, not something the AST rewrite needed to touch.

**R4-3 — manifest mode validated in both directions.** `copy-scan.test.ts` now asserts
`modeMismatches(manifest.files)` is empty: a `jsx`-mode entry must be a `.tsx` file (or the
`components/ui.tsx` carve-out), and a `strings`-mode entry must never be `.tsx`. A flip-mutation
test (`lib/ist.ts`'s mode set to `"jsx"`) proves the check has teeth — it returns
`["lib/ist.ts"]`.

**R4-4 — the `excluded` list is now a frozen, checked-in assertion**, not just an existence check:
`copy-scan.test.ts` pins the exact current 11-entry array from `copy-scan-manifest.json`. Any future
addition or removal to `excluded` must edit this test alongside the manifest — it can no longer
silently grow.

**R4-9 — `safeReturnPath` regression set** (`tests/phase3/safe-return-path.test.ts`, new file):
covers MINOR-1's normalization (a safe path returns its parsed `pathname+search+hash`, not the raw
input string — including dot-segment resolution and whitespace trimming) and SEC-1's open-redirect
guard across protocol-relative, absolute-URL, backslash, embedded-control-character (tab/LF/CR),
mixed-case-scheme, fullwidth-Unicode-homoglyph-slash, and overlong-path inputs. 15/15 passing.

**R4-10 — render-test coverage added to `entry-sheet.test.tsx`** (the only file jsdom-wired via
`vitest.config.ts`'s exact-literal `environmentMatchGlobs`, so new render tests could not go in a
new file): `MirrorPrompt`'s own reload control renders only when the mapped copy rule (or any
per-target mapping, MINOR-3) carries `reload: true` — proved present for C74/C54 and absent for
C79. `PotSummary` pins C5 (open, pre-deadline), C5b (locked, even past deadline), and R4-6's
suppression window (open contest at-or-after its deadline renders nothing, a locked/settled contest
past the same deadline is not suppressed).

**HANG-PROOF** — a verification GET that never settles (`AbortSignal.timeout(3000)` on the real
implementation, mocked here as a never-resolving promise) must not strand the user without
feedback: C55 and disabled steppers appear immediately from the failed save, and C55b (which
requires the verification GET to positively confirm no entry) is never claimed since that
confirmation never arrives.

**Exit gates for this round:** `npx vitest run` — 41 files, 564 tests, all green. `npx tsc
--noEmit` — clean (this run also caught and fixed a real pre-existing type error in
`copy-scan-ast.ts`: `isTransparentWrapper`'s type guard narrowed to `ts.Expression`, too weak to
expose `.expression`; narrowed to the specific `ParenthesizedExpression | AsExpression |
NonNullExpression` union instead).

**Files changed this round:** `tests/phase3/copy-scan-ast.ts` (type-guard fix only — no behavior
change), `tests/phase3/copy-scan.test.ts` (+~120 lines: round-4 mutation proofs, R4-3, R4-4),
`tests/phase3/safe-return-path.test.ts` (new file, R4-9), `tests/phase3/entry-sheet.test.tsx`
(+~130 lines: R4-7 gap test, HANG-PROOF, R4-10 MirrorPrompt + PotSummary render tests), this file
(round-4 fix round 5 documentation).
