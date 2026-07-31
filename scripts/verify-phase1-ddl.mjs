// Phase 1 step 2: prove the migration landed exactly as written. Reads pg_catalog through the
// Management API (the service-role key cannot see catalog privileges reliably, and DDL checks
// have to be catalog-level to be worth anything).
//
//   node --env-file=.env.local scripts/verify-phase1-ddl.mjs

const PAT = process.env.SUPABASE_ACCESS_TOKEN;
const REF = "fwqgyycqnslafpcetjqo";
if (!PAT) {
  console.error("SUPABASE_ACCESS_TOKEN missing (needed for the Management API)");
  process.exit(1);
}

async function q(sql) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${PAT}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: sql }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`query failed: ${JSON.stringify(body)}`);
  return body;
}

let failures = 0;
const ok = (label, cond, extra = "") => {
  if (!cond) failures++;
  console.log(`${cond ? "✓" : "✗ FAIL"} ${label}${extra ? "  — " + extra : ""}`);
};

// ---- tables ----------------------------------------------------------------------------
const NEW_TABLES = [
  "competitions", "gameweeks", "gameweek_fixtures", "gameweek_contests",
  "league_competitions", "member_competitions", "team_provider_ids",
  "sync_state", "sync_issues", "fixture_moves", "result_revisions",
];
const tables = await q(`
  select c.relname, c.relrowsecurity
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'cashford' and c.relkind = 'r'`);
const byTable = new Map(tables.map((t) => [t.relname, t]));
for (const t of NEW_TABLES) {
  ok(`table ${t}`, byTable.has(t));
  ok(`  rls enabled on ${t}`, byTable.get(t)?.relrowsecurity === true);
}

// ---- new columns -----------------------------------------------------------------------
const cols = await q(`
  select table_name, column_name, is_nullable
    from information_schema.columns
   where table_schema = 'cashford'
     and (table_name, column_name) in (
       ('fixtures','competition_id'), ('fixtures','fpl_fixture_id'),
       ('fixtures','score_source'),   ('fixtures','score_observed_at'),
       ('fixtures','external_id'),    ('fixtures','kickoff_at'), ('fixtures','round'),
       ('teams','external_id'))`);
const colOf = (t, c) => cols.find((x) => x.table_name === t && x.column_name === c);
ok("fixtures.competition_id exists and is NOT NULL", colOf("fixtures", "competition_id")?.is_nullable === "NO");
ok("fixtures.fpl_fixture_id exists", !!colOf("fixtures", "fpl_fixture_id"));
ok("fixtures.score_source exists", !!colOf("fixtures", "score_source"));
ok("fixtures.score_observed_at exists", !!colOf("fixtures", "score_observed_at"));
ok("fixtures.external_id is nullable", colOf("fixtures", "external_id")?.is_nullable === "YES");
ok("fixtures.kickoff_at is nullable", colOf("fixtures", "kickoff_at")?.is_nullable === "YES");
ok("fixtures.round is nullable", colOf("fixtures", "round")?.is_nullable === "YES");
ok("teams.external_id is nullable", colOf("teams", "external_id")?.is_nullable === "YES");

// ---- constraints and indexes -----------------------------------------------------------
const CONSTRAINTS = [
  "fixtures_id_competition_key",
  "fixtures_competition_fpl_fixture_key",
  "chk_score_source",
  "chk_move_not_both_null",
];
const cons = await q(`
  select conname from pg_constraint c
    join pg_namespace n on n.oid = c.connamespace
   where n.nspname = 'cashford'`);
const conNames = new Set(cons.map((c) => c.conname));
for (const c of CONSTRAINTS) ok(`constraint ${c}`, conNames.has(c));

const INDEXES = [
  "one_open_gw_per_competition",
  "one_active_gw_per_fixture",
  "one_current_gw_per_fixture",
  "one_active_competition_per_league",
  "idx_fixtures_unmatched",
];
const idx = await q(`
  select indexname from pg_indexes where schemaname = 'cashford'`);
const idxNames = new Set(idx.map((i) => i.indexname));
for (const i of INDEXES) ok(`index ${i}`, idxNames.has(i));

