# FPL snapshot fixture

Recorded 2026-07-27, pre-season (PL 2026-27): 38 events, 20 teams, 380 fixtures, all fixtures
already assigned to a gameweek and unstarted (no scores yet). Used by:

- `tests/phase1/fpl.test.ts` — perturbed per-case (event/team/fixture counts, refs) rather than
  read directly; this snapshot is the "known-good" baseline those perturbations start from.
- `P1-G01` (`docs/testing/phase1-cases.md`) — served verbatim through a mocked `fetch` for the
  full `syncFpl` integration run.

## Refresh

```bash
curl -s "https://fantasy.premierleague.com/api/bootstrap-static/" -o tests/fixtures/fpl/bootstrap.json
curl -s "https://fantasy.premierleague.com/api/fixtures/" -o tests/fixtures/fpl/fixtures.json
```

No auth, no key. Re-run both together — `bootstrap.json`'s `events`/`teams` and `fixtures.json`'s
`event`/`team_h`/`team_a` references must stay mutually consistent, or P1-U01/P1-G01 will fail on
a real ref mismatch instead of the intended synthetic one.

Re-fetch once PL 2026-27 fixtures start finishing (this snapshot has zero finished fixtures) if a
future case needs a real finished-fixture example instead of a synthetic one.
