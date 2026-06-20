---
title: "feat: Dark mode toggle on home (app-wide theme, remembered)"
type: feat
status: completed
date: 2026-06-20
---

# Dark mode toggle on the home page — app-wide theme, remembered locally

## Overview

Add a sun/moon **dark-mode toggle to the home page top bar**. The theme it sets is **app-wide**
(home, league, match, dues, auth screens) and is **remembered in `localStorage`** so it sticks across
reloads and navigation. On a first visit with no stored choice, the app **follows the device's
`prefers-color-scheme`**; once the user taps the toggle, that manual choice wins forever (until they
change it again).

The colours are not invented — the design file ships a full dark palette in **§07 — DARK THEME**
(`docs/design/Cashford System.dc.html:767`), including the League view and several MatchCard states
rendered in dark. We map that palette onto the existing semantic tokens.

**Decisions (confirmed with user):**
- **Scope: app-wide**, toggle control lives on home. (Design §07 shows multiple screens in dark.)
- **Default: follow device setting** (`prefers-color-scheme`); a manual toggle overrides and persists.

## Why this is mostly free

`app/globals.css` already defines every colour as a semantic CSS variable in `@theme`
(`--color-bg`, `--color-surface`, `--color-fg`, `--color-border`, `--color-muted`, `--color-subtle`,
`--color-mint`, …) and the whole UI consumes them through Tailwind utilities (`bg-surface`,
`text-fg`, `border-border`, …). In Tailwind v4 those utilities compile to `var(--color-…)`, so
**redefining the variables under a `.dark` scope re-themes ~90% of the app from one block** — no
per-component edits. Only a short, enumerated list of **hardcoded hex** utilities (result-banner
tints, dashed empty-state borders, the cancelled badge) need explicit `dark:` variants.

## Approach (4 mechanisms)

1. **Class-based theming.** A `.dark` class on `<html>` flips a block of CSS-variable overrides.
   Register the Tailwind v4 variant so `dark:` utilities also work for the hex spots.
2. **No-flash (FOUC) guard.** A tiny **blocking inline script** in the root layout `<head>` reads
   `localStorage` (falling back to `prefers-color-scheme`) and sets/clears `.dark` on `<html>`
   *before first paint and before React hydrates*. `<html suppressHydrationWarning>` absorbs the
   class mismatch.
3. **Toggle component.** A small `"use client"` `ThemeToggle` (sun/moon) in the home top bar flips
   the class and writes `localStorage`. It renders a neutral placeholder until mounted (same pattern
   as `components/LocalTime.tsx`) so SSR never guesses the wrong icon.
4. **Hex remediation.** Swap a few `bg-[#F1F4F7]`-style literals to existing tokens where identical,
   and add `dark:` variants to the rest, using the design §07 dark values.

---

## Dark palette — design §07 → tokens

Source: `docs/design/Cashford System.dc.html:767-836`.

| Token (`globals.css`)   | Light (current) | **Dark (new)**          | Notes |
|-------------------------|-----------------|-------------------------|-------|
| `--color-bg`            | `#f7f8fa`       | `#0B0F14`               | page base (§07 "BG") |
| `--color-surface`       | `#ffffff`       | `#131922`               | cards/headers (§07 "Surface") |
| `--color-fg`            | `#0f172a`       | `#E6EAF0`               | primary text (§07 "Text") |
| `--color-border`        | `#e5e8ec`       | `#232B36`               | §07 "Border" |
| `--color-muted`         | `#64748b`       | `#8b98a9`               | lifted from `#64748b` for legibility on dark |
| `--color-label`         | `#475569`       | `#cbd5e1`               | secondary emphasis text |
| `--color-subtle`        | `#eef1f4`       | `#232B36`               | chip / inactive-segment bg |
| `--color-mint`          | `#e7f6ef`       | `rgba(21,166,106,.18)`  | OPEN badge / "YOU" pill / winner row soft bg |
| `--color-amber-bg`      | `#fdf4d6`       | `rgba(242,201,76,.14)`  | countdown pill bg |
| `--color-amber-fg`      | `#92690b`       | `#e8c466`               | countdown pill text |
| `--color-primary-press` | `#0e8455`       | `#34d399`               | brighter so OPEN/SETTLED badge + CTA **text** reads on dark (design uses `#4ade80`) |
| `--color-win`           | `#16a34a`       | `#4ade80`               | **text** brightens (nets, on-track, amounts). Fill pinned separately ↓ |
| `--color-loss`          | `#ef4444`       | `#f87171`               | text brightens (design lost amount) |
| `--color-primary`       | `#15a66a`       | `#15a66a` (unchanged)   | brand — buttons stay solid green both themes |
| `--color-accent`        | `#f2c94c`       | `#f2c94c` (unchanged)   | brand gold |
| `--color-live`          | `#ff3b30`       | `#ff3b30` (unchanged)   | reads on dark; LIVE badge fill stays red |
| `--color-push`          | `#64748b`       | `#64748b` (unchanged)   | neutral, acceptable on dark |

