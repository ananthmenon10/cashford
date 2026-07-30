# Phase 5 — Dues 2.0, World Cup archive, league-entry polish, and the Premier League transition. Deep implementation plan v3

Date: 2026-07-27  
Author: Codex  
Reviewer: Claude, adversarial pass  
Version: v3  
Status: revised implementation plan after adversarial review round 2

Format follows `docs/plans/2026-07-27-005-phase2-engine-plan.md`: numbered sections, fixed rule IDs, schema contracts, screen matrices, copy IDs, test IDs, sequencing, and acceptance gates.

Phase 1 supplies competitions, gameweeks, `league_competitions`, `member_competitions`, global competition activation, and atomic create/join routines. Phase 2 supplies the dual-ID `transfers` shape, gameweek results, reversal semantics, and the first combined WC+PL dues aggregation. Phase 3 supplies the league shell, Gameweek/Season/Dues routes, participation precedence, and the first competition-aware create/join pass. Phase 4 supplies the standings cache, app-level Table body, and current PL Matches/Analytics reads.

---

## §0 Scope, dependencies, and binding rules

### 0.1 In scope

1. **Dues 2.0**
   - One league balance across World Cup 2026, Premier League 2026-27, and later competitions.
   - Debt simplification across that combined balance.
   - Payment logging by any current league member between any two current or historical financial participants.
   - `logged_by` attribution on every payment.
   - Counterparty confirmation, disputes, cancellation before confirmation, and visible reversals after confirmation.
   - Partial payments and overpayments.
   - Settle-up shortcuts for debtors, creditors, and third-party loggers.
   - The net-positive viewer’s explicit “log as received” flow.
   - A sourced activity feed.

2. **World Cup 2026 archive**
   - League-scoped routes with the fixed tab order `Analytics | Matches | Bracket`.
   - Final analytics first.
   - A plain results list in Matches, with no bracket block.
   - A read-only bracket tab.
   - Existing public bracket links kept valid.
   - No archived competition writes: WC contest predictions, bracket actions, and cross-league
     gameweek mirroring all get server or database status guards before their write paths.

3. **Season pills fix**
   - `Table | Gameweeks` appears on both Season panes.
   - The control is one shared component outside the pane branch.

4. **League-scoped Premier League table**
   - `app/leagues/[slug]/table/page.tsx` is a thin league page over Phase 4’s
     `competition_standings` cache and shared table body.
   - It adds no provider call, standings calculation, or second cache.

5. **Create and join polish**
   - Competition consequence and first deadline shown before commitment.
   - Join preview shows competition, ante, members, and next deadline.
   - Mid-season copy and “Before your time” behavior.
   - Competition-aware invite text with link and plain code.
   - Removal of World Cup-specific copy from the live create/join flow.

6. **World Cup → Premier League transition**
   - A global Phase 1 activation remains separate from a league captain’s adoption.
   - Existing WC leagues do not join the PL without their captain acting.
   - Captain prompt includes the PL ante and first eligible gameweek.
   - Adoption creates the league and member competition rows plus the current gameweek pot in one transaction.
   - Once adopted, the PL becomes the default league view and the WC stays one tap away in the archive.

### 0.2 Non-goals

- No change to World Cup settlement or scoring.
- No change to Premier League points, tiebreak, or gameweek settlement.
- No payment processing, UPI integration, wallet, bank link, or cash custody.
- No competition filter on Dues.
- No second active competition per league.
- No automatic PL adoption for existing leagues.
- No automated WhatsApp messages.
- No retroactive World Cup points system.
- No edit or deletion of confirmed payment facts.
- No rewrite of any `transfers` row when a payment is logged, confirmed, disputed, cancelled, or reversed.
- No Phase 5 reimplementation of Phase 3’s dirty predicate, recalculating note, or C71 copy.
  X-P5-1 consumes those shared Phase 3 exports and must pass independently in Phase 5.

### 0.3 Dependency ledger

| Dependency | Lands in | Phase 5 use |
|---|---|---|
| `competitions`, `gameweeks`, `league_competitions`, `member_competitions` | Phase 1 | Archive identity, PL adoption, eligibility |
| `cashford.activate_competition` | Phase 1 | Global PL rollout only |
| `cashford.create_league`, `cashford.join_league` | Phase 1 | Create/join polish |
| Dual `transfers.contest_id` / `gameweek_contest_id` | Phase 2 | Sourced WC+PL movement feed |
| `gameweek_entry_results.net_inr` | Phase 2 | PL part of the combined balance |
| Non-reversed transfer semantics | Phase 2 | Activity and parity checks |
| Gameweek, Season, Dues league routes | Phase 3 | Phase 5 replaces the Dues body and fixes Season pills |
| X-P5-1: `lib/net-balance.ts`, `components/gw/RecalculatingNote.tsx`, and C71 | Phase 3 | Dirty-contest gate before every Dues balance, plan, shortcut, or prefill |
| Participation precedence | Phase 3, amended by Phase 5 | PL default; archived-only leagues redirect to their archive |
| Extended invite competition DTO | Phase 3 | Phase 5 adds deadline and eligibility facts |
| `competition_standings` cache and shared table body | Phase 4 | Phase 5 supplies the league-scoped `Table` route |
| PL Matches and Analytics reads | Phase 4 | No archive data is mixed into current-season form |

Phase 5 UI work that reads money is blocked until the Phase 2 migration and its persistence checks are green. The archive can be built after Phase 1 and Phase 3. PL adoption cannot ship before Phase 1 global activation has completed its verified sync gate.

### 0.4 Safety rules

**S1.** `lib/settlement.ts` is golden logic. Phase 5 imports `simplifyDebts`; it never edits, wraps, forks, or reimplements it.

**S2.** `lib/settle-contest.ts`, `lib/gameweek-points.ts`, `lib/gameweek-settle.ts`, and Phase 2 settlement routines remain unchanged.

**S3.** Payments change net dues only after confirmation. Pending, disputed, and cancelled records have zero ledger effect.

**S4.** Payments never update, reverse, delete, replace, or annotate `transfers`.

**S5.** Confirmed payment facts are immutable. A correction is a new reversal record.

**S6.** Every ledger movement is an integer number of rupees. Every movement changes two users by equal and opposite amounts.

**S7.** The combined ledger must satisfy `Σ net = 0` before `simplifyDebts` runs. A broken sum renders a sync warning and no payment plan.

**S8.** Every Phase 5 mutation uses an authenticated API route backed by a `SECURITY DEFINER` routine. There is no direct authenticated table write and no money server action.

**S9.** Test writes target league names matching `^ZZ-TEST-`. Seed and browser helpers abort on any other name.

---

## §1 Schema migration

Migration: `supabase/migrations/20260729000001_dues_archive_transition.sql`

The migration is forward-only. It adds membership and payment fields, replaces membership-aware
helpers and policies, and adds the new routines and indexes. It does not change `transfers`, contest
results, gameweek results, or settlement functions.

### 1.1 League membership lifecycle

Add to the applied `cashford.league_members` table:

| Column | Definition |
|---|---|
| `left_at` | `timestamptz` |

There is no `leagues.currency_code`. Phase 5 has one legal currency and every money column and screen
already names INR; a column with one value has no reader.

**M1. Current member.** Every Phase 5 current-member check means a `league_members` row with
`left_at is null`.

**M2. Leave, never delete.** `app/leagues/[slug]/manage/actions.ts::removeMember` stops deleting the
membership row. It calls a new authenticated `cashford.remove_league_member(p_league_id,
p_user_id)` routine. The routine verifies the captain, rejects removal of the captain, takes the
Phase 2 competition and gameweek locks for the league’s active participations, locks the target
`league_members` and `member_competitions` rows, and stamps the same `clock_timestamp()` into
`league_members.left_at` and every `member_competitions.left_at` that is still null. This preserves the
`member_competitions(league_id,user_id)` foreign key and makes Phase 2’s existing `left_at` entry
guards effective.

**M3. RLS membership helper.** Replace the applied helper with:

```sql
create or replace function cashford.my_league_ids()
returns setof uuid
language sql
security definer
stable
set search_path = ''
as $$
  select lm.league_id
    from cashford.league_members lm
   where lm.user_id = (select auth.uid())
     and lm.left_at is null;
$$;
```

All league-scoped select policies that already call `my_league_ids()` then stop exposing leagues,
members, contests, results, transfers, gameweek rows, and participation rows to a departed member.
Replace `profiles_select` as well: its co-league-member subquery must require the named row’s
`lm.left_at is null`, not merely a current viewer league. Current members therefore stop reading a
departed member’s profile name through RLS, and departed members stop reading former leaguemates.
The narrow payment-party policies in §1.9 remain the only authenticated post-departure read.

The migration also replaces legacy WC `predictions_insert` and `predictions_update`, plus all
`knockout_predictions` write policies, so each direct membership subquery requires
`league_members.left_at is null`. Phase 2 gameweek entry already checks
`member_competitions.left_at`; `mirror_gameweek_entry` gets the competition-status backstop in §6.5.

**M4. Rejoin.** `cashford.join_league` still rejects `leagues.status='archived'`. For an active league,
a prior membership row is reactivated instead of ignored: set `league_members.left_at=null` while
preserving its original `joined_at`, and reactivate or insert the active competition’s
`member_competitions` row with `left_at=null`, a fresh `active_from`, and the current future-open
gameweek boundary. Earlier gameweeks stay before the returning member’s time.

### 1.2 `cashford.payments`

| Column | Definition |
|---|---|
| `id` | `uuid primary key default gen_random_uuid()` |
| `league_id` | `uuid not null references cashford.leagues(id) on delete restrict` |
| `kind` | `text not null check (kind in ('payment','reversal'))` |
| `payer_user_id` | `uuid not null references cashford.profiles(id) on delete restrict` |
| `receiver_user_id` | `uuid not null references cashford.profiles(id) on delete restrict` |
| `amount_inr` | `int not null check (amount_inr between 1 and 100000000)` |
| `paid_on` | `date not null` |
| `note` | `text check (note is null or char_length(note) <= 240)` |
| `logged_by` | `uuid not null references cashford.profiles(id) on delete restrict` |
| `logged_at` | `timestamptz not null default now()` |
| `status` | `text not null default 'pending' check (status in ('pending','disputed','confirmed','cancelled'))` |
| `status_changed_at` | `timestamptz not null default now()` |
| `confirmed_at` | `timestamptz` |
| `cancelled_at` | `timestamptz` |
| `required_payer_confirmation` | `boolean not null` |
| `required_receiver_confirmation` | `boolean not null` |
| `reverses_payment_id` | `uuid references cashford.payments(id) on delete restrict` |
| `client_request_id` | `uuid not null` |

