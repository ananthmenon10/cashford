---
title: "feat: Cashford motion system — smooth, seamless animations for the home tabs"
type: feat
status: active
date: 2026-06-23
---

# ✨ Cashford Motion System

Port the design team's motion handoff (`~/Downloads/Cashford.zip` → `handoff/cashford-motion.css` +
`cashford-motion.js`) into the live app as **idiomatic React + Tailwind v4 CSS keyframes**, so the
Matches and Analytics tabs (and the shared chrome) feel alive: numbers roll up, cards rise in as you
scroll, the tab/scope indicators glide, settled wins glow, the live dot breathes, taps feel tactile.

**North star: smooth & seamless.** No layout shift, no hydration flash, 60fps transforms only,
graceful `prefers-reduced-motion` fallback, animations fire **once** on entry and re-fire only on real
data change (only the live pulse loops). Nothing about existing data, flows, or settlement changes.

## Decisions (confirmed with user, 2026-06-23)

1. **CSS-first, no Framer-motion.** Every effect here is a pure transform/opacity/stroke animation that
   CSS keyframes + two small React hooks cover cleanly. The codebase already animates exactly this way
   (`@keyframes live-pulse` + `.animate-live-pulse` + `active:scale-[.99]`; **zero** animation libs in
   `package.json`). Framer would add ~45kb and a new convention to buy spring physics / gesture drags /
   `AnimatePresence` — none of which this design uses. **Rejected:** `motion/react`.
2. **Full scope, phased.** Includes the two effects whose target components don't exist yet: a new SVG
   **accuracy ring** and an **animated net chart**. Each phase is built → staged → self-tested in a
   browser → signed off → shipped to prod before the next begins (the established Cashford gate).
3. **Count-up on hero figures only.** Big NET total + headline accuracy % per scope + league-card net.
   Small stat cells (streak, pot, goal bias) stay static so the screen doesn't read as busy.
4. **Win glow fires once per page load.** Plays the first time a settled **win** card scrolls into
   view; does not replay on further scrolls in the same page session; a fresh load re-arms it.

## ✅ Resolved decision — chart stays as bars (confirmed 2026-06-23)

The scope option mentioned "convert the day-net bars into an animated **line/area** chart." On 2026-06-20
the user **explicitly chose per-day bars over a cumulative line**. **Confirmed: keep the bars, animate them
growing from the ₹0 baseline on reveal.** No line/area switch. The handoff's `cf-drawLine`/`cf-areaRise`
keyframes will **not** be ported (dropped from scope — no parked dead CSS).

---

## Architecture

### One new client module: `components/motion.tsx` (`"use client"`)

The auto-wiring `init()` / `data-*` pattern in the vanilla JS is **not** ported — it's irrelevant in
React. Instead, a tiny surface the existing client components already-being client can use:

| Export | Replaces (vanilla) | Shape |
|---|---|---|
| `useReveal(opts?)` | `observeReveals` / IntersectionObserver | `{ ref, inView }`; `once?: boolean` (win cards use `once`). Reduced-motion → `inView=true` immediately. |
| `<Reveal as className stagger>` | `.cf-feed-item` wiring | Adds `in-view` when scrolled in; `stagger` sets `--i` on children for the cascade. |
| `<CountUp value kind className>` | `countUp(el,to,opts)` | `kind: "inr" \| "pct" \| "int"` (a **string**, not a function — see RSC note). Renders final value on the server, rolls 0→value on the client, then pops. |
| `<AccuracyRing pct size>` | `cf-ringFill` + `[data-ring]` | Phase 3. SVG ring that sweeps to `pct` on reveal, `<CountUp kind="pct">` in the center. |
| `<SlideTrack count active>` | `.cf-tab-ind` / `.cf-seg-thumb` | Phase 1. Absolutely-positioned indicator; `width:100/count%`, `transform:translateX(active*100%)`. Decorative (`aria-hidden`). |

Pure easing/interpolation math is extracted to **`lib/motion-math.ts`** (`easeOutCubic(p)`,
`countUpFrame(from,to,p)`) with a vitest test — matches the repo's pure-function + golden-test convention
(`lib/settlement.ts` style) and satisfies the "tests encode intent" rule. The DOM/rAF wrapper around it
stays in `motion.tsx` (not unit-tested; verified visually).

