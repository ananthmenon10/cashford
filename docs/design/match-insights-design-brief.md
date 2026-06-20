# Design brief — Match Insights card (predict screen)

Component to design: **`<MatchInsights>`**, a card on the scoreline-prediction screen
(`app/leagues/[slug]/m/[id]/page.tsx`). It sits **between the fixture-header card and the
prediction form**, and renders **only before kickoff** (while the contest is open). It gives the
user betting-market + form context to inform their score pick. It is **not** a betting product —
tone is "here's what the market and form say," with a quiet "for guidance only" disclaimer.

Mobile-first, single column, **max width 480px**. Must look native to the existing predict
screen and support **light + dark** themes. Use only the design tokens below.

## Elements to show & ideal representation

| # | Element | Ideal representation |
|---|---------|----------------------|
| 1 | **1X2 win probabilities** (Home/Draw/Away %) | The hero. One full-width **3-segment horizontal bar** (Home `primary` · Draw `subtle/muted` · Draw neutral · Away `loss` or a desaturated tone), widths proportional to %, each segment labelled with team short code + %. Below it (or inline), three compact labelled readouts: `GER 64% · Draw 20% · CIV 16%`. Geist Mono for the numbers. |
| 2 | **Top 3–5 scorelines** | A single **row of ranked chips**, most-likely first and visually emphasised (primary tint/border). Each chip: big mono score `1–0` + small `%` beneath. e.g. `1–0 16%` `2–0 13%` `2–1 12%` `1–1 10%`. (Designer note: tapping a chip will later prefill the score stepper — design them to feel tappable.) |
| 3 | **Over/Under goals line** | One **chip / one-liner** with a goals icon: "Market leans high-scoring · Over 2.5". A subtle up/down arrow conveys high vs low. Secondary weight. |
| 4 | **BTTS %** + **Clean-sheet %** (each team) | A compact **stats strip / 3-up grid** of small labelled cells: `Both score 40%` · `GER clean sheet 45%` · `CIV clean sheet 22%`. Mono numerals, muted labels. |
| 5 | **Raw bookmaker odds + provider** | A **muted footnote row** at the card bottom: "Odds: DraftKings · 1.51 / 4.70 / 6.00" (decimal) with the "for guidance only" disclaimer beside/under it. De-emphasised — smallest text. |
| 6 | **Recent form (last 5)** | Per team, a row: crest + short name + **5 small W/D/L pills** (W=`win`, D=`muted/subtle`, L=`loss`), most-recent on the right. Two rows (home, away). Classic form guide. |
| 7 | **Head-to-head** | A **summary line** + short list: "Last meetings — GER 1W · 2D" then up to 3–5 rows `2–2 · 2009 · Friendly`. |
| 8 | **Group standings** (group stage only) | A **mini standings table**: rank · team · `P W D L GD Pts`, with **the two teams in this fixture highlighted**. 4-row group. Hidden for knockout matches. |

## Layout hierarchy (suggested, not prescriptive)

```
┌─ Match insights ──────────────── Odds via ESPN ─┐
│ [1] Win-probability bar  GER 64% · Draw 20% · CIV 16% │  ← hero, always visible
│ [2] Likely scores  1–0 16% · 2–0 13% · 2–1 12% · 1–1 …  │
│ [3] Over 2.5 leaned   [4] Both score 40% · CS 45%/22%   │  ← secondary stats strip
│ ─────────────────────────────────────────────────────  │
│ ▸ Form & history (collapsible)                          │
│   [6] GER  W W D L W      CIV  L W W D L                 │
│   [7] H2H  GER 1W · 2D · 0L  →  2–2 ’09 · 1–0 ’06 …      │
│   [8] Group F table (this fixture's two teams bold)      │
│ ─────────────────────────────────────────────────────  │
│ [5] Odds: DraftKings · 1.51 / 4.70 / 6.00 · guidance only│  ← muted footnote
└─────────────────────────────────────────────────────────┘
```
Keep the hero (1 + 2) above the fold so the prediction form's CTA stays reachable; put 6–8 in a
collapsible "Form & history" section.

## States to design

1. **Full** — all sections populated (use the sample data below).
2. **Odds not available yet** — match >5 days out / unpriced: hide 1–5; show a single muted line
   "Odds & insights appear closer to kickoff," optionally still show form/H2H if present.
3. **Both themes** — light and dark, side by side.

## Sample data (real — Ivory Coast at Germany, WC2026, probed live)

- Home **Germany (GER)**, Away **Ivory Coast (CIV)**. Germany strong favourite.
- 1X2: **GER 64% · Draw 20% · CIV 16%**. Raw odds (DraftKings): GER 1.51 / Draw 4.70 / CIV 6.00.
- Likely scores: **1–0 16% · 2–0 13% · 2–1 12% · 1–1 10% · 3–0 7%**.
- Over/Under: line **2.5**, Over favoured ("leans high-scoring").
- BTTS **40%** · Clean sheet **GER 45% / CIV 22%**.
- Form — GER: **W W D L W**; CIV: **L W W D L**.
- H2H: **2–2 (2009)**, sample older meetings.
- Group standings: GER 1st, then 3 others.

## Design tokens — use ONLY these (CSS variables; values for light / dark)

| Token | Light | Dark | Use |
|-------|-------|------|-----|
| `bg` | `#f7f8fa` | `#0b0f14` | page behind the card |
| `surface` | `#ffffff` | `#131922` | card background |
| `fg` | `#0f172a` | `#e6eaf0` | primary text |
| `muted` | `#64748b` | `#8b98a9` | secondary text |
| `label` | `#475569` | `#cbd5e1` | small labels |
| `border` | `#e5e8ec` | `#232b36` | card / divider borders |
| `subtle` | `#eef1f4` | `#232b36` | inactive segment / chip bg |
| `primary` | `#15a66a` | `#15a66a` | Home / favourite / emphasis |
| `primary-press`| `#0e8455` | `#34d399` | pressed / accent-on-mint text |
| `mint` | `#e7f6ef` | `rgba(21,166,106,.18)` | soft success bg |
| `win` | `#16a34a` | `#4ade80` | W pill / positive |
| `loss` | `#ef4444` | `#f87171` | L pill / Away / negative |
| `push` | `#64748b` | `#64748b` | neutral |
| `accent` | `#f2c94c` | `#f2c94c` | amber accent |
| `amber-bg` / `amber-fg` | `#fdf4d6` / `#92690b` | `rgba(242,201,76,.14)` / `#e8c466` | warning/soft |

- Radii: card **16px**, control **12px**, pill **999px**.
- Fonts: **Hanken Grotesk** for text; **Geist Mono** for ALL numerals (%, scores, odds).
- Match the existing card style: `border 1px var(--border)`, `background var(--surface)`,
  `border-radius 16px`, `padding 16px`, soft shadow `0 2px 8px rgba(15,23,42,.04)` (light only).
- Section label style used elsewhere: 11px, uppercase, `letter-spacing .04em`, `color: muted`.

## Deliverable

A self-contained **HTML/CSS mockup** (inline styles or a `<style>` block, no external assets) of
the `<MatchInsights>` card showing the **Full** and **Odds-not-available** states in **both light
and dark**. Or a Figma frame. We'll translate it into a React component using Tailwind v4
semantic tokens (`bg-surface`, `text-muted`, `text-win`, etc.).