// ---- triggers --------------------------------------------------------------------------
const trg = await q(`
  select t.tgname, c.relname
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'cashford' and not t.tgisinternal`);
const trgNames = new Set(trg.map((t) => t.tgname));
ok("trigger trg_contests_cup_only on contests", trgNames.has("trg_contests_cup_only"));
ok("legacy fixture->contest trigger still present",
  [...trgNames].some((n) => n.includes("fixture") || n.includes("contest")));

// The legacy trigger function must early-return for non-cup competitions.
const [{ src: syncSrc } = {}] = await q(`
  select pg_get_functiondef(p.oid) as src from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'cashford' and p.proname = 'sync_contest_on_fixture_change'`);
ok("sync_contest_on_fixture_change is cup-scoped", !!syncSrc && syncSrc.includes("format = 'cup'"));

// ---- routines and their privileges ------------------------------------------------------
const SERVICE_ONLY = [
  "claim_sync_lease", "renew_sync_lease", "release_sync_lease",
  "apply_score_update", "run_gameweek_maintenance", "apply_fpl_reconciliation",
  "activate_competition",
];
const AUTHENTICATED = ["create_league", "join_league"];

const routines = await q(`
  select p.proname, p.prosecdef, p.proconfig,
         coalesce(array_to_string(p.proacl::text[], ' '), '') as acl
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'cashford'
     and p.proname in (${[...SERVICE_ONLY, ...AUTHENTICATED].map((r) => `'${r}'`).join(",")})`);

for (const name of [...SERVICE_ONLY, ...AUTHENTICATED]) {
  const r = routines.find((x) => x.proname === name);
  ok(`routine ${name}`, !!r);
  if (!r) continue;
  ok(`  ${name} is SECURITY DEFINER`, r.prosecdef === true);
  ok(`  ${name} pins search_path`, String(r.proconfig ?? "").includes("search_path"));
  // An empty ACL means "PUBLIC has EXECUTE" — every routine here must have an explicit grant list.
  ok(`  ${name} has an explicit ACL`, r.acl !== "");
  ok(`  ${name} not executable by PUBLIC`, !/(^|[ {])=X/.test(r.acl), r.acl);
  if (SERVICE_ONLY.includes(name)) {
    ok(`  ${name} not executable by anon`, !r.acl.includes("anon=X"), r.acl);
    ok(`  ${name} not executable by authenticated`, !r.acl.includes("authenticated=X"), r.acl);
    ok(`  ${name} executable by service_role`, r.acl.includes("service_role=X"), r.acl);
  } else {
    ok(`  ${name} not executable by anon`, !r.acl.includes("anon=X"), r.acl);
    ok(`  ${name} executable by authenticated`, r.acl.includes("authenticated=X"), r.acl);
  }
}

// ---- seeds -----------------------------------------------------------------------------
const comps = await q(`select slug, format, season, espn_slug, fpl_source, status
                         from cashford.competitions order by slug`);
console.log(comps);
const wc = comps.find((c) => c.slug === "wc2026");
const pl = comps.find((c) => c.slug === "pl-2026-27");
ok("wc2026 seeded as archived cup", wc?.format === "cup" && wc?.status === "archived");
ok("pl-2026-27 seeded as preparing league", pl?.format === "league" && pl?.status === "preparing");
ok("pl-2026-27 espn_slug is eng.1", pl?.espn_slug === "eng.1");
ok("pl-2026-27 is fpl_source", pl?.fpl_source === true);

const [lease] = await q(`select key, next_due_at, lease_token from cashford.sync_state
                          where key = 'fpl-sync'`);
ok("fpl-sync lease seeded", !!lease);
ok("fpl-sync starts disabled (next_due_at = infinity)",
  String(lease?.next_due_at ?? "").startsWith("infinity"), String(lease?.next_due_at));

const [{ n: unbacked } = {}] = await q(
  `select count(*)::int as n from cashford.fixtures where competition_id is null`,
);
ok("every fixture has a competition", Number(unbacked) === 0);

console.log(failures === 0 ? "\n✓ DDL verification passed" : `\n✗ ${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
