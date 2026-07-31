# Phase 3 — Core UI. Deep implementation plan v6 after Sol review round 5 (2 wording fixes folded in)

v6 after round 5: the manifest-definition and scan-mode wording, addended to §17.4. v5 was after
round 4, v4 after round 3 (§17.3), v3 after round 2 (§17.2), v2 after round 1 (§17.1).

Format follows `docs/plans/2026-07-27-005-phase2-engine-plan.md`: numbered sections, rule IDs
(`CL*` contest lifecycle, `VP*` viewer participation, `PR*` precedence, `U*` UI rules, `D*`/`R*` data
rules, `C*` copy strings, `E*` edge cases, `T-U*` / `T-B*` tests). v1's orchestrator resolutions are
recorded in §14 and unchanged.

Owner: orchestrator. Implementer: Opus 5. Reviewer: Sol. Tests: Sonnet (authors from THIS doc, not
from the implementation).

Phase 1 as-built context this plan reads against (migration `20260727000001`): `gameweeks`
(number, name, deadline_at, locked_at, status `upcoming|open|locked|completed`, **no `is_current`**),
`gameweek_contests` (stake_inr + deadline_at snapshots, status `open|locked|settling|settled|void`,
input_version), `gameweek_fixtures` (uuid-pk membership history, state `active|void|excluded`,
is_current), `league_competitions` (status `active|archived`, one active per league),
`member_competitions` (**`eligible_from_gameweek_id`**, `left_at`). Phase 2 adds `gameweek_entries`
(status `entered|needs_update|locked_in|invalid`), `gameweek_picks`, `gameweek_entry_results`,
`gameweek_results` (settled_version, **`last_settle_cause`**).

---

## §0 Scope, non-goals, dependencies

### 0.1 In scope
1. **League home — Gameweek tab**, every reachable contest-lifecycle × viewer-participation
   combination (§5), including the not-entered CTA with the stake on the button, entered /
   edit-in-place, `needs_update` nudge, locked reveal, live scoring, settled result.
2. **Entry sheet** — the picker per mockup `03-entry-sheet.html`, steppers-only in Phase 3 (§0.3).
3. **League home — Season tab** — gameweek-by-gameweek history plus running totals.
4. **App home** — 3-tab shell with league cards and badges (Leagues panel rebuilt only).
5. **Create / join league** — competition picker.
6. **Gameweek strip / state header** — consolidated, shared across tabs.
7. **Empty and edge states** — invalid-entry display, void GW, blank GW, double GW, dirty
   (recalculating) results, corrupt terminal contests.
8. **Copy** per the SPEC-PASS2 copy system; **dark and light** themes; **IST** deadline display.

### 0.2 Non-goals (explicit)
- **Matches and Analytics tabs → Phase 4.** Phase 3 ships no PL match detail page and no analytics.
- **Dues 2.0 and season archive → Phase 5.** The Dues tab in Phase 3 renders the existing WC dues
  component unchanged behind the new tab chrome.
- **Table tab → Phase 4** (resolved, §14 Q1). Its data source is the Phase 4 standings pipeline.
  Phase 3 builds the league shell **with the 4-tab layout in mind** but renders three tabs: the tab
  bar is a data-driven array of `{ href, label }` sized for four, so Phase 4 appends one entry and one
  route file with no shell rework.
- No new push or WhatsApp automation. The reminder is a user-initiated `wa.me` link only (U13).
- No changes to the World Cup cup-format screens beyond the pure file move in U1.
- **No no-JS write path** (E20, resolved per Sol finding 4 option 2): a money write never gets a
  form-post variant. The server-rendered absolute deadline stays.

### 0.3 Hard dependencies
| Dep | What Phase 3 needs | Status |
|---|---|---|
| D-EN1 | Phase 1 migration applied to prod (`competitions`, `gameweeks`, `gameweek_fixtures`, `gameweek_contests`, `league_competitions`, `member_competitions`, `create_league` / `join_league`) | **BLOCKED** — orchestrator decisions-log #16, human gate |
| D-EN2 | Phase 2 DB layer (`gameweek_entries`, `gameweek_picks`, `gameweek_entry_results`, `gameweek_results` incl. `last_settle_cause`) + RLS pick-reveal-at-deadline | Not started |
| D-EN3 | Phase 2 API routes `POST /api/gw/enter` (atomic: entry + all picks), `POST /api/gw/picks`, `POST /api/gw/mirror`, `GET /api/gw/contest` | Not started |
| D-EN4 | **Phase 3 work, not Phase 1.** `gameweeks` has no `is_current` (that column exists only on `gameweek_fixtures`) and no `pickCurrentGameweek` helper exists. Phase 3 writes the resolver (U3) against `gameweek_contests` + `gameweeks.status` / `deadline_at`. | **Owned here** |
| D-EN5 | Model chips — deliberately **not** wired in Phase 3 (rule below) | Resolved |
| D-EN6 | `gameweek_results.last_settle_cause` readable by league members through session RLS (Phase 2 plan §0.3 amendment) | Orchestrator is amending Phase 2 |
| D-EN7 | `StatusBadge` extended with a typed gameweek variant (U36a) | Owned here |
| D-EN8 | `resolveInvite` extended with competition identity (U33) | Owned here |

**D-EN5 — chips are OFF in Phase 3, unconditionally.** Sol is right that insights are already
competition-parameterized and `InsightsView.topScores` already carries the model output (the Poisson
work happens when the cache row is written, not at read time — v1's claim that `modelFromOdds` runs
over `InsightsView` was wrong). So "chips appear when insights exist" would silently light chips up in
Phase 3 the moment any PL `fixture_insights` row lands. Therefore:
- The entry page **does not query `fixture_insights` at all** in Phase 3. No insights read, no
  `mapInsightsView` call on this path.
- `ScoreChips` is not mounted. There is no conditional. A seeded insights row cannot produce a chip.
- `lib/model-chips.ts` ships in Phase 3 as a **pure, tested mapper over `topScores`**
  (`chipsForFixture(topScores: ScoreProb[]): ScoreChip[]`) with no caller, so Phase 4 wires it in
  without touching the sheet's layout.
- T-B23 is replaced by **T-B23′**, which seeds an insights row for a fixture in the scratch league's
  open GW and asserts the entry sheet renders **no chip row**.

### 0.4 Safety rules that bind all of Phase 3
- **S1** No change to `lib/settlement.ts`, `lib/settle-contest.ts`, `lib/gameweek-points.ts`,
  `lib/gameweek-settle.ts`. Guarded by T-U11.
- **S2** New design tokens are added **alongside** the existing WC `@theme` tokens. No existing token
  value is edited. `StatusBadge`'s existing labels and classes are pinned unchanged (T-U35).
- **S3** Browser tests never write to **Solid Yenne Boys**, **KK Bois**, **PES Bois** (T-B0).
- **S4** Every new league-format read goes through the **session** Supabase client. The service-role
  inventory is enumerated in §2.4 in three separate lists, and "nothing else" applies only to the new
  league-format path.

---

## §1 Routing and component tree

**U1 — format branch by participation precedence.** A league can hold an archived WC participation
**and** an active PL participation at the same time, so the branch cannot read "the league's format".
`resolveLeagueParticipation(leagueId)`:
1. Select the `league_competitions` row with `status='active'` (a partial unique index guarantees at
   most one). Use its competition's format.
2. If there is no active row, fall back to the most recently joined `archived` row — this is the
   WC-only league today, and it renders the cup view read-only.
3. If there is no row at all, render the empty-league state (C70).

`cup` → existing view; `league` → new gameweek view. The existing 283-line cup view moves **verbatim**
to `app/leagues/[slug]/_cup/CupLeagueView.tsx` (pure move: same imports, same `after(pollScores)`
call, same service-role reads). The branch is the only new logic in the page. T-U36 covers the
branch: active-PL, archived-WC-only, both-present, and none.

**U2 — tabs as routes.** League tabs become real routes so back/forward and deep links work:
- `app/leagues/[slug]/page.tsx` → Gameweek (default)
- `app/leagues/[slug]/season/page.tsx` → Season
- `app/leagues/[slug]/dues/page.tsx` → Dues (existing WC component under new chrome)

`components/gw/LeagueShell.tsx` renders header + gameweek strip + tab bar; the tab bar is links, not
client state, from an array sized for four tabs (§0.2). `components/LeagueTabs.tsx` stays for the cup
format, untouched.

