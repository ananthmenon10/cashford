---
title: "PRD — Home › Matches tab (cross-league match feed)"
type: prd
status: draft-for-design
date: 2026-06-21
tab: 1 of 2
build_order: 1 (Matches ships, signed off, merged → then Analytics)
---

# PRD — Home › Matches tab

> **Audience:** a design agent (produces the visual design reference) + the implementing engineer.
> **This is a product/UX spec, not a visual design and not code.** Make the visual,
> layout, and interaction-polish decisions yourself; this document tells you *what the tab
> must do, the states it must cover, and the data that actually exists* so the design is grounded.

---

## 0. Brief for the design agent (read first)

**Design one thing: a new "Matches" tab on the app home, plus the home tab bar that hosts it.**
Cashford is a World Cup 2026 prediction + settle-up game for friend groups (leagues). Today the
home screen (`/`) is a flat list of the user's leagues. We're turning it into a **3-tab home**:
`Leagues · Matches · Analytics`. **Leagues keeps its current design unchanged** (it's the
screen we have today). You are designing the **tab bar** and the **Matches tab** only. Analytics
is a separate PRD.

- **Platform:** mobile-first web (PWA), single-column, content max-width ~**480px**. Must look
  right at ~360px too.
- **Design system:** match the existing Cashford "Clean Sheet" system — reference
  `docs/design/Cashford System.dc.html` and the existing components for tone: the home **league
  cards** (`app/page.tsx`), the **MatchCard** (`components/MatchCard.tsx`), and the league-page
  **tab bar** (`components/LeagueTabs.tsx`). Reuse the established card/pill/avatar/score-mono
  visual language so this feels native, not bolted on.
- **Light + dark mode** are both first-class (class-based dark theme). Design both; use the
  system's semantic colors (no one-off hexes that break in dark).
- **Fonts:** Hanken Grotesk for text, Geist Mono for numbers/scores (as in the rest of the app).
- **Deliverable:** a static HTML/CSS mockup (like the `Match Insight Blend.dc.html` you produced
  for the predict screen) covering every state and both the 1-league and multi-league variants
  listed in §6 and §7, in light and dark. Annotate the expand/collapse interaction.

**Hard constraint (do not violate):** **nothing about the current league experience changes.**
The per-league screen (`/leagues/[slug]`), the predict screen, the match detail, locked-reveal,
live provisional, and settle-up/dues all stay exactly as they are. This tab is **purely additive**
on the home route. Don't redesign the league cards either — they become the "Leagues" tab as-is.

---

## 1. Why this tab exists

A player in several leagues currently has to enter each league one at a time to see "what's on
today / did I predict everything / how's my live match going." The same World Cup match also lives
in *every* league as a separate contest, so there's no single place that answers **"what's
happening across all my games right now?"** The Matches tab is that place: one cross-league,
time-ordered view of every match the user has money on, with the urgent stuff (live / kicking off
soon / not-yet-predicted) pulled to the top.

**Success looks like:** a multi-league user opens Matches and within one screen knows what's live,
what they still need to predict, and what's coming — without entering any league.

---

## 2. Where it lives + the home tab bar

- Route: `/` (the existing home). Becomes a tabbed screen. Tabs: **Leagues · Matches · Analytics**.
- **Default active tab: Leagues** (current behavior preserved — zero surprise).
- The top bar (logo, version pill, theme toggle, avatar, sign-out) stays as today, above the tabs.
- Tab switching is client-side and must not refetch the whole page; the Matches tab content can
  auto-refresh on its own cadence (see §9).
- **Leagues tab = today's `/` content verbatim.** Matches and Analytics are new panels.

The design agent should design the **tab bar treatment** (how the three tabs sit under the top
bar) consistent with the league-page tab bar, plus an indicator if Matches has something urgent
(see §3 "attention" idea — optional, flag if you include it).

---

## 3. The Live / Today hub (pinned, top of the Matches tab)

A compact, high-signal block at the **top** of the Matches tab that surfaces only what needs
attention *now*, so the user rarely has to scroll. Contents, in priority order:

1. **Live matches** — any match currently in play (state `live`), or just-ended awaiting
   settlement (`settling`). Show the live score, the minute/period label (`45'`, `HT`, `ET 98'`,
   `Pens`, `Break`), and — since picks are public once a match locks — **the user's pick + a
   roll-up of how it's tracking across their leagues** (e.g. "on track +₹240 across 2 leagues").
2. **Predict-now nudge** — count of matches that are **still open and not yet predicted by the
   user** and kick off within the next ~24h. One glanceable line, e.g. "**3 matches need your
   pick**" linking/scrolling to them. (Mirrors the existing "X/Y Predicted" idea on the league
   page, but cross-league.)
3. **Next kickoff** — if nothing is live, show the single next match about to start (countdown).

