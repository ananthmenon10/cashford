# ESPN standings fixture — Phase 4

**Provenance: hand-authored, not captured live** (see `tests/fixtures/espn-summary/README.md` for
why — same constraint applied here). `table.json` follows the `children[].standings.entries[]`
shape §2.5 of the plan describes for ESPN's group-scoped standings payload: one group
("Premier League") with two ranked entries, each carrying `rank`/`gamesPlayed`/`wins`/`ties`/
`losses`/`points`/`pointDifferential` as named `stats[]` rows (ESPN's real convention of encoding
stats as a `{name, value}` array rather than flat fields).

Replace with a genuine recorded payload before trusting this as a real regression net.