**Fill-vs-text caveat (must handle):** flipping `--color-win` to a light green is correct for *text*
but would lighten any `bg-win` *fill*. Grep `bg-win|bg-loss|bg-primary-press` first; the only fill is
the **won banner** (`MatchCard.tsx`). Pin it to explicit `bg-[#16A34A]` so it stays solid green with
white text in both themes (matches §07 dark won card at `:822`). Verify no `bg-primary-press` fills
exist before flipping that token.

---

## Implementation

### File 1 — `app/globals.css`

After `@import "tailwindcss";`, register the class variant; after the existing `@theme {…}` block,
add the dark overrides (plain CSS, **not** inside `@theme` — `html.dark` out-specifies `:root`):

```css
@import "tailwindcss";

/* Class-based dark mode: dark: utilities apply under html.dark (and descendants). */
@custom-variant dark (&:where(.dark, .dark *));

@theme { /* …unchanged light tokens… */ }

/* Dark theme — design §07. One block re-themes the app via the shared CSS vars.
   Brand hues (primary, accent, live) stay constant for continuity. */
html.dark {
  --color-bg: #0B0F14;
  --color-surface: #131922;
  --color-fg: #E6EAF0;
  --color-border: #232B36;
  --color-muted: #8b98a9;
  --color-label: #cbd5e1;
  --color-subtle: #232B36;
  --color-mint: rgba(21, 166, 106, .18);
  --color-amber-bg: rgba(242, 201, 76, .14);
  --color-amber-fg: #e8c466;
  --color-primary-press: #34d399;
  --color-win: #4ade80;
  --color-loss: #f87171;
  color-scheme: dark; /* native form controls / scrollbars follow */
}
```

> `color-scheme: dark` also tells the browser to render the iOS/Android status-bar text and native
> scrollbars in dark; pair with `<meta name="theme-color">` handling in File 2.

### File 2 — `app/layout.tsx`

- Add `suppressHydrationWarning` to `<html>`.
- Add a blocking inline script in `<head>` (runs before paint, before hydration).
- Make `themeColor` media-aware so the browser chrome matches on first paint.

```tsx
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#15A66A" },
    { media: "(prefers-color-scheme: dark)", color: "#0B0F14" },
  ],
};

// …in the component:
return (
  <html lang="en" suppressHydrationWarning className={`${sans.variable} ${mono.variable}`}>
    <head>
      <script
        dangerouslySetInnerHTML={{
          __html:
            "(function(){try{var s=localStorage.getItem('cf-theme');" +
            "var d=s?s==='dark':matchMedia('(prefers-color-scheme: dark)').matches;" +
            "document.documentElement.classList.toggle('dark',d);}catch(e){}})();",
        }}
      />
    </head>
    <body className="min-h-screen">{children}</body>
  </html>
);
```

Storage key: **`cf-theme`**, values `"dark"` / `"light"`. Absent key ⇒ follow system.

### File 3 — `components/ThemeToggle.tsx` (new, client)

```tsx
"use client";
import { useEffect, useState } from "react";

export function ThemeToggle() {
  const [dark, setDark] = useState<boolean | null>(null); // null until mounted → no SSR icon guess
  useEffect(() => setDark(document.documentElement.classList.contains("dark")), []);

  function toggle() {
    const next = !document.documentElement.classList.contains("dark");
    document.documentElement.classList.toggle("dark", next);
    try { localStorage.setItem("cf-theme", next ? "dark" : "light"); } catch {}
    // keep the browser chrome in sync
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", next ? "#0B0F14" : "#15A66A");
    setDark(next);
  }

  return (
    <button
      onClick={toggle}
      aria-label="Toggle dark mode"
      aria-pressed={dark ?? false}
      className="flex h-[30px] w-[30px] items-center justify-center rounded-full text-muted transition-colors active:scale-95"
    >
      {dark === null ? <span className="block h-4 w-4" /> : dark ? <SunIcon /> : <MoonIcon />}
    </button>
  );
}
// SunIcon / MoonIcon = inline <svg> (no external deps; CSP-safe). currentColor fill.
```