Constraints:

1. `payer_user_id <> receiver_user_id`.
2. At least one confirmation flag is true.
3. `kind='payment'` iff `reverses_payment_id is null`.
4. `kind='reversal'` iff `reverses_payment_id is not null`.
5. `confirmed_at` is non-null only for `status='confirmed'`.
6. `cancelled_at` is non-null only for `status='cancelled'`.

Indexes:

```sql
create unique index uq_payment_request
  on cashford.payments(logged_by, client_request_id);

create unique index uq_live_payment_reversal
  on cashford.payments(reverses_payment_id)
  where kind = 'reversal'
    and status in ('pending','confirmed');

create index idx_payments_league_time
  on cashford.payments(league_id, logged_at desc);

create index idx_payments_party
  on cashford.payments(payer_user_id, receiver_user_id);

create index idx_payments_attention
  on cashford.payments(league_id, status)
  where status in ('pending','disputed');
```

`client_request_id` makes a retried log request idempotent. Reusing a request ID with different facts is rejected.

### 1.3 `cashford.payment_confirmations`

This is an append-only decision log. `payments.status` is the current cached state derived by the routines.

| Column | Definition |
|---|---|
| `id` | `uuid primary key default gen_random_uuid()` |
| `payment_id` | `uuid not null references cashford.payments(id) on delete restrict` |
| `actor_user_id` | `uuid not null references cashford.profiles(id) on delete restrict` |
| `action` | `text not null check (action in ('confirm','dispute','cancel'))` |
| `from_status` | `text not null check (from_status in ('pending','disputed','confirmed','cancelled'))` |
| `to_status` | `text not null check (to_status in ('pending','disputed','confirmed','cancelled'))` |
| `created_at` | `timestamptz not null default now()` |
| `client_request_id` | `uuid not null` |

Indexes:

```sql
create unique index uq_payment_confirmation_request
  on cashford.payment_confirmations(actor_user_id, client_request_id);

create index idx_payment_confirmations_payment_time
  on cashford.payment_confirmations(payment_id, created_at, id);
```

Rows are never updated or deleted.

### 1.4 Required confirmer rules

**CF1. Logger is the payer.** Only the receiver must confirm.

**CF2. Logger is the receiver.** Only the payer must confirm.

**CF3. Logger is neither party.** Both payer and receiver must confirm. The payment stays pending after the first confirmation.

**CF4.** A required party may dispute. One required party’s latest dispute makes the payment disputed.

**CF5.** A disputing party may later confirm. The routine recomputes the latest stance of every required party:

- any required latest stance is `dispute` → `disputed`;
- every required latest stance is `confirm` → `confirmed`;
- otherwise → `pending`.

**CF6.** The logger may cancel a pending or disputed record. Nobody can cancel a confirmed record.

**CF7.** A confirmed record is terminal. The only correction path is a reversal.

### 1.5 Payment and reversal ledger signs

For a confirmed ordinary payment from `payer → receiver`:

- payer adjustment: `+amount`;
- receiver adjustment: `−amount`.

For a confirmed reversal:

- payer adjustment: `−amount`;
- receiver adjustment: `+amount`.

A confirmed reversal does not hide or mutate its source payment. The ledger contains both equal and opposite records. The feed marks the original as reversed by deriving the confirmed reversal relationship.

### 1.6 Historical participant rule

A payment party must belong to the league’s financial history. A user qualifies when any of these is true:

1. They have a `league_members` row.
2. They have a `member_competitions` row for the league.
3. They have a legacy `contest_results` row through a contest in the league.
4. They have a `gameweek_entries` row through a gameweek contest in the league.
5. They are already a party on a payment in the league.

This permits settlement with a departed member who still owes or is owed money. It does not permit an arbitrary profile ID.

Rule 2 is belt-and-braces after §1.1: the applied
`member_competitions(league_id,user_id)` foreign key already requires a persistent
`league_members` row. It remains in the participant helper to state the financial-history contract
and defend against a later schema change.

The logger must be a current league member. A departed payer or receiver may still confirm or dispute a payment involving them.

### 1.7 Routines

All routines are `SECURITY DEFINER`, set `search_path=''`, qualify every table and function, read `auth.uid()` internally, use `clock_timestamp()`, and lock rows before state checks.

Payment lifecycle routines do not gate on `leagues.status` or competition status. Logging,
confirmation, dispute, cancellation, and reversal remain available for an archived league forever;
joining that archived league remains blocked by `cashford.join_league`.

#### `cashford.log_payment`

```sql
cashford.log_payment(
  p_league_id uuid,
  p_payer_user_id uuid,
  p_receiver_user_id uuid,
  p_amount_inr int,
  p_paid_on date,
  p_note text,
  p_client_request_id uuid
) returns table (
  outcome text,
  payment cashford.payments
)
```

Rules:

- Caller must be a current member of `p_league_id`.
- `leagues.status` is not a gate. League-level payment logging remains open after a league or all its
  competitions are archived.
- Both parties must pass §1.6.
- Parties must differ.
- Amount and note constraints are rechecked.
- `paid_on` cannot precede `(leagues.created_at at time zone 'Asia/Kolkata')::date` or be later than
  `(clock_timestamp() at time zone 'Asia/Kolkata')::date`.
- The routine derives the two confirmation flags.
- Lock order starts with the league row. Under that lock, a repeat request ID returns
  `outcome='retry'` only when every submitted fact matches.
- Before insert, detect any non-cancelled ordinary payment in the same league with the same
  `(payer_user_id, receiver_user_id, amount_inr, paid_on)`, regardless of `logged_by`. Return that
  row with `outcome='matching_existing'`; do not insert. The route maps this to a soft HTTP 409
  carrying `paymentId`, logger display name, and PC19. This catches payer/receiver double logging,
  while `client_request_id` still catches one logger’s transport retry.
- A new row returns `outcome='created'`.
- The routine does not read or write the current settle-up suggestion.

#### `cashford.respond_to_payment`

```sql
cashford.respond_to_payment(
  p_payment_id uuid,
  p_action text,
  p_client_request_id uuid
) returns cashford.payments
```

Allowed `p_action`: `confirm`, `dispute`.

Rules:

- Lock order: league row, then payment row.
- Caller must be a required payer or receiver for this payment.
- Caller cannot confirm their own assertion when their confirmation flag is false.
- Confirmed and cancelled payments reject further responses.
- Append a confirmation event, recompute all required latest stances, and update cached status in one transaction.
- Before returning an idempotent confirmation event, require its stored `payment_id` to equal
  `p_payment_id`; reuse of the same actor/request key for another payment raises a domain error.
- A retry with the same request ID for the same payment and action returns the already-produced
  state; a changed action is rejected.

#### `cashford.cancel_payment`

```sql
cashford.cancel_payment(
  p_payment_id uuid,
  p_client_request_id uuid
) returns cashford.payments
```

Rules:

- Only `logged_by` may cancel.
- Only pending or disputed records may be cancelled.
- Append a `cancel` event and set `cancelled_at`.
- Before returning an idempotent cancel event, require its stored `payment_id` to equal
  `p_payment_id` and its action to be `cancel`; cross-payment or changed-action reuse is rejected.
- No ledger movement is produced.

#### `cashford.reverse_payment`

```sql
cashford.reverse_payment(
  p_payment_id uuid,
  p_reason text,
  p_client_request_id uuid
) returns cashford.payments
```

Rules:

- Caller must be a current league member.
- `leagues.status` is not a gate; confirmed payments in archived leagues can still be corrected.
- Source must be an ordinary confirmed payment.
- A reversal cannot reverse another reversal.
- There may be only one pending or confirmed reversal for the source. A disputed reversal remains
  visible but no longer occupies `uq_live_payment_reversal`, so a fresh correction may supersede it.
- League, payer, receiver, amount, and original payment date are copied from the source.
- `p_reason` becomes the reversal note and is required.
- Confirmation flags are based on the reversal logger under CF1–CF3.
- Before returning an idempotent reversal, require the stored row’s `reverses_payment_id` to equal
  `p_payment_id` and its copied facts and normalized reason to match. Reusing the actor/request key
  for another source or payload is rejected.
- The reversal has no ledger effect until confirmed.

#### `cashford.adopt_league_competition`

```sql
cashford.adopt_league_competition(
  p_league_id uuid,
  p_competition_slug text,
  p_ante_inr int,
  p_client_request_id uuid
) returns table (
  league_id uuid,
  competition_id uuid,
  eligible_from_gameweek_id uuid,
  gameweek_contest_id uuid,
  adopted boolean
)
```

Rules are in §8.

#### Membership and ledger-issue routines

```sql
cashford.remove_league_member(
  p_league_id uuid,
  p_user_id uuid
) returns timestamptz

cashford.record_dues_ledger_parity(
  p_league_id uuid,
  p_detail jsonb
) returns uuid

cashford.resolve_dues_ledger_issue(
  p_issue_id uuid
) returns void
```

`remove_league_member` follows §1.1. The two ledger-issue routines follow §2.6 and are granted only
to `service_role`; they do not change a money row.
The `remove_league_member` lock order is normative: competition → gameweeks → `league_members` →
`member_competitions`.

### 1.8 Routine privileges

Explicitly revoke every new routine and private helper from `public`, `anon`, and `authenticated`, then grant only these public calls:

| Routine | Grant |
|---|---|
| `log_payment` | `authenticated` |
| `respond_to_payment` | `authenticated` |
| `cancel_payment` | `authenticated` |
| `reverse_payment` | `authenticated` |
| `adopt_league_competition` | `authenticated` |
| `remove_league_member` | `authenticated` |
| `record_dues_ledger_parity` | `service_role` |
| `resolve_dues_ledger_issue` | `service_role` |

