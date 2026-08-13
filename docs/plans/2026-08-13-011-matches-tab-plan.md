# Plan 011 — Home Matches tab: land on the gameweek, not a door

**Date:** 2026-08-13 · **Status:** rev 6 — **APPROVED by Sol (round 6, zero blockers)**;
final two suggestions folded in post-approval (plural-invalid test string, before-assertion
on GW n+1 pots).
**Decided with Ananth:** (1) live GW leads; GW n+1 gets a slim entry banner. (2) On settle,
the next GW takes over immediately; the settled GW collapses to a compact expandable receipt.
(3) Rolling open ships in this plan — **finding: already implemented, §1 proves it instead.**
(4) Single-competition world: pills only when >1 scope. (5) Table and past GWs stay on `/matches`.

## 0. What we're building

The home Matches tab today renders one `<Link href="/matches">View matches</Link>` card
(`app/page.tsx:137-148`). Replace it with a client panel that, on first tab activation,
fetches the current gameweek and renders it inline in cs2 tokens:

- **Body = the GW `resolveAppGameweek` calls current** (§3): Your-GW card + day-grouped
  fixture rows with kickoff/score, live minute, your call, verdict + points.
- **Banner** (amber, above body) when the next GW is open for entry and the viewer has
  leagues still missing a complete entry: per-league aware (§3.3).
- **Receipt** (compact, expandable) for the previous resolved GW while the body shows the
  next open GW (§3.4).
- **Footer link**: "All matches & table →" → `/matches`. Fixture rows → `/m/[fixtureId]`.

Out of scope: table inline, past-GW paging inline, `matchesAlert` red dot, legacy-file
cleanup (`lib/home-matches.ts`, `lib/match-feed.ts`, `MatchFeedCard`, `MatchesTab.tsx`
re-export — separate cleanup, not this plan), AutoRefresh integration beyond §4's interval.
Nothing touches `lib/settlement.ts`, `lib/settle-contest.ts`, `lib/gameweek-settle.ts`,
`lib/gameweek-points.ts` — if implementation needs to, scope has leaked; stop.

## 1. Rolling open — no code change; prove it

Sol round 1 verified the claim: `run_gameweek_maintenance`
(`supabase/migrations/20260727000002_gameweek_entries.sql:662,687,808`) locks the expired
GW and opens the earliest future-deadline GW in the same serialized transaction; entry
writes gate on the pot (`:1143`), never `gameweeks.status`; `one_open_gw_per_competition`
(migration `20260727000001:54`) is preserved, keeping `lib/sync-fpl.ts:262` `.maybeSingle()`
sound. Deliverables:

1. **Focus/banner unit tests** (§5.1) pin the timeline contract: GW n locked + GW n+1 open
   ⇒ body=GW n, banner=GW n+1. This is the rolling-open acceptance at the view layer.
2. **Disposable-DB proof** (scripts/disposable-db/, untracked). Seed (Sol r2-B6, r3-B5,
   r4-B2): competition `status='active'`; an **active** `league_competitions` link;
   **GW n `status='open'` with an existing open pot AND two eligible members holding
   complete `entered` entries with picks for every active fixture** (fewer than two
   `locked_in` entries would void the pot in the same maintenance call —
   `...002.sql:743`); GW n deadline at now−1s **and the seeded pot's own snapshot
   `gameweek_contests.deadline_at = GW n.deadline_at = now−1s`** (pots lock from their own
   snapshot, `...002.sql:698,708`, never from `gameweeks.deadline_at` — a future pot
   deadline leaves the pot open and every assertion fails); ≥1 active, unfinished fixture
   in GW n (else the COMPLETE step at `...002.sql:668` skips `locked`); GW n+1 `upcoming`
   with future deadline. **Assert zero GW n+1 pots before the call.** Invoke `run_gameweek_maintenance`
   ONCE, then assert: GW n `locked`; both entries `locked_in`; GW n's pot `locked` **with
   its original pot id unchanged**; GW n+1 `open` with **exactly one** pot per active
   league ("created once", self-contained with the before-assertion); **exactly one GW in
   `status='open'`**. Evidence into
   implementation-notes. No migration.

## 2. API route — `GET /api/matches/home-tab`

Modeled on `app/api/analytics/modules/route.ts` (NOT an exact mirror — analytics 404s on
missing membership/pair; this route prefers inline-friendly 200 empties, see below):

1. `export const dynamic = "force-dynamic"`; every response path (including `requireUser()`
   401) stamped `Cache-Control: private, no-store`.
