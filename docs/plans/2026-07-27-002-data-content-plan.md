# Data & content plan — what each screen shows, where it comes from, how often we pull

Date: 2026-07-27 · Synthesizes: docs/research/2026-07-27-datasource-report-sol.md (live-verified),
Opus UX research (session transcript), design review round 1 (doc 2026-07-27-001).

## Headline: ESPN backbone + low-frequency FotMob enrichment (decided 2026-07-27)

FotMob's current JSON API (`/api/data/*`) answers without its signature header (live-verified),
but its terms forbid automated/regular use and access controls have churned twice this year.
**Ananth's decision: hybrid.** ESPN/FPL remain the backbone (all per-minute polling). FotMob is
polled at most **every ~4h with randomized jitter** (never a fixed interval), **only for fields
ESPN lacks**, verified by same-match comparison (FotMob 4813735 vs ESPN 740958):
- FotMob-unique, in scope: match xG (full/halves/open-play/set-play/xGOT) + shot-level shot map ·
  player ratings + Player of the Match · momentum (post-match view only) · auto insight facts ·
  predicted lineups when present.
- ESPN-unique: odds (FotMob has none). Everything else exists on both → always ESPN.
- Live momentum is out of scope: it needs live polling, which FotMob never gets.
Safety rails: kill-switch env flag; per-module graceful degradation (403/shape-change hides the
module, never breaks the page); narrow adapter + raw-sample retention; volume stays at dozens of
requests/day (10 fixtures × a few slow ticks).

What we verified we CAN have, free and keyless: confirmed lineups + formations (ESPN summary),
full key events + 96-entry commentary (ESPN), team/player match stats (ESPN), live scores + goals/
cards (ESPN scoreboard), form/H2H/table/odds (ESPN, already integrated), fixtures/GWs/deadlines/
player season stats + availability news (FPL), match + shot-level xG (Understat, post-match XHR
trick). Real gaps with no free source: **predicted lineups** (build our own from last-5 confirmed
XIs + FPL availability, labeled "Cashford predicted" — or omit at launch) and **player ratings**
(omit; not prediction-relevant).

## Source map (per data type → source, cadence, fallback)

One-minute pg_cron stays the scheduler; each source gets its own `next_fetch_at`/TTL — never call
everything on every tick.

| Data | Source & cadence | Fallback |
|---|---|---|
| Fixtures / GW / deadlines | FPL every 6h; every 15m from T−48h to GW deadline | ESPN scoreboard; OpenFootball backfill |
| Live score + goals/cards | ESPN scoreboard 60s, T−5m → FT+10m | FPL fixtures (score/status only) |
| Confirmed lineups | ESPN summary 60s from T−75m until rosters appear, then freeze | none free — degrade gracefully |
| Predicted lineups | Own estimate (last-5 XIs + FPL availability) at T−48/24/2h, labeled | omit rather than fake |
| Match stats (team/player) | ESPN summary 2m live; FT+5m, FT+30m | FPL event stats (partial) |
| Match xG + shot map | FotMob, first jittered ~4h tick after FT, freeze on found | Understat post-FT; own model estimate |
| Player ratings + PotM | FotMob, same post-FT tick | omit module |
| Momentum (post-match) + insight facts | FotMob: post-FT tick; facts at the T−24h-ish tick | omit module |
| League table | ESPN `/apis/v2/.../standings` 10m when live, hourly idle | recompute from stored results |
| Form / H2H | ESPN summary at T−24h + T−90m, cached | derive from stored results |
| Odds | ESPN 6h → hourly (T−24h) → 10m (T−2h), stop at kickoff | our de-vigged Poisson model |
| Top scorers | FPL bootstrap 15m matchdays, daily otherwise | Understat player table |
| Match preview | Generated from ESPN form/H2H/table/odds + FPL availability, T−24h + T−90m | link out; never ingest FotMob copy |

Engineering rules from the research: narrow adapter per source + raw-sample retention + missing-
field monitoring (all are undocumented APIs); never trust ESPN `hasOdds` (check the arrays); an
ESPN summary's embedded table is the CURRENT season's, even on old matches; store `provider` on
every xG value (Understat vs our model disagree materially — never mix scales).

## Screen → content mapping (with the UX research folded in)

- **Match detail**: no tabs — one scroll per state. Pre: header (never 0-0; dash) → your calls per
  league → the room (locked placeholders) → insights (odds, model top scores, form, H2H, 3-row
  table window, team news). Live: what-if strip (protected feature) → league board sorted by
  current-score value with per-row annotations → momentum + one 5-stat row. FT: verdict
  (Exact/Result/Miss) → board with "Off by" → share → one-line market retrospective ("Odds had 2-0
  at 14%").
- **Entry sheet**: scoreline CHIPS from our model on each collapsed row (top-3, one tap fills +
  advances) — the flagship interaction; steppers + tappable number popover as fallback input;
  never default 0-0; auto-advance; "Copy last week's scorelines" + "Fill from the model" (rows
  tagged `model` until touched); one-click Enter carrying the stake; per-fixture "Detailed match
  insight" link marked Coming soon.
- **Matches tab**: consolidated "Your GW3" strip under the GW navigator (points in header only when
  identical across leagues, else per-row Pts column; rank + money per league; one provisional
  caveat; ≤4 rows then "+n more") + segmented control **Fixtures & Results | Table** (FPL naming;
  real PL table lives here, not in leagues).
- **League screen**: Gameweek / Season / Dues + **Table** (Ananth's call 2026-07-27, overriding
  the research recommendation — the PL table also lives inside each league for one-tap access,
  same component as the Matches-tab Table segment).
- **Home league card**: header + competition-row list (n=1 renders as today); second active
  competition blocked at the data layer (partial unique index) until needed.
- **Copy**: adopt the Opus voice rules + full string table (in transcript; to be applied wholesale
  in design pass 2). Key: "You're not in GW3 yet" · "6 of 9 in · pot ₹600" · "All 10 fixtures, or
  you're not in. Sitting out costs nothing." · "Nudge Nikhil and Kunal" · ordinals not P-numbers ·
  Blank/Double Gameweek as official terms · ante/stake, never bet/wager.
- **Join/create**: competition step (PL preselected, consequence line "First gameweek: GW3 ·
  deadline …"); mid-season creation starts at next open GW, earlier weeks read "before your time";
  join preview shows league + competition + ante + members + next deadline + "Joining is free. You
  only stake when you enter a gameweek."; invite copy is a paste-ready WhatsApp message with plain
  code.
- **Parked (v-later)**: global Cashford pre-deadline lean (all-users pick distribution — no friend
  leakage); monthly "phases" leaderboards (FPL pattern); predicted lineups if not at launch.

## Confirmations (resolved 2026-07-27)
1. Data sources: **hybrid** — ESPN/FPL backbone, FotMob at ~4h jittered cadence for its unique
   fields only (see headline).
2. Tabs: Matches gains Fixtures & Results | Table; **leagues ALSO get a Table tab** (4 league tabs).
3. Predicted lineups: **omit at launch**; confirmed lineups (ESPN, ~T−75m) ship day one; own
   predicted-XI generator is a season-time improvement. FotMob's predicted lineups may arrive
   opportunistically via the slow tick when present — display only if fresh.
