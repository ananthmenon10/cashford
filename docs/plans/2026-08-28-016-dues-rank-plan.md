# Plan 016 — Overall rank = position by league dues

## Why
Home card "Season rank" for Solid Yenne Boys showed Ananth #1. Only GW1 is settled; Ananth and
Rishi tied on points and exacts, and `lib/gw-view.ts` broke the tie by userId string. Ananth
decided: the rank should be the member's position by overall net dues in the league.

## Rule
- Rank every league member by all-time league net (`leagueNetByUser`, lib/gameweek-db.ts:211 —
  the same number the home card already shows as `netInr`; includes World Cup-era contests).
- Highest net = #1. Equal nets share the same rank; the next distinct net skips (1, 2, 2, 4).
- Members with no money movement (net 0) are still ranked.
- If `leagueNetByUser` returns `"suppressed"`, rank is null (card shows "You —").

## Changes
1. `lib/gw-view.ts` — replace the points/exacts/userId `viewerSeasonRank` computation with the
   dues rank above. Rename to `viewerDuesRank` only if cheap; otherwise keep the name and update
   the comment. It needs all members' nets: call `leagueNetByUser(supabase, leagueId, memberIds)`
   (all league_members user ids as seeds).
2. `lib/gw-home.ts:897` — `viewerRank: currentStanding?.rank ?? view.viewerSeasonRank` stays;
   the fallback now means dues rank. Copy `LEAGUE_CARD_COPY`/`seasonPosition` "Season rank" →
   "League rank" (lib/gw-copy.ts:87) if that label is what the card shows in this path.
3. `lib/gw-season.ts` — `totals` sort (line ~551) and the rank shown by
   `components/gw/SeasonTable.tsx:79` (`findIndex + 1`) must use the same dues order and shared
   ranks. Add `netInr` and `rank` to `SeasonMemberTotal` if missing; keep points/exacts columns.
   Rows without entries still sort after rows with entries? No — dues order only; keep
   `suppressed` handling.
4. Tests (Vitest): unit test for the rank helper (put it in `lib/dues-rank.ts`, pure):
   [+200, -100, -100] → ranks 1, 2, 2; [0, 0, 0] → all 1; order independent of userId; suppressed
   → null. Update `lib/gw-home.test.ts` / gw-view tests that assert the old tiebreak.
5. Do not touch lib/settlement.ts, lib/settle-contest.ts, lib/gameweek-settle.ts,
   lib/gameweek-points.ts. Live-week `currentStanding.rank` (points-based, for the live pill) is
   unchanged.

## Verify
`npm run typecheck` · `npx vitest run` · `npm run build`. Expected on Solid Yenne Boys: Rishi #1,
Ananth and Vishwa share #2 on gameweek money only; all-time nets (with WC money) may differ —
that is the intended number.
