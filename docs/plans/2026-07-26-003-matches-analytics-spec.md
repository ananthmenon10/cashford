# Cashford 2.0 — Matches & Analytics tab spec

Date: 2026-07-26 · Follows briefs 001 (product) and 002 (IA, D1–D5).
Produced by Claude + Sol (GPT-5.6) independent takes; decisions confirmed by Ananth.

## Confirmed decisions

1. **Pick reveal**: all entrants' picks for the whole gameweek reveal at the GW deadline —
   including Sunday's fixtures on Friday night. Before the deadline: entrant *names* visible,
   scorelines never. League membership gates all friend data.
2. **Current GW rule** (shared by Matches, league Gameweek tab, and badges): a locked-but-unsettled
   GW is current until it settles; on settlement, focus flips to the next open GW with a compact
   "GW7 settled" recap strip linking back. No GW live → next GW with a future deadline. No future
   GW published → latest settled. Two locked GWs overlapping (postponement edge) → newest is
   current, alert for the older.
3. **Analytics scope**: ALL 7 modules at launch — My form, You vs the room, Receipts, Weekly
   labels, Rivalry, Club reads, Prediction habits. (Overrides the phased recommendation; accepted
   cost: biggest single scope item, most comparative cards show empty states until ~GW3.)
4. **Comparison model**: personal-first. Default view "My form" (rates across all leagues, never
   summed points — mirrored picks would double-count). "League lens" compares against ONE named
   league at a time. No merged cross-league friends table, ever. Official points totals only
   under a named league.

## App-level entry semantics

"Entered" at app level = entered in ≥1 league for that GW. Show the count ("Entered in 2 of 3"),
never a third state. Entry/edit CTAs from app tabs always route to a named league's entry sheet
(ask which league first when ambiguous). No global edit that could silently flatten
different-per-league picks; copying picks always re-consents per league with its ante shown.

## Matches tab

Score-and-schedule hub. Not an entry surface, not the league race. Competition switcher on top;
archived competitions frozen read-only.

### Default landing
- Pre-deadline: current GW grouped by day, entry strip (per-league status) pinned.
- Live: current GW, scrolled to first live fixture (else next kickoff).
- Post-settlement: next open GW + "GW7 settled" recap strip.
- User-selected historical GW persists within the visit; next visit returns to current.
- GW picker spans past/current/published-future; future fixtures marked "subject to change".

### State matrix
| | Not entered (any league) | Entered (≥1 league) |
|---|---|---|
| **Pre-deadline** | Fixtures + kickoffs, no picks. Strip: "Not entered". CTA: Enter GW (league chooser first). | Fixtures + own picks (split per league where they differ). Strip: "Entered in 2 of 3". CTAs: Edit picks (named league) · Enter another league. |
| **Live** | Scores/clocks + revealed league picks (viewable even without entering). Strip: "You sat this one out". No late entry. | Live scores + provisional points chip (0/1/3) beside each own pick; header shows provisional MONEY per entered league with an in-progress indicator ("as it stands: +₹600 in Solid Yenne · P1"). CTA: View live race → league Gameweek. All numbers labeled provisional. |
| **Settled** | Final scores, "Not entered", league-winners recap incl. pot amounts. | Final scores, own picks, final points per pick (Exact/Result/Miss), settled net money per league in the GW header. CTAs: View league recap · Share my calls. |

### Fixture row
State (time / minute+LIVE / FT / Postponed / Void) · crests + names · score (dash pre-kickoff) ·
own-pick line: "Your pick 2–1" · "Your pick 2–1 · 3 leagues" · "Your picks vary · 2–1 in 2 ·
1–1 in 1" (expandable) · "No pick". Live: provisional pts per distinct pick. Post-FT: pts +
Exact/Result/Miss. One-line note for void/corrected. No friend consensus in hub rows (no honest
league context). No odds/insights in rows — small "insights" mark only; full insights live in
match detail and the entry sheet.

