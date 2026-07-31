Recommendation: do not make FotMob a production dependency. Expand ESPN for confirmed lineups, major live events, commentary and team/player stats; retain FPL for gameweeks and player-season data; use Understat only for post-match xG. FotMob worked without `x-mas` in my tests, but its terms forbid automated or regular use and its access controls have changed several times.

Tests ran on July 27, 2026 from Cashford’s India-hosted workspace. Plain means curl’s default headers; browser-like adds Chrome user agent, `Accept`, `Referer`, and `Origin`. No repo files were changed.

## Findings

### 1. FotMob

#### Endpoint and status results

| URL | Plain curl | Browser-like | Result |
|---|---:|---:|---|
| [www.fotmob.com/api/matches?date=20260524](https://www.fotmob.com/api/matches?date=20260524) | `404` HTML | `404` HTML | Old JSON path is dead |
| [www.fotmob.com/api/leagues?id=47](https://www.fotmob.com/api/leagues?id=47) | `404` HTML | `404` HTML | Old path is dead |
| [www.fotmob.com/api/matchDetails?matchId=4813745](https://www.fotmob.com/api/matchDetails?matchId=4813745) | `404` HTML | `404` HTML | Old path is dead |
| [www.fotmob.com/api/data/matches?date=20260524](https://www.fotmob.com/api/data/matches?date=20260524) | `200` JSON | `200` JSON | Works |
| [www.fotmob.com/api/data/leagues?id=47](https://www.fotmob.com/api/data/leagues?id=47) | `200` JSON | `200` JSON | Works |
| [www.fotmob.com/api/data/matchDetails?matchId=4813745](https://www.fotmob.com/api/data/matchDetails?matchId=4813745) | `200` JSON | `200` JSON | Works |
| Same match-details request with a valid current `x-mas` | `200` JSON | — | Works |
| Same request with `x-mas: definitely-invalid` | `200` JSON | — | Also works |
| [api.fotmob.com/matches?date=20260524](https://api.fotmob.com/matches?date=20260524) | `200` XML | `200` XML | Separate, older/mobile-style XML feed |

The live JSON base is now `https://www.fotmob.com/api/data`, not the widely copied `https://www.fotmob.com/api`.

Other confirmed current endpoints, all returning `200` with plain curl:

- [`/api/data/allLeagues`](https://www.fotmob.com/api/data/allLeagues): league directory and IDs.
- [`/api/data/teams?id=9825`](https://www.fotmob.com/api/data/teams?id=9825): team profile, fixtures, squad, stats and transfers.
- [`/api/data/playerData?id=737066`](https://www.fotmob.com/api/data/playerData?id=737066): player profile, career and season stats.
- `/api/data/match-score?matchId=4813745`: returned `200 {"match":null}` for this finished game, suggesting it is live-only or conditional.

#### What the three main responses contain

`/api/data/matches?date=YYYYMMDD` returns matches grouped by league. Each match has FotMob match and league IDs, teams, scores, kickoff, start/finish flags, red-card counts and status. The May 24 response contained all ten EPL final-day matches.

`/api/data/leagues?id=47` returns:

- Available seasons and current season.
- Full fixtures/results.
- Overall, home and away tables.
- League overview and transfer sections.
- Player and team leaders.

Adding `season=2025%2F2026` returned top scorer Erling Haaland, plus assists, goals-plus-assists and rating leaders. The player leader objects also link to larger JSON leaderboards on `data.fotmob.com`.

`/api/data/matchDetails?matchId=4813745` returned FotMob’s full Brighton 0–3 Manchester United page:

- Final score and major header events.
- Goals, cards and substitutions with players and minutes.
- Form and H2H.
- Stadium, referee and attendance.
- Confirmed starters, benches, formations, coaches and unavailable players.
- Per-player match ratings and detailed player stats.
- Team stats for full match and each half.
- Possession, shots, shots on target, passes and defensive stats.
- xG, open-play xG, set-play xG and xGOT.
- Shot map with shot location, player and shot-level xG.
- Momentum, table and match preview/review links.

FotMob reported xG as `0.79–1.66` for this match.

Predicted lineups are conditional, not a guaranteed field. I fetched Arsenal–Coventry, match `5795363`, 25 days before kickoff. It returned `200`, form/H2H and unavailable players, but no predicted starters or formations. Confirmed lineups are verified; predicted EPL lineups could not be verified during the off-season.

#### `x-mas` status and workarounds

FotMob’s current web bundle still generates `x-mas` for relative requests. The current implementation is visible in the site’s [minified application bundle](https://www.fotmob.com/_next/static/chunks/pages/_app-d0d35f3c4a5449ec.js). It builds a timestamped, signed payload. Its embedded seed has changed since public community implementations from earlier in 2026.

What matters operationally:

- No header, a valid header and an invalid header all returned `200` from this host.
- Browser-like headers made no difference.
- That does not prove enforcement is gone. A [community wrapper issue from April 2026](https://github.com/tommhe14/fotmob-wrapper/issues/1) reports `403` specifically for `matchDetails`.
- Current reverse-engineering reports also encounter Cloudflare `TURNSTILE_REQUIRED` after producing a correct signature.
- FotMob can therefore enforce by route, region, IP reputation or traffic pattern.

The public `fotmob-wrapper` package hardcodes an unsigned HTTP token service at `http://46.101.91.154:6006/`. I tested it: `404`, HTML. It has no stated owner, TLS, contract or uptime. It is not a stable workaround.

Extracting the latest seed from every new FotMob bundle or running a browser to mint the header could keep a scraper alive for a while, but this is fragile and crosses a clear policy line. FotMob’s [current terms](https://www.fotmob.com/term-of-service) say automated, systematic or regular use is not permitted. Its [robots.txt](https://www.fotmob.com/robots.txt) also disallows `/api/*` for ordinary agents.

For a hobby app, occasional manual research is one thing; a one-minute production cron is exactly the regular automated use they forbid.

### 2. ESPN `eng.1`

Test match: Brighton 0–3 Manchester United, ESPN event `740966`.

- [Scoreboard for May 24, 2026](https://site.api.espn.com/apis/site/v2/sports/soccer/eng.1/scoreboard?dates=20260524&limit=100): `200`, JSON, ten EPL matches.
- [Summary for event 740966](https://site.api.espn.com/apis/site/v2/sports/soccer/eng.1/summary?event=740966): `200`, JSON, 39 KB.
- [Upcoming Arsenal–Coventry summary](https://site.api.espn.com/apis/site/v2/sports/soccer/eng.1/summary?event=401879301): `200`, JSON.
- [Current EPL standings](https://site.api.espn.com/apis/v2/sports/soccer/eng.1/standings): `200`, JSON. Note that `/apis/site/v2/.../standings` returned only `{}`.

| FotMob-grade item | ESPN result |
|---|---|
| Match preview | Partial. Future summaries have news plus form, H2H, table and odds, but no dependable FotMob-style structured preview |
| Form | Yes: `lastFiveGames`, five matches per team |
| H2H | Yes: `seasonseries`, last five matchups |
| League table | Yes: `standings`; use the standalone `/apis/v2/.../standings` route |
| Confirmed lineups | Yes: 11 starters, nine bench players, starter flags, formations and formation places |
| Predicted lineups | No. The future summary returned only team shells, with no roster or formation |
| Live score | Yes |
| Live goals/cards | Yes. Scoreboard `competitions[0].details` carried the three goals and yellow card |
| Full key-event list | Yes in summary: 18 entries including kickoff, goals, card, substitutions, halftime and full time |
| Commentary | Yes: 96 entries for this match, including fouls, shots, corners, VAR and offsides |
| Team match stats | Yes: possession, shots, shots on target, passes, crosses, tackles, interceptions, clearances, cards and more |
| Player match stats | Yes: goals, assists, shots, cards, fouls, saves and substitutions |
| Match xG | No; neither `expectedGoals` nor xG appeared anywhere in this summary |
| Player ratings | No |
| Season top scorers | No in the match summary. Its `leaders` section contains match leaders such as shots and passes |
| Odds | Yes in both `pickcenter` and `odds`, including 1X2 money lines and over/under |

The scoreboard does carry live events, but only major ones. Use it for the score, goal/card notifications and match state. Use summary `keyEvents` for substitutions and the wider event list, and `commentary` if the UI needs play-by-play.

Two ESPN quirks need defensive parsing:

- Both tested summaries had populated `pickcenter` and `odds` arrays while `hasOdds` was `false`.
- The finished 2025–26 match summary currently embeds the 2026–27 table, not a historical table from the match date.

### 3. Other sources

**FPL API.** [`bootstrap-static`](https://fantasy.premierleague.com/api/bootstrap-static/) and [`fixtures`](https://fantasy.premierleague.com/api/fixtures/) both returned `200`. The current bootstrap has 38 gameweeks, 20 teams and 558 players. Player records include availability/news, minutes, starts, goals, assists, cards, saves, FPL BPS/bonus, and season xG/xA/xGI. Fixtures has the 380 EPL fixtures, gameweek IDs, deadlines through the event objects, kickoff, scores and post-start stat lists. [`event/1/live`](https://fantasy.premierleague.com/api/event/1/live/) returned `200` but an empty player list because the season has not begun. FPL remains the best source for GW mapping, deadlines, official fantasy availability, player totals and top scorers. It does not provide formations, confirmed/predicted lineups, possession, shots or an event timeline.

**Understat.** The [2025–26 EPL page](https://understat.com/league/EPL/2025) returned `200`. Its present JSON calls require an XHR-style request: `GET https://understat.com/getLeagueData/EPL/2025/` and `GET https://understat.com/getMatchData/29148/` returned `200` with `X-Requested-With: XMLHttpRequest` and a page referer; plain requests returned `404`. The league response had 380 matches, 537 player summaries and match xG. Match `29148` returned rosters, shots and player xG/xA. Understat’s xG for Brighton–United was `0.70–2.33`, materially different from FotMob’s `0.79–1.66`; do not combine models as if they share one scale. Treat Understat as an undocumented post-match enrichment source, not live infrastructure.

**football-data.org.** The unauthenticated [competition directory](https://api.football-data.org/v4/competitions/) returned `200`; [Premier League matches](https://api.football-data.org/v4/competitions/PL/matches) returned `403` without a token. The free account tier needs an API key, covers 12 competitions, allows ten calls per minute and supplies delayed scores, fixtures and tables. Live scores start at €12/month; lineups and scorers are part of the €29 deep-data tier. See its [current pricing](https://www.football-data.org/pricing) and [rate policy](https://docs.football-data.org/general/v4/policies.html). It does not fill Cashford’s free live-data gaps.

**OpenFootball.** The [2025–26 EPL JSON](https://raw.githubusercontent.com/openfootball/football.json/master/2025-26/en.1.json) returned `200` and contained all 380 fixtures/results. The project is [CC0 public-domain data](https://github.com/openfootball/football.json), but updates are community-maintained. It is valuable for historical backfill, tests and emergency fixture/result reconstruction—not live scores, lineups, events, xG or ratings.

**SofaScore check.** Its date API returned `403` with plain and browser-like server requests, so it is not a dependable keyless alternative from Cashford’s runtime.

## Recommended source map

Use the one-minute pg_cron as a scheduler, but give every source its own `next_fetch_at` or TTL. Do not call every source on every tick.

| Data | Primary source and polling | Fallback |
|---|---|---|
| Fixtures, GW, deadlines | FPL fixtures/bootstrap every 6h; every 15m from T−48h through the GW deadline | ESPN date scoreboard; OpenFootball only for backfill |
| Live score and major events | ESPN date scoreboard every 60s from T−5m until FT+10m | FPL fixtures every 2m for score/status; it cannot replace the event feed |
| Confirmed lineups | ESPN summary every 60s from T−75m until both rosters appear, then freeze | No clean free live fallback |
| Predicted lineups | Cashford-generated estimate from the last five ESPN confirmed XIs plus FPL availability; rebuild at T−48h, T−24h and T−2h; label it “Cashford predicted” | Omit rather than silently present stale third-party guesses |
| Team/player match stats | ESPN summary every 2m while live, then at FT+5m and FT+30m | FPL event stats cover only fantasy-relevant player events |
| Match xG | Understat every 15m after FT for two hours; freeze once found | Omit or show a Cashford model estimate with a separate label |
| Player ratings | No suitable free source. Show ESPN raw stats or FPL BPS, clearly labelled; calculate a Cashford rating only if its formula is public | Licensed provider if a FotMob-like rating is required |
| League table | ESPN `/apis/v2/.../standings` every 10m while EPL matches are live, hourly otherwise | Recalculate from stored FPL/ESPN results |
| Form and H2H | ESPN summary at T−24h and T−90m, then cache | Derive from Cashford’s stored ESPN results; OpenFootball for older seasons |
| Odds | ESPN summary every 6h outside T−24h, hourly until T−2h, every 10m until kickoff, then stop | Cashford’s existing de-vigged Poisson model |
| Top scorers | FPL `bootstrap-static` every 15m on matchdays, daily otherwise | Understat league player table; derive from stored ESPN goal events |
| Match preview | Generate from ESPN form/H2H/table/odds plus FPL availability at T−24h and T−90m | Link to ESPN news; do not ingest FotMob’s editorial copy |

## Risks

1. **FotMob is not production-safe.** Today’s no-header `200` responses may vanish by route, IP or deployment. Its terms explicitly reject Cashford’s proposed polling pattern.

2. **ESPN and FPL are undocumented and unversioned.** Both are much less hostile than FotMob, but neither offers a developer SLA. Keep each behind a narrow adapter, retain raw samples, monitor missing fields and alert on sudden payload-size changes.

3. **ESPN has field contradictions.** Do not trust `hasOdds`; check arrays. Do not assume a summary’s table belongs to the match’s historical season.

4. **xG models disagree.** Store `provider` and `model` with every xG value. Never splice Understat history onto FotMob or another model without marking the break.

5. **Predicted XIs and ratings remain the real free-data gaps.** A licensed feed is the only sound path if the founder wants third-party predictions and a branded rating scale.

6. **Public access is not a redistribution licence.** FotMob is explicit; ESPN, FPL and Understat still need a terms review before Cashford grows beyond a private hobby app.

Next action: extend Cashford’s existing ESPN summary parser for rosters, key events, commentary and match stats, while keeping FotMob out of the cron.