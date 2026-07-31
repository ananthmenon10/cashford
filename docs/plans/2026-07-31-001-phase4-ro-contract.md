# Phase 4 RO-1 / RO-2 implementation-time contract

Status: **DRAFT — NOT APPROVED — NO KEY MAY BE ARMED**

Approval is external. The arm script accepts only `Status: APPROVED`, then reads
the one-time approval row described in §3.3. It hashes this file as-is and
compares that value with the row; no hash stored in this mutable file is trusted.

Date: 2026-07-31
Code basis: the reviewed Phase 4 implementation built from plan v11
Review gate: decision 34 and the round-11 carve-out

This contract replaces only the carved-out RO-1/RO-2 text. It does not change
the Phase 4 plan. A reviewer must compare this file with the named code before
any rollout command runs.

## 1. Tick response this contract reads

The tick keeps all old top-level fields. Its Phase 4 addition has this shape:

```text
phase4.<label> = {
  startedAt: ISO application timestamp,
  finishedAt: ISO application timestamp,
  lease: "claimed" | "not_due" | "leased",
  fetches: integer,
  writes: integer
}
```

The top-level response also has `fotmobEnabled: boolean`, which is the running
deployment's `FOTMOB_ENABLED === "true"` value. It is read-only and contains no
secret.

An exception replaces the last three fields with `error`. The labels map to
lease keys as follows:

| Response label | Lease key |
|---|---|
| `insights` | `espn_insights` |
| `matchData` | `espn_match_data` |
| `commentary` | `espn_commentary` |
| `standings` | `espn_standings` |
| `derivedStandings` | `derived_standings` |
| `reconcile` | `espn_reconcile` |
| `teamNews` | `team_news` |
| `understat` | `understat_xg` |
| `fotmob` | `fotmob_slow` |

`summary` is `{requests, hits}` for the one shared ESPN summary fetcher. The
application timestamps locate the step in logs. They are not database-clock
proof and RO-2 must not use them as snapshot boundaries.

## 2. Actual write sets

Every row below includes the key's own `sync_state` row. Claim and release can
change `last_run_at`, `next_due_at`, `lease_until`, and `lease_token`. A failed
`not_due` or `leased` claim changes nothing.

| Key | Direct and triggered write set from the code |
|---|---|
| `espn_insights` | `fixture_insights`; its own `sync_state` row |
| `espn_match_data` | `fixture_match_data`; `sync_issues` when the stale-read trigger reaches three; its own `sync_state` row |
| `espn_commentary` | `fixture_match_data`; `sync_issues` through the same stale-read trigger; its own `sync_state` row |
| `espn_standings` | `competition_standings(source='espn')`; its own `sync_state` row |
| `derived_standings` | `competition_standings(source='derived')`; its own `sync_state` row |
| `espn_reconcile` | `fixture_match_data`; its own `sync_state` row |
| `team_news` | `fixture_insights`; its own `sync_state` row |
| `understat_xg` | `fixture_provider_ids`; `fixture_provider_data`; `provider_samples`; retention deletes from `provider_samples`; `sync_issues` for shape drift or the breaker; its own `sync_state` row |
| `fotmob_slow` | `fixture_provider_ids`; `fixture_provider_data`; `provider_samples`; retention deletes from `provider_samples`; `sync_issues` for shape drift or the breaker; its own `sync_state` row |

`lib/provider-samples.ts` is part of both slow-provider rows. It inserts a
sample, may insert a `provider_shape` issue, and the migration trigger deletes
samples older than the newest five for the same `(provider, endpoint)`.

The row and column boundary is part of this contract. The observer uses these
primary keys: `fixture_insights(fixture_id)`,
`competition_standings(competition_id,source)`,
`fixture_match_data(fixture_id)`,
`fixture_provider_data(fixture_id,provider)`,
`fixture_provider_ids(fixture_id,provider)`,
`provider_samples(id)`, and `sync_issues(id)`. For each claimed key it derives
permitted fixture rows from the before snapshot and that poller's due rules,
then checks the changed columns against the poller's write columns. A row or
column outside that set fails the observation. For a slow provider,
`fixture_provider_ids` rows are limited to due fixtures from that provider in
the before snapshot. A pre-existing row outside that due set is allowed only
when the diff contains its paired delete and insert, with the same provider and
exact `external_id`; an unpaired pre-existing-row change fails. The observer
matches these pairs one-to-one, so a surviving row cannot stand in for the
inserted half.
For `fixture_match_data`, its due set calls the same `lineupsDueAt`,
`eventsDueAt`, and `statsDueAt` functions as the poller, using the before
snapshot's kickoff, status, finished-at, and cache timestamps. That includes
the real FT+30 cutoff; the observer does not use a separate approximation.