Private participant and status helpers remain ungranted.

Because the base schema grants table privileges broadly by default, also run:

```sql
revoke insert, update, delete on cashford.payments
  from anon, authenticated;
revoke insert, update, delete on cashford.payment_confirmations
  from anon, authenticated;
```

Grant the required table access to `service_role`. RLS is a second barrier, not the only write
barrier.

### 1.9 RLS

Enable RLS on both new tables.

`payments_select` permits a row when:

- `league_id in (select cashford.my_league_ids())`; or
- `auth.uid()` is its payer or receiver.

The second branch lets a departed party read a payment that needs their answer without exposing the rest of the league ledger.

`payment_confirmations_select` permits a row when its parent payment passes the same visibility rule.
Thus a departed payer or receiver can read the confirmation history for their own payment and no
other payment history.

There are no authenticated `INSERT`, `UPDATE`, or `DELETE` policies on either table.

Neither table is added to a realtime publication.

---

## §2 Combined ledger contract

### 2.0 Recalculating gate (X-P5-1)

1. `lib/dues-ledger.ts` imports the shared dirty predicate from Phase 3’s `lib/net-balance.ts`; it
   never reimplements it. The loader reads `gameweek_contests.input_version` and
   `gameweek_results.settled_version` for every gameweek contest in the league.
2. If any gameweek contest is dirty, the loader returns `recalculating` before computing game net,
   combined net, or calling `simplifyDebts`. The ordering is normative: no compute-then-hide path is
   allowed.
3. A WC-only ledger has no gameweek contests, so it is never dirty and renders unchanged.
4. DS11 in §4.1 owns the screen behavior. It reuses Phase 3’s
   `components/gw/RecalculatingNote.tsx` and C71 from `lib/gw-copy.ts`; it does not fork either.
   As in Phase 3 PR3/PR3b, C60 replaces the suppressed figures while C71 labels the state. Net
   figures, combined balance, the settle plan, and every balance-derived shortcut or prefill hide.
   Generic log, confirm, dispute, cancel, and reverse stay live exactly as in DS8.
5. The §2.2 parity fold is evaluated only on a clean ledger. Dirty short-circuits at §2.0 and must
   NEVER report a `ledger_parity` sync issue.
6. T-U46–T-U48 prove dirty-settled, dirty-void-without-entry-results, and WC-only behavior.
   T-B42–T-B43 prove both dirty states in the running Dues screen, including live confirmation of
   an existing pending payment.
7. Acceptance X closes X-P5-1 only when Phase 5’s own tests pass. Completing Phase 3 does not satisfy
   or close it.
8. The §0.2 binding and dependency ledger name the Phase 3 exports, and §12 stage 4 cannot close
   until X-P5-1 and its Phase 5 tests pass.

### 2.1 Base game balance

Phase 5 consumes Phase 2’s combined game-net loader:

```text
WC net = Σ contest_results.net_inr for contests in the league
PL net = Σ gameweek_entry_results.net_inr for gameweek contests in the league
game net = WC net + PL net
```

No competition filter is accepted by the Dues loader.

All current members, departed members with history, and payment parties are seeded into the net map at zero before movements are folded.

### 2.2 Transfer parity

The Dues activity loader reads:

```text
transfers.league_id = league
and transfers.reversed = false
```

It supports both Phase 2 source shapes:

- `contest_id` for World Cup movements;
- `gameweek_contest_id` for Premier League movements.

A persistence test folds these non-reversed rows and compares every member’s result against the Phase 2 result-snapshot aggregation. A mismatch is treated as corrupt money state.

This fold is evaluated only after §2.0 returns a clean ledger. A dirty ledger short-circuits before
parity work and must never record or render a `ledger_parity` sync issue.

Phase 5 does not “repair” a mismatch in the request path.

### 2.3 Payment adjustment

For each confirmed payment or reversal, apply §1.5. Pending, disputed, and cancelled rows contribute zero.

```text
combined net[user] = game net[user] + payment adjustment[user]
```

Required invariants:

**L1.** `Σ game net = 0`.

**L2.** `Σ payment adjustment = 0`.

**L3.** `Σ combined net = 0`.

**L4.** Every value is an integer.

**L5.** Confirmation changes exactly two balances.

**L6.** A confirmed reversal restores the two balances to their pre-payment values when no later movement exists.

### 2.4 Debt simplification

The only plan calculation is:

```ts
simplifyDebts(Object.fromEntries(combinedNetByUser))
```

The call happens once on the server. The complete plan is then filtered or labelled for each viewer. There is no per-viewer recomputation.

`lib/settlement.ts` remains byte-identical.

### 2.5 Stale suggestions

A settle-up row is a suggestion, not a payment instruction stored in the database.

Opening a row pre-fills payer, receiver, and amount. If another gameweek settles before submission, the entered amount stays unchanged. The sheet refreshes the comparison copy but never substitutes a new amount.

Overpayment warns but does not block. It may legitimately move the payer into a net-positive position.

### 2.6 Ledger parity issue lifecycle

When the result-snapshot fold differs from the non-reversed transfer fold, L1 fails, or L3 fails,
`lib/dues-ledger.ts` returns `sync_issue` and a stable detail fingerprint.
`components/dues/LedgerSyncIssue.tsx` posts that fingerprint to the authenticated
`app/api/dues/issues/route.ts`; the route checks current membership, recomputes the three folds on
the server, ignores client-supplied totals, and calls `cashford.record_dues_ledger_parity` only when
the fault still exists. It never inserts into `sync_issues` directly. The warning still
server-renders when JavaScript is absent; only issue telemetry waits for the POST.

The migration adds:

```sql
create unique index uq_open_dues_ledger_parity
  on cashford.sync_issues(ref)
  where source = 'dues'
    and kind = 'ledger_parity'
    and resolved_at is null;
```

The routine writes `source='dues'`, `kind='ledger_parity'`, `ref=p_league_id::text`, and the supplied
fingerprint and fold totals in `detail`. Under the unique partial index it returns the one existing
open issue on repeat renders, so a page view cannot create an issue storm.

The service-only exit is `scripts/inspect-dues-ledger.mjs --league <slug>`. It prints, without
mutating, the `contest_results`, `gameweek_entry_results`, and non-reversed transfer folds and names
the first mismatch. An operator repairs the authoritative source through reviewed SQL or the owning
settlement repair path, reruns the inspection, and then invokes
`scripts/inspect-dues-ledger.mjs --resolve <issue-id>`. That flag uses the service client to call
`cashford.resolve_dues_ledger_issue(issue_id)`, which recomputes parity and stamps `resolved_at` only
when all three invariants pass. No request-path auto-repair exists.

---

## §3 Dues routes, reads, and components

### 3.1 Routes

```text
app/leagues/[slug]/dues/page.tsx
app/leagues/[slug]/dues/log/page.tsx
app/leagues/[slug]/dues/payments/[paymentId]/page.tsx
app/leagues/[slug]/table/page.tsx
app/payments/[paymentId]/page.tsx
app/api/dues/payments/route.ts
app/api/dues/payments/[paymentId]/response/route.ts
app/api/dues/payments/[paymentId]/cancel/route.ts
app/api/dues/payments/[paymentId]/reverse/route.ts
app/api/dues/issues/route.ts
app/api/leagues/[slug]/adopt/route.ts
app/api/leagues/[slug]/members/[userId]/remove/route.ts
```

`app/payments/[paymentId]` is the narrow response screen for a party who has left the league. It shows only that payment and its decision history.

### 3.2 Server modules

```text
lib/dues-ledger.ts
lib/dues-activity.ts
lib/payment-state.ts
lib/payment-copy.ts
lib/financial-participants.ts
lib/dues-view.ts
```

`lib/dues-ledger.ts` owns the equations in §2. Components receive a serializable DTO and perform no money math.

### 3.3 Components

```text
components/dues/DuesHeader.tsx
components/dues/PendingPaymentCard.tsx
components/dues/NetPositionTable.tsx
components/dues/SettlePlan.tsx
components/dues/PaymentSheet.tsx
components/dues/PaymentDetail.tsx
components/dues/ActivityFeed.tsx
components/dues/LedgerSyncIssue.tsx
components/gw/CompetitionSheet.tsx
components/gw/CaptainAdoptionSheet.tsx
components/gw/SeasonViewPills.tsx
```

Dues uses `LeagueShell` without the competition switcher. Its sub-line is always `All competitions · one balance`.

`app/page.tsx` also adds the pending-payment count to each league card. The count includes pending or
disputed ordinary payments and reversals that the viewer must answer, and the badge links to that
league’s Dues route.

### 3.4 Service-role read inventory

The new Dues path gets one service-role profile read for IDs already obtained from RLS-scoped league rows, result rows, entries, or payments. It exists only to name departed members hidden by profile RLS.
After `my_league_ids()` excludes left rows, `profiles_select` no longer names a departed member to
their former league or former leaguemates to them; this bounded service-role read supplies only the
names needed for historical ledger rows.

Payment, confirmation, reversal, adoption, and removal writes call authenticated routines. The sole
service-role write from an API route is the deduplicated `record_dues_ledger_parity` call in §2.6;
its companion resolver is service-only and refuses to clear a still-broken ledger.

---

## §4 Dues screen state matrix

### 4.1 Main screen

| ID | Condition | Lead block | Settle plan | Actions |
|---|---|---|---|---|
| DS0 | Valid ledger, every net is zero, no pending records | Settled-up state | Hidden | `Log a payment` |
| DS1 | Valid ledger, outstanding balances | Net position | Full canonical plan | Row shortcuts + generic log |
| DS2 | Viewer must answer one or more pending records | Oldest pending card pinned first | Based on confirmed records only | `Confirm`, `Dispute` |
| DS3 | Pending record logged by viewer, waiting on one party | Waiting card | Unchanged | `Cancel record` |
| DS4 | Third-party log has one of two confirmations | Waiting card names remaining party | Unchanged | Logger may cancel |
| DS5 | Viewer is party to a disputed record | Dispute card pinned | Disputed record excluded | `Confirm now` or share link |
| DS6 | Confirmed payment | Activity row and adjusted net | Recomputed | `Reverse payment` |
| DS7 | Confirmed reversal | Original struck through, reversal beside it | Recomputed | No edit |
| DS8 | `Σ net != 0` or result/transfer parity fails | Sync warning | Hidden | Generic log plus confirm, dispute, cancel, and reverse stay live; settle shortcuts hide |
| DS9 | Viewer joined after all game movements | Net starts at ₹0 | Based on later confirmed movements only | Normal logging |
| DS10 | Departed participant has non-zero net | Marked `Past member` in table | Included in plan | Current member may log; departed party may answer |
| DS11 | Any gameweek contest is dirty (`input_version > settled_version`) | Shared `RecalculatingNote` with C60 and C71; all net figures and combined balance hidden | Hidden | Every balance-derived shortcut and prefill hides; generic log plus confirm, dispute, cancel, and reverse stay live exactly as DS8 |