### File 4 — `app/page.tsx` (home top bar)

Mount the toggle in the existing right-side header group (`app/page.tsx:77`), before the avatar:

```tsx
<div className="flex items-center gap-3">
  <span className="rounded-pill bg-subtle …">v{APP_VERSION}</span>
  <ThemeToggle />
  <span className="… bg-mint text-primary-press">{initials(username)}</span>
  <form action={logout}><button …>Sign out</button></form>
</div>
```

### File 5 — Hardcoded-hex remediation

From `grep -rEoh '(bg|text|border)-\[#…\]' app components` — full current list and treatment:

| Spot | File | Change |
|------|------|--------|
| Won banner fill `bg-win` | `MatchCard.tsx` (won) | **pin** → `bg-[#16A34A]` (stays solid both themes) |
| Lost banner `bg-[#FEF2F2]` + `text-[#991B1B]` | `MatchCard.tsx` (lost) | add `dark:bg-[#ef44441f] dark:text-[#fca5a5]` |
| Cancelled banner `bg-[#FEE2E2]` + `text-[#B91C1C]` | `MatchCard.tsx` (cancelled) | add `dark:bg-[#ef44441f] dark:text-[#fca5a5]` |
| Push / sat-out / void `bg-[#F1F4F7]` ×3 | `MatchCard.tsx` | swap → `bg-subtle` (token auto-flips; identical in light) |
| Reveal divider `border-[#F1F4F7]` | `MatchCard.tsx` (locked) | swap → `border-border` |
| Void/cancelled container `bg-[#FBFCFD]` ×2 | `MatchCard.tsx` | add `dark:bg-surface` |
| Cancelled badge `text-[#B91C1C] bg-[#FEE2E2]` | `ui.tsx` `StatusBadge` | add `dark:text-[#fca5a5] dark:bg-[#ef44441f]` |
| Avatar palette `#0F172A` | `ui.tsx` `PALETTE` | change → `#334155` (near-invisible on dark `#131922`; reads on both) |
| Dues rows `bg-[#FEF2F2]` / `bg-[#F0FDF4]` | `leagues/[slug]/page.tsx` | add `dark:bg-[#ef44441f]` / `dark:bg-[#16a34a1a]` |
| Dashed empty border `border-[#CBD5E1]` ×3 | home / league / detail | add `dark:border-[#2f3a48]` |
| Live pill `bg-[#FFECEC]`, `text-[#B91C1C]` | `leagues/[slug]/m/[id]/page.tsx` | add `dark:bg-[#ff3b301f]`, `dark:text-[#fca5a5]` |

> The detail page's won/lost/push summary already uses inline `style={{ color: var(--color-win/loss/push) }}`
> — those **auto-brighten** once the tokens flip. No edit needed there.

### File 6 — Audit auth/static pages

`app/login/page.tsx`, `app/change-password/page.tsx`, `app/rules/page.tsx` render under the same root
layout, so they inherit the theme and the FOUC script. Grep each for hardcoded hex and the design's
light-only assumptions (e.g. password strength bars, the amber "first time" banner) and add `dark:`
variants to match §07 where needed. Login/change-password are pre-toggle but still themed if a choice
was stored earlier in the browser.

---

## System-wide impact

- **Interaction graph:** purely client/presentation. Toggle → `classList` on `<html>` + one
  `localStorage.setItem` + one `<meta>` update. No server action, no RLS, no DB, no settlement code.
- **Auto-refresh interplay:** `components/AutoRefresh.tsx` uses `router.refresh()` (soft RSC refresh),
  which **preserves client DOM** — the `.dark` class and toggle state survive every 20–30s refresh on
  the league/match pages (no theme flicker). Even a hard reload re-applies instantly via the inline script.
- **State lifecycle:** no persisted server state; `localStorage` write is idempotent and failure-tolerant
  (try/catch). No orphan/partial-write risk.