`provider_samples` has no fixture foreign key, and `sync_issues` has no actor
foreign key. Their evidence is limited to provider/endpoint or source/kind/ref
ownership. A matching sample or issue is not proof of which application
poller wrote it. Likewise, overlapping fixture rows shared by two claimed
pollers are checked against the union of their permitted columns, not assigned
to one actor.

No poller may change another Phase 4 key or `fpl-sync`. No table outside the
seven fully allowed tables and the target key's `sync_state` row is in any
write set.

## 3. RO-1 — switch proof

RO-1 has a production-negative half and a disposable-positive half.

### 3.1 Production-negative half

This half runs only after migration `20260728000001_match_data_v2.sql` is
applied. Before it lands, the response can contain only
`{startedAt,finishedAt,error}` because `claim_phase4_lease` and the dark rows do
not exist. That pre-migration response proves the route stays dark; it cannot
prove RO-1. The production-negative half therefore follows the migration gate,
never precedes it.

For each key, while it is still at `infinity`:

1. Run `node scripts/phase4-ro-observer.mjs --key <key> --baseline
   --confirm-production` while every Phase 4 key is at `infinity`. Baseline mode
   takes a before snapshot, calls one real deployed tick without arming anything,
   takes an after snapshot, and compares the pair. The observer also requires
   every Phase 4 row to remain at `infinity` with no lease in both snapshots.
2. Require the mapped response field to contain `lease:"not_due"`,
   `fetches:0`, and `writes:0`, with no `error`.
3. Require every protected table, every allowed table, fixtures, competitions,
   result revisions, and every sync row other than the `espn_insights` row to be
   byte-identical. On that row, only these four fields may differ:
   `last_run_at`, `next_due_at`, `lease_until`, and `lease_token`. Any other
   baseline difference fails.

The dark legacy insights path is an intentional exception. When the
`espn_insights` row is at `infinity`, `claim_insights_writer(300)` may set only
`last_run_at`, `lease_until` to its claim time plus at most 300 seconds, and a
new `lease_token`; its release may set only `last_run_at`, `next_due_at` back
to `infinity`, and the two lease fields to null. A completed snapshot must
therefore still show `next_due_at='infinity'`, `lease_until=null`, and
`lease_token=null`; the only expected lasting difference is `last_run_at`.
No other row or column may move. The observer permits only these four named
columns for this handoff. Once the key is armed, the legacy branch is
suppressed and the normal Phase 4 lease rules apply. The 10-minute insights
release has no jitter; the slow-provider release jitter is separately
bounded by 10,800 to 18,000 seconds.

This proves the deployed caller reaches the poller and that the dark switch
stops all work. A `leased` answer is not a pass because it does not prove the
switch is dark.

### 3.2 Disposable-positive half

Run the exact deployed build SHA against a disposable backend made from the
full migration chain. All nine keys start at `infinity`. Arm only the target
key. External replies come from recorded, checksum-pinned fixtures.

Each cell must produce `lease:"claimed"`, stay within its request cap, advance
only its own lease row, and make the stated signal:

| Key | Due setup and required signal |
|---|---|
| `espn_insights` | Scheduled PL fixture inside the odds ladder with an ESPN ID. One summary request; `fixture_insights` changes. |
| `espn_match_data` | Live fixture and a finished fixture due at FT+5/FT+30. Summary request count matches distinct ESPN IDs; the due block columns in `fixture_match_data` change. |
| `espn_commentary` | Finished fixture at FT+10 with no commentary stamp. One summary request; only commentary and shared cache metadata change. |
| `espn_standings` | Active PL competition. One standings request per competition; the `espn` standings row changes. |
| `derived_standings` | Finished scored fixtures. No provider request; the `derived` standings row changes. |
| `espn_reconcile` | Cache row with a changed kickoff and another with a newer `result_revisions.observed_at`. No provider request; only the affected cache rows are invalidated. |
| `team_news` | Ten scheduled fixtures inside T−48h with complete FPL mappings. The poller is competition-wide, not league-scoped. One bootstrap request; every due fixture gets the correct partial `fixture_insights` patch. |
| `understat_xg` | Oldest unfinished enrichment is post-FT+2h and initially unmapped. Discovery plus match calls total at most 12; every matched due fixture may gain an ID, sample, and xG row. A sixth sample proves the retention delete. |
| `fotmob_slow` | `FOTMOB_ENABLED=true` in the disposable run. The production observer must see `fotmobEnabled:true` in the tick response for the whole observation. One open T−24 fixture and one post-FT fixture, both initially unmapped. Discovery may map every due fixture on those dates. Discovery plus detail calls total at most 12; ID, whitelisted sample, pre block, and post block changes stay within that enumerated due set. |