Pending and disputed records never alter the numbers shown in Net position or Settle up.

### 4.2 Log-payment sheet

| ID | Source | Prefill | Confirmation |
|---|---|---|---|
| PS0 | Generic `Log a payment` | No parties or amount | Based on logger’s relation to the parties |
| PS1 | Viewer owes someone | Viewer as payer, creditor as receiver, suggested amount | Receiver confirms |
| PS2 | Viewer is owed | Debtor as payer, viewer as receiver, suggested amount | Payer confirms |
| PS3 | Viewer logs a plan row between two others | Both parties and suggested amount | Both parties confirm |
| PS4 | Partial amount | Typed amount | Normal confirmation |
| PS5 | Amount exceeds current suggestion | Typed amount plus warning | Normal confirmation |
| PS6 | Suggestion changes while sheet is open | Original typed amount retained | Normal confirmation |
| PS7 | Party is departed | `Past member` label | Departed party can answer through direct payment route |
| PS8 | Duplicate submit | Existing payment returned | No duplicate row |
| PS9 | League or membership changed before submit | Routine rejects | No row |
| PS10 | Matching real payment logged by either party | Keep the matching pending card in view and show PC19 | Open the existing record; no new row |

### 4.3 Payment detail

| Status | Display | Allowed action |
|---|---|---|
| Pending, viewer required | Payment facts and logger name | Confirm or dispute |
| Pending, viewer not required | Waiting copy | Logger may cancel |
| Disputed | Disputing member and full facts | Required party may confirm; logger may cancel |
| Confirmed | Confirmation time and ledger effect | Start exact reversal |
| Cancelled | Cancelled time | None |
| Reversal pending | Original link and opposite effect | Required confirmation |
| Reversal confirmed | Original and reversal pair | None |

---

## §5 Payment flows and exact copy

All Phase 5 strings live in `lib/payment-copy.ts` or the archive/join copy modules. Components contain no user-visible literals.

### 5.1 Canonical Dues copy

| ID | Use | Exact string |
|---|---|---|
| DC1 | Header sub-line | `All competitions · one balance` |
| DC2 | Net section | `Net position` |
| DC3 | Net note | `World Cup 2026 and Premier League 2026-27, added up.` |
| DC4 | Plan heading | `Settle up` |
| DC5 | Plan count | `{count} payments clear every balance` |
| DC6 | Plan note | `The fewest payments that clear every balance. You can log any payment, not only these.` |
| DC7 | Generic CTA | `Log a payment` |
| DC8 | Empty ledger | `Everyone is settled up.` |
| DC9 | Product boundary | `Cashford records payments. Money still moves over UPI or in cash.` |
| DC10 | Sync error | `These balances don’t add up yet. Payment suggestions are paused while the ledger is checked.` |
| DC11 | Home league-card badge builder | `1 payment needs your answer` / `{count} payments need your answer` |

### 5.2 Logging copy

| ID | Use | Exact string |
|---|---|---|
| PC1 | Sheet title | `Log a payment` |
| PC2 | Sheet intro | `Records what moved between two people. It changes those two balances only.` |
| PC3 | Payer label | `Payer` |
| PC4 | Receiver label | `Receiver` |
| PC5 | Amount label | `Amount` |
| PC6 | Date label | `Date` |
| PC7 | Note label | `Note (optional)` |
| PC8 | Partial comparison | `{payer} owes {receiver} ₹{due}. Logging ₹{amount} leaves ₹{remaining} outstanding.` |
| PC9 | Exact comparison | `This matches the current ₹{amount} settle-up suggestion.` |
| PC10 | Overpayment | `This is ₹{extra} more than the current suggestion. Cashford will record the amount you entered.` |
| PC11 | Debtor shortcut | `Log ₹{amount} paid to {receiver}` |
| PC12 | Creditor shortcut | `Log ₹{amount} received from {payer}` |
| PC13 | Third-party shortcut | `Log {payer} paying {receiver} ₹{amount}` |
| PC14 | Payer-logged submit | `Log ₹{amount} · send to {receiver} to confirm` |
| PC15 | Receiver-logged submit | `Log ₹{amount} · send to {payer} to confirm` |
| PC16 | Third-party submit | `Log ₹{amount} · both people confirm` |
| PC17 | Partial note | `Partial payments are fine.` |
| PC18 | Save failure | `Couldn’t log this payment. Try again with the same details.` |
| PC19 | Matching payment | `{logger} already logged this — open it` |

### 5.3 Confirmation, dispute, and reversal copy

| ID | Use | Exact string |
|---|---|---|
| CC1 | Pending received | `{payer} says they paid you ₹{amount}` |
| CC2 | Pending payer | `{receiver} says they received ₹{amount} from you` |
| CC3 | Third-party pending | `{logger} logged {payer} paying {receiver} ₹{amount}` |
| CC4 | Confirm | `Confirm` |
| CC5 | Dispute | `Dispute` |
| CC6 | Waiting for one | `Waiting for {name} to confirm.` |
| CC7 | Waiting for two | `Waiting for {first} and {second} to confirm.` |
| CC8 | Immutable note | `Once confirmed, the payment facts can’t be edited. A correction gets a visible reversal.` |
| CC9 | Disputed | `This payment is disputed and stays out of the balance.` |
| CC10 | Confirm after dispute | `It happened · confirm` |
| CC11 | Cancel | `Cancel record` |
| CC12 | Reverse | `Reverse payment` |
| CC13 | Reversal intro | `A reversal keeps the original payment visible and applies the opposite amount after confirmation.` |
| CC14 | Reversed feed row | `Reversal · {reason}` |
| CC15 | Logged-by line | `Logged by {name} · {date}` |
| CC16 | Dispute share text | `Open this Cashford payment to confirm or dispute: {url}` |

### 5.4 Copy source scan

A Phase 5 copy test rejects:

- exclamation marks;
- gameplay uses of `bet`, `wager`, `gamble`, or `punt`;
- straight apostrophes in prose;
- hyphenated scorelines;
- unexported JSX text in Phase 5 routes and components.

---

## §6 World Cup 2026 archive

### 6.1 Routes

```text
app/leagues/[slug]/archive/wc2026/page.tsx
app/leagues/[slug]/archive/wc2026/matches/page.tsx
app/leagues/[slug]/archive/wc2026/bracket/page.tsx
```

The default archive route is Analytics.

This is a binding amendment to Phase 3 U1. When a league has no active participation and its newest
participation is archived WC, `app/leagues/[slug]/page.tsx` redirects to
`/leagues/[slug]/archive/wc2026`; it no longer renders `_cup/CupLeagueView.tsx`.
`app/leagues/[slug]/_cup/CupLeagueView.tsx` is deleted, or its still-useful read-only Matches body is
moved under the archive Matches route and the wrapper is deleted. The archive is the only
league-scoped WC surface.

Tab order is fixed:

1. Analytics
2. Matches
3. Bracket

Routes use real links with `aria-current`. The order must not depend on viewport width or data availability.

### 6.2 Archive shell

`components/archive/ArchiveShell.tsx` renders:

- league name;
- current all-competition balance;
- `World Cup 2026`;
- `ARCHIVED`;
- archive tabs;
- the read-only notice.

The competition sheet is available on archive, Gameweek, Season, and Table. It is absent from Dues.

Active competitions appear first. Archived competitions appear below them. Selecting the PL returns to `/leagues/[slug]`. Selecting WC routes to the archive.

Phase 5 owns `components/gw/CompetitionSheet.tsx`, superseding Phase 3 U34. Its server-built contract
is:

```text
CompetitionSheetDTO {
  leagueSlug
  items: [{
    competitionId
    slug
    name
    format
    participationStatus  // active | archived
    joinedAt
    href?                // absent for archived competitions without a Phase 5 archive route
  }]
}
```

Items sort by participation status (`active` before `archived`), then `joinedAt` descending, then
competition slug ascending. An active league-format item links to `/leagues/[slug]`; archived
`wc2026` links to `/leagues/[slug]/archive/wc2026`. Other archived participations render as non-link
labels until their archive route exists; the sheet must never emit a dead
`/leagues/[slug]/archive/<competition-slug>` href. The trigger is the league-header competition chip.

### 6.3 Analytics tab

New modules:

```text
lib/wc-archive.ts
components/archive/WcFinalStandings.tsx
components/archive/WcRecap.tsx
components/archive/WcRules.tsx
```

The archive does not invent a World Cup points championship. Final standings are an analytics ordering over the rules and data that existed:

1. net rupees descending;
2. correct outcomes descending;
3. exact scorelines descending;
4. user ID ascending.

Columns:

```text
Member | Correct | Exact | Net ₹
```

Data sources:

- predictions joined to finished WC fixtures;
- `accuracy`, `isCorrect`, and `isExact` from `lib/analytics.ts`;
- legacy `contest_results.net_inr`;
- current and historical financial participants;
- final freeze time from the latest settled WC contest.

Every archive stake or money display reads the immutable WC snapshots:
`contests.stake_inr` for per-match stake and `contest_results.net_inr` for outcome money.
`leagues.default_stake_inr` is banned from `lib/wc-archive.ts`; adoption may change that league
default without rewriting WC history.

The personal recap shows finish, correct calls, exact calls, and World Cup net. It does not include PL money.

Rules as they applied:

1. `Per-match stakes`
2. `Correct predictors split the incorrect predictors’ stakes.`
3. `Each match locked at kickoff.`
4. `Closest-score rules broke an otherwise tied field.`

