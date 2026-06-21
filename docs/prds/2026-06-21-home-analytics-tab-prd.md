---
title: "PRD — Home › Analytics tab (performance, rivalry, match intelligence, recap)"
type: prd
status: draft-for-design
date: 2026-06-21
tab: 2 of 2
build_order: 2 (built after Matches is shipped, signed off, and merged)
---

# PRD — Home › Analytics tab

> **Audience:** a design agent (produces the visual design reference) + the implementing engineer.
> **This is a product/UX spec, not a visual design and not code.** Decide the visual language,
> chart styles, and layout yourself; this document defines *what to show, the two honest lenses,
> the privacy rules, and exactly which metrics are computable from the data we have* — so nothing
> you design is impossible to populate.

---

## 0. Brief for the design agent (read first)

**Design the third tab of the app home: "Analytics."** (The home tab bar — `Leagues · Matches ·
Analytics` — is specified and built in the Matches PRD; reuse it.) Cashford is a World Cup 2026
prediction + settle-up game for friend groups. Analytics answers: *"How am I doing — for real —
and how do I stack up?"*

- **Platform / system / fonts / dark mode:** same as the rest of the app — mobile-first, ~480px
  column (clean at 360px), the Cashford "Clean Sheet" design system
  (`docs/design/Cashford System.dc.html`), Hanken Grotesk + Geist Mono, full light/dark parity.
- **Charts:** keep them **lightweight and mobile-native** — sparklines, compact bars, a single
  cumulative line, simple distributions. Avoid dense desktop dashboards; this is a phone. (Engineer
  note: prefer inline SVG/CSS over a heavy charting dependency; design accordingly.)
- **Deliverable:** a static HTML/CSS mockup covering the global view and the per-league drill-down,
  all four themes, the early-tournament/empty states (§8), and light + dark.

**Hard constraint:** **nothing about the existing experience changes** — this is purely additive
on the home route. No new writes; analytics is entirely read/derived.

---

## 1. The core idea: two honest lenses

Cashford settlement is **relative** — you win a pot by being more right than your leaguemates,
which is part luck. So we deliberately separate two truths and never conflate them:

- **💰 Money lens (stored):** your net ₹, pots won/lost, biggest wins/losses. This is the
  *outcome* — social, real stakes, but variance-tinged.
- **🎯 Skill lens (derived):** how accurately you actually predicted — correct outcome %, exact
  scoreline hit rate, average goal error. Computed by comparing your picks to the real results,
  **independent of who you were up against.** You can be the sharpest predictor and still lose
  money to a hot-handed rival — this lens shows that.

Every relevant stat should make clear which lens it's in. **"Sharpest predictor" ranks on the
skill lens; the dues/leaderboard already covers the money lens per league.**

---

## 2. Scope toggle: Global vs Per-league

A control at the top switches the unit of analysis:

- **Global (default):** **you only**, aggregated across **all** your leagues. Your overall skill,
  your total money, your tournament recap, and tournament-wide match intelligence. *No
  cross-member comparison here* — see privacy (§6); you don't necessarily share members across
  leagues.
- **Per-league drill-down:** pick one of your leagues → the same personal stats scoped to that
  league **plus** the **League rivalry** theme (head-to-head, rank race, sharpest board) — which
  only makes sense among people who share a league.