2. `requireUser()` → 401.
3. Params: `comp` (optional slug, zod `z.string().min(1).max(64)`). The route converts
   `searchParams.get("comp")` `null` → `undefined` before parsing (an optional zod string
   rejects `null`). Malformed → 400.
4. Loader (§3) with **`strictScope: true`**: zero viewer scopes, no gameweeks, no
   resolvable focus, or unknown/foreign `comp` → 200 `{ empty: true }` (no existence
   leakage; a mounted tab panel renders an inline empty state, not a 404 page).
5. Loader/query failure → 500, generic copy from `MATCH_COPY`, no error leakage. The
   loader **throws** on failed reads (§3.5) — no silent-empty.
6. Echo keys for the client stale-response guard: top-level `requestedComp` (param as
   received, null if absent) and `selectedComp` (resolved slug) — present on BOTH empty
   and full payloads, so default-scope first requests can be keyed (suggestion 2).

Payload (new `lib/matches-home-tab.ts`):

```ts
export type MatchesHomeTabPayload =
  | { empty: true; requestedComp: string | null; selectedComp: string | null;
      freshness: "empty" }                   // explicit cache class (Sol r2-B3)
  | {
      empty: false;
      requestedComp: string | null;
      selectedComp: string;
      view: MatchesTabView;                 // focus GW per §3.2
      freshness: "settled" | "pre" | "unresolved";  // §3.6 — lifecycle aggregate, NOT gw.state
      nextGw: {
        number: number;
        deadlineAt: string;                  // ISO
        leagues: Array<{                     // per-league, never aggregated away
          leagueSlug: string;
          leagueName: string;
          status: "none" | "complete" | "needs_update" | "ineligible";
          enterHref: string;                 // /leagues/[slug]/enter?gw=N
        }>;
      } | null;
      receipt: {
        gwNumber: number;
        summary: string;                     // server-built collapsed line (§3.4)
        rows: LeagueRowView[];               // expansion detail (existing type, as-is)
        href: string;                        // /matches?gw=N
      } | null;
    };
```

## 3. Loader — `loadMatchesHomeTab(session, userId, opts)`

New `lib/matches-home-tab-load.ts`. Both loaders sit on ONE shared internal
(snapshot + focus + view build) taking explicit flags
`{ strictScope: boolean, strictReadErrors: boolean }` (Sol r2-B2):
- `/matches` (`loadMatchesTab`) passes `{ false, false }` — scope fallback and read
  tolerances byte-identical to today (§5.5 pins it);
- home (`loadMatchesHomeTab`) passes `{ true, true }` — unknown scope → empty, any failed
  read feeding focus/banner/receipt throws (route → 500).
Home opts: `{ requestedScopeSlug?, now? }`; the strict flags are internal to the wrapper,
not caller-supplied.

### 3.1 Scope resolution — strict for home
`resolveViewerCompetitionScopes` as today, then (`strictScope: true`): if
`requestedScopeSlug` is provided and does not match a viewer scope, return the empty
payload — **no fallback**. `/matches` keeps its existing first-scope fallback
(`lib/matches-tab-load.ts:128`) unchanged; both behaviors get tests.

### 3.2 Focus — `resolveAppGameweek` is the selector; no second lifecycle engine
Blocker 1 accepted: do NOT write a parallel CL-aggregation rule. The home tab focus is
exactly what `loadMatchesTab` already computes when `requestedGw` is undefined
(`lib/matches-tab-load.ts:303-317`, built on `resolveAppGameweek`,
`lib/gw-resolve-app.ts:73`): newest unresolved GW (CL9 sync-issue and CL10 all-void count
as unresolved and stay the body, rendering their existing copy states) → else next open →
else latest settled. Pre-season parity included (future GW with no contests may be
selected — same as today). Mixed clean/unresolved across leagues: whatever
`resolveAppGameweek` does today is the contract — pinned by loader-level regression tests
(§5.1), not re-specified here.

**Refactor shape:** extract `loadMatchesTab`'s post-snapshot focus block into a shared
internal (same module or a shared helper imported by both loaders) such that
`/matches` output is byte-identical — pinned by a regression test comparing
`loadMatchesTab` output before/after refactor on fixture data (§5.5). The home loader
consumes the same snapshot + focus, then adds §3.3/§3.4.