### Match detail (opened from hub)
Visible league selector: last league chosen in Matches → else most recently visited league, named
clearly. Never merge leagues into one pick grid. Shows: score/state · own picks across all my
leagues · selected league's entrant picks (names + locked placeholders pre-deadline; scorelines +
points after) · insights · link to that league's Gameweek race. Never edits a single fixture:
pre-deadline "Edit all picks" returns to the league's entry sheet.

## Analytics tab

Explains performance; banter engine. League Season tab keeps the official record (standings, GW
history, pots). Analytics has no standings, no money, no schedule.

### Default landing
Season-to-date **My form** (not a GW). Live weeks: cards frozen at last settled GW + live strip
linking to the race. After settlement: recalc + "GW8 added" change card pinned until opened once.
Competition choice persists; view always resets to My form (not a previous friend comparison).

### State matrix
| | Not entered | Entered |
|---|---|---|
| **Pre-deadline** | Stats through last settled GW. Strip: "GW8 · not entered" + Enter CTA. Never-entered → no-data state, not zeroes. | Settled stats. Strip: "Entered in 2 of 3". Current picks never exposed in comparative cards. |
| **Live** | Cards frozen. Strip: "GW8 live · you sat out". No provisional analytics anywhere. | Cards frozen. Strip: "GW8 live · updates after settlement" + Follow live race. |
| **Settled** | No new personal sample; league lens updates with friends' results. Strip: "No entry in GW8". | Full refresh, "GW8 added" lead card (points/league, exacts, biggest gain, biggest miss). CTAs: See breakdown · Share receipt. |

### Modules (all at launch, priority order)
1. **My form** — avg pts/fixture, result rate, exact rate, avg goal miss, 5-GW form line;
   records (best GW, longest streak) at its foot. Shareable hot/cold summary.
2. **You vs the room** (league lens) — deltas vs league average on exact rate, result rate, goal
   miss, last-5 form. Differences, not another table.
3. **Receipts** — settled calls with social weight: right against consensus, unique exact, big
   miss vs heavy consensus, largest swing vs rival. Named GW/fixture/league; share cards.
4. **Weekly labels** (post-settlement) — Oracle (most exacts), Maverick (scoring non-consensus
   calls), Nearly (one-goal misses), 1–0 Merchant, The Crowd (most modal picks). Hidden under
   3 entrants or too few counted fixtures.
5. **Rivalry** — pick one friend from selected league; only GWs both entered: H2H won/lost/tied,
   exacts, streak, biggest swing.
6. **Club reads** — per club with ≥5 settled picks: result/exact rate, goal miss, league
   comparison ("Arsenal whisperer" / "Can't read Spurs").
7. **Prediction habits** — most-called scoreline, draw rate, home bias, goals predicted vs
   scored, consensus-following rate.

### Empty states
Pre-GW1-settlement: "Your prediction profile starts when GW1 settles" + muted card previews;
CTA Enter GW1 / "You're in; results unlock these cards". Never-entered mid-season: "No submitted
picks yet" + Enter current GW; league lens available but user omitted from awards/comparisons.

## Standing rules (vetoable defaults)

Void fixtures count toward nothing; official corrections recalc affected cards with a visible
"Corrected result" note. GW awards use that GW's entrants, not today's member list; departed
members stay in history. Money in Matches (changed by Ananth 2026-07-26): live provisional
GW money per entered league with in-progress indicator + per-fixture 0/1/3 points chips; settled
GWs show actual net money. Money in Analytics: settled contexts only (pot won in "GW added" card,
season net in My form) — never provisional, cards stay frozen during live play. Debt stays in Dues. Times always absolute local + countdown, never countdown alone. Deep
links carry competition/GW/fixture/optional league, falling back to neutral detail without
friend picks when the viewer lacks league access. Share cards always name competition, GW, and
league; no merged all-friends cards.
