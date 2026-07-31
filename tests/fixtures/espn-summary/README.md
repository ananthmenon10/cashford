# ESPN summary fixtures — Phase 4

**Provenance: real recorded ESPN summary payload, trimmed from the capture without changing
retained keys, nesting, or value types.** Recorded 2026-07-31 from the keyless public API for the
finished Premier League match Liverpool 1–1 Brentford (event `740975`, played 2026-05-24).

`ft.json` keeps the real header and score, three key-event records, five commentary records,
team statistics, and four roster entries per team. The roster statistics are the provider's
`roster[].stats[]` records, including names such as `totalGoals` and `goalAssists`.

`pre.json` is a real recorded ESPN summary payload trimmed from the Arsenal–Coventry City
pre-match capture (`401879301`), recorded 2026-07-31. It keeps the scheduled header, both real
odds rows, and both real team-level roster entries. The source has no player `roster[]` rows,
player match stats, key events, or commentary.

`live.json` is derived from the real FT capture above, not recorded live data. It changes the
status to `in`, keeps the source's 0–0 halftime score and first-half event records, and retains
the trimmed roster shape. Replace it with a genuine live capture once the season runs.