### 3.3 Next-GW banner data — targeted loads, per league
After focus is chosen: `nextGw` = the open-contest GW with a future deadline and
`number > focus.number` (null when focus IS the open GW or none exists). For that GW only,
load its `gameweek_contests` (already in the season snapshot) plus that GW's
`gameweek_entries` for the viewer (one additional query — the snapshot does NOT carry
non-focus entries). Status mapping (Sol r2-B1 — **display maps stored DB states 1:1; no
re-derivation of completeness, no picks query**; `refresh_entry_completeness` at
`...002.sql:465` already guarantees pre-deadline `entered` = complete pick set):
- `ineligible` — `isEligibleForGameweek` evaluated **against the next GW's number**
  (a viewer can be VP0 for the live GW but eligible next, and vice versa);
- `none` — eligible, no entry row;
- `complete` — stored entry status `entered` (copy: "All picks in" — never "Locked in"
  pre-deadline);
- `needs_update` — stored entry status `needs_update` (reconciliation added fixtures).
Banner renders when any league is `none`/`needs_update`; each such league gets its own
row + `enterHref` (multi-league is 2 rows, not an aggregate). **`ineligible` leagues are
excluded from the aggregate decision** (Sol r3-B2): when every ELIGIBLE league is
`complete`, the quiet "GW n+1 picks in · locks <deadline>" line renders; when there are
no eligible leagues at all, nothing renders. Test the `complete + ineligible` mix.

**Active-pair scoping (Sol r3-B3):** banner and receipt league sets are built from a
dedicated active-pair set — `league_competitions.status='active'` AND the viewer's
`member_competitions.left_at is null` for that pair — NOT from the selected-competition
league-links query at `matches-tab-load.ts:143`, which lacks the status filter and can
leak an archived link through another active scope. `/matches` behavior untouched.

### 3.4 Receipt — previous resolved GW
When focus is an open/pre GW and the previous GW (by number) is resolved for all viewer
leagues (settled or clean void — CL5/CL7), build the receipt from that GW's contests:
one additional `gameweek_entry_results`+`gameweek_entries` load scoped to that GW's
contest ids (blocker 2). `summary` is server-built **from the actual `LeagueRowView` kinds** — no re-derived
precedence; `buildLeagueRow` applies VP0/VP5 before lifecycle handling, so CL7+VP5 is
`invalid`, never `void` (Sol r4-B1). Rules:
- **Counted participation** = rows whose entry joined a pot: ranked results and voids
  (stakes returned). `invalid` rows joined nothing (maintenance: invalid entries stake
  nothing, win nothing — `...002.sql:712`) and are NOT counted; neither are sat-out or
  ineligible rows.
- **k = counted rows.** `k >= 2` → `GW{n} · {k} leagues · net {sum}`; net sum only when
  every counted row has a numeric net, else `GW{n} · {k} leagues`.
- **k === 1 → that row's single-result summary** (even when other rows are invalid/
  sat-out/ineligible):
  - ranked: `GW{n} · {ordinal} of {fieldSize} · {pts} pts · {net}` (omit absent segments;
    never fabricate zeros);
  - void: `GW{n} · void — stakes returned` (new MATCH_COPY key — r3-S1).
- **k === 0:** any `invalid` row → `GW{n} · entry not counted` (new MATCH_COPY key;
  plural "entries not counted" when ≥2 invalid rows); else any sat-out row →
  `GW{n} · sat out`; else (all VP0) → **suppress the receipt**. (Terminology note for
  implementation: "ranked" above is display language for `LeagueRowView.kind ===
  "settled"`.)
- Expansion `rows` stay verbatim `LeagueRowView[]` in all cases.
Tests with EXACT expected strings: zero-entrant void, single-entrant void, all-fixtures
void, prior-GW VP0 (suppressed), invalid single (`GW3 · entry not counted`), two invalid
rows (`GW3 · entries not counted`), ranked+void (`GW3 · 2 leagues`), ranked+invalid
(ranked single-result summary), ranked+sat-out (ranked single-result summary), void+VP0
(`GW3 · void — stakes returned`).
`rows` reuses `buildLeagueRow` output verbatim for the expansion (no new fields on
`LeagueRowView` — it has no `verdict` field and the receipt doesn't need one; per-fixture
verdicts stay on /matches and /m/[id]).
If the previous GW is CL9/CL10/dirty it is unresolved ⇒ it IS the focus (§3.2), so the
receipt case cannot see it — assert with a test.

### 3.5 Error discipline
All reads feeding banner/receipt/focus **throw on query error** (route → 500). No
silent-empty fallbacks: a failed entries read must never render as "not entered"
(blocker 2). The existing `/matches` loader's tolerances stay as they are — out of scope.

