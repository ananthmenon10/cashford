# Cashford — Settlement & State Test Plan

League **KK Bois** (4 players): **A**=ananth · **U**=utkarsh · **S**=sharan · **H**=hashir. Stake **₹500**.
Picks written as `outcome score` (H=home, A=away, D=draw). Settlement per plan §7.4 + §17.1 (floor + ₹1 remainder to first winners by user_id; `net_inr` derived from transfers; Σnet=0 per contest).

> Verification: **all 20 as deterministic golden tests** (pure settle() function) for exhaustive math, **plus** a representative subset visually confirmed in the browser on the deployed app (pick → lock → reveal → settled, void, dues, live, knockout).

## Outcome-split (mixed) cases
| # | A | U | S | H | Actual | Winners | Expected nets | Tests |
|---|---|---|---|---|--------|---------|---------------|-------|
| 1 | H 2-1 | A 0-1 | D 1-1 | A 1-2 | H 2-0 | A | A +1500; U/S/H −500 | 1 winner takes 3 stakes |
| 2 | H | H | H | A | H | A,U,S | +167/+167/+166; H −500 | **non-integer pot (₹500÷3)** + remainder ₹1 |
| 3 | H | H | A | D | H | A,U | A/U +500; S/H −500 | 2v2 even split |
| 4 | H | A | A | — | H | A | A +1000; U/S −500; H not_entered | your example 1 + not_entered (S9) |
| 5 | H | H | A | — | H | A,U | A/U +250; S −500; H not_entered | your example 2 |
| 13 | D 1-1 | H | A | D 0-0 | D 1-1 | A,H | A/H +500; U/S −500 | draw is a winning outcome |

## Unanimous-outcome → scoreline tiebreak (layered §7.7)
| # | A | U | S | H | Actual | Winner | Tests |
|---|---|---|---|---|--------|--------|-------|
| 6 | H 2-1 | H 3-1 | H 1-0 | H 3-2 | 2-1 | A (exact) | exact-score wins |
| 7 | H 3-1 | H 3-2 | H 1-0 | H 4-2 | 2-1 | A (err 1, unique) | smallest total goal error |
| 8 | H 3-1 | H 1-0 | H 3-2 | H 2-0 | 2-1 | A & H tie → **split** +500 each | top-tie split |
| 14 | H 2-1 | H 3-0 | H 1-0 | H 4-1 | **A 0-1** (all wrong) | S (least-wrong, total-goals level) | unanimous-wrong → D3 "least-wrong wins" |

## Case C — mixed picks, nobody right (D9)
| # | A | U | S | H | Actual | Result | Tests |
|---|---|---|---|---|--------|--------|-------|
| 9 | H 2-1 | A 1-3 | H 3-0 | A 0-1 | **D 2-2** | A wins (closest, err 1) +1500 | Case C → closest scoreline wins |
| 10 | H 2-1 | A 1-2 | — | — | **D 1-1** | full scoreline tie → **VOID** (`no_separation`) | Case C with no separation |

## Void / participation
| # | Setup | Result | Tests |
|---|-------|--------|-------|
| 11 | only H predicts | **VOID** (`insufficient_entries`); H net 0 | <2 entries |
| 12 | nobody predicts | **VOID**; all not_entered | 0 entries |

## Knockout (advance-based, no draw, scoreline graded on 90')
| # | A | U | S | H | 90' / advance | Result | Tests |
|---|---|---|---|---|---------------|--------|-------|
| 15 | H | A | H | A | 1-1, **home adv (pens)** | A,S +500; U,H −500 | advancer = outcome; scoreline ignored (mixed); **draw button absent** |
| 16 | H 2-1 | H 2-0 | H 1-0 | H 3-1 | 2-1, home adv in reg | A (exact on 90') +1500 | KO scoreline graded on 90-min |
| 17 | A 1-1 | A 0-1 | A 2-2 | A 1-0 | 1-1, **away adv (pens)** | A (exact 1-1) +1500 | scoreline = regulation even via pens; 1-1 scoreline valid in KO |

## Contest / match states + UI
| # | Scenario | Tests |
|---|----------|-------|
| 18 | demo fixture → abandoned after lock | contest **cancelled** (S11), no money |
| 19 | contest locked, fixture live | reveal hidden **before** lock / visible **after**; live card **S5**; no settlement |
| 20 | after #1–#5 settle | net leaderboard = Σ; pairwise "who owes whom" nets reciprocals; Σnet=0 | Dues tab + Splitwise netting |

**MatchCard states covered:** S1 open-no-pick, S2 open-picked, S3 TBD (knockout pre-draw), S4 locked-preKO, S5 live, S5b finished-settling, S6 won, S7 lost, S8 push, S9 not-entered, S10 void, S11 cancelled, S12 KO-advancer overlay.

## Harness
A `seed-demo.mjs` creates controllable demo fixtures (set kickoff/score/status) + a `settle()` golden-test file asserting every row above. Real KK Bois users do the predicting; demo fixtures let us force results deterministically without waiting on real WC matches.