Design the switch (segmented control / dropdown of the user's leagues). Default = Global.

---

## 3. The four themes & their concrete metrics

All metrics below are **computable from existing data** (predictions, contest_results/net,
fixtures' final scores, and `fixture_insights`). Each is tagged with its lens. The design agent
should prioritize/lay these out; not all need equal weight — lead with the highest-signal ones.

### 3a. 🎯 My performance (Global + Per-league)
- **Correct-outcome %** — how often your 1X2 matched the actual result. *(skill)*
- **Exact-scoreline hit rate** — how often you nailed the exact score. *(skill)*
- **Average goal error** — mean total-goals miss per match; a "are you reading games right" stat.
  *(skill)*
- **Cumulative ₹ trend** — a single line of your net over the tournament. *(money)*
- **Pot win rate** — pots won ÷ pots entered. *(money)*
- **Current & longest streak** — consecutive correct outcomes (skill) and/or consecutive pot wins
  (money) — label which.
- **Best & worst result** — biggest single net win and loss, with the match. *(money)*
- **Goals bias** — do you systematically over- or under-predict goals vs reality? (avg predicted
  total vs avg actual total). *(skill, fun)*
- **By stage** — accuracy/net split Group vs Knockout. *(both)*

### 3b. 🏆 League rivalry (Per-league only)
- **Rank-over-time race** — each member's cumulative net across the tournament timeline; where you
  sit and how the lead changed. *(money)*
- **Head-to-head vs each member** — across settled matches you both entered, who predicted better
  (skill) and the net flow between you (money). A "you vs Rohit: you're sharper, but he's up ₹150"
  framing. *(both)*
- **Sharpest predictor board** — league members ranked by **accuracy** (skill), explicitly
  distinct from the money leaderboard already in Dues. Surfaces skill ≠ luck.
- **Most contrarian / most with-the-crowd** — who backs against the field most (uses members'
  picks, post-lock only). *(fun)*

### 3c. 📊 Match intelligence (Global; tournament-wide)
Leverages `fixture_insights` (pre-match 1X2 model probabilities, odds, model scorelines) cross-
referenced with actual results. Fixture-level, shared across leagues.
- **Favorites vs upsets** — across finished WC matches with insight data, how often the model/odds
  favorite actually won; an upset tracker.
- **Your value picks** — matches where you backed an underdog (low pre-match win prob) **and won** —
  your "called the upset" highlights. *(skill × money)*
- **Model vs reality** — calibration: when the model said ~70% home, how often did home win?
- **Most-predicted scoreline vs actual** — for a match (or aggregate), what your-leagues' crowd
  expected vs what happened. *(crowd scoped to your leagues' members — see §6)*
> Design note: this theme is the platform's differentiator. Keep it insightful, not noisy — a few
> strong cards beat a wall of charts. Some sub-stats need a minimum sample (mid/late tournament);
> see §8.

### 3d. 🎉 Tournament recap (Global + Per-league)
Shareable, fun "your World Cup in numbers" — best surfaced as a small set of stat cards, lands
harder late-tournament.
- **Lucky / unlucky team** — which team's matches you net the most / least on. *(money)*
- **Your signature scoreline** — the score you predict most. *(fun)*
- **Biggest night** — your best single matchday by net. *(money)*
- **Boldest correct call** — your lowest-probability pick that came in (ties to match intelligence).
- **Tournament so far** — matches predicted, % entered, total ₹ swung.
> A "share card" treatment (clean, screenshot-friendly) is welcome for recap items — flag if you
> design one. (Actual share/export is out of scope for v1; design the card, not the plumbing.)

---

## 4. Information architecture (suggested; refine)

A scannable vertical scroll on mobile:
1. **Scope toggle** (Global ⇄ a specific league).
2. **Headline strip** — 3–4 hero numbers for the chosen scope (e.g. net ₹, correct-outcome %,
   rank if per-league). Money vs skill clearly distinguished.
3. **My performance** section (the cumulative ₹ line + accuracy + streaks + best/worst).
4. **League rivalry** section — *only in per-league scope*.
5. **Match intelligence** section — *only in global scope* (tournament-wide).
6. **Tournament recap** cards.

Make lens explicit throughout (a 💰/🎯 affordance, a section sub-label, or grouping — your call).

---

## 5. Flows & navigation

- Switching scope re-renders the panel for that unit; cheap, no full reload.
- Stats that reference a specific match (best win, value pick, upset) should be **tappable** →
  the existing match page in the relevant league (or fixture context), reusing what we have.
- Analytics **never writes** and never exposes a new prediction/settlement path.

---

## 6. Privacy & integrity rules (must hold — these constrain what's allowed)

- **No-peek before lock:** any stat involving **other members' picks** (rivalry, contrarian,
  crowd, most-predicted) may use **only matches whose contest has locked/settled.** Pre-lock picks
  are invisible and must never leak via an aggregate.
- **Your own** picks/accuracy you may analyze any time (they're yours).
- **Rivalry is per-league only.** Cross-member comparison requires a shared league; the **global**
  view is strictly about the viewer + tournament-wide facts. Never compare the user to people they
  don't share a league with.
- **"Crowd" = members of the user's leagues** (whose picks are visible post-lock), not a global
  population we don't have rights to. Scope "most-predicted / contrarian" accordingly.
- **Money is already semi-public within a league** (the Dues leaderboard shows every member's net),
  so per-league money rivalry is consistent with today's disclosure. Accuracy derives from
  post-lock picks, also already revealed — so rivalry adds **aggregation**, not new disclosure.

---

## 7. Non-functional requirements

- **Mobile-first**, 480px column, clean at 360px; charts legible on a phone, no horizontal scroll.
- **Performance:** analytics is heavier than a feed (it scans the user's full prediction/result
  history). Compute server-side in bounded aggregate queries; avoid per-match round-trips. Cache
  where sensible (results only change when a match settles). The page must stay fast even
  late-tournament with hundreds of settled contests across leagues.
- **Correctness of derived stats is paramount** — these are claims about the user's skill and money
  and will be scrutinized. Accuracy/net math must be unit-testable pure functions (engineer note:
  the existing `lib/settlement.ts` style — pure, golden-tested — is the bar). The design should not
  imply precision we can't stand behind (e.g. don't show calibration on a 2-match sample).
- **Dark mode parity** for every chart and card (chart colors must come from semantic tokens).
- **Accessibility:** charts need text/number equivalents (don't encode meaning in color alone);
  the scope toggle is keyboard-operable; live-region not needed (analytics isn't realtime).

---

## 8. Early-tournament & empty states (design these — they dominate week 1)

Analytics is **sparse at the start** and must degrade gracefully:
- **No settled matches yet** → no accuracy/net history. Show an encouraging "Your stats appear as
  matches settle — you've predicted N so far" state, not empty charts.
- **Only a few settled** → show what exists; **suppress** stats that need a minimum sample
  (calibration, model-vs-reality, "signature scoreline") until enough data, with a quiet "unlocks
  after N matches" hint. Define the thresholds with the engineer.
- **User in one league** → Global and Per-league are nearly identical; the scope toggle should
  still work but needn't feel redundant (maybe auto-select that league for the drill-down, and the
  global view simply equals it). **Design the single-league experience explicitly** so it isn't
  confusingly duplicative.
- **User sat out many matches** → "not entered" shouldn't distort accuracy (accuracy = over matches
  you *did* predict); make the denominator honest and labeled.
- **User in zero leagues** → mirror the home empty state; no analytics.

---

## 9. Open decisions (flag your choice; not blockers)

1. **How many recap "share cards"** and whether to design the share/screenshot treatment now
   (plumbing deferred regardless).
2. **Rank-race chart density** — full multi-line race vs "your rank over time + current standings".
3. **Minimum-sample thresholds** for calibration / model-vs-reality / signature scoreline.
4. **Streak definition emphasis** — skill streak (correct outcomes) vs money streak (pot wins) —
   which leads.
5. **Whether match-intelligence appears in per-league scope too** (scoped to that league's
   fixtures) or stays global-only.

---

## 10. Out of scope / guardrails

- **No change** to the league page, predict screen, match detail, settle-up/dues, scoring, or
  settlement. Additive on `/` only; read/derived only.
- **No new realtime** — analytics refreshes on navigation, not a live ticker.
- **No global cross-member leaderboard** — rivalry stays per-league (§6).
- **Share/export plumbing** (deep links, image export) is **not** in v1 — design the recap card,
  but shipping the share mechanism is a later decision.
- Charting library/approach is an engineering decision; design to lightweight inline charts.

---

## 11. Acceptance criteria (product-level)

- [ ] Analytics tab on home; Global (default) ⇄ per-league scope toggle works.
- [ ] Money lens and skill lens are visually distinct and never conflated.
- [ ] My-performance shows: correct-outcome %, exact-score %, avg goal error, cumulative ₹ line,
      pot win rate, streaks, best/worst, goals bias, by-stage — all populated from real data.
- [ ] Per-league scope adds rivalry: rank-over-time, head-to-head, **accuracy-ranked** sharpest
      board (distinct from the money leaderboard), contrarian.
- [ ] Global scope shows tournament-wide match intelligence (favorites-vs-upsets, your value picks,
      model-vs-reality, most-predicted vs actual) using `fixture_insights` + results.
- [ ] Tournament recap cards render (lucky team, signature scoreline, biggest night, boldest call).
- [ ] No other member's pre-lock pick is ever inferable; rivalry only appears in per-league scope.
- [ ] Early-tournament/sparse states are graceful; under-sampled stats are suppressed, not faked.
- [ ] Single-league users get a coherent (non-duplicative) experience.
- [ ] Full light + dark parity; 360–480px clean; nothing on the existing experience changed.