### 6.4 Matches tab

The Matches tab is a plain, reverse-chronological WC results list using the existing Done-card data shape.

Each row shows:

- round and date;
- teams and final score;
- viewer’s prediction or `You sat this one out`;
- exact, right-result, miss, void, or no-entry verdict;
- that match’s signed net;
- link to the existing WC match detail route.

There is no bracket component, bracket summary, knockout circle, or bracket leaderboard in this route.

The loader scopes fixtures through the WC competition ID and contests through the selected league ID. It does not rely on `round` alone.

### 6.5 Bracket tab

The archive bracket route renders:

- a read-only knockout circle;
- the viewer’s frozen picks;
- the selected league’s bracket leaderboard;
- the viewer’s correct/decided count;
- a link to the full legacy `/bracket` screen.

`KnockoutCircle` gets an explicit read-only presentation path. It must not mount reset, lock, unlock, or promote controls.

`/bracket` remains valid and becomes read-only after WC archival. Public `/b/[id]` links remain unchanged.

Every bracket mutation action checks the WC competition status before any write. `status='archived'` returns:

`World Cup 2026 is archived. Bracket picks are read-only.`

The lookup is explicit because the applied knockout tables have no `competition_id` or `league_id`:
join `knockout_predictions.tournament_id` or `knockout_brackets.tournament_id` to
`competitions.slug`, with `tournament_id='wc2026'`. The guard covers
`applyKnockoutPromote`, `resetKnockoutBracket`, `lockKnockoutBracket`, and
`unlockKnockoutBracket` in `app/bracket/actions.ts`, and it runs before their session-client or
service-role writes.

The same migration closes the other archived-write paths promised in §0.1. Legacy WC prediction
policies join `contests → fixtures → competitions` and require `competitions.status <> 'archived'`.
`cashford.mirror_gameweek_entry` re-reads the source competition after its Phase 2 gameweek lock and
rejects unless `competitions.status='active'`; each target already requires an active
`league_competitions` row, and the routine now also checks the target contest’s competition status
before pass 2 writes.

The migration re-creates `cashford.mirror_gameweek_entry` from the applied Phase 2 body verbatim,
with only those added competition-status guard statements. Its signature stays byte-identical to
the applied `cashford.mirror_gameweek_entry(uuid, uuid, jsonb)` signature: `create or replace`
preserves privileges for that unchanged signature, while a changed signature silently drops them.
The migration re-emits Phase 2’s exact revoke and grant lines for that signature.

```sql
revoke all on function cashford.mirror_gameweek_entry(uuid, uuid, jsonb)  from public, anon;
grant execute on function cashford.mirror_gameweek_entry(uuid, uuid, jsonb) to authenticated, service_role;
```

### 6.6 Archive data state matrix

| ID | State | Analytics | Matches | Bracket |
|---|---|---|---|---|
| AS0 | Viewer participated | Full final table and personal recap | Picks and money shown | Frozen viewer bracket |
| AS1 | Viewer joined after WC ended | Final table plus “not in this one” note | Results without empty personal rows | League board; no personal claim |
| AS2 | Viewer was present but never predicted | Final table, zero entered count | `You sat this one out` | Frozen empty or partial bracket |
| AS3 | Departed member has history | Kept in standings | Kept on old rows | Kept in league leaderboard |
| AS4 | A legacy result row is missing | Affected money marked unavailable | Match row marked unavailable | Bracket still renders |
| AS5 | No bracket header for viewer | Analytics and Matches unaffected | Unaffected | Official circle plus `You didn’t lock a bracket.` |
| AS6 | Old public share URL | No effect | No effect | Same public bracket page |
| AS7 | PL not adopted by league | `/leagues/[slug]` redirects here; archive is the only WC surface | Full archive | Full archive |
| AS8 | PL adopted | Archive reached through competition sheet | Full archive | Full archive |

### 6.7 Archive copy

| ID | Use | Exact string |
|---|---|---|
| AC1 | Badge | `ARCHIVED` |
| AC2 | Global notice | `Read-only. These are the screens and rules as they applied in 2026.` |
| AC3 | Analytics heading | `Final standings` |
| AC4 | Freeze line | `Frozen at the final settlement on {date}.` |
| AC5 | Rules heading | `Rules as they applied` |
| AC6 | Matches notice | `Read-only. Every World Cup match, with what you called and what it paid.` |
| AC7 | Bracket notice | `Read-only. Frozen when the World Cup ended.` |
| AC8 | Late member | `You weren’t in this league during the World Cup.` |
| AC9 | No WC entries | `You didn’t enter a World Cup match in this league.` |
| AC10 | No bracket | `You didn’t lock a World Cup bracket.` |
| AC11 | Switcher note | `Archived competitions can be read but not played. Your dues carry across both.` |
| AC12 | PL return | `Premier League 2026-27` |

---

## §7 League Table and Season pills

### 7.1 League-scoped Premier League Table

Phase 5 owns `app/leagues/[slug]/table/page.tsx`. It is a thin page over Phase 4’s
`competition_standings` cache reader and shared table body; Phase 5 may extract that body to
`components/matches/CompetitionTable.tsx` if Phase 4 leaves it local to `app/matches/page.tsx`.
The page never calls ESPN, derives a table, or reads the match-summary standings window.

The loader resolves the league’s active league-format participation, passes its `competition_id` to
the Phase 4 reader, and renders inside `LeagueShell` with the competition sheet. The standings are
global competition facts; the league slug supplies access control and shell context, not a second
standings scope.

Phase 5 appends the fourth league-shell route so the final order is
`Gameweek | Season | Dues | Table`.

| ID | State | Required view |
|---|---|---|
| LT0 | Fresh ESPN cache row | Full table; source label from Phase 4 |
| LT1 | ESPN stale or absent, derived row available | Full derived table; Phase 4 fallback label |
| LT2 | Only stale cached data available | Last table plus Phase 4 stale note and fetched time |
| LT3 | No usable cache row | `Table unavailable` state; Gameweek and Season links remain |
| LT4 | League has no active participation and archived WC exists | Redirect through §6.1 to the WC archive |
| LT5 | Viewer is not a current league member | Not found; no standings shell or league facts |

Copy added to the table copy module:

| ID | Use | Exact string |
|---|---|---|
| LTC1 | Empty heading | `Table unavailable` |
| LTC2 | Empty body | `The Premier League table hasn’t reached Cashford yet.` |
| LTC3 | Stale note | `Last updated {time}. A newer table is on the way.` |

### 7.2 Season pills fix

Phase 3 owns the Season screen. Phase 5 closes the round-1 visual bug.

**SP1.** Create `components/gw/SeasonViewPills.tsx` with two links:

```text
Table | Gameweeks
```

**SP2.** Render it in the shared Season page wrapper above the conditional pane. Neither pane may render its own copy.

**SP3.** State is URL-backed with `?view=table` and `?view=gameweeks`.

**SP4.** Missing or invalid `view` resolves to `table`.

**SP5.** Both links retain the selected `?gw=` context where that context is valid.

**SP6.** The active link carries `aria-current="page"`.

**SP7.** This inner `Table` means the league’s Cashford season standings. The outer league `Table`
tab is the real Premier League table route supplied by Phase 5 over Phase 4’s cache.

Matrix:

| URL | Pane | Active pill |
|---|---|---|
| `/season` | Running totals | Table |
| `/season?view=table` | Running totals | Table |
| `/season?view=gameweeks` | Gameweek history | Gameweeks |
| `/season?view=bad` | Running totals | Table |

---

## §8 World Cup → Premier League transition

### 8.1 Two distinct activation levels

**TR1. Global activation.** Phase 1’s service-only `cashford.activate_competition('pl-2026-27')` runs after verified FPL sync. It opens the current gameweek and changes the competition from `preparing` to `active`.

**TR2. League adoption.** Global activation does not add PL participation to existing WC leagues. A league captain must call `cashford.adopt_league_competition`.

This distinction is fixed. No page calls the global activation routine.

### 8.2 Adoption transaction

The migration adds nullable `adoption_client_request_id uuid` and `adopted_stake_inr int` to
`league_competitions`, a check that they are both null or both non-null and that a stored ante is
between ₹50 and ₹1,000,000, and:

```sql
create unique index uq_league_adoption_request
  on cashford.league_competitions(league_id, adoption_client_request_id)
  where adoption_client_request_id is not null;
```

Phase 1 create/join rows keep both null. Captain adoption stores both so a retry can prove that its
key, competition, and ante match even when there is no open gameweek pot.

After reading `auth.uid()` and resolving the slug to a competition ID for lock addressing,
`adopt_league_competition` performs one transaction in this order:

1. Take the Phase 2 competition gate:
   `pg_advisory_xact_lock(hashtextextended(competition_id::text, 1))`.
2. Lock the league row.
3. Verify the caller is `leagues.created_by`.
4. Verify the league itself is not archived.
5. Lock and re-read the target competition.
6. Require `competitions.status='active'` and `format='league'`.
7. Lock all `league_competitions` rows for the league in competition-ID order.
8. Look up `p_client_request_id`. If it belongs to this target and its stored ante matches, reselect
   the participation and pot and return `adopted=false`; if the key’s facts differ, reject.
9. If a target participation already exists, return `adopted=false` only when it is active. If it is
   archived, reject with TC12 rather than falling into the applied `(league_id,competition_id)`
   primary-key violation.
10. Reject when any other competition is active. Never archive it silently.
11. Validate the ante using the same ₹50–₹1,000,000 range as `create_league`.
12. Select the candidate stored-open gameweek ID, take its Phase 2 gameweek advisory lock with
    `cashford.lock_gameweeks(array[id])`, then re-read its `status` and `deadline_at`. Use it only
    when it is still `open` and `deadline_at > clock_timestamp()`; otherwise use null.
13. Update `leagues.default_stake_inr` to the accepted PL ante. This is a future-gameweek default;
    §6.3 forbids the WC archive from reading it.
14. Insert `league_competitions(status='active',
    eligible_from_gameweek_id=current_open_or_null, adoption_client_request_id=key,
    adopted_stake_inr=ante)`.
