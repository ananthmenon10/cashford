# Clean Sheet 2.0 — design pass 2 delta spec

Rebuild/add ONLY the pages below in docs/design/cleansheet2/ (overwrite existing files where named).
Visual language unchanged (match pass-1 files). Apply the new COPY SYSTEM to every rebuilt page.
Truth sources: docs/plans/2026-07-27-001-design-review-round-1.md, 2026-07-27-002-data-content-plan.md,
plus the copy table + UX recommendations in this spec.

## Copy system (apply verbatim where strings match; extend by voice rules elsewhere)
Voice: second person, present tense, contractions, sentence case (ALL CAPS only for badges
NOT ENTERED / ENTERED / LIVE and FT/HT), "picks" in body copy, name people not roles, money always
signed ₹, time always absolute + relative, no exclamation marks, ante/stake never bet/wager.
Strings: "You're not in GW3 yet" (hero) · "Make your picks" (hero CTA) · "You're in ✓" ·
"6 of 9 in · pot ₹600" · "You sat this one out" · badge "locks Fri 23:00 IST" / field "Deadline ·
Fri 5 Sep, 23:00 IST" · "Nudge Nikhil and Kunal" (≤3 missing) else "Send a reminder" ·
"All 10 fixtures, or you're not in. Sitting out costs nothing." · "Entry is final. Your picks stay
editable until the deadline." · "As it stands · +₹600 · 1st of 7" (ordinals, never P1) ·
entry CTA: "2 more to go" → "Enter GW3 · stake ₹100" · "4 fixtures to go" · tiebreak column
"Off by" (verdict word stays Miss) · "GW3 was void — only you entered" · "Blank gameweek —
4 fixtures. Cup clashes. The pot runs as normal." · "Gameweek race" · "You lead on 8 pts".

## Pages

### 03-entry-sheet.html (REBUILD)
Frames: (1) partial 8/10 — each fixture row has top-3 model scoreline CHIPS visible on the
collapsed row (e.g. "2-0 14% · 2-1 11% · 1-0 10%"), one tap fills the row; steppers remain;
empty = "·", never 0-0; disabled CTA reads "2 more to go"; "Fill from the model" + "Copy last
week's scorelines" utilities; filled-from-model rows carry a small `model` tag until touched.
(2) complete 10/10 — CTA live: "Enter GW3 · stake ₹100" (ONE CLICK — no confirm sheet; caption
under CTA: "Entry is final. Your picks stay editable until the deadline."). (3) entered state —
"You're in ✓", Edit picks only (NO withdraw anywhere), mirror prompt shown ONLY as the
conditional variant with caption "shown only because you're in KK Bois + PES Bois (PL active)".
Each fixture's expanded insights panel ends with a "Detailed match insight →" link tagged
**Coming soon**.

### 06-match-detail.html (REBUILD — FotMob-informed, no tabs, one scroll per state)
Frame 1 PRE: header (crests, dash score, kickoff absolute+countdown, picks-lock line) → Your
calls (one row per league + ante; "Edit all picks → GW3 entry sheet") → The room (names + locked
placeholders) → Insights: odds 1X2 · model top scores · form last-5 · H2H last 3 · 3-row table
window (home/away/gap) · team news (injured/suspended) · **Predicted XI (FotMob) module — shown
with "predicted · via FotMob · as of 14:20" freshness tag; include a caption noting it renders
only when the slow poll caught it**.
Frame 2 LIVE: header LIVE 67' + scorers → your pick / right now pts / GW total → what-if strip →
league board sorted by current value, per-row annotations ("Exact if it ends here", "Needs a
Leeds goal") → momentum bar note "(post-match view — no live FotMob polling)" replaced by: live
frame shows the 5-stat row only (shots · on target · corners · possession · xG when available).
Frame 3 FT: verdict chip Exact/Result/Miss + points → your calls across leagues → final board
with "Off by" → share ("Only exact in the league") → market retrospective line ("Odds had 2-0 at
14%. The model's top score was 2-0.") → post-match extras: xG (FotMob) with shot-map thumbnail,
player ratings + Player of the Match, momentum graph — each tagged with source and "arrives
within ~4h of FT".

### 08-matches-tab.html (NEW — replaces the Matches frames from 01-home)
Frame 1: consolidated **Your GW3** card under the GW navigator: header "Your GW3 · 8 pts ·
entered in 2 of 3 · 4 fixtures to go" (points in header only because identical across leagues —
add caption for the differing-picks rule: header drops pts, table gains a Pts column), rows =
league / ordinal rank / signed money, one "Provisional · updates live" footer, "View live race ›".
Below: day-grouped fixture rows incl. one expanded "You called it two ways" row:
  1-1  PES Bois                    3 pts  Exact
  2-1  Solid Yenne · KK Bois       0 pts  Miss
(best-first, league names not counts). Include a void row.
Frame 2: **Table segment** — segmented control "Fixtures & Results | Table" active on Table:
real PL table (20 rows compressed: top 4 zone, your-relevance nothing — plain table, form dots
last-5, GD, pts), source caption "ESPN · updates 10m during matches, hourly otherwise".

### 02-league-gameweek.html (EDIT ONLY: add 4th tab "Table" to the tab bar in every frame; add
one new frame or annotation noting League Table tab = same component as Matches Table.) Also
apply copy system to hero strings ("You're not in GW3 yet" etc.) and REMOVE the Withdraw button
from the entered frame (Edit picks only).

### 09-join-create.html (NEW)
Frame 1 CREATE: step 1 name+ante ("Everyone stakes ₹100 a gameweek. Highest score takes the
pot." + "Changes apply to future gameweeks only."); step 2 competition — Premier League 2026-27
preselected as a confirmed line with "change" link, consequence line "First gameweek: GW3 ·
deadline Fri 5 Sep, 23:00 IST". Never lists archived World Cup.
Frame 2 JOIN preview: "Solid Yenne Boys — Premier League 2026-27 · ₹100 a gameweek · 9 members ·
next deadline Fri 5 Sep, 23:00 IST" + "Joining is free. You only stake when you enter a
gameweek." + the WhatsApp invite message block (link + plain code).
Frame 3 (small): mid-season joiner's Gameweek tab — GW1–2 shown as "Before your time", GW3 open.

### 07-archive.html (EDIT: tab order Analytics | Matches | Bracket; Analytics tab active frame
leads with Final standings; Matches tab = plain results list like today's Done tab, NO bracket
section inside it; Bracket is its own tab.)

### 00-index.html (EDIT: update links/cards for 08/09, note pass-2 changes in one line.)

## Review note for the builder
Screenshot-verify every rebuilt page. Report interpretations. Do not touch pages not listed.
