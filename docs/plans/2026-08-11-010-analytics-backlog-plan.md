# Analytics backlog — implementation plan (Phases A, B, C)

Date: 2026-08-11 · Plan 010 · **rev 5** (Sol review rounds 1–3 + QA data check folded in) · Branch base:
`feature/cashford-2` (prod v127)

Covers the three items left in the "Analytics backlog" block of `implementation-notes.md`
(~line 2389), smallest first: the my-form sparkline (A), the live-side my-form record (B), and
canon modules 02–07 (C).

**Rev 2 changelog** — every finding from Sol's review was checked against the code and accepted;
none was rejected. What moved: void semantics rewritten around the fact that a fully-void contest
has **no** entry-result snapshot at all (§0.1, B); dirty gameweeks are now dropped from the trend
window outright rather than half-plotted (A rule 6); the record's counters gained a
"no usable data" state distinct from suppression (B); `SeasonView` now has to expose per-member
rows for modules 02/05, with the window rule spelled out (C1); the corpus gained stored grading
and a hard boundary against re-deriving verdicts (§C.1); corpus queries gained the `locked_in`
filter, membership collapse, and team-ID grouping (§C.2); the Suspense perf plan was replaced with
a real authenticated read route (§C.6); paging replaced the single-query assumption (§C.2);
`NetValue` moves to its own module (A).

**Rev 3 changelog** — round-2 findings, all seven checked against the code and accepted. `startedAt`
is now nullable, because a dirty gameweek *before* the window makes the starting figure unknowable
and the window rule never filtered pre-window rows (A rule 7, tests 9–10, new footnote-omission
copy key); the `countedFixtures === 0` case got its own exclusion reason. The activation callback in
§C.6 was impossible across the server/client boundary and is replaced by a client context owned by
`HomeTabs` with a sticky latch (new §C.6.2). The route's required `competitionId` had no client-side
source, so `AnalyticsMyForm` now carries it and the client caches by pair and rejects stale responses
(new §C.6.1, §C.6.3). `SeasonMemberGameweek` gained `correctPicks`, which module 02 divides by.
Module 05 returns every rival's record in one response rather than a singular field the route could
not have produced. The route gained a `league_competitions` scope check and explicit
`Cache-Control: private, no-store`. And the smoke claim was wrong twice over —
`scripts/smoke/route-smoke.mjs` is tracked and tests loaders, not HTTP handlers — so route and client
behaviour get real test files instead.

**Rev 4 changelog (final)** — one should-fix in the §C.6.3 fetch lifecycle. The `Set`-based in-flight
guard deadlocks under StrictMode's effect replay: run 1 claims the key and starts the fetch, cleanup
aborts it, run 2 sees the key still claimed and skips, so nothing ever populates — a dev-only hang
that reads as a slow query. Replaced with a keyed `AbortController` map, where an aborted controller
is observable so the key frees itself; cleanup removes only its own entry, identity-checked, so it
cannot delete a newer run's live controller. The echo check now compares against a `currentPairRef`
rather than the effect closure's captured pair — the closure would compare A against A and pass a
response the screen no longer wants. Two client tests added: StrictMode replay still populates, and an
A → B → A rapid switch resolves to A with no stale B frame and no retry line.

**Rev 5 changelog** — the QA test planner ran Phase A's cases against ZZ-P1's live data and found two
conflicts that both fire on first page load; both checked and accepted, Phase A only. First, rule 7
split into three ordered sub-rules: `startedAt` is `null` when **no** pre-window gameweek carries real
settled money, which is ZZ-P1's exact state (the window is GW1–GW3 with nothing before it), so the old
zero seed would have rendered `Last 3 GWs · started ₹0` — the fabricated figure QC step 6 forbids.
Sat-out pre-window gameweeks still contribute known zeros, but only once a real settled one exists.
Second, rule 1 gained a precondition: only rows whose `outcome` is `settled` or `void` are classified
at all. `loadSeasonView` emits a row per gameweek in the competition, so ZZ-P1's open GW4 arrives with
`outcome` null and would have been footnoted as void or sat-out — `excluded` is for settled-era data
the chart cannot use, not for the future. Tests 8–14 rewritten and renumbered, two component tests
extended, three new edge-case bullets. The QC script's claim that ZZ-P1 has void history from the
phase-5 rehearsal was **wrong** — verified today, no void and no dirty gameweek exists anywhere in the
database — so step 4 is now an explicit "cannot be checked on real data yet", and step 6 notes that the
three real leagues carry only the wc2026 cup competition, making their read-only pass an absence check.

---

## 0. What already exists, and the two facts the plan hangs on

Built today (Step 8): `lib/analytics-feed.ts` (pure builders), `lib/analytics-feed-load.ts`
(loaders), `lib/analytics-copy.ts` (copy), `components/AnalyticsFeed.tsx` (presentation),
tests in `tests/phase6/`. Module 01 (my form) shows net + record + sample note. Nothing else
from the canon feed is built.

### 0.1 `per_fixture` — what it is, and exactly when it exists

`cashford.gameweek_entry_results.per_fixture` is a `jsonb` column written by
`lib/gameweek-db.ts:75` with the `PerFixtureScore[]` that `scoreGameweek` produces —
`{ fixtureId, verdict, pts }` where `verdict` is `"exact" | "result" | "miss" | "void"` and `pts`
is `3 | 1 | 0`. It is already read in `lib/match-detail-load.ts` and `lib/matches-tab-load.ts`,
so the shape and the access pattern are both proven.

**It exists only for `outcome = 'settled'` contests.** Two independent code paths guarantee this:

- `settleGameweek` (`lib/gameweek-settle.ts:110-113`) returns `{ kind: "void" }` for
  `no_entrants`, `single_entrant` and `all_fixtures_void` **before** calling `scoreGameweek`. A
  fully-void gameweek therefore produces no scores and no `per_fixture` at all.
- `finalize_gameweek` (`supabase/migrations/20260727000002_gameweek_entries.sql:1869`) executes
  `delete from cashford.gameweek_entry_results where gameweek_contest_id = p_contest_id` on the
  void branch. A settled→void correction erases the snapshot that used to exist.

Consequences, which the rest of this plan obeys:

1. A **fully-void gameweek** contributes nothing to any rate, any record and any chart. It is not
   "a gameweek of voids" — it is a gameweek with no per-entrant data whatsoever.
2. `verdict === "void"` rows appear **only** as partially-void fixtures inside an otherwise
   settled gameweek (`scoreGameweek` pushes a void verdict for every void fixture, picked or not).
   The record's third number counts exactly those, and nothing else.
3. Reading `per_fixture` is never a substitute for checking `gameweek_results.outcome`. Gate on
   `outcome === "settled"` first, then read the blob.

With that gate in place, `per_fixture` supplies:

| Need | Source |
|---|---|
| counted fixtures in a gameweek (the sparkline denominator) | `per_fixture.filter(v => v.verdict !== "void").length` |
| correct picks | `verdict === "exact" \|\| verdict === "result"` |
| incorrect picks | `verdict === "miss"` |
| void picks (partial voids only) | `verdict === "void"` |

`loadSeasonView` (`lib/gw-season.ts`) already queries `gameweek_entry_results` for every member of
the league. Adding `per_fixture` to that existing `select` costs **no new query and no new round
trip**. Nothing in `lib/gameweek-points.ts`, `lib/gameweek-settle.ts`, `lib/settlement.ts` or
`lib/settle-contest.ts` is touched — we read a settled snapshot, we never re-derive grading.