15. Insert `member_competitions` only for current `league_members` rows (`left_at is null`) with the
    same boundary.
16. If an open gameweek exists, insert its `gameweek_contest` with the ante and deadline snapshots
    using `on conflict (league_id,gameweek_id) do nothing`; reselect the row and reject unless its
    competition, stake, and deadline equal the intended facts.
17. Leave the existing WC `league_competitions(status='archived')` row unchanged.
18. Return the participation, eligibility, and reselected pot IDs.

If there is no open future gameweek, participation and member eligibility use a null boundary. Phase 1 maintenance fills both when the next gameweek opens.

### 8.3 Transition entry points

Captain prompt appears:

- on the league’s WC archive landing page;
- on the league card at app home;
- in league management.

Non-captains see a waiting message but no mutation control.

`components/gw/CaptainAdoptionSheet.tsx` posts to
`app/api/leagues/[slug]/adopt/route.ts`. The route authenticates the caller, resolves the slug to the
league ID, validates the body, and calls `adopt_league_competition`; it does not chain table writes.
The sheet generates one UUID when opened and reuses that `clientRequestId` for retries and double
clicks.

The captain sheet shows:

- competition name;
- ante field;
- first eligible gameweek;
- absolute IST deadline;
- statement that the balance and WC archive remain.

### 8.4 Transition state matrix

| Competition | League participation | Viewer | Screen |
|---|---|---|---|
| PL `preparing` | None | Captain/member | No adoption CTA; WC archive remains |
| PL `active` | None | Captain | Adoption card with ante and first deadline |
| PL `active` | None | Member | Waiting-for-captain card |
| PL `active` | PL active | Anyone | PL is default; WC appears under Past |
| PL `archived` | None | Anyone | No adoption CTA |
| PL `active` | Another competition active | Captain | Adoption blocked; current competition named |
| PL `active` | Adoption request racing twice | Captain | One participation and one pot; second call returns existing state |
| No future open GW | PL active after adoption | Anyone | PL shell with between-gameweeks state; maintenance provisions the next pot |

### 8.5 Transition copy

| ID | Use | Exact string |
|---|---|---|
| TC1 | Captain heading | `Premier League 2026-27 is ready` |
| TC2 | Captain body | `Same league, same members, same balance. Your World Cup stays in the archive.` |
| TC3 | Ante label | `Ante per gameweek` |
| TC4 | Consequence | `Everyone stakes ₹{ante} a gameweek. Highest score takes the pot.` |
| TC5 | First gameweek | `First gameweek: GW{number} · deadline {deadline}` |
| TC6 | CTA | `Start Premier League` |
| TC7 | Member heading | `Waiting for {captain} to start the Premier League` |
| TC8 | Member body | `Your World Cup archive and league balance are still here.` |
| TC9 | Adopted | `Premier League 2026-27 is now active for {league}.` |
| TC10 | Other active competition | `{competition} is already active for this league.` |
| TC11 | Preparing | `Premier League setup is still being checked.` |
| TC12 | Prior archived participation | `This league already archived {competition}. It can’t be started again.` |

---

## §9 Create and join polish

### 9.1 Create flow

Phase 3’s active-only competition rule remains.

The default create path asks for:

1. league name;
2. ante per gameweek.

The invite slug is generated from the name. `Edit invite link` opens the existing slug field as an optional disclosure.

Competition behavior:

- one active competition → show a confirmed row, not a select;
- more than one active competition → show the confirmed row with `Change`;
- zero active competitions → block submission with the zero-state copy;
- archived competitions never appear;
- the final consequence shown before submit is the first gameweek and its deadline.

Competition facts are loaded on the server. There is no client-side loading flash and no stale World Cup heading.

The success panel uses the actual competition, ante, deadline, link, and plain code.

### 9.2 Join preview DTO

Extend the Phase 3 active `InviteDTO` with:

```text
competitionSlug
competitionName
competitionFormat
participationStatus
anteInr
nextGameweekNumber
nextDeadlineAt
eligibleFromGameweekNumber
```

`nextGameweekNumber` and `nextDeadlineAt` come from the active participation’s current future gameweek. A stale stored `open` gameweek past its deadline is ignored.
`memberCount` counts only `league_members.left_at is null`.

The same preview renders before signup, before login, and before an authenticated join.

### 9.3 Join states

| ID | Invite state | Display | Action |
|---|---|---|---|
| JS0 | Valid, active PL participation | Full preview | Join |
| JS1 | Logged-out viewer | Same preview | Create account or log in |
| JS2 | Already a member | Full league identity | Open league |
| JS3 | Viewer is captain | Management identity | Open league |
| JS4 | Revoked invite | Expired copy | Ask captain for a new link |
| JS5 | Unknown code | Not-found copy | Retry code |
| JS6 | League has only archived WC | Between-competitions copy | No join |
| JS7 | PL adoption happens after preview | Join routine re-resolves and succeeds if still valid | Join |
| JS8 | PL participation disappears before submit | Routine rejects | Refresh preview |
| JS9 | Mid-season join | Current open GW eligibility | Earlier GWs show `Before your time` |
| JS10 | No future open GW | Join allowed with null boundary | Starts when the next GW opens |

### 9.4 Create/join copy

| ID | Use | Exact string |
|---|---|---|
| JC1 | Create title | `New league` |
| JC2 | Ante label | `Ante per gameweek` |
| JC3 | Ante meaning | `Everyone stakes ₹{ante} a gameweek. Highest score takes the pot.` |
| JC4 | Future-only | `Changes apply to future gameweeks only.` |
| JC5 | Competition heading | `Competition` |
| JC6 | First deadline | `First gameweek: GW{number} · deadline {deadline}` |
| JC7 | Late start | `Earlier gameweeks were played before this league existed. Nobody owes anything for them.` |
| JC8 | Create CTA | `Create {league}` |
| JC9 | Invite note | `You’ll get an invite link on the next screen.` |
| JC10 | Join title | `Join a league` |
| JC11 | Preview competition | `Competition` |
| JC12 | Preview ante | `₹{ante} a gameweek` |
| JC13 | Preview members | `{count} members` |
| JC14 | Preview deadline | `Next deadline` |
| JC15 | Join CTA | `Join {league}` |
| JC16 | Free join | `Joining is free. You only stake when you enter a gameweek.` |
| JC17 | Before time | `Before your time` |
| JC18 | Before-time note | `Your season starts at GW{number}. Earlier gameweeks are read-only history.` |
| JC19 | Between competitions | `This league is between competitions. Ask the captain to start the Premier League first.` |
| JC20 | No active competition | `No competition is open for new leagues right now.` |
| JC21 | Invite message | `Come play {league} on Cashford — {competition} scoreline predictions, ₹{ante} a gameweek. Highest score takes the pot.` |
| JC22 | Invite deadline | `First deadline: {deadline}.` |
| JC23 | Invite code | `Or enter the code: {code}` |
| JC24 | WhatsApp action | `Send on WhatsApp` |

---

## §10 Edge cases

| ID | Case | Required behavior |
|---|---|---|
| E1 | Partial payment | Exact typed amount enters pending; confirmed amount reduces only those two balances |
| E2 | Overpayment | Warning only; confirmation may cross both users through zero |
| E3 | Gameweek settles while payment sheet is open | Typed amount stays fixed |
| E4 | Payment logged by payer | Receiver confirms |
| E5 | Payment logged by receiver | Payer confirms |
| E6 | Payment logged by a third member | Both parties confirm |
| E7 | One of two parties disputes | Record stays outside the balance |
| E8 | Disputing party later confirms | State recomputed from the latest required stances |
| E9 | Logger cancels a dispute | Record remains visible as cancelled and never affects net |
| E10 | Confirmed payment mistake | Exact reversal record; original is unchanged |
| E11 | Reversal disputed | Original payment keeps its ledger effect |
| E12 | Duplicate request | Existing row returned; no duplicate movement |
| E13 | Two confirmations race | Row lock serializes them; one final status |
| E14 | Member leaves with debt | Stays in Net position and settle plan |
| E15 | Departed member must confirm | Direct payment route grants access to that record only |
| E16 | Payment party was never in the league | Routine rejects |
| E17 | Logger leaves between render and submit | Routine rejects logging |
| E18 | Result/transfer parity mismatch | Plan hidden; no automatic repair |
| E19 | `Σ net != 0` | Plan hidden; sync warning |
| E20 | Reversed gameweek transfer | Excluded from activity and parity fold |
| E21 | WC and PL balances offset | Combined net and one simplified plan |
| E22 | No PL adoption | WC archive remains the league landing view |
| E23 | Captain adopts during a zero-open window | Null eligibility; next maintenance fills it |
| E24 | Two adoption calls | One participation and one pot |
| E25 | Another competition already active | Adoption rejected without changing it |
| E26 | User joined after WC | Archive note, not zero performance rows |
| E27 | WC match result missing | Row marked unavailable; archive stays usable |
| E28 | Bracket mutation through an old tab | Server rejects because WC is archived |
| E29 | Old public bracket link | Still opens read-only |
| E30 | Archive Matches route | No bracket markup or bracket query |
| E31 | Dues route | No competition switcher |
| E32 | Invalid Season pill | Falls back to Table |
| E33 | Invite resolved before PL adoption | Between-competitions state |
| E34 | Archived competition submitted to create routine | Existing Phase 1 routine rejects |
| E35 | Stale deadline in join preview | Past-deadline `open` row ignored |
| E36 | Payment note contains only spaces | Stored as null |
| E37 | Future payment date in IST | Routine rejects |
| E38 | No JavaScript | Archive and Dues reads render; money mutation controls are inert |
| E39 | Payer and receiver log the same real payment | Second call returns the first record and PC19; one money row |
| E40 | Disputed reversal stalls | It stays visible and ledger-neutral; a fresh reversal may supersede it |
| E41 | League or all competitions archived | Current members may still log, confirm, dispute, cancel, and reverse league payments |
| E42 | Departed member opens former league routes | League-wide reads fail; their direct payment link and confirmation history still work |
| E43 | Broken ledger page refreshes repeatedly | One open `dues/ledger_parity` sync issue, not one row per view |
| E44 | Departed member rejoins an active league | Membership and current participation reactivate at the new gameweek boundary |
| E45 | Target competition participation already archived | Adoption returns TC12; no raw primary-key error |
| E46 | Same idempotency key is reused for another payment or adoption payload | Routine rejects the changed scope |