- **Error propagation:** `localStorage` unavailable (private mode / blocked) ⇒ catch ⇒ silently falls
  back to system preference on each load. Toggle still works in-session (class flip), just isn't remembered.

## Edge cases & defaults

- **No stored choice** → follow `prefers-color-scheme`; manual toggle then overrides and persists.
- **FOUC** → eliminated by the blocking `<head>` script (sets class before first paint).
- **Hydration mismatch** on the `<html>` class → `suppressHydrationWarning`.
- **Wrong-icon flash** in the toggle → `dark===null` placeholder until mounted.
- **OS theme changes while app is open** → not reflected until next load in v1 (acceptable). *Optional:*
  a `matchMedia('(prefers-color-scheme)')` listener that re-applies only when no `cf-theme` key is set.
- **Multiple tabs** → independent until reload in v1. *Optional:* `window.addEventListener('storage', …)`
  to sync the class across tabs live.
- **Avatar contrast** → only the `#0F172A` palette entry disappears on dark; swapped to `#334155`.
- **Brand fills** (primary buttons, LIVE badge, won banner) stay solid in both themes by design.

## Out of scope (don't touch)

- Server, RLS, settlement, ESPN polling, contest/version logic.
- A user-profile "theme" setting persisted server-side (this is local-only, per the request).
- Redesigning any component layout — this is a colour-token + toggle change only.
- Per-league or per-screen theme overrides — one global theme.

## Acceptance criteria

- [ ] A sun/moon toggle appears in the home top bar; tapping it flips the whole app between light/dark.
- [ ] Choice persists across reloads **and** across navigation to league/match/dues/auth pages.
- [ ] First visit with no stored choice honours the device's light/dark setting.
- [ ] **No flash** of the wrong theme on load (verified on a throttled reload).
- [ ] Dark colours match design §07 (bg `#0B0F14`, surface `#131922`, border `#232B36`, text `#E6EAF0`,
      primary/accent constant); all 12 MatchCard states are legible in dark (banners, badges, reveal grid).
- [ ] No hydration warnings in the console in either theme.
- [ ] `npm run typecheck`, `npm run build`, `npm test` all pass.

## Verification

1. `npm run typecheck` (clean) · `npm run build` (succeeds) · `npm test` (39/39 — settlement untouched).
2. Local UI walk (`chrome-devtools-axi`; logged-in `/chrome` route if auth needed) **in both themes**:
   - Home: toggle flips bg/surface/text/cards; version pill, avatar, "Predict/Edit" CTAs all legible.
   - League page: tabs, match cards (open/picked/locked-reveal/live/won/lost/push/void/cancelled),
     dues leaderboard + owe/owed rows — all readable; won banner stays solid green.
   - Match detail: prediction form, reveal grid, won/lost/push summary brighten correctly.
   - Reload mid-walk → theme holds, **no white flash**. Navigate between pages → theme holds.
   - Toggle off → returns to light; clear `cf-theme` in devtools → next load follows OS setting.
3. Throttled-network reload to confirm the FOUC guard (no light→dark pop).

## Deploy (gated — only on user's go-ahead)

Established Cashford flow: branch `feat/dark-mode-toggle` → build all changes → `npm run typecheck`/
`build`/`test` → **deploy a Vercel staging preview** (`vercel deploy --yes` + alias
`cashford-staging.vercel.app`) for the user to test the toggle + persistence on real (read-only) data →
on approval merge to `main` (ff), run `node scripts/stamp-version.mjs` (v38 → v39), commit, `git push`
→ Vercel auto-deploys prod (bom1). Do not commit/push until the user approves.

## Sources & references

- **Design dark palette & dark screens:** `docs/design/Cashford System.dc.html:767-836` (§07 — DARK THEME).
- **Token definitions:** `app/globals.css:7-32` (`@theme`).
- **Root layout / fonts / themeColor:** `app/layout.tsx:26-42`.
- **No-flash + mounted-placeholder pattern already in repo:** `components/LocalTime.tsx:7-28`.
- **Components consuming tokens (re-theme for free):** `components/MatchCard.tsx`, `components/ui.tsx`,
  `app/page.tsx`, `app/leagues/[slug]/page.tsx`, `app/leagues/[slug]/m/[id]/page.tsx`.
- **Tailwind v4 class-based dark mode** (`@custom-variant`) and CSS-variable theming — Tailwind v4 docs.