**U3 — `resolveGameweekView` (replaces v1's `pickCurrentGameweek`).** Phase 3 owns this. There is no
`gameweeks.is_current`. Resolution order, all scoped to the league's resolved competition:
1. **Validated `?gw=<number>`** — must be an integer, must resolve to a `gameweeks` row in this
   competition, and must have a `gameweek_contests` row for this league. Anything else falls through
   to step 2 (never a 500, never someone else's gameweek).
2. The league's `gameweek_contests` row whose status is `open` **and** whose snapshot `deadline_at` is
   still in the future.
3. The league's `gameweek_contests` row whose snapshot `deadline_at` has passed but whose stored
   status is still `open` — the **cron-lag case**. This renders as closed (PR1), not open.
4. Otherwise the latest terminal contest by `deadline_at`, where terminal includes `locked`,
   `settling`, `settled` **and `void`**.
5. Otherwise no contest — the pre-season / blank state (CL0).

T-U3 covers all five branches, the three `?gw=` rejection modes and the cron-lag case.

**U4 — entry sheet as a route.** `app/leagues/[slug]/enter/page.tsx` (optionally `?gw=`), not a
modal-only component, so it is linkable, refresh-safe and testable by URL. Full-height sheet on
mobile, centered panel on desktop. It is a JSON-driven client form; there is no form-post fallback
(§0.2).

### 1.1 New files
```
app/leagues/[slug]/page.tsx                 (rewritten: participation branch)
app/leagues/[slug]/_cup/CupLeagueView.tsx   (pure move of today's page)
app/leagues/[slug]/season/page.tsx
app/leagues/[slug]/dues/page.tsx
app/leagues/[slug]/enter/page.tsx

lib/gw-participation.ts  resolveLeagueParticipation (U1)
lib/gw-state.ts          resolveContestLifecycle (CL*), resolveViewerParticipation (VP*),
                         resolveRender (precedence PR*)
lib/gw-copy.ts           every Phase 3 user-visible literal, incl. parameterized builders
lib/gw-view.ts           resolveGameweekView (U3), the two-stage loaders (R1/R2/R3), view DTOs
lib/gw-fixtures.ts       membership-history collapse by fixture_id (D6)
lib/gw-eligibility.ts    number-based eligibility join + numerator/pot rules (D5, D5a)
lib/gw-live.ts           provisional outcome via settleGameweek only (U15)
lib/gw-season.ts         season table + running totals
lib/net-balance.ts       per-league net for home cards
lib/model-chips.ts       chipsForFixture(topScores) → ScoreChip[]   (no caller in Phase 3)
lib/copy-last-week.ts    "last week" summary line builder
lib/ist.ts               server-side IST formatting (Intl, en-IN, Asia/Kolkata)

components/gw/LeagueShell.tsx        GameweekStrip.tsx     StateHeader.tsx
components/gw/EntryCta.tsx           EntryCard.tsx         NeedsUpdateNudge.tsx
components/gw/PotSummary.tsx         Standings.tsx         FixtureRow.tsx
components/gw/ScoreChips.tsx         ScoreStepper.tsx      EntrySheet.tsx
components/gw/MirrorPrompt.tsx       Countdown.tsx         SeasonTable.tsx
components/gw/LeagueCard.tsx         CompetitionPicker.tsx EmptyState.tsx
components/gw/RecalculatingNote.tsx  SyncIssueNote.tsx

tests/phase3/copy-scan-manifest.json     the T-U18b/c file contract (§4)
```
`ScoreChips.tsx` ships unmounted in Phase 3 (D-EN5) so Phase 4 adds a call site, not a component.

**Existing files Phase 3 rewrites** (the rest of the T-U18b manifest; no other file is touched):
```
app/page.tsx                 Leagues panel only (U27, U28)
app/leagues/join/page.tsx    U33 join UI
app/leagues/join/actions.ts  InviteDTO participation union (U33)
app/leagues/new/page.tsx     U31, U32
app/leagues/new/actions.ts   create-flow actions
components/ui.tsx            one added gameweek StatusBadge branch (U36a)
```
That is **six** files. The manifest is exactly the candidate set defined by T-U18c (§4). The six
rewritten files are included where they meet that definition.
There is **no route group and no `app/leagues/[slug]/layout.tsx`** — the tabs are the flat sibling
routes listed above, and `LeagueShell` is a component each route renders. §4's manifest and U2 use this
same tree; earlier drafts referred to a `(gw)` group that was never part of the design.

---

## §2 Data access

### 2.1 What RLS actually scopes (corrects v1's D1)
**D1** `leagues`, `league_members`, `league_competitions`, `member_competitions`,
`gameweek_contests`, `gameweek_entries`, `gameweek_picks`, `gameweek_entry_results`,
`gameweek_results` and `transfers` are viewer-scoped through `cashford.my_league_ids()`.
`competitions`, `gameweeks`, `gameweek_fixtures`, `fixtures` and `teams` are **global reference reads
for any authenticated user** — RLS does not scope them, so the *application* must scope every
reference query by an identity it has already proved. Treating reference tables as "RLS decides" is
what made v1's read plan unsafe.

### 2.2 Two-stage read plan (replaces v1's single `Promise.all`)
**R1 — identity stage (RLS-scoped, sequential).** One round trip resolving, for the signed-in viewer:
the league row, the active/archived participation (U1), the viewer's `member_competitions` row, and
the league's `gameweek_contests` row for the resolved gameweek (U3). Nothing else runs until R1
returns, because every later query needs `competition_id`, `gameweek_id` and `gameweek_contest_id`
from it. If R1 yields no membership, render not-found — never a partial page. Both participation rows
are selected **with their `eligible_from_gameweek_id`**, and R1 resolves each id to its gameweek
`number`, because D5 needs the league boundary and the member boundary together and neither can be
inferred later.

**R2 — detail stage (parallel `Promise.all`, every query keyed by R1's proven IDs).**
- (a) the `gameweeks` row + adjacent gameweeks for the strip, by `competition_id`.
- (b) **all** `gameweek_fixtures` rows for `gameweek_id` — every state, not just active (D6) —
  joined to `fixtures` and `teams`.
- (c) the viewer's own `gameweek_entries` row.
- (d) the viewer's own `gameweek_picks` rows — **a separate query, never embedded in (c)**.
- (e) entry **status counts** for the contest (aggregate only, no pick data).
- (f) the eligible-member roster for the denominator (D5).
- (g) `gameweek_results` — **unconditionally**, whatever the stored status, because §5.1's first three
  steps cannot be evaluated without knowing whether a row exists and whether it is dirty. It is one
  single-row read by `(league_id, gameweek_id)`; gating it on "terminal" is exactly what let v2's
  classifier misread corrupt and dirty contests.
- (h) `gameweek_entry_results` when the stored status is terminal. Because R2 is one parallel batch,
  (h) is issued before dirtiness is known, so **the DTO builder drops it whenever §5.1 lands on CL6 or
  CL8** — the dirty branch is handed no snapshot at all and cannot render one (PR3a). T-U2c asserts the
  dirty DTO has no snapshot points field, not merely that it goes unrendered.

**R3 — reveal stage, conditional.** Other members' picks are fetched **only when the snapshot
`deadline_at <= now`**, as a third query issued after R1/R2. Pre-deadline the query is never
constructed. This is the executable form of D4: the RLS reveal rule is the backstop, and the UI simply
never asks.

**D2** Loaders live in `lib/gw-view.ts` and return one `GameweekViewDTO`; components receive the DTO
and never issue queries.

**D3** Picks are never fetched client-side. The entry sheet receives the viewer's picks as server
props; writes go through the Phase 2 API routes.

**D4** Pre-deadline the UI renders only status counts. Enforced by R3 and proven by T-B17′ (sentinel
picks absent from HTML, RSC payload and network bodies).

### 2.3 Derived numbers (corrects v1's D5–D7)
**D5 — eligibility, by gameweek number, across *both* boundaries.** There is no `eligible_from` column
and no `gameweek.start`. `eligible_from_gameweek_id` exists on **two** tables and Phase 2's write API
(rule L9) checks both, so the UI must check both or it will offer entry the API refuses. A member is
eligible for gameweek `G` only when **all** of the following hold:

1. **League boundary** — the `league_competitions` row for `(league_id, competition_id)` has
   `eligible_from_gameweek_id` resolving, through `gameweeks`, to a row whose `number <= G.number`.
   This is when the *league* started playing the competition.
2. **Member boundary** — the member's `member_competitions` row for the same pair has
   `eligible_from_gameweek_id` resolving the same way to `number <= G.number`. This is when the
   *member* started playing it.
3. `member_competitions.left_at is null`.

**A null `eligible_from_gameweek_id` on *either* side means ineligible.** The boundary has not been
assigned yet (maintenance backfills it when the next gameweek opens), so neither a league nor a member
with a null boundary is eligible for any existing gameweek. Both joins are by **number**, never by
timestamp and never by UUID equality. A league that joined at gameweek 8 makes gameweeks 1–7
ineligible for every member, however early the member's own boundary is.

**D5a — numerator and pot by entry status.**
- Pre-deadline: `in` = entries with status `entered` **or** `needs_update`; both count in the
  numerator and both contribute stake to the displayed pot. Entry is final, so a `needs_update` member
  is in until the deadline decides otherwise.
- Post-deadline: `in` = entries with status `locked_in` only. **`invalid` entries never contribute
  stake and never count in the numerator or the pot**, at any point.
- The denominator is always the eligible-member count from D5.

T-U5, T-U5a and T-U5b cover the eligibility join, the pre/post numerator switch, and the invalid
exclusion respectively.

**D6 — effective fixture state needs the whole history.** Loading only effective-active rows loses the
void and excluded rows required to collapse correctly and to render M2. `lib/gw-fixtures.ts` loads
**all** membership rows for the gameweek and collapses **once** by `fixture_id`: active wins over
void, void wins over excluded, excluded-only is ignored entirely. The single collapsed result feeds
progress (U19), standings, live scoring (U15), fixture rows and the settlement input — there is one
collapse, not five. Pinned DTO tests: `active→void→active` and `active→void→excluded` (T-U4a/T-U4b).

**D7** Pot, stake and deadline always come from the **`gameweek_contests` snapshot**, never the live
competition config — a mid-season stake change must not restate a past gameweek.

**D7a — season participation is counted from entries, not results.** "Gameweeks entered" counts
`locked_in` entries, **including void gameweeks**, because a void outcome writes no
`gameweek_entry_results` rows at all (Phase 2 §0.3). Counting result rows would silently under-report
every void gameweek. T-U20a asserts a void gameweek still increments the count.

### 2.4 Service-role inventory (three lists — corrects v1's D8 "nothing else")
**D8 — new league-format path.** Exactly one service-role read: display names for members with
`left_at not null`, whom RLS no longer exposes but the Season tab and settled standings must still
name. The IDs passed to it are **derived from already RLS-scoped rows** (`gameweek_entry_results`,
`gameweek_entries`), never from an unscoped member query. Nothing else on this path.

**D8a — preserved legacy cup reads.** `CupLeagueView.tsx` keeps today's service-role reads unchanged:
member profiles and per-contest prediction counts. These are pre-existing and out of scope for
tightening in Phase 3.

**D8b — preserved create/invite reads.** `resolveInvite` and the create/join server actions keep their
existing service-role usage (an invite must be resolvable by someone who is not yet a member). U33's
extension adds fields to the same query; it does not add a new privileged path.

**D9** No `after(pollScores)` on the league-format path. PL scores arrive via reconciliation; the page
is a pure reader.

**D10** `mapInsightsView` stays the typed boundary for insights — **and Phase 3 never calls it on the
entry path** (D-EN5).

---

## §3 Design-system port (Clean Sheet 2.0)

**U5** New tokens are appended to `app/globals.css` `@theme` under a `--cs2-*` prefix, plus a
`html.dark` block: ink `#14171a`, green `#12805c`, amber `#a86b12`, radii 20 / 14 / 10, surface and
hairline greys per `docs/design/cleansheet2/SPEC.md`. Existing WC tokens (`#15a66a` etc.) untouched (S2).

**U6** Dark values are derived in the spec and stated in the plan — no runtime color math. Every new
token has an explicit dark counterpart.

**U7** All numerals (scores, money, points, counts) use Geist Mono with
`font-variant-numeric: tabular-nums` so live-updating numbers don't jitter.

**U8** The mockup class → component map is authored once as `docs/design/cleansheet2/CLASS-MAP.md` in
stage 1: `.gw-strip` → `GameweekStrip`, `.state-head` → `StateHeader`, `.cta-ante` → `EntryCta`,
`.pick-row` → `FixtureRow`, `.chip` → `ScoreChips`, `.pot` → `PotSummary`, `.tbl-season` →
`SeasonTable`, `.card-league` → `LeagueCard`, `.why` → `EmptyState` / inline explainer.

---

## §4 Copy system

**Rules (enforced by T-U18 and the T-U18b source scan).** Second person, present tense, contractions,
sentence case; ALL CAPS only inside badges; money always signed with ₹; time absolute **and**
relative; **no exclamation marks**; typographic apostrophes (`’`); en dash in scorelines (`2–1`); the
word is **ante** or **stake** — **never bet, wager, gamble, punt**.

**C-RULE (Sol finding 13).** Every user-visible literal in Phase 3 has a `lib/gw-copy.ts` export,
including the ones v1 left inline: M3, M4, U13's nudge text, U30's named CTAs, tab labels, archived and
empty states, error states, the recalculating note and the sync-issue note. Parameterized strings are
**functions** (e.g. `nudgeMessage({ league, gw, deadline })`), and T-U18 tests their *generated output*
with representative values, not just static exports. **Badge labels are copy too** — `RECALCULATING`
is C71, not an inline literal in `components/ui.tsx`.

**T-U18b scope — a checked-in manifest.** v2 scanned `app/leagues/**`, which cannot pass: that tree
contains the byte-for-byte `_cup` move (U1) and legacy routes Phase 3 never touches, all full of
pre-existing inline literals. v3 called its replacement an "explicit list" but still wrote globs
(`(gw)/**`, `new/**`, `components/gw/**`) — and one of them, the `(gw)` route group, does not exist:
§1.1 and U2 declare **flat routes under `app/leagues/[slug]/`**, with no route group and no
`layout.tsx`. A glob is also not enforceable, since it silently absorbs future files.

The scope is therefore a literal file list checked in at **`tests/phase3/copy-scan-manifest.json`**,
using the §1.1 route tree — the single tree used by §1.1, U2 and this section. Every manifest entry
explicitly declares `jsx` or `strings` mode; `[strings]` marks the four non-JSX copy producers below,
and every other entry declares `jsx`:

```
app/page.tsx                                   U27, U28 home Leagues panel (rewritten)
app/leagues/[slug]/page.tsx                    Gameweek tab + participation branch
app/leagues/[slug]/season/page.tsx             Season tab
app/leagues/[slug]/dues/page.tsx               Dues tab chrome (WC component untouched)
app/leagues/[slug]/enter/page.tsx              entry sheet route
app/leagues/join/page.tsx                      U33 join UI
app/leagues/join/actions.ts                    U33 InviteDTO + resolveInvite     [strings]
app/leagues/new/page.tsx                       U31, U32 create flow
app/leagues/new/actions.ts                     create-flow server actions       [strings]

components/gw/LeagueShell.tsx    components/gw/GameweekStrip.tsx
components/gw/StateHeader.tsx    components/gw/EntryCta.tsx
components/gw/EntryCard.tsx      components/gw/NeedsUpdateNudge.tsx
components/gw/PotSummary.tsx     components/gw/Standings.tsx
components/gw/FixtureRow.tsx     components/gw/ScoreChips.tsx
components/gw/ScoreStepper.tsx   components/gw/EntrySheet.tsx
components/gw/MirrorPrompt.tsx   components/gw/Countdown.tsx
components/gw/SeasonTable.tsx    components/gw/LeagueCard.tsx
components/gw/CompetitionPicker.tsx  components/gw/EmptyState.tsx
components/gw/RecalculatingNote.tsx  components/gw/SyncIssueNote.tsx
components/ui.tsx                              gameweek StatusBadge branch ONLY (U36a)

lib/gw-copy.ts                                 the copy module itself
lib/copy-last-week.ts                          "last week" builder             [strings]
lib/ist.ts                                     user-visible time strings       [strings]
```

Every copy-producing module is in the list, not only the pages: `lib/copy-last-week.ts` and `lib/ist.ts`
emit user-visible text and v3 left both outside the scan. The manifest is exactly the candidate set
defined by T-U18c. The six rewritten files — `app/page.tsx`, `app/leagues/join/page.tsx`,
`app/leagues/join/actions.ts`, `app/leagues/new/page.tsx`, `app/leagues/new/actions.ts` and
`components/ui.tsx` (the gameweek `StatusBadge` branch, U36a) — are included where they meet that
definition.

**Two scan modes, because four of these files contain no JSX.** A bare-JSX-literal scan would walk
straight past `join/actions.ts`, `new/actions.ts`, `lib/copy-last-week.ts` and `lib/ist.ts` — exactly
the files most likely to hold a hard-coded sentence, since `resolveInvite`'s error text and the
"last week" and IST builders all return strings. So the manifest marks each entry with a mode and
T-U18b applies both:

| Mode | Files | What it flags |
|---|---|---|
| `jsx` | every `.tsx` file in the manifest | bare string literals in JSX children and in user-visible props (`aria-label`, `placeholder`, `title`, `alt`) |
| `strings` | `app/leagues/join/actions.ts`, `app/leagues/new/actions.ts`, `lib/copy-last-week.ts`, `lib/ist.ts` | ordinary string **and template** literals that are returned, or assigned to a field the view renders — a returned sentence must come from `lib/gw-copy.ts`, not be written in place |

The `strings` mode allows what is structurally not copy: `lib/ist.ts`'s `Intl` option values and locale
and zone identifiers (`'en-IN'`, `'Asia/Kolkata'`, `'2-digit'`), Supabase table and column names, status
and discriminant literals (`'active'`, `'none'`, `'needs_update'`), route paths and thrown internal error
codes. Anything that reaches the screen as a sentence must be an export.

Explicitly **excluded** from both modes: `app/leagues/[slug]/_cup/CupLeagueView.tsx` (the verbatim move,
protected by its own byte-unchanged guard — a copy edit there would break it),
`components/LeagueTabs.tsx` and every other unchanged legacy route or component, and
`lib/settlement.ts` / `lib/settle-contest.ts` / `lib/gameweek-*.ts` (pinned by T-U11, and they render
nothing). For `components/ui.tsx` the scan is bounded to the added gameweek branch, since the legacy
`BADGE` labels are pinned by T-U35. Within scope the allowlist covers only non-copy text: class names,
`aria` role values, test ids and punctuation-only separators.

**T-U18c — the manifest matches reality.** Two assertions, neither of which needs a "whole diff" claim.
1. **No missing files.** The candidate set from `git diff --name-only <baseRef>...HEAD` is defined by
   enumeration, not by an "app/component `.tsx`" filter that leaves the `.ts` producers ambiguous:
   - every changed `.tsx` file under `app/` or `components/`, **plus**
   - `app/leagues/join/actions.ts` and `app/leagues/new/actions.ts` if changed, **plus**
   - `lib/gw-copy.ts`, `lib/copy-last-week.ts` and `lib/ist.ts` if changed,

   minus the explicit exclusion list above. That set must equal the manifest. No other `.ts` file is a
   candidate — server-only modules such as `lib/gw-view.ts` render nothing and are out of scope by
   construction, not by omission. `baseRef` is a **fixed commit** — the Phase 2 merge commit — recorded
   in the manifest rather than resolved at run time, so the test cannot drift with later branches.
2. **No stale files.** Every path in the manifest exists on disk, and every entry declares a valid mode
   (`jsx` for `.tsx`, `strings` for the four `.ts` producers).

So a new Phase 3 page fails (1) until it is added, and a deleted one fails (2) — which is what "the list
cannot silently rot" has to mean to be a test rather than a promise.

### 4.1 Canonical strings lifted verbatim from the mockups (C1–C43)
| ID | State | String |
|---|---|---|
| C1 | Not entered, header | `Gameweek 24 is open` |
| C2 | Not entered, deadline | `Deadline Sat 3 Feb, 4:00 pm IST` |
| C3 | Not entered, CTA | `Enter for ₹200` |
| C4 | Not entered, sub | `You’ll predict all 10 scorelines. You can edit until the deadline.` |
| C5 | Pot line | `Pot ₹1,400 · 7 entered of 10` |
| C6 | Entered, header | `You’re in for Gameweek 24` |
| C7 | Entered, CTA | `Edit picks` |
| C8 | Entered, sub | `Your last saved picks stand. Edit any time before the deadline.` |
| C9 | Entry final note | `Entry is final — you can’t withdraw once you’re in.` |
| C10 | Locked, header | `Gameweek 24 is locked` |
| C11 | Locked, sub | `Picks are visible to everyone now.` |
| C12 | Live, header | `Gameweek 24 is live` |
| C13 | Live, sub | `Points update as matches finish.` |
| C14 | Live, provisional flag | `Provisional — 4 of 10 matches final` |
| C15 | Settled, header (win) | `You won Gameweek 24` |
| C16 | Settled, header (loss) | `Gameweek 24 is settled` |
| C17 | Settled money (win) | `+₹600` |
| C18 | Settled money (loss) | `−₹200` |
| C19 | Scoring explainer | `3 points for an exact scoreline, 1 for the right result.` |
| C20 | Tiebreak explainer | `Tied on points? Most exact scorelines wins, then closest on goals, then the pot splits.` |
| C21 | Entry sheet title | `Your picks — Gameweek 24` |
| C22 | Entry sheet progress | `6 of 10 set` |
| C23 | Entry sheet save | `Save picks` |
| C24 | Entry sheet first save | `Enter for ₹200` |
| C25 | Chip row label | `Likely scores` (unused in Phase 3 — D-EN5) |
| C26 | Void GW | `Gameweek 24 was void` |
| C27 | Void reason, 1 entrant | `Only one person entered, so the ante went back.` |
| C28 | Void reason, 0 entrants | `Nobody entered this gameweek.` |
| C29 | Blank GW | `No Premier League matches this week.` |
| C30 | Home card, open | `Gameweek 24 open · deadline Sat 4:00 pm` |
| C31 | Home card, net owed | `You owe ₹450` |
| C32 | Home card, net due | `You’re owed ₹450` |
| C33 | Home card, settled up | `Settled up` |
| C34 | Join, competition picker | `Which competition?` |
| C35 | Create, stake field | `Ante per gameweek` |
| C36 | Create, stake help | `Everyone puts in the same amount each gameweek.` |
| C37–C43 | Badges | `OPEN`, `ENTERED`, `LOCKED`, `LIVE`, `SETTLED`, `VOID`, `ACTION NEEDED` |

### 4.2 New strings — adopted as drafted, **pending Ananth sign-off alongside decisions-log #17**
C44–C50 cover the `needs_update` / `invalid` rule, a player-facing rule Ananth has not seen.
Implementation proceeds; the sign-off is a review gate, not a blocker.
| ID | State | String |
|---|---|---|
| C44 | needs_update, badge | `ACTION NEEDED` |
| C45 | needs_update, header | `A match was added to Gameweek 24` |
| C46 | needs_update, body | `Your entry needs one more pick before the deadline, or it won’t count.` |
| C47 | needs_update, CTA | `Add the missing pick` |
| C48 | invalid, header | `Your Gameweek 24 entry didn’t count` |
| C49 | invalid, body | `It was incomplete at the deadline, so you staked nothing and won nothing.` |
| C50 | invalid, standings row | `Didn’t count` |
| C51 | Mirror prompt | `Use these picks in your other leagues?` |
| C52 | Mirror target line | `KK Bois — ₹100 ante` |
| C53 | Mirror confirm | `Enter in 2 more leagues` |
| C54 | Mirror stake changed | `The ante in KK Bois changed. Open that league to enter.` |
| C55 | Deadline passed mid-edit | `The deadline passed. Your last saved picks stand.` |
| C56 | Save failed | `Couldn’t save your picks. Try again.` |
| C57 | Double GW note | `Gameweek 24 has two matchdays. All 12 matches count.` |

### 4.2a Strings new in v2 (same sign-off gate)
Every one of these existed as an inline literal or an undefined state in v1; C-RULE gives each an ID.
| ID | State | String |
|---|---|---|
| C58 | Closed, awaiting results (CL2) | `Gameweek 24 is closed. Results start once matches finish.` |
| C59 | All final, awaiting settlement (CL4) | `All matches are final. Working out the pot.` |
| C60 | Dirty result (CL6 / CL8) | `A score changed. These numbers are being worked out again.` |
| C61 | M3, cause `result_revision` | `Updated after a score correction` |
| C62 | M3, cause `membership_change` | `Updated after a fixture change` |
| C63 | M3, cause `combined` / fallback | `Updated after a correction` |
| C64 | Corrupt terminal contest (CL9) | `We can’t show this gameweek’s result yet. It’s being looked into.` |
| C65 | Not eligible (VP0) | `You join from Gameweek 25` |
| C66 | Not entered, terminal GW (PR8) | `You sat this one out` |
| C67 | Nudge body (U13) | `{league} — Gameweek {n} closes {deadline}. Get your picks in.` |
| C68 | Home CTA, named league | `Enter for ₹200 in KK Bois` |
| C69 | Archived competition | `This competition is finished.` |
| C70 | League with no participation (U33 `none` arm) | `This league hasn’t started a competition yet.` |

### 4.2b Strings new in v3
| ID | State | String |
|---|---|---|
| C71 | Badge label, dirty contest (CL6 / CL8) | `RECALCULATING` |
| C72 | All fixtures void, no result yet (CL10) | `Every match in this gameweek was called off.` |

C71 is the export that makes the U36a badge branch pass T-U18b; the badge is the only place the string
appears, and ALL CAPS is permitted there under §4's badge exception.

### 4.3 Label canonicalization
- **Ante** for the amount per gameweek; **stake** for what a member has at risk in a specific pot.
  Never mixed in one sentence.
- **Entered** for the state, `n entered of m` for the count. Not `In`, not `In so far`.
- The denominator is eligible members (D5). Where the mockups show `6/9` or `6 of 10`, those numbers
  were **illustrative, not a data contract** — D5 wins and rendered numbers may differ.
- Typographic apostrophes and en dashes everywhere.

---

## §5 Render state model — two orthogonal dimensions

v1's single GS1–GS11 list conflated the contest's lifecycle with the viewer's participation, so it
could not express reachable states like "settled contest, viewer never entered" or "dirty result".
v2 resolves the two independently and composes them under an explicit precedence table.

### 5.1 Contest lifecycle — `resolveContestLifecycle(contest, gw, fixtures, results, now)`
**Stored status is never trusted on its own**, and the classifier is an **ordered, mutually exclusive
decision tree**, not a set of conditions. v2's table overlapped in six reachable Phase 2 states (an
immediate 0/1-entrant void has a result row before any fixture is final; a dirty result made unready
matched both the live and the dirty rules; a dirty result being re-settled carries stored status
`settling`; a corrupt terminal contest with unready fixtures matched three rules; an all-void gameweek
matched blank even with a valid void result) and left one state unclassified (a past-deadline
stored-`open` contest with every active fixture final). The tree below returns exactly one state for
every input.

**Load rule.** `gameweek_results` is **always** loaded — including while status is `settling` — because
steps 1–3 cannot be evaluated without it. There is no "terminal only" fetch condition.

**Definitions.** `active` = effective-active fixtures after the D6 collapse; `void` = effective-void
fixtures after the same collapse. **True blank** means **no effective-active fixtures AND no
effective-void fixtures** — a gameweek whose fixtures were all voided is *not* blank.

Evaluated top to bottom; the first match wins:

| Step | ID | Test | Renders |
|---|---|---|---|
| 1 | **CL9** | stored status ∈ {`settled`, `void`} **and** no `gameweek_results` row | Sync issue (C64); no points, no money, no CTA |
| 2 | **CL6 / CL8** | a `gameweek_results` row exists **and** `input_version > settled_version` | **Recalculating** (C60 + C71 badge). CL6 when `outcome='settled'`, CL8 when `outcome='void'`. Points from the **current** provisional input (PR3a); all money suppressed |
| 3 | **CL5 / CL7** | a `gameweek_results` row exists **and** `input_version == settled_version` | CL5 (`outcome='settled'`) final money; CL7 (`outcome='void'`) C26 + reason. Reached regardless of fixture readiness, so an immediate 0/1-entrant void lands here, not in CL2 |
| 4 | **CL0** | no contest row for this league, **or** true blank (no active **and** no void fixtures) | Blank / pre-season (C29) |
| 5 | **CL1** | `deadline_at > now` | Open — CTA live. Stored status is irrelevant: a future deadline is open |
| 6 | **CL10** | `deadline_at <= now` and **zero active fixtures** (so ≥1 void, since step 4 already excluded true blank) | **All matches were called off** (C72); no standings, no money |
| 7 | **CL2** | `deadline_at <= now`, **≥1 active fixture**, and **none** of them final | Closed, awaiting results (C10 + C58); picks revealed |
| 8 | **CL3** | `deadline_at <= now`, **≥1 active fixture**, **some but not all** final | Live (C12 + C14); provisional standings |
| 9 | **CL4** | `deadline_at <= now`, **≥1 active fixture**, **all** final | All final, settling (C59); provisional standings. **Accepts stored `open`, `locked` or `settling`** — this is the step that classifies the previously-unreachable past-deadline stored-`open`-all-final contest |

**CL2, CL3 and CL4 all require at least one active fixture.** v3 put CL10 last as a "fallback", which
made it unreachable: over an empty active set both "none are final" (CL2) and "all are final" (CL4) are
vacuously true, so a zero-active gameweek matched CL2 and never reached CL10. Ordering CL10 before CL2
and adding the non-empty precondition to CL2–CL4 fixes it from both sides, so the tree and T-U1a agree.

Consequences worth stating because they were the overlaps:
- A result row **always** outranks fixture readiness (steps 1–3 precede 6–9), so re-settlement in
  progress (`settling` + dirty) renders as recalculating, never as CL4.
- Corrupt (CL9) is checked first, so an unready corrupt contest can never read as live.
- CL0 no longer swallows all-void gameweeks; those go to CL7 with a result, else CL10.
- Vacuous truth over the empty active set is now impossible to hit: CL10 catches zero-active first,
  and CL2–CL4 refuse it anyway.

### 5.2 Viewer participation — `resolveViewerParticipation(member, entry)`
| ID | Condition |
|---|---|
| VP0 | Not eligible for this gameweek (D5), or `left_at` precedes it |
| VP1 | Eligible, no entry row |
| VP2 | Entry `entered` (complete) |
| VP3 | Entry `needs_update` |
| VP4 | Entry `locked_in` |
| VP5 | Entry `invalid` |

### 5.3 Precedence — `resolveRender(cl, vp)`
| ID | Rule |
|---|---|
| PR1 | **`deadline_at <= now` means closed**, whatever the stored status says. A stored-`open` past-deadline contest never shows a CTA and never shows an editable sheet. |
| PR2 | CL9 (corrupt) beats everything: C64 only, no points, no money, no CTA. |
| PR3 | CL6 / CL8 (dirty) suppress **money** everywhere on the page — standings net, the viewer's result line, the season row and the home card — and show C60 with the C71 badge. Points and picks may still render, subject to PR3a. Stale money is never presented as final. |
| PR3a | **Dirty points come from the live input, not the snapshot.** In CL6 / CL8 the page recomputes points and ranks from the **current** `gw-live` input through `settleGameweek` (D8b) and must **never** read `gameweek_entry_results`, whose points belong to the superseded settlement. If the current provisional points cannot be computed — missing scores, an unbuildable input, an engine throw — points and ranks are **suppressed** too, leaving C60 alone, and never a fallback to zero. Showing a stale points number is the same class of error as showing stale money. In CL8 the question does not even arise: Phase 2 writes entry-result rows only for `outcome='settled'`, so a void contest has no snapshot to be tempted by — the live path is the only path. |
| PR3b | **Dirtiness propagates to every cumulative view.** A dirty gameweek contest suppresses **every** cumulative figure it contributes to, until re-settlement: the **Season** running totals and per-member season money (§7), the home card's net line, and the **PL Dues** balances **and** settle plan. Each suppressed figure shows C60 in place of the number, naming the affected gameweek. **WC Dues are untouched** — the cup ledger has no gameweek input and must render exactly as it does today. Phase 3 owns the first three surfaces; the PL Dues route itself is Phase 5 (§0.2), so the Phase 3 Dues tab, which shows WC only, has nothing to suppress. The Phase 5 half is **X-P5-1** below, not an assumption about Phase 5's current text. The single predicate lives in `lib/net-balance.ts` (T-U8) so both phases share one implementation rather than two. |
| PR4 | CL0 beats every VP: no CTA, no standings, C29. |
| PR5 | VP0 forces the whole page read-only with C65, whatever the lifecycle. |
| PR6 | A CTA exists only when CL1 **and** VP ∈ {VP1, VP2, VP3}. VP1's CTA is C3, VP2's is C7, VP3's is C47. |
| PR7 | VP5 (invalid) never shows money and never appears in the pot; its standings row shows C50. This holds even in CL5. |
| PR8 | VP1 in a terminal lifecycle renders C66, not an empty result row. |
| PR9 | A single-entrant void (CL7, `void_reason='single_entrant'`) shows C27 both to the lone valid entrant **and** to VP5 viewers whose invalid entry is why the contest had one entrant. |

#### 5.3a Cross-plan requirement X-P5-1 (dirty PL money in Dues)
PR3b names a surface Phase 3 does not build. v3 said the rule was "carried into the Phase 5 plan",
which was a claim about another document rather than a requirement — and it was false: Phase 5 §2 sums
`gameweek_entry_results` directly, computes the combined balance and calls the settle-plan routine with
no version check anywhere, so a re-settling gameweek would surface stale PL money. Stating it as a
named, tracked obligation instead:

> **X-P5-1.** The Phase 5 plan's Dues loader (§3.2) must read `gameweek_contests.input_version` and
> `gameweek_results.settled_version`, apply the **shared dirty predicate from `lib/net-balance.ts`**,
> and return a `recalculating` state **before** it computes or renders the combined balance, the
> per-member balances or the debt-simplification settle plan (§2.4). Dirty-settled and dirty-void unit
> and browser cases must assert those figures and every balance-derived shortcut are hidden until
> re-settlement. WC-only ledgers are unaffected.

**Status:** enforced by the orchestrator on the Phase 5 side, whose revision is in flight; recorded in
`docs/plans/2026-07-27-004-orchestrator-decisions.md`. Phase 3 owns only the predicate and its unit
proof (T-U8, T-U2d) — the predicate is exported for exactly this reason, so Phase 5 consumes one
implementation rather than writing a second. **Completing Phase 3 does not satisfy or close X-P5-1.
Phase 5 must implement and pass X-P5-1 independently.** The two are tracked separately, and until
Phase 5 does so, stale PL money during re-settlement is a known open gap on the Dues route.

### 5.4 Modifiers
- **M1** double gameweek → C57.
- **M2** a fixture is effective-void → inline explainer on that row, excluded from scoring. Requires
  the full membership history (D6).
- **M3** re-settlement cause, read from `gameweek_results.last_settle_cause` (D-EN6):
  `result_revision` → C61, `membership_change` → C62, `combined` → C63, `initial` → no note. **This is
  the only allowed source** — the `gameweek_audit_log` is service-only and D8 forbids reading it. If
  D-EN6 does not land, M3 degrades to C63 for every non-initial cause. T-U6a/T-U6b/T-U6c cover
  initial, score-correction and membership-change.
- **M4** VP0 → C65 (see PR5).

### 5.5 Other rules
**U9** Components never re-derive state. They receive `{ cl, vp, modifiers }` from `lib/gw-state.ts`.

**U10** Typographic apostrophes and en dashes in every rendered string.

**U11** Three league tabs in Phase 3 from a four-sized array (§0.2).

**U12** Pot, stake and deadline render from the contest snapshot (D7), through D5a's status rules.

**U13** In CL1 with VP1 or VP3, within 12 hours of the deadline, the header shows a `wa.me` link built
from C67. User-initiated, new tab, sends nothing automatically.

**U14** The countdown is client-only and hydrates over a server-rendered absolute IST string.

**U15 — provisional scoring calls `settleGameweek` only.** `settleGameweek` already calls
`scoreGameweek` internally, so calling both would fork the logic. `lib/gw-live.ts` builds one
`GwInput` from **all currently final effective-active fixtures plus every effective-void fixture**
(void results are part of the input, not an omission) and calls `settleGameweek` once. Money from a
provisional call is **never returned to the view layer** — only points, ranks and the C14 counter.
T-U10 tests five input shapes directly against engine output: zero-final, partial-final,
partial-plus-void, all-final, and a score correction applied to a previously all-final input.

---

## §6 Entry sheet

**U16** State lives in the client component, seeded from server props. Unsaved edits are cached in
`sessionStorage` keyed `cf-gw-draft:<gwContestId>` **purely as crash protection** — not a draft state,
never shown to anyone, cleared on successful save. The UI never says "draft".

**U17** Steppers are the only input in Phase 3 (D-EN5). `ScoreChips` is not mounted and no insights
query runs on this page.

**U18** Steppers clamp **0–9** (§14 Q5; the DB allows 0–99 so raising the clamp later needs no
migration), keyboard-accessible, `aria-label` per side.

**U19** Progress line C22 counts fixtures with both scores set, against the collapsed effective-active
set (D6).

**U20 — first save is ONE atomic call.** Phase 2 defines `/api/gw/enter` as a single transaction that
creates the entry **and** its complete picks, so Phase 3 posts once:
- No entry yet → `POST /api/gw/enter` with the full pick payload. One write, one failure boundary.
  The button carries the stake (C24).
- Entry exists → `POST /api/gw/picks` (C23).

The button is disabled until the entry is complete, with the count as the reason. There is no confirm
sheet (design review round 1) and no form-post fallback (§0.2).

**U21** Errors map to specific copy, never a generic toast: deadline passed → C55, sheet becomes
read-only; validation rejected → highlight the offending rows; network or 5xx → C56 with a retry that
re-posts the same payload; stale stake → C54.

**U22** The mirror prompt appears **only** when the viewer is in at least one other league with the
same competition active and has no entry for this gameweek there.

**U23** Each mirror target carries `acceptedStakeInr` from the rendered chip, so the API can reject a
stake that changed under the user (C54). Partial failures list per-league results; nothing is written
on mismatch.

---

## §7 Season tab

**U24** Two panes — gameweek-by-gameweek rows and running totals — same pill filters on both. Each
gameweek row links to `?gw=<number>` on the Gameweek tab.

**U25** Members who have left are retained with their historical results (D8 supplies the name). They
are excluded from the current entered denominator (D5).

**U26** Running totals show points, exacts, gameweeks entered and net money — money signed, points
not. Gameweeks entered comes from `locked_in` entries including void gameweeks (D7a).

**U26a — dirtiness reaches the totals, not just the row.** A dirty gameweek suppresses its own row's
money **and** every running total it feeds: the season net, the per-member season money and any
league-wide money summary (PR3b). Each suppressed figure shows C60 naming the gameweek. Points columns
still render, computed the PR3a way. Season points and exacts are unaffected only where the dirty
gameweek's points are themselves computable; otherwise those cells are suppressed too, never carried
from the superseded snapshot.

---

## §8 App home

**U27** Only the Leagues panel of `app/page.tsx` is rebuilt. The 3-tab `HomeTabs` ARIA shell stays.

**U28** `LeagueCard` badge states, exactly eight: `OPEN` (CL1 + VP1), `ENTERED` (CL1 + VP2),
**`ACTION NEEDED` (CL1 + VP3)**, `LOCKED` (CL2), `LIVE` (CL3 / CL4), `SETTLED` (CL5), `VOID` (CL7),
and `RECALCULATING` (CL6 / CL8) — the last suppressing the card's money line (PR3b). Cup-format
leagues keep today's badge.

`ACTION NEEDED` requires **CL1 as well as VP3**. Keying it off VP3 alone was wrong: cron lag leaves a
past-deadline entry sitting at `needs_update` until maintenance flips it to `invalid`, and an action
badge on a contest whose deadline has passed invites an edit PR1 forbids. **After the deadline the
lifecycle badge wins** for every participation state, so a `needs_update` entry in CL2 renders
`LOCKED`, in CL3/CL4 `LIVE`, and in CL5 `SETTLED`. T-U25a tests the full lifecycle × participation
badge cross-product, including every VP under CL2 through CL8.

**U29** The entered count never becomes a badge — it lives in the card sub-line (C30).

**U30** Card CTAs name the league (C68) so they read correctly out of context.

---

## §9 Create and join

**U31** `CompetitionPicker` lists only competitions with `status='active'` — Phase 1 seeds PL as
`preparing`, and a preparing competition must not be pickable.

**U32** Zero active competitions → the create flow is blocked with an explainer, not an empty picker.

**U33 — `resolveInvite` extension (D-EN8).** Today's `InviteDTO` returns `stakeInr` but no competition
identity, so join cannot show the competition and the ante before commitment. v2 bolted non-null
competition fields onto the `active` invite variant, which cannot represent a league with **no**
`league_competitions` row at all — a real state, since `create_league` can succeed before any
competition is attached. Flat optional fields would push that check to every call site. Instead the
invite carries a **nested discriminated union on participation**, so the type makes the no-competition
case unforgettable:

```ts
export type InviteParticipation =
  | { participation: "active";   competitionId: string; competitionName: string;
      competitionFormat: "gameweek" | "cup" }
  | { participation: "archived"; competitionId: string; competitionName: string;
      competitionFormat: "gameweek" | "cup" }
  | { participation: "none" };

export type InviteDTO =
  | { status: "notfound" }
  | { status: "revoked" }
  | ({ status: "active"; leagueId: string; slug: string; leagueName: string;
       captainName: string; memberCount: number; stakeInr: number;
       token: string; leagueStatus: string } & InviteParticipation);
```

Competition fields exist **only** on the `active` and `archived` arms; the `none` arm has no
`competitionId` to be null. Resolution uses the same precedence as U1: the league's `active`
`league_competitions` row, else the most recent `archived` row, else `none`.

UI per arm: `active` shows competition name, format and ante, and offers join. `archived` shows C69
and does not offer entry. **`none` shows C70, and joining membership *is* allowed** — the invite is
valid and the league exists, so the user joins and waits; there is simply nothing to enter yet and no
ante to display. T-U31a asserts all three arms: the field set present on each, the absence of
competition keys on `none`, and that only `active` renders a join-with-ante CTA.

**U34** The competition chip in the league header is **non-interactive** in Phase 3 — no switcher, since
only one active competition exists (§14 Q4).

---

## §10 Shared components

**U35** IST formatting is server-side via `Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata' })`
in `lib/ist.ts`. The client never formats the absolute time, so there is no hydration mismatch.
`Countdown` renders only the relative part, only after mount.

**U36** `Avatar` and `inr()` from `components/ui.tsx` are reused unchanged.

**U36a — `StatusBadge` gets a typed gameweek variant.** Today's `StatusBadge` takes a legacy
`CardState` and its `BADGE` map has no `ENTERED`, `ACTION NEEDED` or `RECALCULATING`, so U28 is not
implementable against it as-is. Add a **separate discriminated variant** —
`<StatusBadge kind="gameweek" state={GwBadgeState} />` alongside the existing
`<StatusBadge state={CardState} />` — with its own map. Every existing label, class string and the
`no_separation` void special case are pinned byte-for-byte by T-U35; the cup path keeps calling the old
signature. The new map's labels come from `lib/gw-copy.ts` (C71 for `RECALCULATING`), so the gameweek
branch — and only that branch — is inside the T-U18b scan.

---

## §11 Edge matrix

| ID | Case | Behavior |
|---|---|---|
| E1 | No open contest (between gameweeks) | U3 step 4 — latest terminal contest, incl. void |
| E2 | Blank gameweek (no effective-active fixtures) | CL0, C29 |
| E3 | Double gameweek | M1 + C57; all matches count |
| E4 | Fixture added pre-deadline | VP3, CTA C47 |
| E5 | Incomplete at deadline | VP5, C48–C50, PR7 |
| E6 | 0 entrants | CL7 + C28 |
| E7 | 1 entrant | CL7 + C27, PR9 |
| E8 | Fixture voided mid-gameweek | M2 row explainer, excluded from scoring |
| E9 | Void fixture returns | counts again by `fixture_id` (D6) |
| E10 | Score corrected post-settlement | CL6 → C60, money suppressed; after re-settle CL5 + M3 |
| E11 | A correction makes a dirty contest unready | stays CL6 (recalculating); never falls back to live |
| E12 | Terminal status with no results row | CL9, C64 |
| E13 | Cron lag: stored `open` past its deadline | PR1 → CL2, no CTA |
| E14 | Member joined mid-season | VP0, PR5, C65 |
| E15 | Member left mid-season | retained in history (U25), out of the denominator |
| E16 | League archived / no active participation | read-only, C69 (archived) / C70 (`none`) |
| E17 | Deadline passes while the sheet is open | C55, read-only |
| E18 | Stake changed between render and mirror | C54, nothing written |
| E19 | A seeded insights row exists | no chip row renders (D-EN5, T-B23′) |
| E20 | **No JS** | the server-rendered absolute deadline still renders; the **entry sheet does not submit** — a money write gets no form-post variant (resolved per Sol finding 4, option 2) |
| E21 | Cup-format league | old view via U1 |
| E22 | Single-member league | enter allowed; void at lock (E7) |
| E23 | Slow or failed API | C56, retry same payload |
| E24 | `?gw=` invalid / foreign / non-numeric | falls through to U3 step 2, never a 500 |
| E25 | Every fixture in the gameweek voided, no result row yet | CL10, C72 — not blank (CL0) |
| E26 | Same, but a void result row exists | CL7 with the void reason |
| E27 | `needs_update` entry still stored past the deadline (cron lag) | lifecycle badge wins: `LOCKED`, no CTA (PR1, U28) |

---

## §12 Cross-cutting

Accessibility: the tab bar is real links with `aria-current`; steppers are buttons with per-side
labels; the entered count is an `aria-live="polite"` region only in CL3 / CL4. Motion reuses
`cf-riseIn`, `CountUp`, `SlideTrack`; `prefers-reduced-motion` disables `CountUp`. Theme: every new
component is checked in both themes (T-B29). Performance: R1 is one sequential round trip, R2 is one
parallel batch, R3 is conditional; no client fetch on first paint; no realtime subscription in Phase 3.

---

## §13 Test inventory

### 13.1 Component and unit (vitest)
**Lifecycle and participation cross-product.**
- **T-U1** `resolveContestLifecycle` returns each of CL0–CL10 from crafted contest / fixture / result
  fixtures, including all-final-while-`locked`, all-final-while-`settling`, dirty settled, dirty void,
  and terminal-without-results.
- **T-U1a — exclusivity and exhaustiveness of the §5.1 tree.** One case per overlap v2 could not
  decide, asserting the single expected state: (a) immediate 0/1-entrant void, result row present, no
  fixture final → **CL7**, not CL2; (b) dirty result whose fixtures are no longer all final → **CL6**,
  not CL2/CL3; (c) dirty result mid-re-settlement with stored status `settling` → **CL6**, not CL4;
  (d) terminal stored status with no result row and unready fixtures → **CL9**, not CL2/CL3;
  (e) all-void gameweek **with** a valid void result → **CL7**, not CL0; (f) all-void gameweek with
  **no** result → **CL10**, not CL0 **and not CL2** — this is the v3 shadowing bug, and the case is
  pinned to the step order: CL10 sits between CL1 and CL2; (g) past-deadline stored-`open` with every
  active fixture final → **CL4** (v2 returned nothing); (h) a property test over randomized raw inputs
  asserting the classifier returns exactly one state and never throws.
- **T-U1b — zero-active vacuous truth.** Three inputs with an **empty active set** after the D6
  collapse: past deadline with ≥1 void and no result → **CL10**; the same with a void result → **CL7**
  (step 3 wins); pre-deadline with ≥1 void and no active → **CL1** (a future deadline still outranks
  CL10). Each asserts the returned state is not CL2 and not CL4, which is what "CL2–CL4 require ≥1
  active fixture" means in code. T-B26b is the browser half of the first case.
- **T-U2** `resolveRender` over the **CL × VP cross-product**: every CL0–CL10 against every VP0–VP5,
  asserting PR1–PR9 incl. PR3a/PR3b. Named cases: invalid viewer in CL3 / CL5 / CL7; non-entered viewer in CL3 / CL5 /
  CL7; a valid entrant plus invalid entries in a single-entrant void; dirty settled against each VP.
- **T-U2a** PR3 money suppression: no money string appears in any CL6 / CL8 render, for any VP.
- **T-U2b** PR1: a stored-`open` contest past its deadline yields no CTA and no editable sheet.
- **T-U2c — PR3a dirty points source.** With a `gameweek_entry_results` snapshot saying 9 points and a
  current `gw-live` input producing 6, the CL6 render shows **6**, and the DTO handed to the view has
  **no snapshot points field at all** (R2 (h) dropped it). When the live input cannot be built, points
  and ranks are absent rather than stale, and only C60 renders.
- **T-U2d — PR3b propagation.** A dirty gameweek suppresses the season running total, the season member
  row and the home net line, each showing C60. `netBalance` returns "suppressed" for the PL ledger and
  an unchanged figure for the WC ledger from the same fixture — the unit-level guarantee X-P5-1 requires
  Phase 5's Dues loader to consume. The exported predicate is asserted directly (T-U8) so Phase 5 has a
  tested function to call, not a rule to re-derive.

**Resolver, data and numbers.**
T-U3 `resolveGameweekView` — all five branches, three `?gw=` rejection modes, cron-lag case.
T-U4 membership-history collapse; T-U4a `active→void→active`; T-U4b `active→void→excluded`.
T-U5 eligibility join by gameweek number across **both** boundaries (D5): member-eligible and
league-eligible → eligible; member-eligible but the **league** boundary is a later gameweek →
ineligible; league boundary null → ineligible for every member; league boundary equal to the target
gameweek → eligible; league boundary earlier but member boundary later → ineligible. T-U5a null
`member_competitions.eligible_from_gameweek_id` excluded and `left_at` respected; T-U5b numerator/pot
pre- versus post-deadline and invalid never staking.
T-U6 pot / deadline read from the snapshot, not live config; T-U6a/b/c M3 for `initial`,
`result_revision`, `membership_change`.
T-U7 `lib/ist.ts` formats a known instant to the expected IST string across a full year.
T-U8 `net-balance` signs, and returns "suppressed" for a dirty contest.
T-U9 `model-chips` maps `topScores` to chips correctly **and has no caller in Phase 3** (import-graph
assertion).
T-U10 `gw-live` against engine output for five input shapes (U15); provisional money is never returned
to the view layer.
**T-U11** byte-unchanged guard on `lib/settlement.ts`, `lib/settle-contest.ts`,
`lib/gameweek-points.ts`, `lib/gameweek-settle.ts` (checksums pinned).

**Entry sheet.**
T-U12–T-U17: stepper clamp at 0–9, completeness, **first save posts one `/api/gw/enter` with all
picks** (T-U14 asserts exactly one request and no `/picks` call), edit save posts `/api/gw/picks`,
error mapping (U21), sessionStorage cleared on save.

**Copy.**
**T-U18** every export of `lib/gw-copy.ts` **and the generated output of every parameterized builder**
with representative values: no `bet|wager|gamble|punt`, no `!`, no straight apostrophes, no hyphenated
scoreline. **T-U18a** every CL × VP render path has copy for header, sub and CTA. **T-U18b** source
scan over the files in `tests/phase3/copy-scan-manifest.json` (§4) in **both** modes: bare JSX literals
in the `.tsx` entries, and returned string / template literals in the four `.ts` copy producers
(`join/actions.ts`, `new/actions.ts`, `lib/copy-last-week.ts`, `lib/ist.ts`), with an allowlist limited
to class names, `aria` role values, test ids, punctuation-only separators and the structural non-copy
literals §4 names. **T-U18c** the manifest equals the enumerated candidate set — changed `app/` and
`components/` `.tsx` files, plus the two action `.ts` files, plus the three named `lib/` producers —
between the manifest's fixed `baseRef` (the Phase 2 merge commit) and `HEAD`, minus the stated
exclusions; every manifest path exists and declares a valid mode.

**Season, home, join, branch.**
T-U20–T-U24 season table: running totals, departed members, pill filters, gameweek links; **T-U20a** a
void gameweek still increments gameweeks-entered (D7a); T-U24a dirty rows suppress money **and the
running totals they feed** (U26a).
T-U25–T-U28 home cards: the eight badge states, named CTAs (C68), cup-format fallback, net money.
**T-U25a** the home-badge **lifecycle × participation** cross-product: `ACTION NEEDED` appears only at
CL1 + VP3, and every VP under CL2 / CL3 / CL4 / CL5 / CL6 / CL7 / CL8 yields the lifecycle badge —
explicitly including CL2 + VP3 → `LOCKED`, which is the cron-lag case.
T-U29–T-U31 competition picker: active-only, zero-active guard; **T-U31a** the `InviteDTO`
participation union — all three arms (`active`, `archived`, `none`), the competition fields present on
the first two and **absent as keys** on `none`, C69 on `archived`, C70 on `none`, join offered with the
ante only on `active` and join-membership still permitted on `none`.
**T-U35** `StatusBadge` legacy pin: every existing state's label and class byte-identical, including
the `no_separation` void case, with the new gameweek variant present.
**T-U36** `resolveLeagueParticipation` precedence: active-PL, archived-WC-only, both, none.

### 13.2 Browser (chrome-devtools-axi against staging)
**T-B0 (gate)** No writes to Solid Yenne Boys, KK Bois or PES Bois, ever. All write tests run in the
scratch league.

**axi session convention.** Each browser worker runs its own session so parallel workers never share a
page: `CHROME_DEVTOOLS_AXI_SESSION=worker-p3-<n>` (`worker-p3-1`, `worker-p3-2`, …). A worker never
touches another worker's session name, and a crashed run is retried under the same name.

**Setup.** `scripts/qa-p3-seed.mjs` (untracked, per repo convention) creates league **`ZZ-P3`** with
five seeded members and a synthetic PL competition covering: an open gameweek, a
stored-open-past-deadline gameweek, a locked gameweek with no finals, a partial-final gameweek, an
all-final-unsettled gameweek, a settled gameweek, a **dirty** settled gameweek, a void gameweek (0
entrants), a void gameweek (1 entrant + 1 invalid), a **dirty void** gameweek, an **all-fixtures-void**
gameweek with no results row (CL10), a terminal gameweek with no results row, and a blank gameweek. It
also seeds one `needs_update` entry **past its deadline** (the cron-lag badge case), one `invalid`
entry, one mid-season joiner, one departed member, and a league whose `league_competitions`
`eligible_from_gameweek_id` starts mid-season so the league-boundary half of D5 is exercised.

**Dirty-gameweek seeding, corrected.** Only the **dirty settled** gameweek gets a stored
`gameweek_entry_results` snapshot whose points differ from the current provisional points. v3 asked for
that on the dirty *void* gameweek too, which the seed cannot produce: Phase 2 §0.3 writes per-entry
result rows **only** for `outcome='settled'`, and a settlement that changes to void deletes any earlier
snapshot. So the **dirty void** gameweek is seeded with `gameweek_results` (`outcome='void'`,
`input_version > settled_version`) and **no entry-result rows at all** — which is the reachable dirty-void
state and the one T-B22b tests. Settled→void divergence is covered as a pair instead: the same contest
observed as **CL6 before finalization** (settled snapshot still present, already dirty) and **CL7 after
finalization** (re-settled to void, snapshot gone). Staging is `cashford-staging.vercel.app` — the custom domain bypasses Vercel SSO;
the app login still needs a seeded test account.

T-B1–T-B12 walk each CL state and assert header, sub, CTA and standings copy.
T-B13 the CL × VP cases that only exist in the browser: invalid viewer on a settled gameweek,
non-entered viewer on a settled gameweek, VP0 on an open gameweek.
T-B14 the stake appears on the CTA button.
T-B15 entering is one tap and **one** network call to `/api/gw/enter`, no confirm sheet (network
assertion).
T-B16 edit-in-place keeps last saved picks.
**T-B17′ sentinel-pick leak test.** Seed another member's picks with a unique sentinel scoreline token.
Pre-deadline, assert the token is absent from the raw HTML, the RSC flight payload **and** every
network response body. Post-deadline, assert it is present. This is the executable form of D4.
T-B18 the `needs_update` nudge and its CTA.
T-B19 an invalid entry is visible with C48–C50 and no money.
T-B20 live provisional count; no money rendered.
T-B21 settled money signed.
T-B22 **a dirty settled gameweek renders C60 with no money anywhere on the page**, including the home
card.
**T-B22a — dirty settled, divergent points.** The seed sets the stored `gameweek_entry_results`
snapshot to points that differ from what the corrected scores now produce. Assert on the Gameweek tab
that the **current** points render and the snapshot numbers appear nowhere, on the Season tab that the
running total is suppressed with C60, on home that the card shows `RECALCULATING` (C71) with no net
money, and on the Dues tab that the WC figures are unchanged (the PL Dues surface is Phase 5, where
this case is re-run against the real route).
**T-B22b — dirty void, no snapshot.** A void gameweek whose re-settlement is pending, seeded the only
way Phase 2 permits: a dirty `gameweek_results` row with `outcome='void'` and **no entry-result rows**.
Assert the current provisional points render when they are computable and that **no** points render when
they are not (never a fallback to zero), plus C60, the `RECALCULATING` badge, the void reason still
visible, and no money on the Gameweek tab, Season tab or home card.
**T-B22c — settled→void divergence as a pair.** The same contest at two moments: **CL6** before
finalization, where the stale settled snapshot exists and must not be read (current points render
instead), and **CL7** after finalization, where the snapshot is gone and the void money line is final.
This is the divergence case v3 tried to express as a single impossible seed.
T-B23′ a seeded `fixture_insights` row for an open-gameweek fixture produces **no chip row** (replaces
the skipped T-B23; D-EN5).
T-B24 void reasons for 0 and 1 entrant, incl. PR9.
T-B25 terminal-without-results renders C64 and no numbers.
T-B26 blank gameweek (CL0 — no contest, or no fixtures of any state); T-B26a the double-gameweek note;
**T-B26b** the all-fixtures-void gameweek with no result row renders C72, no standings and no money —
distinct from T-B26's blank state, which is the pairing that proves CL10 is reachable in the browser and
not just in the unit fixtures.
T-B27 the mirror prompt appears only with another eligible league and rejects a changed stake.
T-B28 a Season tab gameweek link round-trips to the right gameweek.
T-B29 every new screen in dark and light.
T-B30 the deadline renders in IST with JS disabled, **and the entry sheet is inert** (E20).
T-B31 `?gw=` invalid, foreign and non-numeric all fall through without a 500.

**T-B32 — WC regression, baselined (replaces v1's single unspecified T-B26).**
- Baselines are captured **before** the U1 move, on the same commit, at a fixed **390×844** viewport,
  in **both themes**, with `prefers-reduced-motion: reduce` forced and animations disabled.
- Coverage: every WC league tab (all five, client-side switched), a match link navigation, the manage
  link, and the league header.
- Diff threshold: **≤0.1 %** differing pixels per capture, zero tolerance for layout-shifting diffs.
- **T-B32a** cup-versus-league branch: a WC-only league renders the cup view; a PL league renders the
  gameweek view; a league with both renders the gameweek view (U1 precedence).

---

## §14 Resolved decisions (v1 review — unchanged, plus E20)

| ID | Question | Resolution |
|---|---|---|
| Q1 | Table tab timing | **Phase 4.** Data source is the Phase 4 standings pipeline. Phase 3's shell reserves the slot (§0.2, U11). |
| Q2 | `needs_update` / `invalid` copy | **C44–C50 adopted as drafted**, pending Ananth sign-off alongside decisions-log #17 (§4.2). Implementation proceeds. |
| Q3 | Entered denominator | **D5 wins** — eligible members, not `league_members`. Mockup counts were illustrative (§4.3). |
| Q4 | Competition chip | **Non-interactive in Phase 3** (U34). |
| Q5 | Stepper clamp | **0–9 confirmed**; the DB allows 0–99, so raising it later needs no migration (U18). |
| D-EN5 | Model chips vs Phase 4 insights | **Steppers-only in Phase 3**, now enforced unconditionally (§0.3). |
| E20 | No-JS entry | **Drop the no-JS submission claim** (Sol finding 4, option 2). A money write gets no form-post variant; the server-rendered deadline stays. |

---

## §15 Sequencing, with a dependency gate on every stage

| Stage | Work | Gate |
|---|---|---|
| 1 | Tokens, `CLASS-MAP.md`, `StatusBadge` gameweek variant + T-U35 | **None** — proceeds while D-EN1 is blocked |
| 2 | Pure libraries: `gw-state.ts` (CL / VP / PR), `gw-copy.ts`, `gw-fixtures.ts`, `gw-eligibility.ts`, `gw-live.ts`, `ist.ts`, `model-chips.ts`, with T-U1–T-U11 and T-U18* | **None** — pure functions over fixtures |
| 3 | League shell + Gameweek tab read-only lifecycles (CL0–CL10) | **D-EN1 + D-EN2** |
| 4 | Entry sheet and write path (CL1 × VP1–VP3) | **D-EN1 + D-EN2 + D-EN3** |
| 5 | Season tab | **D-EN1 + D-EN2** |
| 6 | App home cards | **D-EN1 + D-EN2** |
| 7 | Create / join + `resolveInvite` extension | **D-EN1** |
| 8 | Edge sweep, both themes, browser suite | **All of D-EN1–D-EN3 + seeded staging** |

**Only stages 1 and 2 can start while D-EN1 is human-blocked** (decisions-log #16), plus any isolated
component built against fixtures. **No staging acceptance criterion can be met before D-EN1 is
applied** — reporting Phase 3 "done" from stages 1–2 alone would be false.

**Stage 2 Sol review gate.** Stage 2 is reviewed by Sol before stage 3 begins, run through the
orchestrator pipeline (`codex exec` in tmux with prompt / output files under the session scratchpad,
per decisions-log #1). Stage 2 now carries the whole state model, so a wrong precedence rule or a wrong
eligibility join would propagate into every screen.

Stages 5–7 can run in parallel once stage 3 lands.

---

## §16 Acceptance criteria
- **A** Every CL0–CL10 lifecycle and every PR1–PR9 (PR3a/PR3b included) precedence rule is reachable on
  seeded staging and matches §5's copy exactly, verified in the browser, not from a build. "Reachable"
  includes CL10: T-U1b and T-B26b must show a zero-active gameweek landing there rather than in CL2.
- **B** No file listed in S1 changed — T-U11 green with pinned checksums; `StatusBadge`'s legacy labels
  and classes pinned by T-U35.
- **C** `npm run typecheck`, `npm run build`, `npx vitest run` all green with **no skipped tests** —
  v1's one skip (T-B23) is gone, replaced by T-B23′.
- **D** T-U18, T-U18a, T-U18b and T-U18c pass: no banned word, no exclamation mark, no straight
  apostrophe, no hyphenated scoreline, no un-exported user-visible literal in any manifest file, and the
  manifest matches the changed UI and copy files from its fixed `baseRef`.
- **E** T-B17′ passes: a sentinel pick from another member is absent from HTML, the RSC payload and all
  network bodies before the deadline, and present after it.
- **F** No money string renders anywhere for a dirty (CL6 / CL8) contest — page, standings, season row,
  season running totals or home card (T-B22, T-B22a, T-B22b, T-B22c, T-U2a, T-U2d) — and no dirty render
  shows snapshot points (T-U2c). PL Dues is **out of Phase 3 scope** and covered by X-P5-1 instead; this
  criterion does not claim it.
- **G** First save issues exactly one `/api/gw/enter` request carrying all picks (T-U14, T-B15).
- **H** WC regression: every baselined capture within the 0.1 % threshold across five tabs, two themes
  and both navigations (T-B32), plus the branch test (T-B32a).
- **I** Every new screen passes in dark and light (T-B29); the deadline shows in IST with JS off and the
  sheet is inert (T-B30).
- **J** Zero writes to the three real leagues across the whole suite (T-B0).

---

## §17 Sol findings mapping

### 17.1 Round 1 (14 findings, folded into v2)

| # | Severity | Finding | Where it landed |
|---|---|---|---|
| 1 | Blocker | D-EN4 / U3 depend on a nonexistent `gameweeks.is_current` and a nonexistent helper | D-EN4 re-marked Phase 3 work; **U3** rewritten as `resolveGameweekView` over `gameweek_contests` + `gameweeks.status` / `deadline_at`, with validated `?gw=`, void included in terminal, and the cron-lag branch. T-U3, E13, E24 |
| 2 | Blocker | GS1–GS11 miss reachable Phase 2 states | **§5 split into CL0–CL9 × VP0–VP5 with precedence PR1–PR9.** `deadline_at <= now` = closed (PR1); dirty = recalculating with money suppressed (PR3). The GS table is deleted. T-U1, T-U2 (full cross-product), T-U2a/b, T-B13 |
| 3 | Blocker | M3's cause is not derivable from allowed reads | **M3 reads `gameweek_results.last_settle_cause`** (D-EN6; Phase 2 §0.3 amended), with cause-neutral C63 as the degradation. C61–C63, T-U6a/b/c |
| 4 | Blocker | U20 contradicts the atomic-entry contract; E20's no-JS post is not implementable | **U20 is one `/api/gw/enter` call with all picks**; edits post `/picks`. **E20 resolved by option 2**: the no-JS submission claim is dropped, the server-rendered deadline stays. §0.2, §14, T-U14, T-B15, T-B30 |
| 5 | Blocker | The read plan does not make D4 executable; D1 overstates RLS | **§2.1** states which tables RLS scopes and which are global reference reads. **R1 / R2 / R3 two-stage plan**; picks never embedded in the entries query; other-member picks queried only post-deadline. **T-B17′** sentinel-pick leak test over HTML, RSC and network bodies |
| 6 | Should-fix | D5 names nonexistent fields; derived-number contracts incomplete | **D5** rewritten as the number-based join on `eligible_from_gameweek_id` with null excluded and `left_at is null`. **D5a** defines numerator and pot by entry status. **D7a** counts season participation from `locked_in` entries incl. void gameweeks. T-U5, T-U5a, T-U5b, T-U20a |
| 7 | Should-fix | D6's loader cannot collapse effective state | **D6** loads all membership history, collapses once by `fixture_id`, and feeds one result to progress, standings, live scoring, rows and settlement input. R2(b), T-U4a, T-U4b |
| 8 | Should-fix | U15 underspecified; T-U10 can pass with a second scoring path | **U15** calls `settleGameweek` only, over final active **plus** effective-void fixtures; provisional money never reaches the view layer. **T-U10** tests five input shapes against engine output |
| 9 | Should-fix | D-EN5 does not enforce steppers-only | **Chips off unconditionally**: the entry page never queries insights, `ScoreChips` is not mounted, `model-chips` is a caller-less tested mapper over `topScores`. The `modelFromOdds`-over-`InsightsView` error is corrected. **T-B23′**, T-U9, E19 |
| 10 | Should-fix | §15 understates the blockers | **§15 is now a per-stage gate table**; stages 3, 5, 6 need D-EN1 + D-EN2, stage 4 adds D-EN3, stage 7 needs D-EN1; only stages 1–2 may proceed while blocked, and no staging acceptance may begin |
| 11 | Should-fix | Branch and service-role inventory not tight enough | **U1** resolves active participation first, archived fallback second. **§2.4** splits service-role usage into D8 (new path, one read, IDs from RLS-scoped rows), D8a (preserved cup reads) and D8b (preserved create / invite reads). T-U36 |
| 12 | Should-fix | T-B26 and shared-component reuse don't guard the WC surface | **T-B32** baselined at 390×844, both themes, motion disabled, ≤0.1 % threshold, five tabs plus match and manage navigation; **T-B32a** branch test. **U36a** adds a typed gameweek `StatusBadge` variant with legacy labels pinned by T-U35 |
| 13 | Should-fix | The copy test does not enforce the copy system | **C-RULE**: every literal gets an export, parameterized builders are tested on generated output, and **T-U18b** source-scans the new pages / components with a narrow allowlist. C58–C70 give the previously-inline strings IDs |
| 14 | Should-fix | U33 relies on data the invite DTO does not return | **U33** extends `resolveInvite` with `competitionId`, `competitionName`, `competitionFormat`, `participationStatus` and the active-versus-archived precedence. D-EN8, C69, T-U31a |

Round 2 closed 11 of the 14: only 6, 13 and 14 carried over, joined by three new findings. All six are
folded into v3 below.

### 17.2 Round 2 (3 carried over + 3 new, folded into v3)
| # | Severity | Sol's finding | v3 change |
|---|---|---|---|
| R2-1 | Blocker (new) | The CL0–CL9 condition table can return two states or none — six reachable Phase 2 overlaps, plus past-deadline stored-`open`-all-final matching nothing | **§5.1 replaced by an ordered, mutually exclusive decision tree**: corrupt-without-result → dirty → clean result → true blank → pre-deadline → post-deadline fixture progress. CL4 accepts stored `open`/`locked`/`settling`. True blank redefined as no active **and** no void fixtures; the all-void-without-result state gets **CL10** and **C72**. `gameweek_results` is always loaded, `settling` included. **T-U1a** tests all six overlaps, the all-final-stored-open case and exclusivity as a property. *(v3's CL10 placement was still wrong — see R3-1.)* |
| R2-2 | Blocker (new) | Dirty rendering guaranteed neither current data nor complete money suppression — `gameweek_entry_results` would show stale points, and Season / Dues could keep stale money | **PR3a**: CL6/CL8 points and ranks come from the current `gw-live` input through `settleGameweek`, never the entry-result snapshot, which R2 (h) drops from the DTO entirely; if the live input can't be computed, points are suppressed too. **PR3b**: dirtiness propagates to Season running totals, per-member season money, the home net line and PL Dues balances **and** settle plan, each showing C60; **WC Dues unchanged**. The predicate lives once in `lib/net-balance.ts`, which the Phase 5 Dues route inherits. T-U2c, T-U2d, T-U8, T-B22a, T-B22b |
| R2-3 | Blocker (new) | The home badge could show an impossible action after the deadline — `ACTION NEEDED` keyed off VP3 alone, and cron lag leaves `needs_update` past the deadline | **U28**: `ACTION NEEDED` = **CL1 + VP3**; after the deadline the lifecycle badge wins for every VP, so CL2 + VP3 renders `LOCKED`. **T-U25a** covers the lifecycle × participation badge cross-product, cron-lag case named |
| R2-4 | Carried (6) | D5 omitted the league's own `league_competitions.eligible_from_gameweek_id` boundary that Phase 2 L9 enforces, so the UI could offer entry the API refuses | **D5** now requires **both** boundaries to resolve to gameweek numbers ≤ the target, with `left_at is null`; **null on either side means ineligible**. **T-U5** extended with league-boundary null / equal / later cases and league-early-member-late. The seed gains a mid-season league boundary |
| R2-5 | Carried (13) | `RECALCULATING` had no copy export, and T-U18b's `app/leagues/**` scope included the verbatim `_cup` move and unrelated legacy routes, which no allowlist can rescue | **C71** exports `RECALCULATING` (and **C72** the CL10 string). **T-U18b** now scans an **explicit file list** — the Phase 3 routes and components plus the new gameweek branch of `components/ui.tsx` — excluding `_cup/**` and unchanged legacy routes. **T-U18c** asserts the list covers the whole Phase 3 diff. *(v3's "list" was still globs — see R3-3.)* |
| R2-6 | Carried (14) | The invite DTO added non-null competition fields to the `active` variant without a shape for the no-participation case | **U33** uses a **nested discriminated participation union**: `active` / `archived` carry the competition fields, `none` has no competition keys at all. `none` renders **C70** and **still allows joining membership**. **T-U31a** tests all three arms |

### 17.3 Round 3 (3 findings, folded into v4)
Round 3 closed the badge, dual-boundary and invite-union findings (R2-3, R2-4, R2-6). Three remained.

| # | Severity | Sol's finding | v4 change |
|---|---|---|---|
| R3-1 | Blocker | CL10 was unreachable: over an **empty** active set both CL2 ("none final") and CL4 ("all final") are vacuously true, and both sat before CL10, so T-U1a expected a state the tree could not return | **CL10 moved to step 6** — after CL1, before CL2 — and **CL2, CL3 and CL4 now require ≥1 active fixture**, fixing it from both directions. New **T-U1b** pins the three zero-active inputs (CL10, CL7 with a void result, CL1 pre-deadline) and asserts none returns CL2 or CL4; **T-B26b** is the browser half, paired with T-B26's genuine blank |
| R3-2a | Blocker | "PR3b is carried into Phase 5" was a claim about a document that contains no dirty state, no version read and no suppression — Phase 5 §2 sums `gameweek_entry_results` and calls the settle plan directly, so stale PL money would surface during re-settlement | Restated as **§5.3a X-P5-1**, a named cross-plan requirement: the Phase 5 Dues loader must read `input_version` / `settled_version`, apply the **shared predicate from `lib/net-balance.ts`**, and return `recalculating` **before** computing combined balances, per-member balances or the debt-simplification plan, with dirty-settled and dirty-void unit and browser cases. Marked **enforced by the orchestrator, tracked in the decisions log**, with Phase 3 owning only the predicate and its proof (T-U8, T-U2d) — and an explicit note that **completing Phase 3 does not satisfy or close X-P5-1 — Phase 5 must implement and pass it independently** |
| R3-2b | Blocker | The seed gave the dirty **void** gameweek divergent stored snapshot points, which Phase 2 §0.3 forbids: entry-result rows exist only for `outcome='settled'`, and a change to void deletes them | Divergent-snapshot seeding is now **dirty-settled only**. The dirty-void gameweek is seeded the reachable way — dirty `gameweek_results` with `outcome='void'` and **no entry-result rows** — and **T-B22b** asserts current provisional points when computable, **no** points when not (never zero), plus C60, the badge, the void reason and no money. Settled→void divergence moves to **T-B22c** as a pair: **CL6** before finalization, **CL7** after. PR3a gains the note that CL8 has no snapshot to read |
| R3-3 | Blocker | T-U18b called itself an explicit list but used `(gw)/**`, `new/**`, `components/gw/**`; the `(gw)` route group contradicts §1.1; `app/page.tsx` and `lib/copy-last-week.ts` were outside the scan; T-U18c named no base revision | Scope is now a checked-in manifest, **`tests/phase3/copy-scan-manifest.json`**, listing **exact paths** on the §1.1 flat route tree — every page, every `components/gw` component, the `components/ui.tsx` gameweek branch, and every copy producer including `lib/copy-last-week.ts` and `lib/ist.ts`. §1.1 now also lists the six pre-existing files Phase 3 rewrites and states there is **no route group and no league `layout.tsx`**, so §1.1, U2 and §4 share one tree. **T-U18c** compares the manifest against `git diff` from a **fixed `baseRef`** (the Phase 2 merge commit) recorded in the manifest, minus explicit exclusions, and asserts every manifest path exists. `_cup` stays under its own byte-unchanged guard |

### 17.4 Round 4 (2 findings, folded into v5)
| # | Severity | Sol's finding | v5 change |
|---|---|---|---|
| R4-1 | Blocker | §5.3a stated the X-P5-1 implication **backwards** — "Phase 3 must not be marked complete on the strength of X-P5-1 being satisfied" guards the wrong direction and would let Phase 3 closure read as closing the Phase 5 obligation | §5.3a now reads: **"Completing Phase 3 does not satisfy or close X-P5-1. Phase 5 must implement and pass X-P5-1 independently."** §17.3's R3-2a row carries the same sentence, so the two sections agree |
| R4-2 | Blocker | The manifest was not an enforceable contract: T-U18b scanned only bare **JSX** literals, so the four `.ts` copy producers (`join/actions.ts`, `new/actions.ts`, `lib/copy-last-week.ts`, `lib/ist.ts`) were listed but never actually scanned, and T-U18c's "`.tsx` app/component filter" left them ambiguous. The inventory sentence also said "four" while naming five files and omitted `components/ui.tsx` | **T-U18b gains two modes**: `jsx` for the `.tsx` entries (JSX children plus user-visible props) and `strings` for the four named `.ts` producers (returned string and template literals), each entry tagged in the manifest, with structural non-copy literals — `Intl` options, locale and zone ids, table and column names, status discriminants, route paths, internal error codes — explicitly allowed. **T-U18c's candidate set is enumerated**: changed `app/` and `components/` `.tsx` files **plus** the two action `.ts` files **plus** the three named `lib/` producers, minus exclusions; it also asserts each entry declares a valid mode. The inventory now says **six** rewritten files and lists `components/ui.tsx` |

**Round 5 addendum (v6).** R4-1 closed. R4-2 left one contradiction: §1.1 and §4 still called the
manifest "§1.1's new files plus the six rewritten files", which competes with T-U18c as the definition,
and §4 said unmarked entries default to `jsx`, which competes with T-U18c's assertion that every entry
declares a mode. Both now read the single way: **the manifest is exactly the candidate set defined by
T-U18c, with the six rewritten files included where they meet that definition, and every manifest entry
explicitly declares `jsx` or `strings`.**