---

## §11 Test inventory

### 11.1 Unit and component tests

**Ledger math**

- **T-U1** WC-only balance.
- **T-U2** PL-only balance.
- **T-U3** combined WC+PL balance.
- **T-U4** confirmed payment signs.
- **T-U5** confirmed reversal signs.
- **T-U6** pending, disputed, and cancelled rows contribute zero.
- **T-U7** partial payment.
- **T-U8** overpayment crossing zero.
- **T-U9** property test over 1,000 generated ledgers: `Σ net = 0` before and after payments.
- **T-U10** `simplifyDebts` receives the combined net once and returns a deterministic plan.
- **T-U11** corrupt non-zero sum returns `sync_issue` and never calls `simplifyDebts`.
- **T-U12** result-snapshot fold equals non-reversed transfer fold.

**Payment state**

- **T-U13** payer logger requires receiver.
- **T-U14** receiver logger requires payer.
- **T-U15** third-party logger requires both.
- **T-U16** first of two confirmations stays pending.
- **T-U17** dispute wins over incomplete confirmations.
- **T-U18** later confirmation resolves a dispute.
- **T-U19** confirmed and cancelled are terminal.
- **T-U20** reversal links and opposite effect.
- **T-U21** original payment remains unchanged after reversal.
- **T-U22** idempotency keys reject changed payloads.

**Archive**

- **T-U23** final WC table ordering.
- **T-U24** correct and exact counts use `lib/analytics.ts`.
- **T-U25** late-joiner state.
- **T-U26** departed member retention.
- **T-U27** Matches ordering and signed match net.
- **T-U28** bracket leaderboard filters bracket owners to the selected league’s current and
  historical members; the knockout tables themselves have no league scope.
- **T-U29** archive tab order is exactly Analytics, Matches, Bracket.
- **T-U30** Matches imports no bracket component.

**Season and create/join**

- **T-U31** both Season panes render the same pill component.
- **T-U32** invalid Season view falls back to Table.
- **T-U33** create consequence resolves the first future deadline.
- **T-U34** invite DTO for active, archived-only, zero-open, and stale-open cases.
- **T-U35** invite message uses actual competition, ante, deadline, link, and code.
- **T-U36** transition matrix, including captain/member and preparing/active states.

**Guards**

- **T-U37** pinned checksum for `lib/settlement.ts`.
- **T-U38** pinned checksums for the Phase 2 gameweek engine files.
- **T-U39** Phase 5 copy exports and generated strings pass the copy rules.
- **T-U40** source scan finds no bare user-facing Phase 5 JSX literal.
- **T-U41** `CompetitionSheet` orders active participation first, then archived by joined time and
  slug; active PL and archived WC have the exact target hrefs, while another archived competition is
  a non-link label with no dead href.
- **T-U42** league Table renders fresh ESPN, derived fallback, stale, and unavailable states from
  Phase 4 DTOs without a provider call.
- **T-U43** changing `leagues.default_stake_inr` after the World Cup does not change any
  `lib/wc-archive.ts` stake or money output.
- **T-U44** matching-payment detection treats payer-log and receiver-log as one real payment while
  preserving same-logger retry behavior.
- **T-U45** archived competition guards cover legacy WC predictions, all four bracket actions, and
  cross-league mirroring.
- **T-U46** a dirty-settled ledger returns `recalculating`, and a spy proves `simplifyDebts` is never
  called.
- **T-U47** a dirty-void ledger with no `gameweek_entry_results` rows still returns `recalculating`;
  absence of entry-result rows is not treated as a clean zero.
- **T-U48** a WC-only ledger has no dirty gameweek contest and renders its normal balance and settle
  plan.

### 11.2 Persistence tests

Run against disposable Postgres first, then the shared database with scratch data only.

- **T-P1** migration applies twice.
- **T-P2** constraints reject self-payments, bad amounts, bad reversal shapes, and overlong notes.
- **T-P3** authenticated users cannot write either table directly.
- **T-P4** current member can read all league payments.
- **T-P5** unrelated league member cannot read them.
- **T-P6** departed party can read only payments involving them.
- **T-P7** anon cannot call any routine.
- **T-P8** authenticated caller cannot call private helpers.
- **T-P9** any current member may log between two other financial participants.
- **T-P10** arbitrary profile injection is rejected.
- **T-P11** `logged_by` always equals `auth.uid()`.
- **T-P12** logger cannot forge a confirmation.
- **T-P13** required counterparty can confirm.
- **T-P14** third-party log requires both confirmations.
- **T-P15** dispute and later confirmation append events without deleting history.
- **T-P16** duplicate log and response requests are idempotent.
- **T-P17** concurrent responses produce one final state.
- **T-P18** confirmed facts cannot be changed through any granted path.
- **T-P19** reversal copies the exact pair and amount.
- **T-P20** second live reversal is rejected.
- **T-P21** confirmed reversal restores the prior combined net.
- **T-P22** transfer IDs, amounts, `reversed` flags, and row count, plus
  `contest_results` and `gameweek_entry_results` row counts and every `net_inr`, are identical before
  and after every payment operation.
- **T-P23** WC `contest_id` and PL `gameweek_contest_id` rows both enter the activity fold.
- **T-P24** captain adoption creates one active participation, member rows, and one current pot.
- **T-P25** non-captain adoption fails.
- **T-P26** preparing or archived competition adoption fails.
- **T-P27** another active competition blocks adoption without mutation.
- **T-P28** double adoption is idempotent.
- **T-P29** zero-open adoption stores null boundaries and maintenance later fills them.
- **T-P30** all new routines have empty search paths, explicit revokes, and the stated grants.
- **T-P31** stamped-left member loses every league-wide RLS read, cannot write a WC prediction or
  bracket pick, and keeps read/respond access to only their own payment and its
  `payment_confirmations`.
- **T-P32** `remove_league_member` preserves the `league_members` row, stamps matching
  `member_competitions.left_at`, and an entry racing the leave cannot commit afterward.
- **T-P33** payer and receiver concurrently logging the same pair, amount, and IST date produce one
  ordinary payment; the loser receives `matching_existing` with the winner’s ID.
- **T-P34** `respond_to_payment`, `cancel_payment`, and `reverse_payment` reject an idempotency key
  whose stored record belongs to another payment.
- **T-P35** a disputed reversal does not block a new reversal; pending or confirmed reversal still
  does.
- **T-P36** one broken league produces exactly one open
  `sync_issues(source='dues',kind='ledger_parity')` row across repeated reports; after parity is
  restored, the second half invokes `scripts/inspect-dues-ledger.mjs --resolve <issue-id>` and proves
  the service path resolves it, while the same flag fails before parity is restored.
- **T-P37** neither `payments` nor `payment_confirmations` appears in any realtime publication.
- **T-P38** explicit table grants deny authenticated and anon insert, update, and delete on both
  payment tables even when RLS is bypass-tested by privilege inspection.
- **T-P39** archived league status does not block payment log, response, cancel, or reversal, while
  `join_league` still rejects the archived league.
- **T-P40** adoption takes the competition gate and gameweek lock, re-reads the open gameweek,
  survives a double call with one request ID, and returns the reselected single pot.
- **T-P41** pre-existing archived target participation returns the domain error; no unique violation
  escapes.
- **T-P42** WC prediction policies and `mirror_gameweek_entry` reject an archived competition before
  any write; after the Phase 5 migration, the mirror routine’s signature and privileges equal the
  applied Phase 2 signature plus its revoke/grant contract.

### 11.3 Browser tests

Seed scripts create only:

```text
ZZ-TEST-P5-DUES
ZZ-TEST-P5-ARCHIVE
ZZ-TEST-P5-TRANSITION
ZZ-TEST-P5-JOIN
```

Every helper checks the name prefix before writing or cleaning up.

Use separate authenticated sessions for payer, receiver, third-party logger, captain, member, late joiner, and departed participant.

- **T-B1** combined WC+PL net table and one settle plan.
- **T-B2** debtor uses `Log as paid`; receiver confirms; both views update.
- **T-B3** net-positive viewer uses `Log as received`; payer confirms.
- **T-B4** third member logs between two others; first confirmation changes no balance; second does.
- **T-B5** partial payment leaves the stated remainder.
- **T-B6** overpayment warning does not block.
- **T-B7** dispute excludes the record; later confirmation applies it.
- **T-B8** logger cancels a disputed record.
- **T-B9** confirmed payment reversal shows both feed rows and restores the balance.
- **T-B10** departed party opens `/payments/[id]`, sees no other league data, and confirms.
- **T-B11** Dues has no competition switcher.
- **T-B12** ledger sync issue hides the plan and settle shortcuts while generic log, confirm,
  dispute, cancel, and reverse controls stay live and work.
- **T-B13** archive opens on Analytics.
- **T-B14** tab order is Analytics, Matches, Bracket at mobile and desktop widths.
- **T-B15** Final standings lead the archive.
- **T-B16** late joiner sees AC8.
- **T-B17** Matches is a plain Done-style list and contains no bracket markup.
- **T-B18** archive match links open read-only WC match details.
- **T-B19** Bracket has no edit, reset, lock, unlock, or promote control.
- **T-B20** old `/bracket` and one seeded public `/b/[id]` link still open.
- **T-B21** both Season panes show `Table | Gameweeks`.
- **T-B22** pill URLs survive refresh and back navigation.
- **T-B23** PL preparing shows no adoption CTA.
- **T-B24** global PL active gives the captain the adoption prompt.
- **T-B25** non-captain sees waiting copy and no adoption request.
- **T-B26** captain opens `CaptainAdoptionSheet`, adopts, PL becomes default, and WC remains under
  Past in `CompetitionSheet`.
- **T-B27** the adoption route receives the same `clientRequestId` twice and creates one
  participation and one pot despite a double click.