**Why `kind` is a string, not a `format` function:** `app/page.tsx` is a **Server Component** and renders
the league cards (and their net) inline. Functions can't cross the RSC serialization boundary, so
`<CountUp format={inr}>` from the server would throw. `kind="inr"` (serializable) lets the client
component pick its formatter internally. `inr`/`pct` formatting lives in `motion.tsx` (or is imported
from `components/ui.tsx`'s pure `inr`).

### `app/globals.css` additions (re-tokenized for dark mode)

Port the 9 keyframes + utility classes, but **map the handoff's hardcoded hex to semantic tokens** so
dark mode never flashes white:

- `--cf-ease: cubic-bezier(.2,.8,.2,1)` added under `@theme` (or `:root`).
- `cf-greenWash`: start from `var(--color-surface)` / `var(--color-border)` (NOT `#fff`) → element's
  resting green tint. **Critical:** the raw handoff washes *from white*, which flashes white on a dark
  card. Re-token it.
- `cf-livePulse`: ripple uses `var(--color-live)` (#ff3b30) — already token-aligned.
- `cf-numberPop`, `cf-riseIn`, `cf-sheen`, `cf-scoreFlash`, `cf-ringFill`. (`cf-drawLine`/`cf-areaRise`
  are **not** ported — chart stays as bars.)
- `.cf-press`, `.cf-feed-item`, `.cf-result`/`.cf-sheen`, `.cf-live-dot`, `.cf-score.flash`, `.cf-tab-ind`,
  `.cf-seg-thumb` utility classes.
- `@media (prefers-reduced-motion: reduce)` block: collapse all to final state (durations → .001ms,
  ring shows final offset, feed items opacity 1).

`.tabular` (already defined, `globals.css:73`) is reused on every count-up span so the rolling digits
don't change width (no horizontal jitter).

---

## Implementation phases (each is a full gate: typecheck+build+test → staging → browser self-test → your QC → prod)

### Phase 1 — Foundation + structural polish (broad, low-risk)
*Goal: the app "feels alive" with zero new components and no data risk.*

- `lib/motion-math.ts` + `lib/motion-math.test.ts` (easeOutCubic, countUpFrame).
- `components/motion.tsx`: `useReveal`, `<Reveal>`, `<SlideTrack>` (single shared IntersectionObserver,
  disconnect-safe on unmount; reduced-motion guard at the top of every hook).
- `app/globals.css`: all keyframes + classes (re-tokenized).
- **`.cf-press`** — migrate the 7 `active:scale-[.99]` sites and add to the 2 that lack press feedback
  (`MatchFeedCard.tsx:110` multi-league card, `MatchesTab.tsx:243` picks-due banner, which also lacks
  `transition-transform`). Scale tightens to `.96` per handoff; **verify on large cards — dial to `.98`
  if `.96` feels heavy.** Sites: `app/page.tsx:104,150`, `MatchesTab.tsx:100,143,243`,
  `MatchFeedCard.tsx:74,104,110`, `MatchTabs.tsx:63`, `MatchCard.tsx:90`, `ThemeToggle.tsx:32`.
- **`.cf-live-dot`** — migrate the 3 `animate-live-pulse` dots (`MatchesTab.tsx:107`, `FixtureHeader.tsx:53`,
  `ui.tsx:22`) to the box-shadow ripple. **Check each for `overflow-hidden` ancestors that would clip the
  ripple**; keep the old `.animate-live-pulse` keyframe until all three are migrated, then it can stay
  (harmless) or be removed.
- **`<SlideTrack>`** sliding indicator on `HomeTabs.tsx` (3 tabs) and `LeagueTabs.tsx` (N tabs), driven by
  the existing `useState` active index. Tab content still swaps via `hidden` (instant); only the underline
  glides. ARIA tab roles untouched.
- **Sliding scope thumb** on `AnalyticsTab.tsx` scope pills (Global + per-league) via `<SlideTrack>`.
- **`<Reveal stagger>`** wrapping the match-list rows in `MatchesTab.tsx` (Next-24h + Results day buckets)
  and the analytics cards in `AnalyticsTab.tsx`.

**Verify:** at 360px and 480px, indicators land under the active tab/pill and glide; reveals cascade with
no CLS; press feels right; live dot ripples (not clipped); dark mode shows no white flash; reduced-motion
(emulate) → everything resting/instant.

### Phase 2 — Numbers that move + the win moment
*Goal: money and skill figures roll up; settled wins celebrate once.*

- **`<CountUp>` on hero figures only:** Analytics big NET (`AnalyticsTab` `HeadlineNet`) + headline accuracy
  % (`HeadlineStat`, Global + per-league), and the league-card net in `app/page.tsx:117`. Negative nets
  roll 0→−N with the existing win/loss color on the parent (the magnitude grows; sign via `kind:"inr"`).
  `suppressHydrationWarning` on the span; reduced-motion → final value, no roll. Re-runs when the value
  prop changes (the home page's 30s `AutoRefresh` can change it) — guarded by a prev-value ref so it only
  re-rolls on a real change, never on every render.
- **Win glow (once per page load):** apply `.cf-result` + `.cf-sheen` + `[data-pop]` on the **settled win**
  card (`ResultFull`, `MatchFeedCard.tsx:259–300`, which already rests at the green tint) using
  `useReveal({ once: true })` so it plays once then unobserves. Losses/pushes get no glow.
- **Goal score flash (`onGoal` port):** in `HubLiveCard` (`MatchesTab.tsx:87`), compare previous vs current
  score across `AutoRefresh` ticks (prev-score ref) and replay `.cf-score.flash` on change.
  **Verification caveat:** only visually confirmable when a real WC match is live; Test League has no ESPN
  feed. Logic is correct-by-construction + a manual prop-change poke via devtools; flagged as best-effort.

**Verify:** numbers roll smoothly with tabular width (no jitter); the pop lands; a settled win glows once
and does not replay on scroll-away-and-back; light + dark both correct; reduced-motion shows final numbers.

### Phase 3 — New SVG components (accuracy ring + animated chart)
*Goal: the two effects the design envisioned but the UI doesn't have yet. Confirm the bars-vs-line flag first.*

- **`<AccuracyRing pct size>`**: SVG ring (C = 2π·r) whose progress arc sweeps from empty to `pct` on
  reveal (`cf-ringFill`, `stroke-dashoffset` target computed from pct), with `<CountUp kind="pct">` in the
  center. Replaces the plain headline accuracy text in `AnalyticsTab` (Global + per-league). Uses
  `--color-primary` for the arc, `--color-subtle` for the track — token-driven, dark-safe.
- **Animated net chart (bars — confirmed):** make the existing `DayBars` divs **grow from the ₹0
  baseline on reveal** (animate `transform: scaleY` / height from 0, `transform-origin` at the zero line,
  staggered per day). Up-days green, down-days red, as today. No viz change, decision preserved. No
  line/area variant.

**Verify:** ring sweeps to the correct % and the centered number lands on the same value; bars grow from
zero both up and down without overshooting the axis; reduced-motion shows the final ring/bars instantly;
no CLS as the SVG mounts.

---

## System-wide impact

- **RSC boundary:** all five target components are already `"use client"`; the new client module nests
  cleanly. The one server→client crossing (league-card `<CountUp>` in `app/page.tsx`) is safe because all
  props are serializable (`value:number`, `kind:string`, `className:string`) — hence `kind`, not `format`.
- **AutoRefresh (30s) interaction:** the home page re-renders with fresh data every 30s. Count-up guards on
  a prev-value ref so it only re-rolls on a genuine change; reveals are `once` or idempotent; the live dot
  loop is unaffected. No animation restarts on a no-op refresh.
- **No state/data lifecycle risk:** this is display-only. No DB, RLS, settlement, ESPN, or cron code is
  touched. No migration. Settlement golden tests stay green untouched.
- **Surfaces that share primitives:** `.cf-press` and `.cf-live-dot` reach `FixtureHeader`, `MatchCard`,
  `MatchTabs`, `ui.tsx`, `ThemeToggle` — broader than the home tabs, for app-wide consistency. Bespoke
  moments (count-up, win glow, ring, chart) stay where the data lives (home tabs + match cards).

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| **Dark-mode white flash** on win glow (handoff washes from `#fff`) | Re-token `cf-greenWash` to `var(--color-surface)`; verify in dark at QC. |
| **CLS / layout jump** from reveals or count-up | Animate only transform/opacity/filter; `.tabular` on count-up spans; never animate height/margin (bars use `scaleY` from a fixed box). |
| **Hydration mismatch** on count-up (client starts at 0, server renders final) | `suppressHydrationWarning` on the span; SSR keeps the final value for correctness/no-JS. |
| **Live-dot ripple clipped** by `overflow-hidden` ancestor | Check each of the 3 sites at QC; give the dot room or drop `overflow-hidden` locally. |
| **`.96` press feels heavy** on big cards | Ship `.96`, eyeball at QC, dial to `.98` via the single token if needed. |
| **N-tab indicator math** (handoff hardcodes 2 tabs) | `<SlideTrack count active>` computes width/translate from props; tested at 3 (Home) and N (League). |
| **Goal-flash unverifiable** without a live match | Correct-by-construction + devtools prop poke; flagged best-effort, low blast radius. |
| **Observer leak** on unmount | Single shared observer, `unobserve` on cleanup; `once` paths disconnect after first hit. |

## Acceptance criteria

- [ ] No animation library added; `package.json` runtime deps unchanged.
- [ ] `npm run typecheck`, `npm run build`, `npm test` all green (incl. new `lib/motion-math.test.ts`).
- [ ] All animations respect `prefers-reduced-motion` (CSS collapse **and** JS early-return in hooks).
- [ ] Zero CLS introduced; count-up digits don't change width; reveals don't shift layout.
- [ ] No hydration warnings in the console on the home or league pages.
- [ ] Light **and** dark verified at 360px and 480px each phase; no white flash, no clipped ripple.
- [ ] Existing flows unchanged: tab switching, predictions, settle-up, dark toggle, league view all behave
      exactly as before; only motion is added.
- [ ] Count-up limited to hero figures; small stat cells static.
- [ ] Win glow plays once per page load on settled wins only; never on loss/push; no replay on re-scroll.
- [ ] Per phase: built → staged at `cashford-staging.vercel.app` → self-tested in the logged-in browser →
      your QC sign-off → version-stamped + pushed to prod, before the next phase starts.

## Files

**New:** `components/motion.tsx`, `lib/motion-math.ts`, `lib/motion-math.test.ts`.
**Edited (CSS):** `app/globals.css`.
**Edited (Phase 1):** `components/HomeTabs.tsx`, `components/LeagueTabs.tsx`, `components/AnalyticsTab.tsx`,
`components/MatchesTab.tsx`, `components/MatchFeedCard.tsx`, `components/FixtureHeader.tsx`,
`components/ui.tsx`, `app/page.tsx`, `app/leagues/[slug]/page.tsx`, `components/MatchCard.tsx`,
`app/leagues/[slug]/m/[id]/MatchTabs.tsx`, `components/ThemeToggle.tsx`.
**Edited (Phase 2):** `components/AnalyticsTab.tsx`, `components/MatchFeedCard.tsx`, `components/MatchesTab.tsx`,
`app/page.tsx`.
**Edited (Phase 3):** `components/AnalyticsTab.tsx` (ring + DayBars).

## Deploy (gated — only on your go-ahead, per phase)

`node scripts/stamp-version.mjs` → commit `lib/version.ts` + the phase's files (explicit `git add`, never
`git add .`) → `git push origin main` → Vercel auto-deploys `bom1`. Staging first:
`vercel deploy --yes --scope ananthmenon10` → `vercel alias set <url> cashford-staging.vercel.app`.

## Sources & references

- **Handoff:** `~/Downloads/Cashford.zip` → `handoff/cashford-motion.css`, `handoff/cashford-motion.js`
  (extracted copy in scratchpad). 9 keyframes, the touch/tab/seg/feed/result/live class set, and the
  `countUp`/`observeReveals`/`onGoal`/`wireSwitchers` helpers.
- **Tokens:** `app/globals.css:10–37` (`@theme`), `:46–63` (`html.dark`), existing `live-pulse` at `:77–81`.
- **Targets:** `components/HomeTabs.tsx`, `MatchesTab.tsx` (HubLiveCard `:87`, NextUpCard, picks-due `:243`),
  `MatchFeedCard.tsx` (ResultFull `:259–300`), `AnalyticsTab.tsx` (no ring/SVG today — `pct()` `:15`, DayBars),
  `app/page.tsx` (net `:117`), `LeagueTabs.tsx`.
- **Convention precedent for hooks/SSR:** `components/LocalTime.tsx` (null-init + `useEffect` hydration-safe
  pattern), `lib/settlement.ts` (pure-fn + golden-test).
- **Prior decision (flagged):** per-day net bars chosen over a cumulative line (2026-06-20 Analytics work).