If there's nothing live, nothing un-predicted soon, and nothing imminent, the hub **collapses to
nothing** (don't show an empty shell) — the feed below carries the screen.

> Design note: the hub and the feed share the same match-card vocabulary; the hub is a
> *prioritized lens*, not a different card type. Decide whether live cards in the hub are visually
> "louder" (e.g. live accent border/pulse) than the same match would look in the feed.

---

## 4. The all-matches feed (below the hub)

One **time-ordered, cross-league feed of every match the user has at least one contest in**
(every league predicts the same 104 WC fixtures, so this is effectively "every WC match you're
playing"). It folds what the league page splits across `Next 24h / Later / Live / Done` into a
single adaptive list.

- **Default sort:** chronological by kickoff. Group with light date/section headers (e.g.
  **Today**, **Tomorrow**, **Sat 13 Jun**, and a **Past / Results** section for finished matches).
  Decide the exact grouping; the principle is upcoming-soonest-first, results most-recent-first
  within the past section.
- Each row is a **match card** (§5–6). The same match appears **once**, regardless of how many of
  the user's leagues it's in (dedup by fixture — that's the core of this tab).
- Consider a lightweight filter/segment if the list is long (e.g. All · Upcoming · Live · Results),
  but the **hub already handles urgency**, so a filter is optional — flag if you add it.

---

## 5. The match card — data it can show (grounding)

For every match we reliably have (all already in the DB):

- **Fixture facts:** round (Group / R32 / R16 / QF / SF / 3rd / Final), the two team labels +
  short codes/crests, kickoff time, knockout-or-not, live score (`ft_home`/`ft_away`), live
  minute + status detail, and (knockout, post-match) which side advanced.
- **The user's pick** for this match **per league** (outcome H/D/A + predicted scoreline). Picks
  are **hidden before lock** (no-peek) and **visible after lock** — so a card may legitimately
  show "your pick" on a locked/live/finished match but **must not reveal anyone's picks (including
  patterns that leak them) before lock.**
- **Per league for this match:** stake (₹), how many league members have entered ("3/6 joined" —
  count only, never the picks, before lock), the user's settled result (won/lost/push/not-entered/
  void) and net ₹.
- **Match intelligence (optional surface):** `fixture_insights` gives pre-match win-probability
  (1X2), model "most-likely scorelines", and form/H2H — **fixture-level, shared across leagues.**
  Whether to peek a probability bar or "model favorite" hint onto upcoming cards is a design call
  (it's available; don't over-clutter the feed — the full insight already lives on the match page).

A match the user is **not** in any league for does **not** appear (no contest = no card).

---

## 6. Match card — collapsed states (must cover all of these)

The card adapts to the match's lifecycle state. These mirror the existing `MatchCard` states; the
feed must represent every one (reuse the established visual treatments where they exist):

| State | What the collapsed card conveys |
|---|---|
| **Open, not predicted** | Teams, kickoff countdown, a clear **"Make pick"** affordance, stake. The urgent case the hub also surfaces. |
| **Open, predicted** | Teams, your pick echo (e.g. "BRA 2–0"), countdown, **"Edit"** affordance. |
| **Teams TBD** (knockout bracket not set) | Placeholder ("Teams TBD — opens once the bracket is set"); no pick action. |
| **Locked** (pre-kickoff, picks now revealed) | Teams, "Locked", countdown to kickoff, your pick. *(Per-member reveal lives on tap/expand or the match page — keep the feed card calm.)* |
| **Live** | Live score, minute/period, your pick + "on track to win/lose +₹X" provisional. |
| **Settling** | Full-time score, "settling…". |
| **Won / Lost / Push / Not-entered / Void / Cancelled** | Final score, outcome treatment + your net ₹ (celebratory for a win, muted for push/sat-out, dimmed for void/cancelled). |

**Crucial cross-league nuance for the collapsed card:** a single match can have **different
status, stake, pick, or result in each league**. The collapsed card shows a **roll-up**:

- **Pick:** if the user picked the **same** scoreline in all their leagues for this match → show
  that one pick. If picks **differ across leagues** → show a "mixed picks" treatment (e.g. "2
  picks" / show the outcome if outcomes agree but scores differ) rather than a misleading single
  value. Design this clearly.
- **Money at stake / net:** roll up across the user's leagues for this match (e.g. "Stake ₹200
  across 2 leagues"; settled: "+₹420 across 2 leagues"). If some leagues won and some lost, show
  the **net** and let the expansion break it down.
- **Leagues affordance:** a small "**in 3 leagues**" chip when the match spans more than one of the
  user's leagues, which is the cue to expand.

---

## 7. Match card — expanded state (the per-league breakdown)

Tapping the card (or an explicit expander) reveals the **per-league breakdown** — this is the
payoff of "one card per match, expandable." For each league the user has this match in, one row:

- League name.
- The user's pick in **that** league (or "not predicted" if open & unpicked there).
- Stake / state / result + net ₹ for that league.
- "X/Y joined" (count only, pre-lock).
- A way to **jump into that league's match page** (`/leagues/[slug]/m/[contestId]`) — the existing
  screen, untouched — to predict, edit, or see full insight + the reveal.

Design both variants explicitly:

- **Single-league user (or a match that's only in one of their leagues):** there's nothing to roll
  up. The card should behave like a clean single-league match card — **no "in N leagues" chip, and
  expansion is either absent or just opens the match page.** Decide the cleanest treatment so a
  1-league user never sees confusing cross-league chrome.
- **Multi-league user:** the roll-up + expandable breakdown is the whole point. Make the
  collapsed→expanded transition obvious and the per-league rows tappable.

---

## 8. Flows & navigation

- **Tap an open/unpredicted match** (single league) → that league's match page to predict.
- **Tap a match in multiple leagues** → expand the breakdown; tapping a **league row** → that
  league's match page.
- **"Make pick" / "Edit"** affordances route to the existing predict screen (no new predict UI).
- Everything that mutates a prediction or settles still happens on the **existing per-league
  screens** — this tab is read + navigation only. It never writes.
- Back from a league match page returns to the home Matches tab with scroll/tab state ideally
  preserved.

---

## 9. Non-functional requirements

- **Mobile-first**, 480px column, thumb-reachable actions; works at 360px with no horizontal
  scroll or wrapping tabs.
- **Live freshness:** the tab should keep live scores/minutes/provisional current on a periodic
  refresh (the app already auto-refreshes the league page every 30s; reuse that cadence). Live
  cards update in place without yanking scroll.
- **Performance:** one screen aggregating across all the user's leagues must stay fast — the data
  is a single grouped read (contests across the user's leagues, joined to fixtures, grouped by
  `fixture_id`, which is indexed). No N+1 per league. The page must not block on ESPN; live score
  refresh is best-effort/background.
- **Dark mode parity** required for every state.
- **Accessibility:** the tab bar is a proper tablist (keyboard + ARIA, like the match-page tabs);
  expand/collapse is keyboard-operable; live updates use polite live-region semantics where
  appropriate; color is never the only signal for win/lose/live.
- **No-peek integrity:** the design must make it impossible to infer other members' picks before a
  match locks. Pre-lock, only **counts** ("3/6 joined") may appear, never picks.

---

## 10. Empty & edge states (design these)

- **User in zero leagues** → Matches mirrors today's home empty state ("Your captain will add you
  to a league…"). No feed.
- **Leagues exist but no contests yet** → "No matches scheduled yet."
- **Nothing today / nothing live** → hub collapses; feed shows upcoming + a calm "Nothing on right
  now — next up: …".
- **All matches finished (tournament over)** → feed is all results; hub gone.
- **A match the user didn't predict in any league** → still shows (it's on their schedule), with a
  subtle "you sat this out" once settled.
- **Mixed results across leagues for one match** (won in A, lost in B) → collapsed shows net;
  expansion shows the split.
- **Stale/lagging live data** (cron lag: lock passed but not flipped) → treat as locked, as the
  existing card logic does.

---

## 11. Open decisions (flag your choice; not blockers)

1. **Probability/odds hint on upcoming feed cards** — peek a 1X2 bar or "model favorite" onto
   upcoming cards, or keep the feed clean and leave insight to the match page? (Data exists.)
2. **Feed filter/segment control** — needed, or does the hub + sectioning suffice?
3. **Live accent intensity** — how "loud" live cards are (pulse/border/accent).
4. **"Attention" indicator on the Matches tab label** — a dot/count when something is live or
   un-predicted-soon, like the league page's X/Y nudge?

---

## 12. Out of scope / guardrails

- **No change to** the league page, predict screen, match detail, locked-reveal, live provisional,
  settle-up/dues, scoring, or settlement. Additive on `/` only.
- **No new prediction/settlement UI** — all writes stay on existing per-league screens.
- **No new global rivalry/leaderboard here** — leaderboards stay per-league; cross-member
  comparison belongs to the Analytics PRD (and stays per-league there too).
- The **Leagues tab** is the current home content, unchanged.

---

## 13. Acceptance criteria (product-level)

- [ ] Home shows three tabs (Leagues · Matches · Analytics); Leagues is default and unchanged.
- [ ] Matches tab shows a single cross-league, time-ordered feed; each WC match appears **once**.
- [ ] A live match shows live score + minute + the user's cross-league provisional, updating on
      refresh without scroll jump.
- [ ] Un-predicted matches kicking off soon are surfaced in the hub and actionable.
- [ ] A multi-league match shows a roll-up (pick/stake/net + "in N leagues") and expands to a
      per-league breakdown, each row linking into that league's existing match page.
- [ ] A single-league user sees clean single-match cards with no cross-league chrome.
- [ ] Every lifecycle state (open/predicted/TBD/locked/live/settling/won/lost/push/not-entered/
      void/cancelled) is represented.
- [ ] Pre-lock, no other member's pick is inferable anywhere on the tab.
- [ ] Full light + dark parity; 360–480px clean; nothing on the existing league experience changed.
