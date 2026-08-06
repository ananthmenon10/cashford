# Task #15 source material — archive gaps and top-bar decision

Recovered verbatim from the 5 Aug review session on the MacBook Air, for the
MBP build session. This is the input for step 7 of the handoff plan
(`2026-08-05-009-macbook-handoff.md`).

## Review context (from the reviewer's headline)

The v100 `contests.competition_id` crash took down the entire archive, not
just Dues — all three archive routes call `loadDuesView` for the
combined-balance line. Fixed in 8afeaa1 (v101) and 9309ac1 (v102), both
shipped and verified. Consequence: **the whole archive journey is
untested-in-prod** — walk all three archive routes plus the captain adoption
sheet with a real logged-in session before trusting anything below.

What the review confirmed as built-to-spec (don't re-litigate): the
league→archive redirect, archived-write guards (triggers + policies), all
three archive views (`ArchiveShell`, standings sort, recap, rules, matches
list, read-only bracket), the adoption routine itself (SECURITY DEFINER,
locks, idempotency), and the competition sheet ordering/hrefs.

## The 8 ranked gaps (verbatim, ranked by user impact)

1. **The adoption prompt exists in one of three promised places, and
   non-captains see nothing.** `CaptainAdoptionSheet` is imported only by the
   archive analytics page. `components/gw/LeagueCard.tsx` and
   `app/leagues/[slug]/manage/page.tsx` have no entry point, and
   `TRANSITION_COPY.memberHeading`/`memberBody` (TC7/TC8,
   `lib/payment-copy.ts:92-93`) render nowhere. A non-captain opening the
   league after the World Cup lands on the archive with no explanation of why
   the season hasn't started and no way to nudge the captain. Biggest hole in
   the journey.

2. **`lib/transition.ts` is dead code.** `transitionState()` is imported only
   by `tests/phase5/transition.test.ts`. The archive page reimplements a
   narrower condition inline (`pl?.data?.status === "active" &&
   !plParticipation.data && isCaptain`). So the §8.4 matrix is not what runs:
   `preparing`, `blocked` and `archived` all collapse to "show nothing", and
   TC10/TC11/TC12 never reach a screen — the sheet surfaces raw Postgres
   `error.message` text instead (`app/api/leagues/[slug]/adopt/route.ts`).
   T-U36 passes against a module the product doesn't use.

3. **Late joiners get fabricated zero rows instead of the "not in this one"
   note (AS1/E26 broken).** AC8 `lateMember`, AC9 `noEntries`, AC10 `noBracket`
   exist in `lib/payment-copy.ts:72-74` and are used by no component. Standings
   are built from every `league_members` row, so someone who joined after the
   World Cup gets a real standings line and a recap reading "Finish #N · 0
   correct · 0 exact · ₹0". Reading their WC history next year, they see an
   invented last place rather than "you weren't here".

4. **One missing fixture result blanks a member's whole archive row (AS4
   diverges).** In the analytics page, any prediction on a fixture without
   `ft_home`/`ft_away` adds that `user_id` to `unavailableUserIds`, and
   `WcFinalStandings` then renders `—` for that member's Correct, Exact *and*
   Net. The plan scoped "unavailable" to the affected money only.

5. **The freeze line prints placeholder text.**
   `ARCHIVE_COPY.freeze("final settlement")` renders "Frozen at the final
   settlement on final settlement." AC4 wanted the date of the latest settled
   WC contest; that query was never written. Visible on the archive landing
   page, first paragraph.

6. **Hard-coded `pl-2026-27`.** The route passes the slug literally and
   ignores any parameter; the archive page's adoption condition also queries
   only that slug. Fine this season, a rewrite next — the routine itself is
   already generic on `p_competition_slug`.

7. **Adoption's pot reselect skips the plan's verification.** §8.2 step 16
   required rejecting unless the reselected `gameweek_contest`'s competition,
   stake and deadline match the intended facts. The migration does
   `on conflict … do nothing` and reselects by `(league_id, gameweek_id)` with
   no equality check, so a pre-existing pot at a different stake would be
   silently adopted. Narrow window, but it's the one place adoption can bind
   money it didn't set.

8. **Archive test coverage is absent.** `tests/phase5/` has `dues-ledger`,
   `dues-view`, `payment-state`, `transition` — nothing for T-U23–T-U30
   (standings order, analytics-derived counts, late joiner, departed member,
   Matches ordering, bracket leaderboard scoping, tab order,
   no-bracket-import), T-U41 (`CompetitionSheet` ordering/hrefs) or T-U43
   (`default_stake_inr` can't move WC history). No Phase 5 copy scan either;
   `tests/phase3/copy-scan.test.ts` doesn't cover `lib/payment-copy.ts`.
   Combined with the prod crash, that's why the archive shipped broken and
   nobody caught it — no test renders these pages.

## Three additional items the reviewer flagged (also in #15 scope)

- **AC11 never renders.** `components/gw/CompetitionSheet.tsx` moves a user
  between the per-gameweek PL world and the per-match WC world with no label
  saying the archive is readable-not-playable and the balance spans both.
  Reviewer called it the "cheapest high-value fix on this list".
- **Dormant `resultByKey` trap.** The archive analytics page keys on
  `contest.id`, but that column isn't in the `contest_results` select — every
  key is `undefined:<user>`, so per-entry `net` is always null. Harmless today
  (nothing reads it), breaks the moment a money-derived stat is added to the
  recap. Same select-string bug family as v101/v102.
- **Departed members are never labelled.** Correctly retained in standings,
  but `PHASE5_UI_COPY.pastMember` renders nowhere (AS3 implied a label).

## Decisions already made (do not re-litigate)

- Reviewer's priority: **gaps 1–3 are what a real league hits within a day of
  the World Cup ending** — fix those first. No formal must-fix/nice-to-have
  split beyond that; Ananth queued the whole set into #15 without trimming.
- Nothing from this list was fixed on the Air before the rsync. The only
  archive-related fixes shipped were the v101/v102 dues-view crashes (context
  above, already in git).
- The pre-GW1 board summary of #15's scope: "variant C top bar, plus the
  archive-journey fixes: non-captain card, state machine wiring, late-joiner
  copy, freeze date, dynamic season slug, and the dormant column-mismatch
  trap" — i.e. all of the above.

## Top bar: variant C decision context

- **What C is**: an archive banner in `ArchiveShell` — names the season being
  read, absorbs the read-only notice, and offers exactly one exit ("go to the
  live season"). Mock: `docs/design/throwaway/archive-topbar-variants-CD.html`
  (untracked, present in the rsynced tree). Copy in that mock is the
  reference; no separate copy decisions were made.
- **Scope**: the archive pages only (all three routes share `ArchiveShell`).
  Not dues, not standings, not the live-league shell.
- **Why C won** (N=6 stress test, `archive-topbar-scale-test.html`): A and C
  stay constant regardless of season count — one banner, one name, one action;
  B (segmented switcher) breaks at 3+ seasons; D (timeline) pays a 554px
  scroll tax that lands on the most important node (the live season). The
  bottom competition sheet stays the "all seasons" browser (active first,
  archived newest-first).
- **Parked idea**: D's timeline is worth reusing later as the *content* of the
  competition sheet, where vertical space is free. Not part of #15.
- Ananth's decision, verbatim: "Go with C, queue it into the fix batch."
