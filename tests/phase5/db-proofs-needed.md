# Phase 5 proofs that need a disposable database or browser

These are intentionally not Vitest tests. A prover must use a disposable Postgres database for the
persistence cases and the four `ZZ-TEST-P5-*` leagues for browser cases. No shared or real league may
be written. Each browser helper must reject a league name that does not start with `^ZZ-TEST-`.

## Persistence inventory

- **T-P1** Apply `20260729000001_dues_archive_transition.sql` twice; the second apply succeeds without changing the schema or failing on existing objects.
- **T-P2** Attempt self-payments, amounts below ₹1 or above ₹100,000,000, malformed payment/reversal kind links, and notes longer than 240 characters; each is rejected.
- **T-P3** As an authenticated user, attempt direct insert, update, and delete on `payments` and `payment_confirmations`; all are rejected.
- **T-P4** As a current member, select every payment in the member’s league; all league payments are visible.
- **T-P5** As a member of another league, select the first league’s payments; no rows are visible.
- **T-P6** Stamp a payer or receiver’s membership `left_at`, then select through that departed session; only payments involving that user are visible, along with their confirmation history.
- **T-P7** As anon, call every public Phase 5 routine; every call is rejected.
- **T-P8** As authenticated, call each private participant/status helper directly; every call is rejected.
- **T-P9** As any current league member, log a payment between two other current or historical financial participants; the row is created with the logger as `logged_by`.
- **T-P10** Log a payment using a profile ID with no membership, competition, result, entry, or payment-party history in the league; the routine rejects it.
- **T-P11** Log as one user and inspect the row; `logged_by` equals the authenticated user, regardless of submitted input.
- **T-P12** Have the logger attempt to append a confirmation for a flag that is false for that logger; the routine rejects it.
- **T-P13** Have the required payer or receiver confirm; the confirmation event is appended and the cached state changes only when all required parties have confirmed.
- **T-P14** Log as a third party, have only one financial party confirm, then inspect the payment; it remains pending. Have the second party confirm; it becomes confirmed.
- **T-P15** Append a dispute, then append a later confirmation; both events remain, and the later latest stance resolves the payment. No event is deleted.
- **T-P16** Submit the same log request twice with the same `(logged_by, client_request_id)` and identical facts; one payment row exists and the retry returns it. Change one fact under the same key; the routine rejects it.
- **T-P17** Race two required responses from separate sessions; the final state is derived from one latest stance per actor, with no duplicate or lost confirmation outcome.
- **T-P18** After confirmation, attempt to change payer, receiver, amount, date, note, or confirmation facts through every granted path; all changes are rejected.
- **T-P19** Reverse a confirmed ordinary payment; the reversal copies league, payer, receiver, amount, and original payment date, and links through `reverses_payment_id`.
- **T-P20** Submit two live reversals for one confirmed source; the second is rejected while the first is pending or confirmed. A disputed reversal must not occupy the live-reversal guard.
- **T-P21** Confirm a payment, compute the combined ledger, confirm its reversal, and compute again; both payer and receiver return to their pre-payment balances.
- **T-P22** Snapshot all transfer IDs, amounts, `reversed` flags, row count, all `contest_results` rows and every `net_inr`, plus all `gameweek_entry_results` rows and every `net_inr`; run every payment operation, then assert the snapshots are byte-for-byte unchanged.
- **T-P23** Seed one WC transfer with `contest_id` and one PL transfer with `gameweek_contest_id`; run the activity/ledger fold and prove both rows enter it.
- **T-P24** As captain, adopt an active PL competition with an open gameweek; assert one active league participation, one member row per current member, and one current pot.
- **T-P25** As a non-captain, call adoption; it fails and creates no participation, member row, or pot.
- **T-P26** Attempt adoption when PL is preparing and when it is archived; both fail without mutation.
- **T-P27** Set another competition active for the league, then attempt PL adoption; it fails naming the current competition and changes no row.
- **T-P28** Call adoption twice concurrently with the same client request ID, competition, and ante; the first creates one participation and one pot, the retry returns `adopted=false`, and counts remain `1 + 0 = 1` rather than `2`. Reuse the key with another ante or competition; it fails.
- **T-P29** Adopt with no future open gameweek; assert null eligibility and pot boundaries, then open the next gameweek and run maintenance; both boundaries are filled.
- **T-P30** Inspect every new routine and private helper: empty search path, explicit revoke from `public`, `anon`, and `authenticated`, and only the grants in §1.8.
- **T-P31** Stamp a member left; assert every league-wide RLS read is gone, WC prediction and bracket writes fail, and only direct payment plus that payment’s confirmation history remains readable.
- **T-P32** Call `remove_league_member`; assert the membership row remains, matching current `member_competitions.left_at` values are stamped, and a racing gameweek entry cannot commit after the leave lock.
- **T-P33** Race payer and receiver logging the same pair, amount, and IST date; assert one ordinary payment row and `matching_existing` with the winner’s ID for the loser.
- **T-P34** Reuse a response, cancellation, or reversal idempotency key for a different payment; each routine rejects the cross-payment key reuse.
- **T-P35** Create a disputed reversal and attempt a new reversal; the new one is allowed. Repeat with a pending or confirmed reversal; the new one is rejected.
- **T-P36** Break one league’s result/transfer parity and report it repeatedly; assert exactly one open `sync_issues(source='dues', kind='ledger_parity')` row. Restore parity, run `scripts/inspect-dues-ledger.mjs --resolve <issue-id>`, and assert resolution. Run the resolve flag before repair; it fails and leaves the issue open.
- **T-P37** Inspect realtime publications; neither `payments` nor `payment_confirmations` appears.
- **T-P38** Inspect table privileges and attempt writes with RLS bypassed; anon and authenticated lack insert, update, and delete on both payment tables.
- **T-P39** Archive a league, then log, respond, cancel, and reverse as allowed; each payment operation still works. Attempt `join_league`; it fails.
- **T-P40** Race adoption against the competition gate and gameweek lock; assert the routine re-reads the gameweek, uses one request ID, and returns the one reselected pot.
- **T-P41** Seed a pre-existing archived target participation; adoption returns the TC12 domain error, not a raw primary-key violation.
- **T-P42** Attempt WC prediction and `mirror_gameweek_entry` writes for an archived competition; both fail before writing. Compare the mirror routine signature and privileges with the applied Phase 2 signature plus the Phase 5 revoke/grant contract.