For the three ESPN summary consumers, one route tick also asserts shared-fetch
dedupe: `summary.requests` equals distinct fetched ESPN event IDs and
`summary.hits` records reuse. The positive half snapshots all protected tables
and every non-Phase-4 `sync_state` row before and after; both sets must be
identical.

### 3.3 External approval ceremony

The migration already creates `cashford.sync_issues.detail jsonb`, so the
approval record uses that table and does not alter the unapplied migration. The
designated row is identified by
`source='phase4'`, `kind='ro_approval'`, and `ref='phase4-ro-contract'`. Its
`detail` must contain the reviewed contract's full-file SHA-256 and the
deployed source commit SHA. It may also contain the deployed `APP_VERSION`
value. There must be exactly one unresolved matching row.

After the final review, deployment, and the status change to `APPROVED`, Ananth
runs this one-time Management API insert. `CONTRACT_SHA` is computed from the
final approved file. `DEPLOYED_SHA` is copied from `vercel inspect` for the
deployment that serves `https://cashford.vercel.app`.

Pre-arming condition: before this approval record is inserted, every reviewed
surface—the contract, `scripts/phase4-ro-observer.mjs`,
`scripts/phase4-rollout.mjs`, migration
`20260728000001_match_data_v2.sql`, and the Phase 4 code tree—must be committed
and pushed. Every one of those surfaces must be contained in the deployed build
commit. The recorded `deployed_build_sha` must name a commit that contains the
reviewed contract file whose hash is recorded in `contract_sha256`.

```bash
export CONTRACT_SHA="$(shasum -a 256 docs/plans/2026-07-31-001-phase4-ro-contract.md | awk '{print $1}')"
export DEPLOYED_SHA="<40-character-deployed-commit-sha>"
export DEPLOYED_APP_VERSION="<optional APP_VERSION digits, for example 88>"
python3 -c 'import json,os; d={"contract_sha256":os.environ["CONTRACT_SHA"],"deployed_build_sha":os.environ["DEPLOYED_SHA"]}; v=os.environ.get("DEPLOYED_APP_VERSION",""); d.update({"deployed_app_version":v} if v and not v.startswith("<") else {}); q="insert into cashford.sync_issues(source,kind,ref,detail) values (\x27phase4\x27,\x27ro_approval\x27,\x27phase4-ro-contract\x27,\x27"+json.dumps(d).replace("\x27","\x27\x27")+"\x27::jsonb)"; open("/tmp/phase4-ro-approval.json","w").write(json.dumps({"query":q}))'
curl -sS -X POST "https://api.supabase.com/v1/projects/fwqgyycqnslafpcetjqo/database/query" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  --data @/tmp/phase4-ro-approval.json
```

The arm command is then
`node scripts/phase4-rollout.mjs --key <key> --confirm --deployed-sha <sha>`.
It refuses a draft, hashes the current worktree file, fetches
`https://cashford.vercel.app`, and compares the deployed `APP_VERSION` (`vNN`)
when that value is exposed by the fetched response and recorded in the row.
Cashford's public redirect may hide the signed-in version pill, so the source
commit check is the required build check and is operator-attested: the supplied
SHA must be copied from `vercel inspect` and must match the database record. The
app-version check is automated when available; the source-SHA check is attested.
A local contract edit therefore always fails the database hash comparison. No local
`FOTMOB_ENABLED` variable is used as deployment evidence; FotMob evidence comes
from the tick response field in §1.

### 3.4 Pre-arming checklist

Before inserting the approval row or arming any key, confirm all of the
following:

1. The reviewed contract, observer, rollout script, migration
   `20260728000001_match_data_v2.sql`, and Phase 4 code tree are committed and
   pushed.
2. The deployed build commit contains every reviewed surface, including the
   reviewed contract file.
3. The `deployed_build_sha` recorded in the approval row is that deployed build
   commit and contains the file whose reviewed contract SHA is recorded in the
   row.
4. The contract remains `DRAFT — NOT APPROVED` until the review is complete;
   only then may its status change to `APPROVED` and the approval row be
   inserted.

## 4. RO-2 — production observation after one key is armed