- **T-B28** create shows ante consequence and first deadline before submit.
- **T-B29** join preview shows competition, ante, members, and deadline before commitment.
- **T-B30** logged-out join preview matches the authenticated preview.
- **T-B31** mid-season joiner sees earlier gameweeks as `Before your time`.
- **T-B32** invite text contains the actual PL facts, link, and plain code.
- **T-B33** all new screens pass light and dark visual checks.
- **T-B34** no JavaScript leaves reads intact and all money controls inert.
- **T-B35** browser network log contains no write to a league outside `^ZZ-TEST-`.
- **T-B36** payer logs a pending payment, receiver tries to log the same facts, sees PC19 plus the
  matching pending confirmation card, and opens the original record.
- **T-B37** `/leagues/[slug]` for an archived-WC-only league redirects to
  `/leagues/[slug]/archive/wc2026`; no `CupLeagueView` surface remains.
- **T-B38** `CompetitionSheet` appears on Gameweek, Season, league Table, and archive, with active
  before Past, and never appears on Dues.
- **T-B39** league Table shows the same Phase 4 standings body and source label as app-level Matches
  Table.
- **T-B40** the home league card shows DC11 only for payments the viewer must answer and links to the
  right Dues screen.
- **T-B41** an archived league still permits a current member to complete payment confirmation and
  reversal, while its invite stays closed.
- **T-B42** a dirty-settled Dues screen hides every balance, plan, shortcut, and prefill, shows the
  shared C71 recalculating state, and still lets the viewer confirm an existing pending payment.
- **T-B43** a dirty-void Dues screen with no entry-result rows has the same suppression and C71
  assertions, and still lets the viewer confirm an existing pending payment.

---

## §12 Sequencing

| Stage | Work | Gate |
|---|---|---|
| 1 | Pure payment state, ledger math, archive standings, and copy modules | Phase 2 types available |
| 2 | Migration, leave semantics, RLS, payment routines, issue routines, adoption routine | Stage 1 unit tests green |
| 3 | Disposable-Postgres persistence suite | Stage 2 |
| 4 | Dues loaders and read-only main screen | Phase 2 Dues aggregation applied; Phase 3 `lib/net-balance.ts`, `RecalculatingNote.tsx`, and C71 landed; X-P5-1 is a blocking exit gate |
| 5 | Payment APIs and log/confirm/dispute/cancel/reverse screens | Stage 3 |
| 6 | League Table route, competition sheet, and Season pills fix | Phase 3 + Phase 4 table body |
| 7 | Archive redirect, shell, Analytics, Matches, and read-only bracket | Phase 1 + Phase 3 |
| 8 | Create/join polish | Phase 3 create/join pass landed |
| 9 | Captain adoption prompt and PL transition | Global PL activation verified |
| 10 | Shared-DB persistence smoke with `ZZ-TEST-*` leagues | Stages 2–9 |
| 11 | Staging browser suite in both themes | Stage 10 |
| 12 | Adversarial review and correction pass | All prior gates green |

Dues should not be exposed in production until the multi-user confirmation, dispute, reversal, and departed-member browser cases have run against staging.

---

## §13 Acceptance criteria

**A.** One Dues screen combines WC and PL game results plus confirmed payments, with no competition filter.

**B.** Every valid combined ledger satisfies `Σ net = 0` before and after each payment or reversal.

**C.** `simplifyDebts` is the only debt-plan function, and `lib/settlement.ts` is byte-identical.

**D.** A payment changes no game-money row. T-P22 proves transfer IDs, amounts, reversal flags, and
row count plus both result-table row counts and every `net_inr` stay fixed.

**E.** Any current member can log between two financial participants, and `logged_by` always records the authenticated user.

**F.** Payer logging requires receiver confirmation; receiver logging requires payer confirmation; third-party logging requires both.

**G.** Pending, disputed, and cancelled records never alter dues. Confirmed records do.

**H.** Partial payment, overpayment, stale suggestion, dispute resolution, cancellation, and confirmed reversal all pass persistence and browser tests.

**I.** A departed member with debt remains in the ledger and can answer a payment involving them without reading the full league.

**J.** World Cup archive tabs appear in the exact order `Analytics | Matches | Bracket`; Analytics leads with Final standings.

**K.** Archive Matches contains no bracket block. Archive Bracket exposes no mutation path. Old bracket links still work.

**L.** The league-scoped PL Table reads only Phase 4’s standings cache, and both Season panes render
`Table | Gameweeks` from one shared component.

**M.** Global PL activation never auto-adopts an existing league. Only its captain can adopt, and the transaction creates one participation, the eligible member rows, and at most one current pot.

**N.** After adoption, PL is the default league view, WC remains read-only under Past, and Dues still shows one balance.

**O.** Create and join show the active competition, ante, first or next deadline, and mid-season consequence before commitment.

**P.** Every new copy string contains no exclamation mark and uses ante or stake for gameplay money.

**Q.** `npm run typecheck`, `npm run build`, `npx vitest run`, the Phase 2 suite, and the full Phase 5 suite pass with no skipped tests.

**R.** Browser verification covers the running screens, not only a build, in light and dark themes.

**S.** Every Phase 5 test write targets a `ZZ-TEST-*` league. Solid Yenne Boys, KK Bois, and PES Bois receive zero test writes.

**T.** A removed member is soft-departed across league and competition membership, loses
league-wide RLS access, and keeps only party-scoped payment access.

**U.** The same real payment logged by both counterparties creates one row and opens the first
record; request idempotency is scoped to the target payment or adoption.

**V.** Payment confirmation and correction remain available during ledger warnings and after league
archival; archived leagues remain closed to joining.

**W.** One open Dues parity issue is recorded per broken league and can be resolved only through the
service inspection path after parity is restored.

**X.** The Dues loader returns `recalculating` before any balance, plan, shortcut, or prefill
calculation while any gameweek contest is dirty; Phase 5’s T-U46–T-U48 and T-B42–T-B43 close
X-P5-1 independently of Phase 3.

---

## §14 Findings-resolution map

| Finding | Resolution | Sections changed |
|---|---|---|
| 1 | Added soft departure, atomic leave/rejoin semantics, current-only membership helper and policies, and party-only post-leave payment access | §1.1, §1.6, §1.7–§1.9, §3.4, §9.2, §10 E42/E44, §11 T-P31/T-P32 |
| 2 | Added cross-logger real-payment match detection, soft-conflict response, matching card, copy, edge and tests | §1.7 `log_payment`, §4.2 PS10, §5.2 PC19, §10 E39, §11 T-U44/T-P33/T-B36 |
| 3 | Replaced Phase 3’s archived-WC fallback view with the canonical archive redirect and retired `CupLeagueView` | §0.3, §6.1, §6.6 AS7, §10 E22, §11 T-B37 |
| 4 | Made `CompetitionSheet.tsx` a Phase 5 deliverable with an ordered DTO, href contract, placements, and tests | §3.3, §6.2, §7.1, §11 T-U41/T-B38 |
| 5 | Made the league-scoped Table route a Phase 5 deliverable over Phase 4’s cache, with states, copy and tests | §0.1, §0.3, §3.1, §7.1–§7.2, §11 T-U42/T-B39, §12, §13 L |
| 6 | Added the authenticated adoption route, captain sheet, and persisted client request key | §1.7, §3.1/§3.3, §8.2–§8.3, §11 T-P40/T-B26/T-B27 |
| 7 | Applied Phase 2 competition/gameweek lock order, post-lock re-read, conflict-safe pot insert/reselect, and archived-target handling | §8.2, §8.4, §8.5 TC12, §10 E45, §11 T-P40/T-P41 |
| 8 | Bound WC archive money to contest/result snapshots and banned league default stake from its loader | §6.3, §8.2 step 13, §11 T-U43 |
| 9 | Kept confirmation and correction actions live during sync warnings; hid only the plan and shortcuts | §4.1 DS8, §11 T-B12, §13 V |
| 10 | Scoped response, cancel, and reversal idempotency records to their payment and payload | §1.7, §10 E46, §11 T-P34 |
| 11 | Removed disputed reversals from the live unique predicate and allowed a fresh correction | §1.2, §1.7 `reverse_payment`, §10 E40, §11 T-P35 |
| 12 | Added one-open-issue parity reporting and a named service-only inspect/resolve path | §1.7–§1.8, §2.6, §3.4, §10 E43, §11 T-P36, §13 W |
| 13 | Kept league payments open after archival while leaving archived league invites closed | §1.7, §10 E41, §11 T-P39/T-B41, §13 V |
| 14 | Filled persistence and publication gaps, extended T-P22, and guarded WC predictions and mirroring | §1.1, §1.8–§1.9, §6.5, §11 T-U45/T-P22/T-P31/T-P37/T-P38/T-P42 |
| 15 | Joined knockout `tournament_id` to `competitions.slug`, named all four action guards, and corrected leaderboard test scope | §6.5, §11 T-U28/T-U45 |
| 16 | Dropped the unused one-value league currency column and DTO field | §1.1, §9.2 |
| 17 | Defined the payment-date lower and upper bounds in IST from `leagues.created_at` and `clock_timestamp()` | §1.7 `log_payment` |
| 18 | Added explicit table-level mutation revokes for anon and authenticated | §1.8, §11 T-P38 |
| 19 | Marked the member-competition participant rule as belt-and-braces under the applied foreign key | §1.6 |
| 20 | Added the home pending-payment badge and a copy ID for disputed-payment sharing | §3.3, §5.1 DC11, §5.3 CC16, §11 T-B40 |
| 21 | Gave `SeasonViewPills` its concrete file path | §3.3, §7.2 SP1 |
| 22 | Added X-P5-1’s shared dirty-contest gate before all Dues money computation, its recalculating state, tests, dependency gate, and acceptance criterion | §0.2–§0.3, §2.0, §2.2, §4.1 DS11, §11 T-U46–T-U48/T-B42–T-B43, §12, §13 X |
| N1 | Pinned the Phase 5 mirror replacement to the applied Phase 2 body, byte-identical signature, and re-emitted privileges; extended the persistence check | §6.5, §11 T-P42 |
| N2 | Prevented `CompetitionSheet` from emitting routes Phase 5 does not build and covered another archived competition | §6.2, §11 T-U41 |
| N3 | Added the service-backed `--resolve` command and exercised it after repair | §2.6, §11 T-P36 |
| N4 | Made the membership-removal lock order explicit | §1.7 |
