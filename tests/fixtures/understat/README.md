# Understat fixtures — Phase 4

**Provenance: hand-authored, not captured live** (see `tests/fixtures/espn-summary/README.md`).

- `match.json` — one finished Understat match record: `h`/`a` team titles, string-typed
  `goals.h`/`goals.a` and `xG.h`/`xG.a` (Understat serialises numerics as strings inside its
  JSON-in-HTML payload — the adapter must coerce, not just parse-through).
- `league.json` — a two-match league page: one finished (`isResult: true`, populated `goals`/`xG`)
  and one not-yet-played (`isResult: false`, `null` `goals`/`xG`), to exercise the "absent beats
  empty" rule for fixtures that haven't kicked off yet (A-10/A-10a…e).

Replace with genuine recorded payloads before trusting this as a real regression net.
