# Design review round 1 — Ananth's feedback → decisions & actions

Date: 2026-07-27 · Applies to docs/design/cleansheet2/ v1 and plan docs 001–003.
Open research (Sol: FotMob/ESPN data sources · Opus: FotMob/FPL UX + copy) feeds the ⏳ items.

## Decided now (apply in next design/build pass)

1. **No withdraw.** Entry is final once made; picks stay editable until the deadline. Rulebook §1
   updated in doc 001. Removes the withdraw modal from the entry sheet and the "Withdraw" action
   from the entered state.
2. **One-click entry.** No confirmation bottom sheet. The Enter button itself carries the stake
   ("Enter gameweek · stakes ₹100") so staking stays explicit in a single tap.
3. **Mirroring is conditional.** The "use these picks in other leagues" prompt appears only when
   the user belongs to ≥1 other league with this competition active. Otherwise nothing renders.
4. **Dues logging is open, audited.** Any league member can log a payment between ANY two members
   (not just their own). Backend records `logged_by` + timestamp alongside payer/receiver/amount/
   date/note. Confirmation still comes from the counterparty; logger identity shows in the record.
5. **Season tab pills.** The Table / Gameweeks segmented control must be present on BOTH panes
   (it was missing from the standings frame — mockup bug, not a design change).
6. **Archive tab order.** 1: Analytics (leads with Final standings) · 2: Matches (plain match list
   with results, exactly like today's Done list — NO bracket section inside it) · 3: Bracket.
7. **Matches tab live updates.** Cross-league status is ONE consolidated section pinned under the
   GW header ("GW3 LIVE"), not stacked per-league tiles. Design pattern ⏳ (Opus proposal pending).
8. **Copy overhaul.** Full grammar + tone pass over every string. Use FPL terminology where it
   exists (Gameweek, Deadline, …); sporty/simple/intuitive elsewhere. "You are NOT entered" is the
   canonical bad example. Glossary + copy table ⏳ (Opus).

## To resolve with research ⏳

- **Data sources per surface** (FotMob vs ESPN vs FPL vs other keyless/no-paywall): match preview,
  form, H2H, lineups, live events, stats/xG, player ratings, league table, top scorers. Output =
  source map with poll frequency per data type + fallbacks (Sol).
- **Match detail redesign**: full pre/live/post spec informed by FotMob anatomy; only
  prediction-relevant modules. Includes the "Detailed match insight" CTA inside each fixture's
  expanded insights on the entry sheet — ships as **Coming soon** until this lands.
- **Entry feel**: score-input interaction study (steppers vs grid vs wheel) → prototype the chosen
  one so the "feeling of entering the scoreline" can be judged on the next design pass.
- **League screen extra tabs**: evaluate adding e.g. a real PL Table tab (FotMob-style) —
  recommend max 1–2 or none.
- **Join/create league flow**: what changes with competitions first-class (competition picker at
  creation? default PL? invite copy). Recommendation pending, then confirm with Ananth.
- **Home with 2 active competitions per league**: propose scalable pattern (badge stacking? card
  per league-competition? competition rotation?). May stay unimplemented for launch; decide
  whether to hard-prevent duplicates for now. Recommendation pending.

## Explicitly noted

- Dues design approved but flagged for extensive testing before real money flows through it.
- FotMob is the aspirational bar for pre/live/post information density done cleanly.
