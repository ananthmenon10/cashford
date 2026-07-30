# Clean Sheet 2.0 — full product elaboration spec

Every screen of Cashford 2.0 in the chosen design direction (docs/design/throwaway/opus/01-clean-sheet-2.html
is the visual reference — same fonts (Hanken Grotesk + mono numerals), same soft tokens, quiet green =
money/progress, amber = deadline urgency, one design system throughout). Static HTML, throwaway but
high-fidelity. Mobile frames ~390px. These pages define the end product for user testing.

Product truth sources: docs/plans/2026-07-26-001 (rules), -002 (IA, D1-D5), -003 (Matches/Analytics matrices).
Do not invent product behavior; every state below is decided.

## Page structure
One HTML file per surface in docs/design/cleansheet2/. Each file: title, one-line purpose, then phone
frames LEFT-TO-RIGHT showing the states in lifecycle order, each frame captioned with its state name +
the case rules it demonstrates (short, under the frame). A final "Cases & flows" annotation block at the
bottom of each page lists edge cases with how the UI handles them.

## Files

### 01-home.html — App home (3 tabs)
Frames:
A. Leagues tab: 3 league cards showing the badge states — "GW3 · NOT ENTERED · locks Fri 23:00 IST"
   (amber), "GW3 · ENTERED ✓" (green), "GW2 LIVE · you 7 pts · P2" (live pulse). Card = name, net
   balance, competition line, badge, entered-count + pot. Plus create/join.
B. Matches tab, live state: competition switcher, GW navigator, day-grouped fixture rows (FT with my
   pick + points chip, LIVE with minute, upcoming with kickoff), "your picks vary · 2-1 in 2 · 1-1 in 1"
   row, a void row ("postponed → GW14"), provisional money strip per entered league ("as it stands:
   +₹600 in Solid Yenne · P1", in-progress indicator).
C. Matches tab, not-entered viewer: same fixtures, "you sat this one out" strip, no personal points,
   league-winners recap.
D. Analytics tab, My form default: hero card (avg pts/fixture, result %, exact %, avg goal miss,
   5-GW sparkline), league lens selector, "GW8 added" change card, You-vs-room deltas.
E. Analytics empty state (pre-GW1): "Your prediction profile starts when GW1 settles" + muted previews.
Cases block: entered = ≥1 league (count shown); analytics frozen during live; money in analytics only
settled; competition choice persists.

### 02-league-gameweek.html — League → Gameweek tab
Frames: pre-deadline not entered (hero: deadline absolute+countdown, ante/entered/pot, Make predictions;
entrants chips; WhatsApp reminder; last-week recap) · pre-deadline ENTERED (edit picks / withdraw actions,
"your picks" summary) · LIVE (GW leaderboard w/ tiebreak columns, per-fixture breakdown with 0/1/3 chips,
void fixture row explained inline) · SETTLED (winner card, pot, tiebreak explanation "2 exacts vs 1",
net table, settled → Dues note, Go to GW4) · edge frame: VOID GW (1 entrant — ante returned, copy
explains) + blank-GW banner variant ("Only 4 fixtures this week — cup clashes. Pot runs as normal.").
Cases: current-GW rule (settles → flips to next open + recap strip), deadline passed with unsaved edits →
last saved stands, postponed after lock → void chip.

### 03-entry-sheet.html — GW entry flow
Frames: partial (8/10, disabled CTA "Enter gameweek · stakes ₹100 (8/10 picked)", next-missing-pick
jump, one fixture expanded w/ insights) · complete (10/10, enabled CTA) · confirm modal (ante, pot
becomes, edit-until, withdraw note) · ENTERED state (bar: ENTERED ✓, Edit picks / Withdraw, cross-league
mirror prompt "Use these picks in KK Bois (₹50)? PES Bois (₹100)?" as per-league opt-ins) · withdraw
confirm modal (returns ante, picks kept as unsent).
Cases: two states only (no draft — picks local until Enter), late joiner sees next open GW, deadline
mid-edit rule.

### 04-season.html — League → Season tab
Frames: standings (pts, GW wins, exacts, net ₹, tabular numerals, me highlighted) · gameweek history
list (winner + pot per GW, tap → that GW settled view) · early-season state (GW1 only).
Cases: sitting out costs nothing/scores nothing note; points count entered GWs only.

### 05-dues.html — League → Dues tab
Frames: main (ALL COMPETITIONS banner, pending-confirmation card pinned [confirm/dispute], net
leaderboard, settle-up plan payments with "log ›", activity feed with sources "PL GW3 pot · +₹600" /
"WC Final · −₹50" / "payment received ₹300 ✓") · log-payment sheet (payer/receiver/amount/date/note,
partial allowed, overpay warning) · dispute state + reversal entry example ("↩ reversal — logged in
error").
Cases: two-party records only, confirmed = immutable + reversal, no competition switcher here,
GW settling while payment screen open → records typed amount.

### 06-match-detail.html — Match drill-in
Frames: pre-deadline (score dash, my picks across MY leagues, league selector pill, entrant names +
locked placeholders, full insights: odds/form/H2H/table, "Edit all picks → entry sheet" CTA) · live
(minute, league picks board with everyone's scorelines + live 0/1/3, what-if strip) · FT (final points,
Exact/Result/Miss chips).
Cases: league selector = last chosen; never merges leagues; no single-fixture editing.

### 07-archive.html — Competition switcher + WC archive
Frames: switcher sheet (Active: PL 2026-27 · GW3 ✓ / Past: World Cup 2026 — won by Utki, read-only
note) · WC archive league view (ARCHIVED pill, old tabs Matches/Bracket/Analytics, frozen stats,
"rules as they applied then", knockout circle thumbnail, share links note).
Cases: switcher never on Dues; archive fully read-only.

### 00-index.html — Overview + flows
Top: one-paragraph product summary. Then the five key user flows as horizontal step diagrams (simple
numbered chips linking to the pages): 1 Enter a gameweek (home badge → league GW → entry sheet →
confirm → entered → mirror) · 2 Sweat the weekend (Matches live → match detail → league live race) ·
3 Settle up (GW settles → Dues delta → log payment → confirm) · 4 Look back (switcher → WC archive) ·
5 Miss the deadline (badge amber → deadline passes → not-in-this-week state → next GW). Then a linked
card per page. Also a "later skins" note: Broadcast = live surfaces, Quant Desk = Analytics, per-screen
toggle back to Clean Sheet.

## Design tokens (be consistent; these become the real @theme)
Ink #17251d-ish dark green-grey; surface white/off; muted grey-green; accent green #0d7a43 family
(money/progress/positive); amber #b45309 (deadline/attention); red only for dispute/negative money;
radius 12/8; Hanken Grotesk text, mono tabular for all numerals/money; generous spacing; hairline
dividers; soft shadows only on floating elements (modals, CTA).