## Browser inventory

Use separate authenticated sessions for payer, receiver, third-party logger, captain, member, late
joiner, and departed participant. Seed only `ZZ-TEST-P5-DUES`, `ZZ-TEST-P5-ARCHIVE`,
`ZZ-TEST-P5-TRANSITION`, and `ZZ-TEST-P5-JOIN`.

- **T-B1** Show the combined WC+PL net table and one settle plan.
- **T-B2** Debtor opens `Log as paid`; receiver confirms; both views update.
- **T-B3** Net-positive viewer opens `Log as received`; payer confirms.
- **T-B4** Third member logs between two others; first confirmation changes no balance and second confirmation does.
- **T-B5** Partial payment leaves the stated remainder.
- **T-B6** Overpayment warning does not block submission.
- **T-B7** Dispute excludes the payment; later confirmation applies it.
- **T-B8** Logger cancels a disputed record.
- **T-B9** Confirmed reversal shows both feed rows and restores the balance.
- **T-B10** Departed party opens `/payments/[id]`, sees no other league data, and confirms.
- **T-B11** Dues has no competition switcher.
- **T-B12** Ledger sync issue hides plan and settle shortcuts while generic log, confirm, dispute, cancel, and reverse controls stay live and work.
- **T-B13** Archive opens on Analytics.
- **T-B14** Archive tab order is Analytics, Matches, Bracket at mobile and desktop widths.
- **T-B15** Final standings lead the archive.
- **T-B16** Late joiner sees AC8.
- **T-B17** Matches is a plain results list with no bracket markup.
- **T-B18** Archive match links open read-only WC match details.
- **T-B19** Bracket has no edit, reset, lock, unlock, or promote control.
- **T-B20** Old `/bracket` and one seeded public `/b/[id]` link still open.
- **T-B21** Both Season panes show `Table | Gameweeks`.
- **T-B22** Season pill URLs survive refresh and back navigation.
- **T-B23** PL preparing shows no adoption CTA.
- **T-B24** Global PL active gives the captain the adoption prompt.
- **T-B25** Non-captain sees waiting copy and no adoption request.
- **T-B26** Captain adopts; PL becomes default and WC remains under Past in `CompetitionSheet`.
- **T-B27** Adoption receives the same `clientRequestId` twice and creates one participation and one pot.
- **T-B28** Create shows ante consequence and first deadline before submit.
- **T-B29** Join preview shows competition, ante, members, and deadline before commitment.
- **T-B30** Logged-out and authenticated join previews match.
- **T-B31** Mid-season joiner sees earlier gameweeks as `Before your time`.
- **T-B32** Invite text contains actual PL facts, link, and plain code.
- **T-B33** New screens pass light and dark visual checks.
- **T-B34** No JavaScript leaves reads intact and makes money controls inert.
- **T-B35** Browser network log contains no write to a league outside `^ZZ-TEST-`.
- **T-B36** Payer logs pending payment; receiver tries the same facts, sees PC19 and the matching pending card, and opens the original.
- **T-B37** Archived-WC-only league redirects to `/leagues/[slug]/archive/wc2026`; no `CupLeagueView` remains.
- **T-B38** `CompetitionSheet` appears on Gameweek, Season, league Table, and archive, before Past, and never on Dues.
- **T-B39** League Table uses the Phase 4 standings body and source label.
- **T-B40** Home league card shows DC11 only for payments the viewer must answer and links to the correct Dues screen.
- **T-B41** Archived league still lets a current member complete payment confirmation and reversal while its invite stays closed.
- **T-B42** Dirty-settled Dues hides every balance, plan, shortcut, and prefill, shows shared C71, and still lets the viewer confirm a pending payment.
- **T-B43** Dirty-void Dues with no entry-result rows has the same suppression and confirmation behavior.

## Pure-boundary note

**T-U22** has no pure idempotency boundary in the named Phase 5 modules; prove it through T-P16 and
T-P34. **T-U44** has no pure matching-payment boundary; prove it through T-P33 and T-B36. The
remaining archive, copy, route-source, component, and table IDs in §11 need their named archive/app
boundaries or browser harness; this stub records the database/browser proof rather than inventing
expected values from their current implementation.