### 3.6 Freshness class
`freshness` derives from the lifecycle aggregate across the viewer's focus-GW contests
(NOT `gw.state`, which maps CL2/CL6/CL8/CL9/CL10 to "pre" — `lib/matches-tab-load.ts:593`):
- any contest in CL2/CL3/CL4/CL6/CL8/CL9/CL10 (deadline passed, not fully resolved) →
  `"unresolved"`;
- **`focusContests.length > 0`** and all resolved (CL5/CL7) → `"settled"` (the length
  guard prevents a vacuous all-resolved on a no-contest pre-season focus — Sol r2-B3,
  mirroring the existing guard at `lib/matches-tab-load.ts:593`);
- else (pre-deadline or no contests) → `"pre"`.
Empty payloads carry `freshness: "empty"`. Cache tests cover zero-scope, no-gameweek,
and no-contest focus responses.

## 4. Client — `components/matches/HomeMatchesTab.tsx`

`"use client"`, rendered as the `matches` prop in `app/page.tsx`; receives no server data.

**Activation & revalidation (one rule, blockers 5+6):**
- Consume `activeIndex` from `HomeTabsContext` (it already re-renders consumers on tab
  change). The Matches index is 1 in both layouts (`analyticsVisible` true/false) —
  asserted by test. No new context field needed; the component keeps its own sticky
  `activated` state (`useEffect` on `activeIndex === 1`).
- Cache entries keyed by `selectedComp` (first default-scope request keyed by a
  `"__default"` sentinel until the echo arrives, then re-keyed; suggestion 2). Each entry
  stores `receivedAt = Date.now()` at client receipt (suggestion 3 — never server clock).
- TTL by payload `freshness`: `settled` → 10 min · `pre` → 5 min · `unresolved` → 60 s ·
  `empty` → 10 min.
- **Automatic freshness triggers — exactly two** (scope-pill switches and the error
  retry button also fetch, but on user action): (a) transition of `activeIndex` to 1
  (re-activation) with entry age > TTL; (b) while `activeIndex === 1` and the document is
  visible and `freshness === "unresolved"`: a 60 s `setInterval` refetch, with a
  `visibilitychange` listener that clears the interval when hidden and restarts it (with
  an immediate staleness check) when visible again; also cleared on tab switch and
  unmount. This is the live freshness bound — the client attempts a refresh every 60 s
  while parked on the tab (network time and upstream data age mean no stronger guarantee).
  No other background polling.
- Fetch machinery copied from `AnalyticsModules` (`components/analytics/AnalyticsModules.tsx:29-89`):
  keyed AbortController Map with identity-checked cleanup, `currentKeyRef` staleness
  check, server echo guard (`requestedComp`/`selectedComp`), AbortError swallowed,
  error → retry button.

