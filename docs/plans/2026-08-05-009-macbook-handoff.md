# MacBook Pro handoff — Cashford 2.0 build

Written 5 Aug 2026 on the MacBook Air, for the fresh Claude session on the
MacBook Pro (`am10@Ananths-MacBook-Pro`). The Air goes offline after this.
Read this file first, then `CLAUDE.md` (repo root) for standing rules.

## Where things stand

- `main` at `0e3528c` is pushed and deployed (v102 hotfix line). Prod is healthy.
- Design decisions for the next build round are LOCKED. The single source of
  truth is **`docs/design/2026-08-05-feedback-r1-reference.html`** — decisions
  table, final frames, and global build rules. Build agents must follow it;
  the throwaway option files in `docs/design/throwaway/feedback-r1/` are
  history, not spec.
- This machine's copy of the repo was mirrored from the Air on 5 Aug
  (rsync, includes untracked ops scripts and `.env.local`).

## Locked decisions (summary — the reference file has the frames)

| Screen | Decision |
|---|---|
| Home & Matches | Inline hub layout A; competition scope chips when leagues span competitions; GW navigator A (segmented strip, jump to any GW); entry-status copy A ("entry submitted", 8-state table is canon); fixture list B (day accordions, complete); table A (20 full rows, live rows highlighted) |
| Analytics | Top tab, no internal tabs; sticky filter row, one aggregate feed (A); per-season sections for cross-competition (B); my-form scoped to one league (A) |
| League card | Option B (split card), all 10 states; open-GW action owns the primary block; other-GW facts demote to a slim strip; dues chip additive |
| League screen | Client-side tab swaps; Season tab A (summary header + newest-first GW history, no current-GW panel); table standard B with sticky first column; GW navigation B (chevrons + all-gameweeks sheet) |
| Entry & Create | 0-0 default picks, muted until touched, "N picks left at 0-0" confirm guard; quick-score chips centered; stacked score rows (name and score centered per box); friendly datetime |

Global rules (also at the end of the reference file): friendly datetime
everywhere in the user's local timezone; the table standard applies to every
table; no collapsed or summary rows anywhere; tab switches never reload the
page; Bracket tab removed from home.

**Sticky column implementation note:** `position: sticky` fails on grid items
(trapped in their grid area) and under row-level horizontal padding. Use flex
rows and put the horizontal inset on the first/last cells. Details in
`implementation-notes.md` (5 Aug entry).

## Proposed build order (align with Ananth before starting)

1. **#12 Route smoke pass** — authed pages against the real DB. Catches the
   PostgREST select-string failure class (v101/v102) that tsc and vitest miss.
   Do this first; it protects everything after it.
2. **Foundations** — shared datetime formatter (local tz), table-standard
   component (sticky column), entry-status copy constants. Plus the two
   one-liners: #14 hide Analytics tab pre-GW1, remove Bracket tab.
3. **League screen** — client-side tab swaps, Season tab A, GW navigation B,
   table standard applied. Also fix the empty Gameweeks sub-tab bug (query
   works — cause still unknown, diagnose here).
4. **League card Option B** — all 10 states.
5. **Entry sheet + create league** — 0-0 defaults, chips, stacked rows,
   datetime. Fix the "You'll predict all 10 scorelines" copy (count is per-GW).
6. **Home & Matches hub** — the biggest piece; layout A + navigator +
   complete lists/table + multi-competition scope.
7. **#15 Transition fix batch** — archive top bar variant C
   (`docs/design/throwaway/archive-topbar-variants-CD.html`) + the 8 ranked
   archive gaps from the archive review.
8. **Analytics** — structure A, cross-comp B, my-form A.
9. **#13 /rules rewrite** for the gameweek format; **#16 match detail UI**
   (replace the JSON dumps with designed insight modules).

## Delegation per step

| Step | Builder | Reviewer | QC |
|---|---|---|---|
| 1. #12 Route smoke pass | Luna | Opus (harness design: it must fail on the v101/v102 class) | The run itself — execute against the real DB, read-only, all three real leagues + ZZ-P1 |
| 2. Foundations (datetime, table component, copy constants, #14, bracket removal) | Luna | Opus | Vitest units + chrome-devtools-axi render of a /dev harness page |
| 3. League screen | Luna | Terra (tab-swap architecture, GW navigation state), Opus second pass | Orchestrator in Ananth's Chrome on ZZ-P1 (GW1–4 states are pre-seeded for this) |
| 4. League card | Luna | Opus (10 states vs reference frames) | Ananth's Chrome: ZZ-P1 covers open/settled/compound; archive states via KK Bois read-only |
| 5. Entry sheet + create league | Luna | Opus | Ananth's Chrome, writes in ZZ-P1 only; verify 0-0 guard copy against the reference |
| 6. Home & Matches hub | Luna (split into two dispatches: hub+navigator, then lists+table) | Terra (biggest surface, multi-competition scoping), Opus second pass | Ananth's Chrome; live-row highlight needs a real live GW or mocked /dev page |
| 7. #15 Transition batch | Luna | Terra + Opus dual review (adoption touches money paths) | Staging deploy + Ananth's Chrome on archive routes; re-run smoke pass |
| 8. Analytics | Luna | Opus | Ananth's Chrome; cross-competition sections need a league with WC history (read-only on real leagues) |
| 9. #13 /rules + #16 match detail | /rules: Sonnet (content, per plain-writing rules), Ananth approves copy. Match detail: Luna, Opus review | Render check + Ananth's Chrome on a real fixture with insights |

Standing rules across all steps: orchestrator runs typecheck + build + vitest
after every step; re-run the #12 smoke pass after each merge once it exists;
nothing touches settlement/scoring without strong tests; all UI QC on authed
pages happens in Ananth's logged-in Chrome (claude-in-chrome), never
chrome-devtools-axi.

## Machine and ops facts

- Delegation: Luna/Terra/Sol agent defs are in `~/.claude/agents/`;
  `~/.codex/AGENTS.md` pointer is in place; codex CLI is symlinked from
  ChatGPT.app and already authenticated. gh is logged in as ananthmenon10.
  Chrome + chrome-devtools-axi installed.
- ZZ-P1 test league is still seeded at GW4 for design review. Revert with:
  `node --env-file=.env.local scripts/zzp1-review/restore.mjs --confirm`
  (manifest: `scripts/zzp1-review/zzp1-review-manifest.json`).
- Demo kit is parked (`scripts/demo-seed/`), proven, ~5 min to set up on a
  green light.
- Real leagues — never write-test: Solid Yenne Boys, KK Bois, PES Bois.
- Secrets: `.env.local` carries a temporary `CASHFORD_ANANTH_PASSWORD` line —
  remind Ananth to remove it after demo testing. Regenerate the Supabase
  `sbp_` PAT at season start.
- Verify before "done": `npm run typecheck` · `npm run build` ·
  `npx vitest run`. UI QC needs Ananth's logged-in Chrome (claude-in-chrome);
  chrome-devtools-axi is for render checks only.