The backlog note said a live-side W–L–V record "can't be derived the way the archive side's can".
That was true of the route it considered (`lib/analytics.ts`'s `Entry`, which has no void path). It
is not true of `per_fixture`. **We do not add a void path to `Entry`.** The archive (cup) side keeps
its hardcoded `0` void count, because a cup fixture cannot be void in that data model.

### 0.2 Dirty gameweeks — live numerators, stale denominators

`rowIsDirty` (`lib/gw-season.ts:35-58`) marks a gameweek whose `settled_version` is behind its
contest's `input_version`. For those rows, `loadSeasonView` replaces `points` and `exacts` with a
**live recomputation** from `loadGameweekView`'s standings (`lib/gw-season.ts:313-330`), while money
alone is suppressed (`displayNetInr`, `lib/gw-season.ts:50-57`). `GameweekStanding`
(`lib/gw-view.ts:118`) carries `points`, `exacts` and `goalError` — **no fixture count and no
per-fixture verdicts.**

So for a dirty gameweek, `points` is live and `per_fixture` is stale. Dividing one by the other
produces a number that is wrong in a way nobody can see. **Rule for this whole plan: never divide a
live numerator by a stale denominator.** Where the two disagree, the gameweek is excluded.

The alternative — threading a live per-fixture count out through `GameweekStanding` — was
considered and rejected: it edits the live recomputation path, which sits next to scoring, for a
transient state that resolves itself on the next cron settle. Not worth it.

### Conventions every phase below inherits

- Pure builder in `lib/`, unit-tested, null-safe · thin loader · presentational component.
- **Never fabricate a zero.** Absent data is `null` and renders `—`; a module whose data is absent
  does not render at all. This bug class recurred four separate times in the 2.0 build (the
  `""`-sentinel record, the fabricated `₹0` section line, the `₹0 · 0 settled gameweeks` my-form
  card, the archive net summed from an empty result set). Every new field below is nullable, and
  every new module has an explicit hide condition. **A reducer seeded at `0` is the specific shape
  this bug takes** — `buildRunningTotals` (`lib/gw-season.ts:61-85`) already seeds its sums at
  zero, so every counter added below carries a distinct "no data" state rather than relying on the
  sum. Treat "what does this render before any gameweek settles?" as the first review question on
  every builder.
- Competition-scoped. PL 2026-27 numbers never mix with archived World Cup numbers. The all-time
  strip is the only place they combine, and it stays as it is.
- All user-facing strings in `lib/analytics-copy.ts`. Every new component under `components/` must
  also be added to `tests/phase3/copy-scan-manifest.json` `files` with a note — the AST copy-scan
  fails on any literal written in place, and the manifest is itself checked against the candidate
  set, so a missing entry is a failure too.
- Money: `inr()` from `components/ui.tsx` (already emits U+2212 for negatives). Green for positive,
  red for negative, `cs2-ink-3` for zero.
- Tailwind v4 `cs2-*` tokens only, light + `html.dark`. No new tokens needed: the canon's chart
  green is `cs2-green`, its loss bar `cs2-red`, its grid line `cs2-line`. Numerals in `font-mono`.
- Gate per phase: `bash scripts/verify-all.sh` must print
  `ALL GREEN (typecheck · vitest · build · smoke)`.
- Browser QC per phase: ZZ-P1 test league with the `testa` dummy account (writes fine), plus
  Ananth's real account read-only on Solid Yenne Boys / KK Bois / PES Bois. Real leagues are never
  write-tested.

### The canon these phases build to

Locked reference: `docs/design/2026-08-05-feedback-r1-reference.html`, section
`data-component="My form module at multi-scope" data-option="A"` (lines ~7551–7590). Module feed
canon: `docs/design/throwaway/analytics-v5-merged.html` (modules 01–07). Note:
`Analytics Tab - Final.dc.html` is the older World Cup two-frame design and is **not** the module
source, despite being cited as such in the brief.

The Option A my-form card, top to bottom: `● Live season` badge · "My form" · "Settled only · the
named league is the whole sample" · `PL 26-27` badge · `+₹1,240` "season net" · `14–5–1` "record" ·
a spark box headed "Last 6 GWs · pts / fixture" with a right-aligned mono `GW1–GW6` and a six-point
polyline over two dashed grid lines, feet reading `0.72 0.86 0.64 0.91 1.03 0.94` · a "Net trend"
row, sub "Last 6 GWs · started +₹920", value `+₹320`, and a six-bar run where negative gameweeks
carry a `loss` class · the sample note.

Everything above the spark box exists today. Phase A builds the spark box and the net-trend row.
Phase B fills in the `14–5–1`.

---

## Phase A — sparkline and net-trend row in my form

**Size: S.**

### Goal

The live-side my-form card shows a six-point points-per-fixture line and a six-bar net-trend run
over the viewer's most recent **clean settled** gameweeks in the selected league, with a real range
label (`GW1–GW6`) and a real net delta. Anything not cleanly measurable is absent, not zero.

### Files

Modify:
- `lib/gw-season.ts` — add `per_fixture` to the `gameweek_entry_results` select; add
  `countedFixtures`, `correctPicks`, `incorrectPicks`, `voidPicks` (each `number | null`) to
  `SeasonInputRow`, populated for the viewer's row and for each row in the `byUser` loop, and
  **only** when the gameweek's `outcome === "settled"` and the row is not dirty (§0.1, §0.2).
  Phase B and module 02 consume the same fields, so they land once here.
- `lib/analytics-feed.ts` — new builder `buildMyFormTrend`; new `trend` field on `AnalyticsMyForm`.
- `lib/analytics-feed-load.ts` — pass `season.rows` into `buildLiveMyForm`.
- `lib/analytics-copy.ts` — trend copy keys.
- `components/AnalyticsFeed.tsx` — import `NetValue` from its new home; mount `<MyFormTrend>`
  inside `MyFormCard`.
- `tests/phase3/copy-scan-manifest.json` — entries for the new component files.

Create:
- `components/analytics/NetValue.tsx` — `NetValue` **moved out** of `AnalyticsFeed.tsx` (where it
  is module-private at line 14) into a shared presentational module. Moving it, rather than
  exporting it in place, is what avoids a cycle: `AnalyticsFeed` imports `MyFormTrend`, so
  `MyFormTrend` importing from `AnalyticsFeed` would be circular. Both now import downward from
  `components/analytics/NetValue.tsx`. Every later phase's component reuses it; nobody
  re-implements the green/red/`···`/`—` logic.
- `components/analytics/MyFormTrend.tsx` — presentational: inline SVG spark line + bar run.
- `tests/phase6/analytics-trend.test.ts` — builder unit tests.
- extend `tests/phase6/analytics-feed-components.test.tsx` with the render cases.

### Data flow

`gameweek_entry_results` (`points, exacts, net_inr, goal_error, per_fixture`) + `gameweek_results`
(`outcome`, `settled_version`) → `loadSeasonView` → `SeasonRow[]` (descending `gwNumber`, carries
`displayNetInr`, `dirty`, `outcome`, `isVoid`) → `loadAnalyticsFeed` (which already holds the
season view in `seasonViewByPair`, so no extra load) → `buildLiveMyForm(…, season.rows)` →
`buildMyFormTrend` → `AnalyticsMyForm.trend` → `<MyFormTrend>`.

### New types

```ts
export type MyFormTrendPoint = { gwNumber: number; ptsPerFixture: number };
export type MyFormNetBar = { gwNumber: number; net: number };

export type MyFormTrend = {
  points: MyFormTrendPoint[];   // ascending gwNumber, 2..6 entries, no holes
  bars: MyFormNetBar[];         // same gameweeks, same order
  rangeLabel: string;           // "GW1–GW6"
  netDelta: number;             // sum of the window's nets — always a number (see rule 6)
  /** Net before the window opened. **Null when unknowable** — see rule 7. */
  startedAt: number | null;
  /** Gameweeks the window skipped, and why — drives the footnote, never silently dropped. */
  excluded: {
    gwNumber: number;
    reason: "void" | "not_entered" | "recalculating" | "no_counted_fixtures";
  }[];
};
```

Note what is **not** nullable: a point, a bar and `netDelta` are either present and trustworthy or
the whole gameweek is absent from the window. Rev 1 had `ptsPerFixture: number | null` and a
`"suppressed"` money variant, which invited exactly the mismatch §0.2 describes.

`startedAt` is the one exception, and it is nullable for a reason the window rule cannot fix.
`netDelta` is safe because rule 1 already dropped every dirty gameweek *inside* the window.
`startedAt` sums gameweeks **before** the window, which rule 1 never filtered — and a dirty
gameweek's `displayNetInr` is the literal string `"suppressed"` (`lib/gw-season.ts:56`), not a
number. If any pre-window gameweek is dirty, the starting figure is **unknown, not zero**, so
`startedAt` is `null` and the component omits the whole "started +₹N" clause rather than printing a
number that is short by that gameweek's net. This is the fabricated-zero class in its most
plausible disguise: `Number("suppressed")` is `NaN`, and a `?? 0` fallback would render a
confidently wrong starting balance.

`AnalyticsMyForm` gains `trend: MyFormTrend | null`; archive my-form always passes `null` — cup
fixtures have no gameweek axis.

### `buildMyFormTrend(rows)` rules

1. **Precondition — only gameweeks whose result has landed are classified at all.** Drop any row
   where `outcome` is neither `"settled"` nor `"void"` **silently**: no point, no bar, and **no
   `excluded` entry**. `loadSeasonView` emits a row for every gameweek in the competition, including
   ones that have not been played — an open or upcoming gameweek has no `gameweek_results` row, so
   `outcome` is `null` (`lib/gw-season.ts:377`: `outcome: result?.outcome ?? null`) and
   `entryStatus` is typically `"entered"` rather than `"locked_in"`.

   This precondition runs **before** the classification below, and it exists because `excluded` means
   "settled-era data this chart cannot use" — a fact about the past worth footnoting. A gameweek that
   simply has not happened yet is not a gap in the sample. Without the precondition, ZZ-P1's open GW4
   falls through to the rules below and produces either a false `"void"` line (it fails
   `outcome === "settled"`) or a misleading `"you sat out"` line (its `entryStatus` is `"entered"`) —
   footnoting a gameweek nobody could have played. This fires on **first page load**, not in an edge
   case: every league in mid-season has a current open gameweek.

   Then, among rows that pass the precondition, keep only those where all of:
   `entryStatus === "locked_in"`, `outcome === "settled"`, `isVoid === false`, `dirty === false`,
   `points != null`, and `countedFixtures != null && countedFixtures > 0`. Anything failing one of
   those **is** recorded in `excluded` with its reason and dropped. Specifically:
   - **fully-void gameweek** → `outcome !== "settled"`, and it has no snapshot at all (§0.1) →
     `reason: "void"`.
   - **gameweek the viewer sat out** → `entryStatus !== "locked_in"` → `reason: "not_entered"`.
   - **dirty gameweek** → `reason: "recalculating"`. Dropped **entirely** — neither point nor bar
     (§0.2). Rev 1 plotted the live point next to a suppressed bar; that divided a live numerator
     by a stale `countedFixtures`.
   - **settled gameweek whose snapshot has no counted fixtures** (`countedFixtures === 0`, or
     `per_fixture` empty or all-void) → `reason: "no_counted_fixtures"`. Distinct from `"void"`,
     because this gameweek *does* have a snapshot — there is just nothing in it to divide by. The
     footnote wording differs accordingly, and the distinction is what keeps the void footnote's
     count honest.
2. Sort ascending by `gwNumber`, take the **last 6**.
3. If fewer than **2** usable gameweeks remain, return `null`. One point is not a trend.
4. `ptsPerFixture = round(points / countedFixtures, 2)`.
5. The x-axis is **positional, not calendar-spaced** — matching the canon frame. If GW3 is excluded
   the line joins GW2 to GW4 directly, and `excluded` records why. There are no holes in `points`.
6. `netDelta` = sum of the window's `displayNetInr`. Because rule 1 already excluded every dirty
   row, no member of the window can be `"suppressed"` — assert that invariant in the builder and
   test it, rather than carrying a suppressed branch that can no longer be reached.
7. `startedAt` = cumulative net over gameweeks strictly **before** the window's first `gwNumber`,
   from the same `rows` array, no extra query. It is `number | null`, and it renders **only when the
   viewer verifiably had a prior balance**. Three rules, in order:

   a. **No pre-window gameweek carries real settled money → `null`.** If the window covers the whole
      of the viewer's entered season, there is no earlier balance to have started from. Returning `0`
      here would render `Last 3 GWs · started ₹0`, which claims the viewer was flat before GW1 — a
      fabricated figure, and one QC step 6 explicitly forbids. **This is ZZ-P1's exact state today:
      the window is GW1–GW3 with nothing before it, so the clause must not render on first load.**
      "Real settled money" means a pre-window row that passed rule 1's precondition, has
      `outcome === "settled"`, is not dirty, and has a numeric `displayNetInr`.
   b. **Any pre-window gameweek is dirty → `null`.** `displayNetInr` is `"suppressed"` there, so the
      sum is unknowable. Scan for a suppressed value and bail; do not coerce, do not fall back to
      `0`. `Number("suppressed")` is `NaN` and a `?? 0` would print a confidently wrong balance.
   c. **Otherwise → the sum.** Gameweeks the viewer sat out contribute a known zero and do not null
      the figure — but only because rule (a) has already established that at least one pre-window
      gameweek does carry real money. A run of nothing but sat-out gameweeks fails (a) and returns
      `null`, because "sat out every earlier gameweek" and "had a balance of ₹0" are different
      claims. Open and upcoming gameweeks are not pre-window rows at all; the precondition removed
      them before this rule sees the array.

   Net effect: the clause appears when there is a prior balance to report, and disappears in both
   directions of doubt — nothing came before, or what came before is unknowable.
8. `rangeLabel` = `GW{first}–GW{last}`, or `GW{n}` when equal.
9. When `excluded` is non-empty, the component renders a one-line footnote naming the count and the
   reason — the same honesty move as module 05's shared-gameweek footnote. A silently shortened
   window reads as a complete one. One footnote line per distinct reason present.
10. When `startedAt` is null, the net-trend sub-line drops the "started" clause and reads
    `Last N GWs` alone. The `netDelta` value still renders — the change over the window is known
    even when the level it started from is not.

### Component

`<MyFormTrend trend={trend} />`, returns `null` when `trend` is null.

- Spark box: `viewBox="0 0 300 83"`, `preserveAspectRatio="none"`, two dashed grid lines at y=21
  and y=50 in `cs2-line`, one `polyline` in `cs2-green` (stroke 2.5, round caps), a `circle` per
  point (r 3.5, white fill, green stroke), last point solid at r 4.5.
- y-normalisation: map `[min, max]` onto `[70, 13]` with a 10% pad. When min equals max, pin every
  point to the vertical middle rather than dividing by zero.
- Feet: one mono `<span>` per point, 2dp, evenly spaced.
- `aria-label` from a copy template — a bare polyline gives a screen reader nothing.
- Net-trend row: title, sub-line, `<NetValue net={netDelta} />`, and the bar run — one `<span>` per
  bar, heights scaled off `max(|net|)`, `cs2-green` positive, `cs2-red` negative, `cs2-line` at
  minimum height for an exact zero.
- Sub-line: `netTrendSubStarted` when `startedAt` is a number, plain `netTrendSub` when it is null.
  No "started —", no "started ₹0".
- Footnote when `excluded` is non-empty, one line per distinct reason.

### Copy keys

```ts
trendHead: (count: number) => `Last ${count} GWs · pts / fixture`,
trendRange: (first: number, last: number) => first === last ? `GW${first}` : `GW${first}–GW${last}`,
netTrendTitle: "Net trend",
/** startedAt === null — the change is known, the starting level is not. */
netTrendSub: (count: number) => `Last ${count} GWs`,
/** startedAt is a number. `started` is pre-formatted by inr(), which already emits U+2212. */
netTrendSubStarted: (count: number, started: string) => `Last ${count} GWs · started ${started}`,
trendAria: (first: number, last: number, from: string, to: string) =>
  `Points per fixture from GW${first} to GW${last}, ${from} to ${to}`,
trendExcludedVoid: (n: number) => `${n} void gameweek${n === 1 ? "" : "s"} left out.`,
trendExcludedNotEntered: (n: number) => `${n} gameweek${n === 1 ? "" : "s"} you sat out left out.`,
trendExcludedDirty: (n: number) => `${n} gameweek${n === 1 ? "" : "s"} still recalculating.`,
trendExcludedNoFixtures: (n: number) =>
  `${n} gameweek${n === 1 ? "" : "s"} with no counted fixtures left out.`,
```

`netTrendStarted: "started"` from rev 2 is gone — a bare word fragment forces the component to
assemble the sentence, which is what the copy-scan rule exists to prevent.

### Tests (`tests/phase6/analytics-trend.test.ts`)

1. Six clean settled gameweeks → six ascending points, `rangeLabel` "GW1–GW6", feet equal
   `points/countedFixtures`.
2. Eight → the **last six** (GW3–GW8), not the first six.
3. One usable gameweek → `null`. Two → a trend.
4. **A fully-void gameweek** (`outcome: "void"`, no snapshot, `countedFixtures: null`) is excluded
   with `reason: "void"`, appears in neither `points` nor `bars`, and does not appear as `0.00`.
   *(This replaces rev 1's test 4, which asserted a void gameweek contributes to `voidPicks` — §0.1
   proves that state cannot exist.)*
5. A gameweek the viewer did not enter → excluded, `reason: "not_entered"`, no `0.00`.
6. `countedFixtures === 0` on a settled gameweek → excluded with `reason: "no_counted_fixtures"`
   (not `"void"`), and no divide-by-zero. Same assertion for an empty and an all-void `per_fixture`.
7. **A dirty gameweek is excluded outright** — absent from `points` and from `bars`, recorded with
   `reason: "recalculating"`, and `netDelta` is a plain number computed from the remaining
   gameweeks. Regression guard for §0.2: assert the dirty gameweek's live `points` never reaches
   the output.
8. `startedAt` sums only gameweeks before the window (guard against double-counting the window), and
   only when rule 7(a) is satisfied.
9. **`startedAt` is `null` when a pre-window gameweek is dirty** (rule 7b) — the specific case:
   GW1–GW2 clean settled, GW3 dirty, GW4–GW9 clean, window GW4–GW9. Assert `startedAt === null`, and
   assert it is **not** `0`, **not** `NaN`, and **not** the GW1+GW2 sum with GW3 silently skipped.
   `netDelta` is still a number, since GW3 is outside the window.
10. `startedAt` is a **number** when a pre-window gameweek was merely not entered *and* another
    pre-window gameweek carries real settled money (rule 7c) — the sat-out gameweek contributes a
    known zero. Case: GW1 settled with net, GW2 sat out, window GW3–GW8 → `startedAt` equals GW1's
    net. Guards against over-nulling, which would hide the clause for the common late-joiner case.
11. **`startedAt` is `null` when there are no pre-window gameweeks at all** (rule 7a) — the window is
    the whole entered season. Case: exactly GW1–GW3, all clean settled, window GW1–GW3. Assert
    `startedAt === null` and specifically **not `0`**. This is ZZ-P1's state on first load, so it is a
    first-paint case rather than an edge case, and `0` here would render the forbidden
    `Last 3 GWs · started ₹0`.
12. `startedAt` is `null` when every pre-window gameweek was sat out — no real settled money before
    the window (rule 7a). Distinguishes "sat out everything earlier" from "had a balance of ₹0".
13. **An open gameweek produces neither a point nor an `excluded` entry** (rule 1's precondition) —
    the ZZ-P1 shape: GW1–GW3 settled and entered, GW4 with `outcome: null` and
    `entryStatus: "entered"`. Assert `points` has three entries, `bars` has three, and
    `excluded` is **empty** — no `"void"` entry and no `"not_entered"` entry for GW4. Then assert the
    component renders **no footnote at all** for that trend. A footnote about a gameweek nobody could
    have played is worse than no footnote.
14. An upcoming gameweek with `entryStatus: null` (no entry row at all) is likewise dropped silently,
    not recorded as `"not_entered"`. Same precondition, different row shape.
15. Flat run → no NaN, all points identical.
16. Shuffled input rows → same output as sorted input (the builder must not trust
    `loadSeasonView`'s descending order, which `loadAnalyticsFeed` separately depends on).
17. Empty `rows` → `null`.
18. `excluded` is populated in gameweek order with one entry per skipped gameweek, and two
    gameweeks excluded for different reasons produce two distinct reason values.
19. **The ZZ-P1 first-load shape end to end**, as one case: GW1–GW3 clean settled and entered, GW4
    open. Assert a three-point trend, `rangeLabel` "GW1–GW3", `excluded` empty, `startedAt` null, and
    `netDelta` a number. This is the state the screen will actually be in on the day Phase A ships, so
    it gets its own test rather than being implied by tests 11 and 13.

Component tests (`tests/phase6/analytics-feed-components.test.tsx`):

20. `trend: null` → no SVG in the document.
21. Six points → six `circle`s and six feet; last foot's text equals the last value to 2dp.
22. A negative gameweek renders the loss-coloured bar; an exact-zero gameweek renders the neutral
    minimum-height bar and not a green one.
23. Non-empty `excluded` renders the footnote; empty `excluded` renders no footnote element; two
    distinct reasons render two lines. **Third case: a trend built from a season that ends in an open
    gameweek renders no footnote at all** — the open gameweek never reaches `excluded`, so nothing is
    there to print. Assert the footnote element is absent, not merely empty.
24. **`startedAt: null` renders the sub-line with no "started" clause** — assert the rendered text
    does not contain "started", and does not contain `₹0`. Run this twice: once for the dirty
    pre-window case and once for **the no-pre-window case (ZZ-P1's first load)**, since that is the
    one a `?? 0` slip would turn into `Last 3 GWs · started ₹0`. `startedAt: 920` renders
    `Last 6 GWs · started +₹920`.

### Edge cases

- **No data / one gameweek:** `null`; the card renders as it does today.
- **Late joiner** (`eligible_from_gameweek_id` mid-season): pre-join gameweeks have no
  `gameweek_entries` row → `entryStatus` null. Those that already **settled** are excluded as
  `not_entered` and footnoted; ones that have not been played yet fail rule 1's precondition and
  vanish silently. A GW5 joiner sees a trend from GW5, never a run of zeros from GW1, and `startedAt`
  is `null` for them until a settled pre-window gameweek carries real money.
- **Window covers the whole entered season** (nothing before GW1 in the window): rule 7(a) puts
  `startedAt` at `null` and the sub-line reads `Last 3 GWs` with no starting figure. The chart, the
  bars and `netDelta` are all unaffected. **This is ZZ-P1 today** and the first state the module will
  be seen in.
- **Open or upcoming gameweek** (`outcome` null, `entryStatus` `entered` or null): dropped by rule 1's
  precondition before classification — no point, no `excluded` entry, no footnote. The chart simply
  ends at the last settled gameweek, which is what a reader expects mid-gameweek.
- **Fully-void gameweek:** no snapshot exists at all; excluded and footnoted.
- **Partially-void gameweek:** settled, so it plots. Its `countedFixtures` excludes the void
  fixtures, which is the correct denominator — the void fixtures contributed to nobody's points.
- **Double gameweek:** one `gwNumber`, more counted fixtures; the rate handles it with no special
  case. This is why the canon chose a rate over raw points.
- **Every recent gameweek dirty:** fewer than 2 usable → `null`, and the card falls back to
  net + record. Correct: a chart of two stale points is worse than no chart.
- **An *older* gameweek dirty, the recent six clean:** the chart and `netDelta` are unaffected —
  rule 1 only ever looked at the window. `startedAt` is `null`, so the sub-line reads `Last 6 GWs`
  with no starting figure. The chart is the most valuable part of the module and it still ships;
  only the one clause that genuinely cannot be computed disappears.
- **Archive (cup) league selected:** `trend` is `null` by construction.

### QC script

1. `npm run dev`, log in as `testa`, Home → Analytics.
2. Select **ZZ-P1**. Confirm the point count equals ZZ-P1's clean settled gameweeks, the range
   label matches those gameweek numbers, and two feet values equal `points ÷ counted fixtures`
   cross-checked against the league's Season tab. As of today that is **GW1–GW3, three points** —
   GW4 is open, so it must not appear as a point and must not appear in the footnote either. Any
   footnote at all on ZZ-P1 right now is a bug.
3. Confirm `netDelta` equals the sum of those gameweeks' nets. **Expect no "started" figure on ZZ-P1**
   — the window starts at GW1, so nothing precedes it and rule 7(a) makes `startedAt` null. Seeing
   `started ₹0` is the exact failure this step exists to catch. Then check the rule the other way: a
   "started" figure is allowed only when the Season tab shows at least one settled gameweek before the
   window with real money, and it must equal season net minus `netDelta`.
4. **Void and dirty gameweeks cannot be checked on real data yet** — verified today, the database has
   no void gameweek and no dirty gameweek anywhere, ZZ-P1 included. Those two paths are covered by
   builder tests 2, 3, 5, 9 and 12 only. Do not claim a browser check for them; if a void or dirty
   gameweek appears later, come back and confirm it is absent from the chart **and** named in the
   footnote.
5. Dark mode: line, grid, bars, feet all legible; no hardcoded hex.
6. Ananth read-only on all three real leagues. These carry only the **wc2026 cup** competition, so
   their my-form is the archive path where `trend` is `null` by construction — this step can only
   assert **absence**: no chart, no footnote, no "started" clause, no `0.00` point anywhere. It is a
   guard against the module leaking onto the archive side, not a check of chart maths.
7. 320px width: the SVG scales, feet do not overflow.

### Risks

- `season.rows` is **descending** and `loadAnalyticsFeed` depends on that (`rows[0]` is the "through
  GW6" marker). The builder sorts ascending itself; test 16 is the guard.
- `per_fixture` from an older settle path could be `[]`. Rule 1 treats `countedFixtures === 0` as
  unusable with its own reason, so the failure mode is a missing point, never a wrong one.
- **`startedAt` is the one place a stale number can still slip through**, because it reads
  gameweeks the window rule never filtered. `displayNetInr` is `number | "suppressed"`, so TypeScript
  will force the branch — the danger is answering it with `Number(...)` or `?? 0` instead of `null`.
  Tests 9, 10, 11 and 12 pin every direction. TypeScript will **not** catch the no-pre-window case
  (test 11): a `0` seed that never gets added to is a valid number, so only the test stops it.
- Moving `NetValue` touches `AnalyticsFeed.tsx`'s imports. It is a pure move; the existing component
  tests cover the render, so a mistake shows up as a red test, not a silent regression.
- `preserveAspectRatio="none"` stretches stroke width horizontally. The canon accepts it; if it
  reads badly at 320px, switch to a fixed aspect ratio rather than re-scaling the geometry.

---

## Phase B — live-side my-form record

**Size: S.** Depends on Phase A only for the `gw-season.ts` field addition, which A lands.

### Goal

The live my-form card shows a real `14–5–1` correct–incorrect–void record for the selected league's
gameweek competition, from the grading the settlement engine recorded — not re-derived, not
estimated, and never `0–0–0` from an absence of data.

### Files

Modify:
- `lib/gw-season.ts` — aggregate the four counters into `buildRunningTotals`, and onto
  `SeasonMemberTotal`.
- `lib/analytics-feed.ts` — `buildLiveMyForm` sets `record` from those totals.
- `tests/phase3/gw-season.test.ts` — totals aggregation cases.
- `tests/phase6/analytics-feed.test.ts` — `buildLiveMyForm` record cases.

No new query. No new copy key: `ANALYTICS_COPY.recordLine(correct, incorrect, voided)` already
exists and is already used by the archive side.

### New types

`SeasonMemberTotal` gains:

```ts
correctPicks:    number | null | "suppressed";
incorrectPicks:  number | null | "suppressed";
voidPicks:       number | null | "suppressed";
countedFixtures: number | null | "suppressed";
```

Three states, all distinct and all needed:

- **`number`** — at least one settled, clean, non-dirty gameweek contributed a usable
  `per_fixture` blob, and this is the sum over those.
- **`null`** — no usable snapshot exists in the member's set. Empty set, every gameweek void,
  `per_fixture` absent, or `per_fixture` malformed. `buildLiveMyForm` renders **no record**.
- **`"suppressed"`** — at least one gameweek in the set is dirty, so the sum would be stale.
  `buildLiveMyForm` renders no record.

`number | "suppressed"` alone (rev 1) could not express the middle case, and `buildRunningTotals`
seeds its reducers at `0` (`lib/gw-season.ts:61-85`), so an empty or malformed set would have
produced `0–0–0` — a fabricated record, the exact bug class §"Conventions" names. Implementation:
accumulate into a `number | null` that stays `null` until the first usable row, and short-circuit
to `"suppressed"` the moment a dirty row is seen. Do not reuse the existing zero-seeded reducers.

### Aggregation rules

Per row, **only when `outcome === "settled"` and the row is not dirty** (§0.1, §0.2), from
`per_fixture`:

- `correctPicks` = count of `verdict === "exact"` + count of `verdict === "result"`
- `incorrectPicks` = count of `verdict === "miss"`
- `voidPicks` = count of `verdict === "void"` — **partial voids inside settled gameweeks only**
- `countedFixtures` = `correctPicks + incorrectPicks` (voids are in none of the three aggregates,
  per `scoreGameweek`'s P2 rule)

Rows failing the gate, or carrying an absent/empty/malformed blob, contribute **nothing** — they do
not contribute a zero and they do not make the total `null` if another row was usable.

**The grading-drift guard.** `scoreGameweek` pays 3 for an exact and 1 for a result, so
`points === 3·exacts + 1·results`, therefore `correct === points − 2·exacts`. Assert that identity
in a unit test against the same fixture data used to compute the record. It exists to fail loudly if
the points scale ever changes under us, and it encodes *why* the record is trustworthy — it is the
settlement engine's own verdicts. Read-only assertion; changes no scoring code.

### Tests

1. One settled gameweek, `per_fixture` of 3 exact / 4 result / 2 miss / 1 void → record `7–2–1`,
   `countedFixtures` 9.
2. Two settled gameweeks sum correctly across both.
3. `points − 2·exacts === correctPicks` on that same data (drift guard).
4. **A fully-void gameweek in the set contributes nothing** — no snapshot exists (§0.1) — and if it
   is the *only* gameweek, all four counters are `null` and `buildLiveMyForm` renders no record.
   *(Replaces rev 1's test 4.)*
5. A **partially-void** settled gameweek: the void fixtures land in `voidPicks` and in neither
   `correctPicks` nor `countedFixtures`. This is the only path to a non-zero third number.
6. A member who never entered → counters `null`, `hasEntries: false`, `buildLiveMyForm` returns
   `null` (existing behaviour, regression guard).
7. A dirty gameweek anywhere in the set → all four `"suppressed"`, `record: null`. **And `net` is
   `"suppressed"` too** — `buildRunningTotals` already suppresses `netInr` for a dirty set, so the
   card shows `···` for the net and no record at all. (Rev 1 claimed suppression "keeps the net";
   that was wrong.)
8. `per_fixture: []` → contributes nothing. With no other usable row: `null`, not `0–0–0`.
9. `per_fixture` containing an unrecognised verdict string → the row is treated as unusable rather
   than under-counted. The column is jsonb with no check constraint, so this is reachable.
10. Archive side unchanged: `buildArchiveMyForm` still emits `correct–incorrect–0`.

### Edge cases

- **No settled gameweek yet:** `buildLiveMyForm` already returns `null` when
  `gameweeksEntered === 0`. Unchanged.
- **One gameweek:** a `7–2–1` from one gameweek is honest and shows; the existing sample note
  ("1 settled gameweek in this league") carries the caveat.
- **Late joiner:** only their own entries have snapshots, so the record covers only what they
  played.
- **A league with no partial voids ever:** the record reads `14–5–0`. A measured zero is fine; the
  rule forbids fabricated zeros, not real ones.
- **Dirty / re-settling gameweek:** record absent, net `···`.

### QC script

1. `testa` on ZZ-P1: read the record off the card, then hand-recount exacts and results for two
   gameweeks from the Season tab. They must match.
2. The third number: **ZZ-P1 has no void fixtures today** (same verification as Phase A QC step 4 —
   no void and no dirty gameweek exists anywhere in the database), so the only correct reading right
   now is `0`, and the check is that the record renders **with** that `0` rather than going blank.
   The non-zero path is covered by builder test 5, not by the browser.
3. Ananth read-only on all three real leagues: these are **cup** competitions, so this is the archive
   record (`n–n–0`) and not the live path. Assert it is present and plausible. The dirty-gameweek
   reading — record absent, net showing `···` — has no data to check against and stays on test 7.
4. Archive league in the filter: still `n–n–0` from the cup path, unchanged.

### Risks

- The one real risk is trusting a jsonb blob's shape. Mitigated by the settled-and-clean gate
  (§0.1/§0.2), by treating an unexpected verdict as unusable (test 9), and by the
  `points − 2·exacts` identity guard (test 3).
- `buildRunningTotals` is shared with the Season tab. The additions are additive, but run
  `tests/phase3/gw-season.test.ts` and QC the Season tab before calling it done.

---

## Phase C — canon modules 02–07

**Size: L overall.** Three gated sub-phases: C1 (M), C2 (M), C3 (L, the proposed cut line).

### C.1 The shared corpus — what it must contain

Five of the six modules need the same thing: **every locked-in entrant's picks, each fixture's
effective state and result, and the stored grading of each pick, for the settled gameweeks of one
league's competition.**

Rev 1's corpus held predictions only. That is not enough: modules 03, 04, 05's swing clause and 06
all need to know whether a pick was an exact, a result or a miss, and how many points it paid.
Re-deriving that in a builder would be a second implementation of `gradeFinal`
(`lib/gameweek-points.ts:96`) — two grading rules in one codebase, drifting apart silently. So
the corpus carries the **stored** grading, and builders read it.

```ts
// lib/analytics-corpus-load.ts
export type CorpusPick = { userId: string; fixtureId: string; predHome: number; predAway: number };

export type CorpusFixture = {
  fixtureId: string; gwNumber: number;
  /** collapsed from membership history — see C.2(b) */
  state: "final" | "void";
  ftHome: number | null; ftAway: number | null;
  homeTeamId: string; awayTeamId: string;
  homeName: string; homeShort: string;
  awayName: string; awayShort: string;
};

/** The stored settlement snapshot. Grading is READ, never recomputed. */
export type CorpusEntryResult = {
  userId: string; gwNumber: number;
  points: number; exacts: number; goalError: number;
  perFixture: { fixtureId: string; verdict: "exact" | "result" | "miss" | "void"; pts: 0 | 1 | 3 }[];
};

export type SeasonPickCorpus = {
  leagueId: string; competitionId: string;
  members: { userId: string; name: string; isViewer: boolean }[];
  /** settled, non-dirty gameweeks only; entrants AS OF that gameweek */
  gameweeks: { gwNumber: number; entrantIds: string[] }[];
  /** gameweeks present in the league's history but excluded, with the reason */
  excludedGameweeks: { gwNumber: number; reason: "void" | "recalculating" | "not_settled" }[];
  fixtures: CorpusFixture[];
  picks: CorpusPick[];
  results: CorpusEntryResult[];
};
```

**The boundary, stated so no builder crosses it.** A builder may read `verdict` and `pts` from
`perFixture`, and `points`/`exacts`/`goalError` from `CorpusEntryResult`. A builder may compute
*prediction-shaped* facts from `picks` and `fixtures` — a predicted scoreline's frequency, a
predicted outcome (home/draw/away) for a consensus vote, the goal margin between a prediction and
a result, whether a miss was by exactly one goal. A builder may **never** decide whether a pick was
correct, exact or a miss, and may never assign points. If a fact needs a verdict, it reads the
stored verdict.

Dirty gameweeks are excluded from the corpus entirely and recorded in `excludedGameweeks`, for the
same reason as §0.2: their stored `perFixture` disagrees with their live points. Every module
therefore inherits a clean, consistent gameweek set, and every module's footnote can name what was
left out.

### C.2 Corpus queries — the four things that must be right

**(a) Only locked-in entries.** `gameweek_entries.status` is
`'entered' | 'needs_update' | 'locked_in' | 'invalid'`
(`supabase/migrations/20260727000002_gameweek_entries.sql:136-137`). Only `locked_in` entries are
scored, and `invalid` entries genuinely occur. Every corpus query filters
`.eq("status", "locked_in")`; there is a partial index for exactly this predicate
(`idx_gameweek_entries_gw_locked`). Skipping the filter would silently include non-scored picks in
every consensus vote, every modal-pick label and every club rate.

**(b) Fixture membership is history-preserving.** `gameweek_fixtures` keeps `excluded` and `void`
rows alongside the current one (that is why `one_active_gw_per_fixture` is a *partial* unique
index, and why `gameweek_picks.membership_id` can reference a stale row and still be valid — see
the L4 note at the table definition). Selecting rows directly yields duplicate and dead fixtures.
Pass the rows through **`collapseGameweekFixtures`** (`lib/gw-fixtures.ts:27`), which mirrors the
`gameweek_effective_fixtures` view: any `active` row wins, then `void`, and `excluded`-only history
disappears. `lib/gw-view.ts` already goes through it; the corpus must too.

**(c) Group clubs by team ID, never by label text.** FPL reconciliation writes
`home_team_id`/`away_team_id` and never touches `home_label`/`away_label`
(`supabase/migrations/20260727000001_competitions_gameweeks.sql:770` insert and `787` update).
Gameweek-era fixtures therefore have team FKs and, in general, no labels — `home_label` is the
World Cup's mechanism. Module 06 groups by `home_team_id`/`away_team_id` and joins
`teams(id, name, short_name)` for display, exactly as `lib/gw-view.ts:626` does with its named-FK
select (`fixtures!gameweek_fixtures_fixture_id_competition_id_fkey`,
`home_team:teams!fixtures_home_team_id_fkey`). `lib/club-name-alias.ts` is **not** needed here —
it exists to reconcile FPL-shaped names against ESPN-shaped standings, and the corpus reads names
from `teams` directly.

**(d) Page every unbounded read.** PostgREST caps a response at 1000 rows by default. A 20-member
league over 38 gameweeks at 10 fixtures is ~7,600 pick rows, so a single unpaged query would return
1,000 of them and every downstream number would be quietly wrong. Every corpus query that can
exceed 1000 rows (`gameweek_picks`, `gameweek_entry_results`, `gameweek_fixtures`) uses `.range()`
paging with a **stable total order** — `order("entry_id").order("fixture_id")` for picks, and the
equivalent composite for the others — looping until a page comes back short. Never order by a
non-unique column alone: a tie at a page boundary drops or duplicates rows.

Loader tests (`tests/phase6/analytics-corpus-load.test.ts`, against a stubbed client in the style
of the existing loader tests):

1. **>1000 picks** across three pages reassemble into one complete, duplicate-free set, and a
   boundary tie on the primary order key is neither dropped nor duplicated.
2. A query error throws with a labelled context, matching `fail()`'s existing spelling — it never
   returns a partial corpus.
3. The select strings resolve their **named** FKs. This is the v101/v102 failure class: an
   ambiguous embed against a table with two FKs to `teams` fails at request time, not at compile
   time, so it needs a test that asserts the literal select string contains the named-FK form.
4. `status = 'locked_in'` filtering: an `invalid` and an `entered` entry in the fixture data are
   absent from `picks` and from `gameweeks[].entrantIds`.
5. Membership collapse: a fixture with `excluded` + `active` history appears once, as `final`;
   an `excluded`-only fixture does not appear.
6. Dirty suppression: a dirty gameweek is absent from `gameweeks`, `picks` and `results`, and
   present in `excludedGameweeks` with `reason: "recalculating"`.
7. Fully-void gameweek: absent, `reason: "void"`, and no `results` rows (§0.1).
8. Departed entrants: a member no longer in `member_competitions` but with locked-in entries still
   appears in `members` with a resolved name (the `loadSeasonView` departed-names pattern), so a
   past gameweek's labels and receipts are not attributed to "Player".
9. Competition isolation: a league with both a PL and an archived WC competition returns only the
   requested competition's fixtures, picks and results.

Cost: three paged queries per `(league, competition)`, scoped to settled clean gameweeks. Not on
the home critical path — see §C.6.

### C.3 Where each module's inputs come from

| Module | Inputs | Exists today? | Needs corpus? |
|---|---|---|---|
| 02 You vs the room | every member's per-gameweek points, exacts, correctPicks, goalError, countedFixtures | Partly — the data is computed in `loadSeasonView` but **not exposed** (§C.4) | No |
| 03 Receipts | per-fixture picks + stored verdicts + names | Yes in the DB, no loader | **Yes** |
| 04 Weekly labels | one gameweek's picks + verdicts for every entrant | Yes in the DB, no loader | **Yes** (one gameweek) |
| 05 Rivalry | two members' per-gameweek points/exacts; shared-gameweek set | Partly — same exposure gap (§C.4) | No for v1; yes for the swing clause |
| 06 Club reads | viewer's picks joined to team IDs + stored verdicts | Yes in the DB, no loader | **Yes** |
| 07 Prediction habits | viewer's picks + results; room picks for the consensus split | Yes in the DB, no loader | **Yes** |

Nothing is hard data-blocked. What varies is cost, and whether a module's headline claim survives
without the corpus.

### C.4 The `SeasonView` exposure gap, and the one comparison window

Modules 02 and 05 need every member's **per-gameweek** rows. `loadSeasonView` builds exactly that
in a local `byUser` map (`lib/gw-season.ts:247`) and then throws it away: `SeasonView` returns
`{ rows, totals, viewerName }` (`lib/gw-season.ts:105`), where `rows` is the **viewer's** rows and
`totals` is one aggregate row per member. Rev 1 assumed per-member rows were available. They are
not.

**Fix.** Add a third field:

```ts
export type SeasonMemberGameweek = {
  userId: string;
  gwNumber: number;
  entered: boolean;          // status === "locked_in"
  settled: boolean;          // outcome === "settled" && !dirty
  points: number | null;
  exacts: number | null;
  correctPicks: number | null;   // exact + result, from the stored per_fixture snapshot
  goalError: number | null;
  countedFixtures: number | null;
};
export type SeasonView = {
  rows: SeasonRow[];
  totals: SeasonMemberTotal[];
  memberGameweeks: SeasonMemberGameweek[];   // NEW
  viewerName: string | null;
};
```

Cost, stated plainly:

- **Query cost: zero.** `byUser` is already built from data already fetched. This is a projection,
  not a new read.
- **Payload cost: real but bounded.** A 20-member league over 38 gameweeks is 760 rows of nine
  scalars — tens of KB serialised. It is a flat array of a **slim** row type on purpose, not
  `SeasonRow[]` (which carries `href`, `viewerId` and the whole `[key: string]: unknown` tail).
- **Where it travels:** through the analytics read route (§C.6), never through the home page's
  eager payload. Also confirm no existing `SeasonView` consumer serialises the whole object into a
  client component; the Season tab reads `rows`/`totals`, so adding a field is additive, but check
  it during C1 rather than assume it.
- **Also expose** `goalError` on `SeasonMemberTotal` (currently summed only for ranking, not kept),
  which module 02's avg-goal-miss row needs.
- **`correctPicks` is in the projection because module 02's result-rate row divides by it.** It costs
  nothing new: Phase A already reads `per_fixture` in this loader and Phase B already derives
  `correctPicks` per row for the record, so the projection copies a value that exists by the time C1
  starts. Its `null` means the same thing everywhere — no usable snapshot for that (member,
  gameweek) — which is what lets module 02 drop a row instead of printing `0%`. Omitting it would
  have forced module 02 either to re-derive verdicts (crossing §C.1's boundary) or to reconstruct
  correctness from `points − 2·exacts`, which is the same arithmetic in a second place.

**One comparison window, defined once, applied everywhere in module 02.** The window is: gameweeks
where **the viewer** was `locked_in` **and** the gameweek is settled, non-void and non-dirty. Every
other member's numbers in module 02 are computed **over that same set of `gwNumber`s** — not over
their own full season. Without this, a GW20 joiner's five gameweeks get compared against
established members' twenty, and the "+6" difference is measuring tenure, not skill.

The `≥2 other members` hide threshold applies **within** the window: at least two other members must
have at least one `locked_in` settled gameweek inside it. A per-row denominator of 0 hides that row.
The module's sub-line names the window (`Over your 5 settled gameweeks · 3 others`), because a
difference against an unnamed sample is not a fact.

Module 05's window is its own, narrower one — the intersection of the viewer's and the rival's
locked-in settled gameweeks — and it is already named in the canon's footnote.

### C.5 The sub-phases

#### C1 — modules 02, 05, 07 (**M**)

Highest value per unit of work: 02 and 05 need no corpus, and 07's viewer slice is the cheapest
corpus consumer, so C1 lands the corpus loader against the simplest client.

**Module 02 — You vs the room.** Canon: league scope selector, then four difference rows — exact
rate (`17%` vs "Other 3 average 11%", `+6`), result rate (`54%` vs 48%, `+6`), avg goal miss (`1.4`
vs 1.7, `−0.3`, "lower is better"), last-5 form (`1.02` pts/fixture vs 0.79, `+0.23`) — then a
per-member exact-rate bar list (You 17% · Dheeraj 14% · Kiran 11% · Rohan 8%) and a sentence.

- Builder `buildYouVsRoom(memberGameweeks, viewerId)` in `lib/analytics-room.ts`. Derives the
  window per §C.4, then per member: exact rate = `exacts / countedFixtures`, result rate =
  `correctPicks / countedFixtures`, avg goal miss = `goalError / countedFixtures`, last-5 form =
  pts/fixture over the last five gameweeks **of the window**.
- Every rate is `number | null`; a 0 denominator hides its row. The "other N average" is over
  members with a non-null rate, and the count of those members is stated in the copy.
- Hide the module when fewer than 2 other members qualify inside the window.
- Never blend leagues — matches the locked "Do not blend form samples across leagues" ruling.
- The closing sentence is a copy template over computed facts (who is closest, on which metric),
  not generated prose. If it needs a fifth branch, drop the sentence.

**Module 05 — Rivalry.** Canon: league selector, rival selector, `4 Won / 2 Lost / 1 Tied`,
`13–8 Exacts`, a note, and a footnote ("7 shared gameweeks of the 8 settled. He sat out GW3; that
week is excluded from both sides.").

- Per-rival builder `buildRivalry(memberGameweeks, viewerId, rivalId)` → `RivalryRecord =
  { won, lost, tied, viewerExacts, rivalExacts, sharedGameweeks, settledGameweeks,
  excludedGameweeks, currentRunLength, runOwner }`.
- **The module's shape is every rival at once, not one selected rival.** The rival selector is client
  state, so the route — which has no rival parameter and must not grow one — returns:

  ```ts
  export type AnalyticsRivalry = {
    /** Selector options, ordered by name. Empty ⇒ the module hides. */
    options: { userId: string; name: string }[];
    /** One precomputed record per option's userId. */
    byRivalId: Record<string, RivalryRecord>;
    /** Which option the client selects on first paint — most shared gameweeks, name as tie-break. */
    defaultRivalId: string | null;
  };
  ```

  A singular `rivality`-shaped field (rev 2) could only have worked with a rival parameter on the
  route, which would mean a round trip per selector change — for data the response already holds.
- Computing all rivals server-side is **free in query terms**: every record is derived from the same
  `memberGameweeks` array, which was already fetched for module 02. It is pure CPU over an in-memory
  array, no per-rival I/O.
- **Payload cost, stated:** one record per other member, ~10 scalars each plus an
  `excludedGameweeks` list. A 20-member league is 19 records — a few KB. It grows linearly with
  members, and the practical ceiling is a friend group, not a public league. If a league ever gets
  large enough for this to matter, the fix is to add a rival parameter and fetch on selection, and
  the trade reverses — note it, do not pre-build it.
- Shared gameweeks only: intersect on `gwNumber` where both are `locked_in` and the gameweek is
  settled, non-void, non-dirty. Each rival gets its own intersection, so `sharedGameweeks` differs
  per rival — which is exactly why the footnote must be per-record and not module-level. Excluded
  gameweeks are named in the footnote; the footnote is what makes the record honest, so it ships with
  the module.
- A rival with **zero** shared gameweeks is left out of `options` entirely rather than offered with an
  empty record. An option that resolves to `0 Won / 0 Lost / 0 Tied` is the fabricated-zero bug with a
  dropdown in front of it.
- Switching rivals reads `byRivalId[id]` — no round trip, no loading state, no refetch.
- **v1 omits "biggest swing"** (needs corpus verdicts); the note reduces to the streak clause. The
  swing clause lands in C2.
- Hide when no other member shares a settled gameweek.

**Module 07 — Prediction habits.** Canon: most-called scoreline (`2–1`, "18 of 80 picks"), draw rate
(`14%` vs "Actual draws this season: 26%"), home bias (`61%` vs "Home wins actually landed 44%"),
goals predicted vs scored (`−0.2`, "2.7 per game vs 2.9 actual"), a consensus split (with crowd 38%
/ against 29% / no consensus 33%), and a sentence.

- Builder `buildPredictionHabits(corpus, viewerId)` in `lib/analytics-habits.ts`. The first four are
  prediction-shaped facts over the viewer's picks and the fixtures' results — inside the §C.1
  boundary, since none of them needs a verdict.
- Consensus split: per fixture, the modal predicted **outcome** across that gameweek's locked-in
  entrants; the viewer is "with crowd" / "against" / "no consensus" (no strict mode). The
  accompanying "when you break away you score more often" clause **does** need verdicts and reads
  them from `perFixture`.
- Hide below **20** settled picks. A most-called scoreline out of 6 picks is noise sold as a habit;
  the canon frame's own claim is "across all 80 settled picks".
- Every percentage pair is `number | null`; a null actual hides that row rather than printing `0%`.

**C1 files.** Create `lib/analytics-corpus-load.ts`, `lib/analytics-room.ts`,
`lib/analytics-rivalry.ts`, `lib/analytics-habits.ts`, `app/api/analytics/modules/route.ts` (§C.6),
`components/HomeTabsContext.tsx` (§C.6.2), `components/analytics/AnalyticsModules.tsx` (the fetch
shell, §C.6.3), `components/analytics/{YouVsRoom,Rivalry,PredictionHabits}.tsx`, one test file per
builder in `tests/phase6/`, plus `tests/phase6/analytics-modules-route.test.ts` and
`tests/phase6/analytics-modules-client.test.tsx`. Modify `lib/gw-season.ts` (`memberGameweeks`
including `correctPicks`, `SeasonMemberTotal.goalError`), `lib/analytics-feed.ts`
(`AnalyticsMyForm.competitionId`, §C.6.1), `lib/analytics-feed-load.ts` (pass the resolved
`competitionId` through), `lib/analytics-copy.ts`, `components/AnalyticsFeed.tsx`,
`components/HomeTabs.tsx` (provider + sticky latch, §C.6.2), `scripts/smoke/route-smoke.mjs`
(tracked — corpus loader coverage), `tests/phase6/analytics-feed.test.ts` (the new required
`competitionId`), `tests/phase3/copy-scan-manifest.json`.

#### C2 — modules 04 and 06, plus the clauses the corpus unblocks (**M**)

**Module 04 — Weekly labels.** Canon: the latest settled gameweek, "GW8 · Solid Yenne Boys ·
4 entrants, 10 counted fixtures", then four labels — 🔮 Oracle (most exacts), 😩 Nearly (most
one-goal misses), 🐑 The Crowd (most modal picks), 🎲 Maverick (most non-consensus correct calls) —
each naming a member and a reason, plus a footnote that a label is skipped when nobody clears its
bar and that labels use that gameweek's entrants, not today's member list.

- One gameweek, so the slice is small. Builder `buildWeeklyLabels(corpusForGameweek)`.
- Oracle and Maverick read stored verdicts (`exact`, and correct-against-the-mode). Nearly and The
  Crowd are prediction-shaped (a one-goal miss is a margin; a modal pick is a vote) — inside the
  §C.1 boundary.
- Each label needs an explicit bar and a unique winner. Ties and empty fields produce
  `awarded: null` with a reason string — the canon frame shows exactly this for Maverick, so
  not-awarded is a designed state, not an error path. This is the cheapest place in the plan to
  fabricate a winner; ties and empties are the first two tests.
- "Entrants as of that gameweek" comes from `SeasonPickCorpus.gameweeks[].entrantIds`. Never read
  today's `member_competitions`.
- The target gameweek is the corpus's **latest included** gameweek. If the most recent gameweek is
  void or dirty it was already excluded, so the module labels the previous one and its footnote says
  which gameweek it is labelling.

**Module 06 — Club reads.** Canon: clubs with ≥5 settled picks, each row showing crest initials,
club name, "8 picks · 3 exact · avg miss 0.9" and a result-rate percentage, then two verdict lines
("Arsenal whisperer — 24 pts above the other three on their games", "Can't read Spurs — the other
three get 52% on them, you get 29%").

- Builder `buildClubReads(corpus, viewerId)`. A pick counts for **both** teams in the fixture,
  grouped by `homeTeamId`/`awayTeamId` (§C.2(c)), displayed via `teams.name` / `teams.short_name`.
- Exacts, result rate and the points comparison read stored verdicts and `pts`. Avg miss is a
  margin, computed from picks and results.
- The ≥5 threshold is canon and does real work: the module is empty for most of the early season.
  Hide it entirely when no club clears the bar — no encouraging empty state full of zeros.
- The two verdict lines need the room's rate on the same clubs; each is `null` when fewer than 2
  other members have picks on that club.
- Crest initials: reuse the existing club-badge spelling in `components/gw/`; do not add a second.

Also in C2: module 05's "biggest swing" clause (largest single-fixture `pts` gap between viewer and
rival, read from `perFixture`), and module 02's per-member bar list if deferred from C1.

#### C3 — module 03 Receipts (**L**) — the proposed cut line

Canon: three cards — "Alone against the room", "Wrong, loudly", "Biggest swing vs {name}" — each
with the fixture and scoreline, a sentence naming the other members individually, an avatar row, a
sample line ("1 of 4 entrants"), and a **Share ↗** button.

**Recommendation: defer, or ship a reduced v1 without sharing.**

1. It is the only module needing per-fixture *selection* logic — three separate "find the most
   sendable moment of the season" searches over the full corpus, each with its own tie-breaks and
   its own nothing-qualifies state. Roughly modules 04 and 06 combined.
2. Its copy names individual friends in generated sentences. Every other module compares against an
   average or one chosen rival. Getting the tone right for "Dheeraj, Kiran and Rohan all said
   Arsenal by three" across 2–20 members is a copy problem as large as the data problem.
3. **Share is not built.** There is no share-card, image-generation or share-sheet path anywhere in
   the repo. The module's premise is "settled calls worth sending to the group"; without sharing it
   is three more read-only cards.

Reduced v1 if built: two cards ("Alone against the room", "Wrong, loudly"), no share button, no
avatar row, hidden when neither qualifies. Skip "Biggest swing vs X" — module 05 owns that
comparison.

### C.6 How the modules actually load — the read route

Rev 1 proposed streaming the modules from a server component inside a `<Suspense>` boundary. That
cannot work, for two independent reasons:

- **The league selection is client state.** `AnalyticsFeed` holds `selectedLeagueId` in `useState`
  (`components/AnalyticsFeed.tsx:142`). A server component cannot read it, and the modules are
  all scoped to the selected league.
- **`HomeTabs` mounts every panel.** It renders `panels.map(...)` into
  `<div role="tabpanel" hidden={active !== i}>` (`components/HomeTabs.tsx:78`). A hidden panel is
  still mounted, so anything eager inside it pays its full cost even when the tab is never opened.
  Suspense would move the cost off first paint but not off the request.

**Replacement design.**

*Route:* `app/api/analytics/modules/route.ts`, `GET`, `export const dynamic = "force-dynamic"`.

*Query params:* `leagueId` (uuid) and `competitionId` (uuid), validated with `zod` like every other
route in `app/api/`. Both are **required** — every module is scoped to a (league, competition) pair,
and a league can hold both a live PL competition and an archived WC one, so a league-only route could
not tell which was being asked for. §C.6.1 is how the client comes to have both.

*Auth and scope,* in this order, before any corpus read:

1. `requireUser()` from `lib/gw-api.ts` (or `createClient()` + `auth.getUser()`, as
   `app/api/dues/payments/route.ts:12-13` spells it) → **401** when absent.
2. Membership: `league_members` filtered by `league_id` + `user_id` + `.is("left_at", null)` →
   **404** when the viewer is not a member. 404 rather than 403, matching
   `app/api/dues/issues/route.ts:9`'s existing spelling — it does not confirm the league exists to a
   non-member. `.is("left_at", null)` also covers the departed-member case: someone who has left gets
   404, not their old numbers.
3. **Scope:** `league_competitions` filtered by `league_id` + `competition_id` → **404** when that
   pair does not exist. Without this check the route would accept any competition uuid alongside a
   league the viewer *is* in, and the corpus loader would happily return an empty-but-valid corpus
   for a competition the league never joined — a 200 with fabricated emptiness rather than an error.
   Do not filter on `status` here: an **archived** link is a legitimate scope (the WC archive), and
   the modules render the same way for it.

Corpus reads then go through the **RLS-scoped** client wherever possible, so `cashford.my_league_ids()`
is a third gate behind the two explicit ones; the service client is used only for departed-profile
name resolution, exactly as `loadSeasonView` already does.

*Response:*

```ts
{
  /** Echoed back so the client can reject a stale or out-of-order response. */
  leagueId: string;
  competitionId: string;
  modules: {
    youVsRoom: AnalyticsYouVsRoom | null;
    rivalry: AnalyticsRivalry | null;       // options + byRivalId, see module 05
    habits: AnalyticsHabits | null;
    weeklyLabels: AnalyticsWeeklyLabels | null;
    clubReads: AnalyticsClubReads | null;
    receipts: AnalyticsReceipts | null;
  };
}
```

Every module field is nullable and every one is `null` until its phase lands, so C1 ships the route
with three of six populated and C2 fills in two more with no shape change. Echoing both IDs is what
makes the client's staleness check possible — see §C.6.2. Errors: `{ error: string }` with the same
status conventions as the dues routes.

*Cache:* `Cache-Control: private, no-store` on the response. `private` because the payload is
per-viewer and must never land in a shared or CDN cache; `no-store` because it changes whenever the
cron settles a gameweek. No `revalidate`, no `unstable_cache`. If the response ever proves expensive
enough to want caching, the key has to include the viewer, so that is a separate decision.

#### C.6.1 Where `competitionId` comes from

The client needs the pair, and today it has neither half in a usable form: `AnalyticsFeed` holds only
`selectedLeagueId`, `AnalyticsLeagueOption` is `{ id, slug, name }`, and `AnalyticsMyForm`
(`lib/analytics-feed.ts:43-52`) carries `competitionName` but **no `competitionId`**. Rev 2 specified
a route requiring an ID the client could not produce.

The fix is small, because the loader already resolves the pair. `loadAnalyticsFeed` computes
`participation.competitionId` per league in its my-form loop (`lib/analytics-feed-load.ts:230-238`)
and then drops it on the floor. So:

- Add `competitionId: string` to `AnalyticsMyForm` and populate it in **both** `buildLiveMyForm` and
  `buildArchiveMyForm` (both already receive the resolved participation). It is a required field, not
  optional: every my-form card is by definition scoped to one competition, and an optional field would
  push a `?? ""` fallback into the fetch URL.
- The selected scope is then `feed.myFormByLeague[selectedLeagueId]?.competitionId`. When that is
  null — a league with no resolvable participation, which already renders no my-form card — the
  client **does not fetch at all** and no module renders. No guessed competition, no empty request.
- `AnalyticsMyForm.kind` already distinguishes `"live"` from `"archive"`, so the client knows which it
  is asking about without a second lookup.

This lands in **C1**, and it is the one change in Phase C that touches the existing feed builders.
Their existing tests assert the returned object; adding a required field will fail them until updated,
which is the desired signal.

#### C.6.2 The client mechanism — a context, not a callback

Rev 2 said `HomeTabs` gains an `onActiveChange` callback so "the page can learn when Analytics is
first activated". **That cannot work.** `app/page.tsx` is a server component — no `"use client"`
directive (its first import is `next/image`) — and it builds the analytics panel as a ReactNode at
`app/page.tsx:97-101`, passing `<AnalyticsFeed feed={analyticsFeed} />` into `HomeTabs` as a prop. A
server component cannot receive a function prop from a client child, and it has no state to put the
answer in. The callback has no possible recipient.

What does work is that `HomeTabs` already owns the state (`const [active, setActive] = useState(0)`,
`components/HomeTabs.tsx:26`) and already renders the analytics ReactNode **inside its own JSX tree**
(`components/HomeTabs.tsx:76-81`). A React context provider wrapping that tree reaches the panel even
though the panel element was created on the server: the element is *constructed* server-side but
*rendered* at that position in the client tree, so it reads whatever context is above it there.

Concretely:

- New `components/HomeTabsContext.tsx` (client): `createContext<{ activeIndex: number;
  analyticsActivated: boolean }>` with a safe default (`{ activeIndex: 0, analyticsActivated: false }`)
  so any consumer rendered outside the provider degrades to "not activated" rather than throwing.
- `HomeTabs` computes `analyticsActivated` as a **sticky latch** — a second piece of state set true
  the first time `active` equals the analytics index, and never reset. Sticky matters: without it,
  tabbing away would unmount-or-idle the modules and tabbing back would refetch.
- `HomeTabs` wraps its existing panel container in the provider. Nothing else about the tab list,
  `SlideTrack`, or the `onKey` keyboard handling changes — that handler stays exactly as it is, which
  is what rev 2's "pick whichever keeps the keyboard handling untouched" was reaching for.
- `AnalyticsFeed` (already a client component) calls `useContext` and passes `analyticsActivated` down
  to `<AnalyticsModules>` alongside the scope it already owns. `AnalyticsFeed` keeps owning
  `selectedLeagueId`; the context supplies only tab state. Two pieces of state, each owned where it
  already lives, joined in the one component that needs both.

An alternative — hoisting both tab state and analytics state into a single new client shell that
`app/page.tsx` renders — also works and is noted here as the fallback if the context turns out to
fight the existing `useId`-based ARIA wiring. Prefer the context: it is additive, and it leaves
`HomeTabs`' public prop shape unchanged for its other two panels.

#### C.6.3 Fetch behaviour

`<AnalyticsModules leagueId competitionId activated />`:

- **No fetch before activation.** The effect's first guard is `if (!activated) return`. The Leagues
  tab must issue zero requests to this route.
- **No fetch without a scope.** `if (!leagueId || !competitionId) return` — see §C.6.1.
- **Cache keyed by the pair**, not by league: `useRef<Map<string, AnalyticsModulesView>>` keyed
  `` `${leagueId}:${competitionId}` ``. A league-keyed cache would serve a league's PL modules for its
  WC archive scope, since both share a `leagueId`.
- **Refetch on scope change**, hitting the cache when the pair was already fetched. Switching away and
  back is free.
- **In-flight tracking: a keyed map of request tokens, never a `Set` of keys.**
  `useRef<Map<string, AbortController>>`, keyed by the same pair key as the cache. Before starting,
  look the key up: if an entry exists **and** its controller is not aborted, this request is genuinely
  already in flight and the effect skips. Otherwise store a fresh `AbortController` under the key and
  fetch with its signal.

  A bare `Set` of in-flight keys **deadlocks under StrictMode's effect replay**, and the failure mode
  is "the modules never load", which is worse than a duplicate request. The sequence: effect run 1
  adds the key and starts the fetch; React's simulated unmount fires the cleanup, which aborts that
  fetch; effect run 2 re-runs, sees the key still in the `Set`, and skips. Nothing is in flight and
  nothing will retry — the panel sits on its skeleton forever, in dev only, which is exactly where it
  would be mistaken for a slow query.

  The map fixes it because an aborted controller is observable: run 2 finds the entry, sees
  `signal.aborted`, and treats the key as free.
- **Cleanup deletes only its own entry.** Each effect run captures the controller it created and, on
  cleanup, aborts it and removes that key **only if the stored controller is still the same object**.
  A cleanup that clears the key unconditionally would delete a *newer* run's live controller and
  re-open the duplicate-request hole it exists to close.
- **Stale-response rejection compares against a live ref, not the closure.** Keep
  `currentPairRef = useRef(pairKey)`, updated on every render. On resolve, compare the response's
  echoed `leagueId`/`competitionId` against `currentPairRef.current` and **drop the response** if they
  differ. This is why the route echoes them (§C.6).

  The ref matters: an effect closure captures the pair by value at the moment it ran, so a response
  from the effect that fetched league A would compare A against A and pass — even though the user has
  since selected B. Comparing against the captured value asks "is this the response I asked for?",
  which is always yes. Comparing against the ref asks "is this the response the screen still wants?",
  which is the actual question.
- Two requests in flight can resolve out of order, and the loser would otherwise overwrite the winner —
  the classic race that shows one league's numbers under another league's heading. Abort plus the echo
  check are two overlapping guards because an abort can lose the race with an in-progress resolve.
  Ignore `AbortError` rejections; they are the expected outcome of a scope change, not a failure worth
  a retry line.
- `fetch(url, { cache: "no-store" })`, matching the route's own header. Without it Next can serve a
  memoized response inside the same render pass.
- Skeleton while pending; a quiet retry line on failure (one line plus a retry button, in copy) —
  never a blank module shell and never a thrown boundary.

*Smoke and tests:* `scripts/smoke/route-smoke.mjs` is **tracked** (`git ls-files scripts/smoke/`
lists it) and it exercises **page data loaders directly, not HTTP handlers** — its own header says
"every page loader receives a client wrapper that records and rejects writes". Rev 2 called it
untracked and implied it covers routes; both were wrong, and it means the smoke script alone cannot
cover this route. So:

- **Smoke:** add the **corpus loader** to `route-smoke.mjs` for the four discovered leagues, which is
  what that harness is actually shaped for — it proves the loader's select strings resolve against the
  live schema, the v101/v102 failure class this script exists to catch. Commit the change; it is a
  tracked file.
- **Route handler tests** (`tests/phase6/analytics-modules-route.test.ts`), calling the exported `GET`
  with a stubbed client: missing or non-uuid params → 400; no session → 401; non-member → 404; a member
  who has left (`left_at` set) → 404; a `(leagueId, competitionId)` pair absent from
  `league_competitions` → 404; an **archived** pair → 200 (not 404); a valid request → 200 with both
  IDs echoed and every module key present; and the response carrying `Cache-Control: private, no-store`.
- **Client tests** (`tests/phase6/analytics-modules-client.test.tsx`): no fetch while
  `activated` is false; one fetch on activation; refetch on scope change; **no** refetch on returning to
  a cached pair; retry line on a rejected fetch; and an out-of-order pair of responses where the
  earlier-selected scope resolves last and is dropped — assert the rendered numbers belong to the
  currently selected scope. Plus the two lifecycle cases, which are the ones a hand-QC pass would
  miss:
  - **StrictMode replay still populates.** Render inside `<StrictMode>` so the effect runs, cleans up
    and re-runs, then assert the modules render real data. This is the deadlock guard: with a `Set`
    it hangs on the skeleton, and it hangs *only* in dev, so nothing else in the suite would catch it.
  - **A → B → A rapid switch resolves to A.** Switch scope to B and back to A before any response
    lands, then resolve B's request after A's. Assert the rendered numbers are A's, that no B render
    ever happened (check the intermediate frames, not just the final one), and that no retry line
    appeared — the aborted requests must not read as failures.

*Out of scope, deliberately:* the backlog's per-viewer totals query (which would get
`loadSeasonView`'s all-member computation off the home critical path) and the cheap existence-only
query for `analyticsVisible`. Both would help here. Neither is required — the route already moves the
expensive work off the home request. If a C1 measurement shows the **eager** path is now the
bottleneck, stop and plan that work separately rather than absorbing a perf refactor into a feature
phase.

### C.7 Phase C tests

Per builder, minimum: a full-data golden case; a no-data case returning `null`; a one-gameweek case;
a late-joiner case (asserting the §C.4 window, not the full season); a partially-void-fixture case;
a fully-void-gameweek case (absent, footnoted); a dirty-gameweek case (absent, footnoted); and a tie
case where relevant (04's labels, 06's top club, 07's most-called scoreline).

Per component: the hidden state renders nothing, and the populated state renders the builder's
numbers with no `0` or `0%` standing in for a missing value.

Cross-cutting: one test asserting **no builder computes a verdict** — the four-verdict vocabulary
appears in `lib/gameweek-points.ts` and in corpus *reads*, and a grep-style assertion over the new
builder files that they contain no scoreline-comparison-to-verdict logic is a cheap guard against
the §C.1 boundary eroding. Add the canon's 4-entrant shape as a shared fixture in
`tests/fixtures/` so every module is tested against the small league the design was drawn for.

### C.8 Phase C edge cases (all modules)

- **No data:** every module hides; the feed falls back to strip + my form, which is today's screen.
  Verify literally, against a league with zero settled gameweeks.
- **One gameweek:** 02 shows rates over a 1-gameweek window with the window named in the sub-line;
  04 works (single-gameweek by design); 05 shows 1–0–0 with its footnote; 06 almost certainly hides
  on the ≥5 bar; 07 hides on the 20-pick bar.
- **Late joiner:** every builder derives its member set from the data, never from today's
  `member_competitions`; module 02 compares only inside the viewer's window (§C.4); 04 labels its
  gameweek's entrants.
- **Partially-void fixtures:** excluded from every rate denominator (`scoreGameweek` P2), counted in
  the Phase B record's third number, and excluded from module 06's per-club counts.
- **Fully-void gameweek:** absent from the corpus with `reason: "void"` (§0.1). 04 labels the
  previous included gameweek and says so.
- **Dirty gameweek:** absent from the corpus with `reason: "recalculating"`. Every module's footnote
  can name it, so a shortened sample never reads as a complete one.
- **Two-member league:** 02 hides (needs ≥2 others in the window); 05 works; 04's Crowd and Maverick
  labels usually go not-awarded — correct, and worth a test.
- **Departed member:** still named in 04's labels and 03's receipts via the resolved-name path;
  never rendered as "Player".

### C.9 Phase C QC script

1. `testa` on ZZ-P1: open Analytics and confirm the modules **do not load until the tab is opened**
   (watch the network panel — no `/api/analytics/modules` request while on Leagues).
2. Confirm every visible number is reproducible from the Season tab or a gameweek detail page.
   Spot-check one per module.
3. Change the league filter: confirm exactly one refetch per new **(league, competition) pair**, no
   refetch on switching back to a pair already loaded, and no PL number surviving into an archived
   World Cup selection (or the reverse). Then switch scope rapidly three or four times and confirm the
   numbers on screen belong to the scope now selected — the out-of-order guard (§C.6.3) under a real
   network.
4. Tab away to Leagues and back to Analytics: no new request (the activation latch is sticky), and the
   modules are still on screen.
5. In 02, confirm the sub-line names the comparison window and that the window matches the viewer's
   settled gameweek count — not the league's.
6. In 05, cycle every rival and confirm the shared-gameweek footnote count changes with the rival,
   not just the record — **and that cycling rivals issues no network request at all** (§C.6.3: the
   records are all in the one response). Confirm no rival in the dropdown shows `0 Won / 0 Lost /
   0 Tied`; a rival with no shared gameweek should not be offered.
7. **No void or dirty gameweek exists anywhere in the database** (verified 2026-08-11), so the footnote
   paths cannot be exercised in the browser. Confirm instead that with a fully clean sample **no
   footnote appears at all** — an empty exclusion list must not print an empty line. The named-footnote
   behaviour stays covered by the builder tests.
8. Dark mode on every module, then 320px: bar lists and the 04 label grid wrap, not overflow.
9. Kill the dev server mid-fetch (or block the route in devtools) and confirm the retry line
   appears — no blank module shells, no thrown boundary.
10. Hand-edit the request URL to a `competitionId` belonging to a different league: confirm **404**,
    not a 200 with empty modules. Then a `leagueId` the viewer is not in: also 404.
11. Confirm the response carries `Cache-Control: private, no-store` in the network panel.
12. Ananth read-only on all three real leagues: no fabricated zero, no blended competition, and the
    Leagues tab's time-to-interactive unchanged against the pre-C1 baseline.
13. A league with no settled gameweek: strip + my form only, no empty module shells.

### C.10 Phase C risks

- **Silent truncation.** The 1000-row cap is the highest-consequence risk in the phase: it produces
  plausible wrong numbers with no error. §C.2(d)'s paging plus loader test 1 are the countermeasure,
  and the >1000-row test must exist before any builder is trusted.
- **Two grading implementations.** §C.1's boundary plus §C.7's cross-cutting test. If a builder ever
  needs a verdict the corpus does not carry, extend the corpus — do not compute it.
- **The `SeasonView` shape change.** Additive, but shared with the Season tab. Run
  `tests/phase3/gw-season.test.ts` and QC the Season tab in C1.
- **The `AnalyticsMyForm.competitionId` addition** (§C.6.1) is *not* additive in the same way: it is a
  required field on a type two builders construct, so it breaks their existing tests until updated.
  That is the intended signal — an optional field would have let a `?? ""` reach the fetch URL.
- **The scope race.** Two async sources of truth (the selected pair, and whichever response lands)
  showing one league's numbers under another's heading is a bug users would report as "wrong numbers",
  not "slow". §C.6.3's echo check, abort and in-flight dedup are three overlapping guards because the
  failure is silent and plausible.
- **Six modules, one recurring bug.** The fabricated-zero class hit four times in the 2.0 build.
  Every builder returning `null` for absent data, and a "hidden state renders nothing" test per
  component, are the specific countermeasures. Do not merge a module without both.
- **Generated sentences.** 02, 06 and 07 each end in one, and 03 is mostly sentences. Each is a copy
  template over computed facts with a bounded branch count. A fifth branch means drop the sentence.
- **Scope creep from the canon.** `analytics-v5-merged.html` also has a lead editorial card ("The
  week in Ananth"), Share buttons throughout, and module-01 extras (Best gameweek, Longest streak).
  None are modules 02–07 and none are in this plan; they are listed under Out of scope so their
  absence is not read as an oversight.

---

## Execution order and gating

**A → B → C1 → C2 → C3.** Each fully piped — builder, loader, component, tests, verify gate, browser
QC — before the next starts. No phase begins while the previous has a red gate or an open QC finding.

1. **Phase A.** Lands the `gw-season.ts` `per_fixture` read, the four row-level counters, and the
   `NetValue` move. Gate: `bash scripts/verify-all.sh` → `ALL GREEN`, plus the Phase A QC script on
   both accounts including the void-footnote check.
2. **Phase B.** Small because A did the plumbing. Gate: same, plus a hand-recount of one league's
   record against its Season tab.
3. **Checkpoint before C.** A and B together complete the locked Option A my-form frame. Stop, log
   both in `implementation-notes.md` (deviations under `## Deviations`), and confirm with Ananth that
   modules 02–07 are still wanted in canon order — C is larger than A and B combined.
4. **C1** (corpus loader + read route + 02 + 05 + 07). Gate: verify-all green, C QC steps 1–9, **and**
   a recorded home-page timing measurement plus a confirmed >1000-row paging test. If timing
   regressed, fix it inside C1; do not carry it into C2.
5. **C2** (04 + 06 + the deferred clauses). Same gate, re-running the timing check.
6. **C3** (03 Receipts). Only after an explicit decision on the share question. Default
   recommendation: defer.

## Out of scope

- Anything touching `lib/settlement.ts`, `lib/settle-contest.ts`, `lib/gameweek-settle.ts` or
  `lib/gameweek-points.ts`. Every phase **reads** settled snapshots and re-derives no grading. The
  one new assertion about the points scale (Phase B test 3) is a read-only guard.
- Threading a live per-fixture count out through `GameweekStanding` (§0.2). Dirty gameweeks are
  excluded instead.
- Adding a void path to `lib/analytics.ts`'s `Entry`. The archive record's third number stays a
  literal `0`; cup fixtures cannot be void in that model, and `per_fixture` covers the live side.
- The backlog's per-viewer totals query, and the cheap existence-only query for `analyticsVisible`.
  Both are real perf wins; both stay out unless a C1 measurement forces one, in which case it gets
  its own plan.
- gap-7 and the parked adoption SQL.
- Any migration. No DDL, no DB writes. Every field in this plan comes from a column that already
  exists.
- Sharing: share cards, image generation, share sheets. This is what makes module 03 a defer.
- The canon's lead editorial card ("The week in Ananth"), and module 01's Best gameweek / Longest
  streak cells from `analytics-v5-merged.html`.
- `components/AnalyticsTab.tsx` (the superseded Phase 4 surface) and the World Cup archive analytics
  route. Neither is touched.