**Rendering — cs2 tokens throughout** (the tab must sit beside the Leagues tab; do NOT
import `Phase4MatchesPage` or its old `rounded-card/bg-surface` tokens):
- reuse view-model + copy: `LeagueRowView`, `FixtureRowView` (render its already-computed
  `state` — do NOT import the server loader's `fixtureLabel` into the client),
  `MATCH_COPY`, `<LocalTime>`/`<Countdown>`; **extract `verdictCopy` out of
  `Phase4MatchesPage.tsx:470` (currently private) into a shared pure module** consumed by
  both — Sol r2-B5; row layout borrowed from `components/gw/FixtureRow.tsx`;
- banner: amber trio card, one row per missing league (§3.3);
- receipt: single-line `summary`, expandable to `rows`;
- day groups: static headers, no collapse;
- scope pills only when `scopes.length > 1`; switching refetches with `?comp=`;
- empty/error states: quiet cs2 cards, copy in `MATCH_COPY`;
- dark mode via tokens only — no `dark:` background overrides (C1 lesson).

## 5. Tests

1. **Focus/banner/receipt unit tests** (loader-level, fixture data): S1 open-not-entered ·
   S1b entered · S2 locked+banner · S3 live+banner · S3b mid-GW nothing live · S4
   settled→handover+receipt · GW38 season over (focus=last settled, no banner, no next) ·
   sat-out receipt · VP0 focus GW but eligible next (banner shows) · eligible focus but
   ineligible next (banner hidden) · CL9 sync-issue body · CL10 all-void body ·
   dirty/recalculating body · previous-GW-unresolved ⇒ no receipt · overlap (two
   unresolved GWs → newest is body) · pre-season no-contest GW focus · mixed lifecycle
   across leagues (pin current `resolveAppGameweek` outcome) · zero scopes / no gameweeks
   → empty · every `nextGw.leagues[].status` permutation incl. multi-league split states.
2. **Route tests:** 401 · malformed `comp` 400 · absent `comp` default-scope 200 ·
   unknown/foreign `comp` 200 empty · zero scopes 200 empty · loader throw → 500 ·
   happy 200 shape + echo keys · Cache-Control on every path incl. 401.
3. **jsdom client tests:** no fetch before activation · one fetch on first activation ·
   no refetch on tab away/back within TTL · refetch on re-activation past TTL (per
   freshness class) · unresolved interval fires while visible, cleared on tab-away and
   visibility-hidden · **visibility-resume: on hidden→visible, immediate staleness check
   fires a fetch when stale, the interval restarts, and no duplicate timers exist**
   (Sol r3-B6) · A→B→A comp-switch staleness (C1 pattern) · `__default` sentinel re-key ·
   **invalid-comp keying: when `selectedComp` is null the cache entry keys on
   `requestedComp`** (Sol r3-S2) · **an all-ineligible `nextGw` stays present in cached
   data with its banner hidden — distinct from `nextGw: null`** (Sol r4-S2) · error →
   retry.
4. **Copy-scan manifest** entries for EVERY changed file under `app/`/`components/` —
   the new component, `app/api/matches/home-tab/route.ts`, the touched `app/page.tsx`,
   and `HomeTabs.tsx`/`HomeTabsContext.tsx` if touched (the candidate scan at
   `tests/phase3/copy-scan.test.ts:343` fails otherwise).
5. **`/matches` parity regression:** `loadMatchesTab` output identical before/after the
   focus-block extraction on a fixture snapshot (refactor guard), plus its scope-fallback
   behavior (§3.1) pinned. **Injected-error tests** (Sol r3-B4) for each tolerated read, **named by
   query purpose** — scope-links read, member-scopes read, focus-entries read,
   entry-results read, picks read (line numbers move in the refactor): with `{strictReadErrors:false}` the read failure is
   swallowed exactly as today; with `{true}` the home loader throws. A success-only
   snapshot comparison cannot catch this — these error paths are the refactor's main risk.
6. **Smoke harness:** add a `loadMatchesHomeTab` case to `scripts/smoke/route-smoke.mjs`
   (it imports loaders, not route modules — `scripts/smoke/route-smoke.mjs:39,479`).

Verify gate: `bash scripts/verify-all.sh` → ALL GREEN (typecheck · vitest · build · smoke).

## 6. QC on staging (ZZ-P1 only)

PL GW1 deadline ≈ 22 Aug — live/settled unreachable on real data now; QC splits:

- **Browser QC (reachable):** login testa → home → Matches: S1 body (GW1, entry CTA, 10
  fixtures, no pills) · fetch fires only on first activation (network panel) · tab
  away/back no refetch within TTL · fixture tap → `/m/[id]` · footer → `/matches` · dark
  mode · then enter a FULL pick set as testa (**preconditions: verify the ZZ-P1×GW1
  `gameweek_contests` row exists** — cron provisions it; entry writes reject incomplete
  pick sets, `...002.sql:1202`, so there is no browser-reachable partial entry) → S1b
  "All picks in" renders. `needs_update` is NOT browser-reachable (it arises from
  reconciliation adding fixtures post-entry) — covered by loader/component tests only.
- **Never:** touch PES Bois entries or real-league screens (PES shares pl-2026-27).
- **Deferred to matchday** (logged in implementation-notes): S2/S3/S4 live QC — covered
  now by §5.1/§5.3 fixtures.

## 7. Ship sequence

Feature branch → Luna max build → verify-all → Terra review (fix loop) → commit →
staging deploy + alias → Sonnet QC → merge main --ff-only → `node scripts/stamp-version.mjs`
→ commit stamp → push (prod auto-deploy) → resync branch → chrome-devtools-axi prod crash
check. Stage files explicitly; never `git add .`.

## 8. Risks

1. The focus-block extraction is the only touch to a shipped surface — byte-identical
   `/matches` output is the acceptance (§5.5).
2. Cost: season-wide snapshot (~12 queries) + ≤2 targeted GW loads per fetch; bounded by
   TTLs and the two refetch triggers. Follow-up if Vercel timings complain: slim per-GW
   snapshot.
3. `nextGw` copy must never claim "not entered" league-wide when one of two leagues is in
   — per-league rows are the guard.
4. `matchesAlert` dot stays `false`; legacy matches-feed files untouched — both are
   separate follow-ups.