RO-2 is deliberately conservative. A concurrent legitimate write makes the
run fail and revert; it cannot make an unsafe run pass.

### 4.1 Observer and database clock

The reviewed runner is `scripts/phase4-ro-observer.mjs`. It uses a direct
Postgres connection held by the rollout operator, not an application RPC. The
connection forces `default_transaction_read_only=on`, verifies that setting,
and runs only `SELECT`. It also requires explicit production confirmation plus
the reviewed database and tick hosts.

The runner requires `PHASE4_RO_DATABASE_URL` plus an explicit production
confirmation flag. It refuses a host or project ID that does not match the
reviewed deployment record. It records the outer database-clock bracket, then
uses the response's separate window for each poller:

1. A read-only `REPEATABLE READ` transaction takes `clock_timestamp()` and the
   complete before snapshot immediately before the HTTP tick;
2. the full tick JSON;
3. A second read-only `REPEATABLE READ` transaction takes the complete after
   snapshot immediately after the HTTP tick.

The runner rejects missing, overlapping, reversed or reordered poller windows.
Every `[startedAt,finishedAt]` pair must fall inside the database bracket within
five seconds of clock skew. These windows are an order and timing check only;
the two snapshots do not attribute a database row to an individual poller.
Database evidence is the union of the claimed pollers' derived row and column
ownership, with the source/endpoint limits above. The contract makes no
per-poller actor claim beyond that evidence. The database timestamps remain
the true outer boundaries.

### 4.2 Snapshots

Both snapshots contain, and every snapshot is one transaction-wide consistent
read point:

- count plus order-independent content checksum for every base table in
  `cashford`;
- full rows for all seven allowed tables, so inserts, updates, and deletes can
  be diffed by primary key and changed column;
- full rows for all `sync_state` keys.

The protected set is derived at run time exactly as E3 does. Every protected
table must be byte-identical. Every changed allowed-table row must be owned by
at least one claimed poller, by primary key and due fixture/key set, and every
changed non-key column must be in that poller's permitted column set. A
`provider_samples` diff may contain both the insert and its retention delete;
its row attribution is provider/endpoint only. A `sync_issues` diff is
source/kind/ref evidence only. A change with no such owner fails.

For `sync_state`, only the target Phase 4 row may change, plus the explicitly
listed dark-legacy `espn_insights` lease fields when another key is the target.
The target must show a moved `last_run_at`, cleared lease fields, and
`next_due_at` later than the post-tick database clock, or exactly `infinity`
when the target opened its breaker. A breaker outcome is a failed rollout and
triggers revert.

### 4.3 Zero-write predicate for every other tick writer

Before the target result is accepted, the same tick must say:

- `fpl.ran === false`, and the before/after `fpl-sync` row is identical;
- `poll` is `{fetched:0,updated:0,resolved:0,skipped:true}`;
- `ko` is `{skipped:"throttled"}`;
- `locks` is `{processed:0,locked:0,voided:0}`;
- `settles` is `{candidates:0,settled:0}`;
- every competition value in `gameweeks` has zero for `completed`, `locked`,
  `pots_provisioned`, `pots_locked`, `entries_locked_in`,
  `entries_invalid`, `w1_voids`, `w1_voids_refreshed`, and
  `completeness_updated`;
- `gwSettles` has zero for `scanned`, `settled`, `voided`, `retried`,
  `aborted`, and `skipped`, with an empty `detail`;
- when the target is `espn_insights`, legacy `insights` is
  `{checked:0,updated:0}`; for another target, the dark legacy result is
  checked against its explicit fixture-insights ownership rule;
- a Phase 4 key still at `infinity` is `lease:"not_due"`, `fetches:0`,
  `writes:0`, with no `error`;
- an already-armed Phase 4 key may report `claimed`, `not_due` or `leased`.
  `not_due` and `leased` must report zero fetches and writes. `claimed` must
  stay within the key's bound below, and every changed allowed table must
  belong to the union of the claimed keys' section-2 write sets.

For any claimed `fotmob_slow` run, the captured tick JSON must contain
`fotmobEnabled:true`. This is the running deployment's read-only response field,
not a local environment attestation, and it must be true on every FotMob
observation. The observer also derives FotMob due fixtures from the before
snapshot and rejects a claimed run with due work and `fetches:0`.

The runner derives bounds from the before-snapshot, so the assertion stays
tied to the poller's cadence and current database size. For either slow
provider, let `D` be its due fixture count, `G` the possible discovery calls
from those due fixtures, `R` the number of due-fixture remap candidates across
those discovery responses, `T` the retention deletes possible after inserting
the samples (computed from the before-snapshot), and `B` be one possible
provider-breaker issue when `D>0`. The write bound is:

`D × 3 writes-per-fixture + G × 2 writes-per-discovery + R × 2 (remap delete plus insert) + T + B`.

The observer computes the same formula from its before snapshot. The three
per-fixture writes cover the detail data row, a sample, and a possible shape
issue; the two discovery writes cover its sample and possible shape issue.
The sample retention trigger is counted separately. This replaces a fixed
constant and covers discovery fan-out.

| Key | Fetch bound | Write bound |
|---|---:|---:|
| `espn_insights` | fixture count | fixture count |
| `espn_match_data` | fixture count | twice fixture count, allowing its issue path |
| `espn_commentary` | fixture count | twice fixture count, allowing its issue path |
| `espn_standings` | competition count | competition count |
| `derived_standings` | zero | competition count |
| `espn_reconcile` | zero | fixture count |
| `team_news` | one | fixture count |
| `understat_xg` | 12 | Formula above from due fixtures, discovery remap candidates, and baseline sample retention |
| `fotmob_slow` | 12 | Formula above from due fixtures, discovery remap candidates, and baseline sample retention |

Only keys whose field says `claimed` may change their own `sync_state` row.
Dark or skipped armed keys must leave it byte-identical. This exemption makes
RO-2 usable after the first arming without weakening table ownership.

The checksum rule remains decisive. These counters select a quiet tick and
help explain a failure; they never excuse a protected-table change.

### 4.4 Target acceptance

The target field must have `lease:"claimed"`, no `error`, non-negative
`fetches` and `writes`, and the target lease row must advance as described
above. A zero product write is allowed when production has no due fixture; the
disposable RO-1 positive cell already proves the write path. Any product write
that does occur must match the row and column ownership rules from the actual
poller.

Run only one target per quiet window. Save the two snapshots, tick JSON, build
SHA, migration checksum, fixture checksums used by RO-1, and the diff report.

For `espn_insights`, arming and legacy-caller removal are one switch. The tick
reads that key before the legacy call: `infinity` keeps `pollInsights` live;
any armed value suppresses it and lets only `pollInsightsLeased` run. RO-2
requires legacy `insights` to be `{checked:0,updated:0}` in an armed insights
tick. For a different target, the dark legacy writer may report its own
checked/updated counts and its fixture-insights rows must pass the legacy
ownership rule above. No deploy window may contain two active insights writers.

If the `espn_insights` row is missing, `claim_insights_writer` throws before
selecting either writer. The route catches that error in `phase4Step`; neither
legacy `pollInsights` nor leased `pollInsightsLeased` runs. The response has an
`error` on `phase4.insights`, not a false `not_due` result. The observer aborts
on that exact error. Recovery is: stop the rollout, restore the row with the
already-reviewed idempotent migration `20260728000001_match_data_v2.sql` (or
the same approved `insert into cashford.sync_state(key,next_due_at) values
('espn_insights','infinity') on conflict (key) do nothing`), verify the row has
no lease and is at `infinity` through baseline mode, then repeat the dark
negative proof. Do not arm a key until that proof passes.

### 4.5 Failure and revert

On any failed assertion:

1. Run exactly `node scripts/phase4-rollout.mjs --key <key> --revert --confirm`.
   The script refuses the lesser `--key <key> --revert` form and any other
   argument order.
2. Read the key back and require `next_due_at='infinity'` with no lease.
3. Stop. Do not arm the next key.
4. Keep all evidence for review. Never delete or repair production reference
   rows as rollout cleanup.

## 5. Known limits for adversarial review

- The direct observer needs a reviewed read-only production connection.
- Application timestamps are not database timestamps.
- The whole tick sits inside the database boundary. Exact protected-table
  checks plus the zero-write predicate make this fail closed, but a concurrent
  user write will cause a false failure.
- A concurrent write to the same permitted row and column could still be
  indistinguishable from a claimed poller's write. The quiet-window rule,
  primary-key/column diff, source limits, and expected due-row set reduce this
  risk; they do not provide actor-level proof. If review requires actor-level
  proof, rollout needs temporary database audit support approved as a separate
  migration.
- `sync_state.updated_at` does not exist, and the protected tables' existing
  `updated_at` columns are defaults rather than update triggers. This contract
  does not use either for attribution.

Until these limits and the observer implementation pass adversarial review,
all nine keys remain at `infinity`.
