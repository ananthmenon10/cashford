import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { PHASE4_SYNC_KEYS } from "../lib/poll-keys.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FULLY_ALLOWED = new Set([
  "fixture_insights",
  "competition_standings",
  "fixture_match_data",
  "fixture_provider_data",
  "fixture_provider_ids",
  "provider_samples",
  "sync_issues",
]);
const APPROVED_RPCS = new Set([
  "claim_phase4_lease",
  "claim_insights_writer",
  "replace_provider_fixture_id",
  "renew_sync_lease",
  "release_sync_lease",
  "release_sync_lease_jittered",
  "arm_sync_key",
]);
const APPROVED_SYNC_ROUTINES = new Set([
  "arm_sync_key",
  "claim_phase4_lease",
  "claim_insights_writer",
  "release_sync_lease_jittered",
]);
const REQUIRED_FILES = [
  "app/api/cron/tick/route.ts",
  "app/matches/page.tsx",
  "app/m/[fixtureId]/page.tsx",
  "components/Phase4MatchesPage.tsx",
  "components/Phase4MatchDetailPage.tsx",
  "lib/espn-insights.ts",
  "scripts/phase4-rollout.mjs",
];
const LIB_PATTERN =
  /^(analytics-view|espn-(insights|standings|summary|summary-fetch)|fotmob(-copy)?|fpl-availability|gw-(live-money|rank|resolve-app)|insights-cadence|match-(blocks|copy|detail|detail-load)|matches-tab(-load)?|phase4-poll-runtime|poll-(commentary|due|insights|keys|lease|match-data|slow-providers|standings|team-news|understat)|provider-(ids|match|samples)|reconcile-match-cache|standings-view|understat|view-format|xg-select)\.ts$/;

function phase4Files() {
  const dynamic = fs
    .readdirSync(path.join(ROOT, "lib"))
    .filter((name) => LIB_PATTERN.test(name))
    .map((name) => `lib/${name}`);
  return [...new Set([...REQUIRED_FILES, ...dynamic])].sort();
}

function migrationFiles() {
  return fs
    .readdirSync(path.join(ROOT, "supabase/migrations"))
    .filter((name) => /^20260728000001_[a-z0-9_]+\.sql$/.test(name))
    .map((name) => `supabase/migrations/${name}`)
    .sort();
}

function memberName(node) {
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  if (
    ts.isElementAccessExpression(node) &&
    node.argumentExpression &&
    ts.isStringLiteralLike(node.argumentExpression)
  ) {
    return node.argumentExpression.text;
  }
  return null;
}

function callName(node) {
  return ts.isCallExpression(node) ? memberName(node.expression) : null;
}

function literalArgument(node) {
  const argument = node.arguments[0];
  return argument && ts.isStringLiteralLike(argument) ? argument.text : null;
}

function outerQueryExpression(node) {
  let current = node;
  while (
    current.parent &&
    ((ts.isPropertyAccessExpression(current.parent) &&
      current.parent.expression === current) ||
      (ts.isElementAccessExpression(current.parent) &&
        current.parent.expression === current) ||
      (ts.isCallExpression(current.parent) &&
        current.parent.expression === current))
  ) {
    current = current.parent;
  }
  return current;
}

function descendantCalls(node) {
  const names = [];
  const visit = (child) => {
    const name = callName(child);
    if (name) names.push(name);
    ts.forEachChild(child, visit);
  };
  visit(node);
  return names;
}

function objectMethod(node, sourceFile) {
  const options = node.arguments[1];
  if (!options || !ts.isObjectLiteralExpression(options)) return "GET";
  const method = options.properties.find(
    (property) =>
      ts.isPropertyAssignment(property) &&
      property.name.getText(sourceFile).replaceAll(/['"]/g, "") === "method",
  );
  if (
    method &&
    ts.isPropertyAssignment(method) &&
    ts.isStringLiteralLike(method.initializer)
  ) {
    return method.initializer.text.toUpperCase();
  }
  return "GET";
}

export function scanTypeScript(source, file = "<memory>") {
  const errors = [];
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const visit = (node) => {
    const method = callName(node);
    if (method === "from" || method === "rpc") {
      const value = literalArgument(node);
      const rendered = node.arguments[0]?.getText(sourceFile) ?? "<missing>";
      if (!value) {
        errors.push(`${file}: computed .${method}(${rendered})`);
      } else if (method === "rpc") {
        if (!APPROVED_RPCS.has(value)) {
          errors.push(`${file}: unapproved RPC ${value}`);
        } else if (
          file !== "lib/poll-lease.ts" &&
          !(file === "lib/provider-ids.ts" && value === "replace_provider_fixture_id") &&
          !(file === "scripts/phase4-rollout.mjs" && value === "arm_sync_key")
        ) {
          errors.push(`${file}: lease RPC outside lib/poll-lease.ts`);
        }
      } else {
        const queryCalls = descendantCalls(outerQueryExpression(node));
        const mutation = queryCalls.find((name) =>
          ["insert", "update", "upsert", "delete"].includes(name),
        );
        if (
          !queryCalls.some((name) =>
            ["select", "insert", "update", "upsert", "delete"].includes(name),
          )
        ) {
          errors.push(`${file}: detached .from("${value}") query`);
        }
        if (mutation && !FULLY_ALLOWED.has(value)) {
          errors.push(`${file}: ${mutation} on ${value}`);
        }
        if (mutation && value === "sync_state") {
          errors.push(`${file}: direct sync_state write`);
        }
      }
    }

    if (
      (ts.isPropertyAccessExpression(node) ||
        ts.isElementAccessExpression(node)) &&
      ["from", "rpc"].includes(memberName(node) ?? "") &&
      !(
        ts.isCallExpression(node.parent) &&
        node.parent.expression === node
      )
    ) {
      errors.push(`${file}: detached client method .${memberName(node)}`);
    }

    if (ts.isCallExpression(node) && method === "query") {
      const sql = node.arguments[0]?.getText(sourceFile) ?? "";
      if (/\b(insert|update|delete|truncate|alter|create|drop)\b/i.test(sql)) {
        errors.push(`${file}: non-Supabase SQL writer`);
      }
    }
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "fetch" &&
      !["GET", "HEAD"].includes(objectMethod(node, sourceFile))
    ) {
      errors.push(`${file}: non-read fetch ${objectMethod(node, sourceFile)}`);
    }
    if (
      ts.isCallExpression(node) &&
      [
        "writeFile",
        "writeFileSync",
        "appendFile",
        "appendFileSync",
        "rename",
        "unlink",
        "rm",
        "truncate",
      ].includes(method ?? "")
    ) {
      errors.push(`${file}: non-database writer .${method}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  if (/from\s+["'][^"']*\/settlement["']/.test(source)) {
    errors.push(`${file}: import from a protected settlement module`);
  }
  const moneyImport = /from\s+["'][^"']*gameweek-(points|settle)["']/.test(
    source,
  );
  if (moneyImport && file !== "lib/gw-live-money.ts") {
    errors.push(`${file}: money helper import outside lib/gw-live-money.ts`);
  }
  if (file === "lib/gw-live-money.ts") {
    for (const value of ["settleGameweek", "gameweekNets"]) {
      if (!source.includes(value)) {
        errors.push(`${file}: missing approved import ${value}`);
      }
    }
  }
  return errors;
}

function routineBlocks(sql) {
  const blocks = new Map();
  const regex =
    /create or replace function cashford\.(\w+)\s*\([\s\S]*?\$\$;/gi;
  for (const match of sql.matchAll(regex)) blocks.set(match[1], match[0]);
  return blocks;
}

function quotedValues(source) {
  return [...source.matchAll(/'([^']+)'/g)].map((match) => match[1]);
}

function keySetError(actual, label) {
  const expected = [...PHASE4_SYNC_KEYS].sort();
  const got = [...new Set(actual)].sort();
  return JSON.stringify(got) === JSON.stringify(expected)
    ? null
    : `${label}: expected ${expected.join(",")}; got ${got.join(",")}`;
}

function scanDmlTargets(sql, file, errors) {
  for (const match of sql.matchAll(
    /\b(insert\s+into|update|delete\s+from|alter\s+table|truncate(?:\s+table)?)\s+cashford\.(\w+)/gi,
  )) {
    const operation = match[1].toLowerCase();
    const table = match[2];
    if (table !== "sync_state" && !FULLY_ALLOWED.has(table)) {
      errors.push(`${file}: ${operation} targets ${table}`);
    }
  }
  for (const block of sql.matchAll(/\bdo\s+\$\$([\s\S]*?)\$\$;/gi)) {
    for (const match of block[1].matchAll(
      /(?:\bbegin\b|\bthen\b|;)\s*(insert\s+into|update|delete\s+from|truncate(?:\s+table)?)\s+(?:(cashford)\.)?(\w+)/gi,
    )) {
      const table = match[3];
      if (table !== "sync_state" && !FULLY_ALLOWED.has(table)) {
        errors.push(`${file}: DO block ${match[1].toLowerCase()} targets ${table}`);
      }
    }
  }
}

export function scanMigration(sql, file = "<migration>") {
  const errors = [];
  if (/\b(?:drop\s+table|truncate\s+cashford)\b/i.test(sql)) {
    errors.push(`${file}: destructive statement`);
  }
  for (const match of sql.matchAll(
    /\bcreate\s+table\s+(?:if\s+not\s+exists\s+)?cashford\.(\w+)/gi,
  )) {
    if (!FULLY_ALLOWED.has(match[1])) {
      errors.push(`${file}: create table targets ${match[1]}`);
    }
  }
  scanDmlTargets(sql, file, errors);

  const routines = routineBlocks(sql);
  for (const [name, block] of routines) {
    if (
      /\b(?:insert\s+into|update|delete\s+from)\s+cashford\.sync_state\b/i.test(
        block,
      ) &&
      !APPROVED_SYNC_ROUTINES.has(name)
    ) {
      errors.push(`${file}: sync_state write in routine ${name}`);
    }
  }
  for (const name of APPROVED_SYNC_ROUTINES) {
    if (!routines.has(name)) errors.push(`${file}: missing routine ${name}`);
  }

  const seed = /insert into cashford\.sync_state[\s\S]*?on conflict \(key\) do nothing;/i.exec(
    sql,
  )?.[0];
  if (!seed) {
    errors.push(`${file}: missing sync_state seed`);
  } else {
    const values = [...seed.matchAll(/\('([^']+)'\s*,\s*'infinity'\)/g)].map(
      (match) => match[1],
    );
    const mismatch = keySetError(values, `${file} seed keys`);
    if (mismatch) errors.push(mismatch);
    if (values.length !== PHASE4_SYNC_KEYS.length) {
      errors.push(`${file}: every seed must be a literal dark infinity row`);
    }
  }

  let outsideRoutines = sql;
  for (const block of routines.values()) {
    outsideRoutines = outsideRoutines.replace(block, "");
  }
  if (seed) outsideRoutines = outsideRoutines.replace(seed, "");
  if (
    /\b(?:insert\s+into|update|delete\s+from)\s+cashford\.sync_state\b/i.test(
      outsideRoutines,
    )
  ) {
    errors.push(`${file}: sync_state write outside an approved routine or seed`);
  }

  for (const name of ["arm_sync_key", "claim_phase4_lease"]) {
    const block = routines.get(name) ?? "";
    const allowlist = /p_key\s+not\s+in\s*\(([\s\S]*?)\)/i.exec(block)?.[1];
    const mismatch = keySetError(
      allowlist ? quotedValues(allowlist) : [],
      `${file} ${name} allowlist`,
    );
    if (mismatch) errors.push(mismatch);
  }

  const arm = routines.get("arm_sync_key") ?? "";
  if (
    !/p_due_at\s+is\s+null/i.test(arm) ||
    !/lease_token\s+is\s+null/i.test(arm)
  ) {
    errors.push(`${file}: arm_sync_key lost its null/lease guards`);
  }
  const claim = routines.get("claim_phase4_lease") ?? "";
  const lockAt = claim.search(/\bfor\s+update\b/i);
  const clockAt = claim.search(/\bclock_timestamp\s*\(\s*\)/i);
  if (
    lockAt < 0 ||
    clockAt < lockAt ||
    !claim.includes("'claimed'") ||
    !claim.includes("'not_due'") ||
    !claim.includes("'leased'")
  ) {
    errors.push(`${file}: claim_phase4_lease lost atomic outcome semantics`);
  }
  const jitter = routines.get("release_sync_lease_jittered") ?? "";
  if (
    !/p_min_secs\s*<=\s*0/i.test(jitter) ||
    !/p_min_secs\s*>=\s*p_max_secs/i.test(jitter) ||
    !/lease_token\s*=\s*p_token/i.test(jitter) ||
    !/\brandom\s*\(\s*\)/i.test(jitter)
  ) {
    errors.push(`${file}: jitter release lost bounds or token guard`);
  }
  return errors;
}

function selfTest(migration) {
  const codeCases = [
    scanTypeScript(`db["from"](name).select("*")`),
    scanTypeScript(`db.from("gameweek_audit_log").update({x:1})`),
    scanTypeScript(`const from = db.from; from("fixtures")`),
    scanTypeScript(`db.rpc("claim_sync_lease", {})`, "lib/poll-lease.ts"),
    scanTypeScript(`db.rpc("claim_phase4_lease", {})`, "lib/other.ts"),
    scanTypeScript(`client.query("update cashford.fixtures set status='live'")`),
    scanTypeScript(`fetch("/write", {method: "POST"})`),
  ];
  if (codeCases.some((errors) => errors.length === 0)) {
    throw new Error(`E1 planted-case failure: ${JSON.stringify(codeCases)}`);
  }
  if (
    scanMigration(
      migration.replace(
        "('espn_insights', 'infinity')",
        "('fpl-sync', 'infinity')",
      ),
    ).length === 0
  ) {
    throw new Error("E2 planted bad seed was accepted");
  }
  if (
    scanMigration(
      `${migration}\ndo $$ begin update cashford.gameweek_results set outcome = 'void'; end $$;`,
    ).length === 0
  ) {
    throw new Error("E2 planted DO-block DML was accepted");
  }
  if (
    scanMigration(
      migration.replace("v_now := clock_timestamp();", "v_now := now();"),
    ).length === 0
  ) {
    throw new Error("E2 planted pre-lock clock regression was accepted");
  }
}

export function runScan() {
  const errors = [];
  const files = phase4Files();
  let scannedFiles = 0;
  for (const file of files) {
    const absolute = path.join(ROOT, file);
    if (!fs.existsSync(absolute)) {
      errors.push(`${file}: required Phase 4 file is missing`);
      continue;
    }
    errors.push(...scanTypeScript(fs.readFileSync(absolute, "utf8"), file));
    scannedFiles++;
  }
  const migrations = migrationFiles();
  if (migrations.length !== 1) {
    errors.push(
      `expected one unapplied Phase 4 migration; found ${migrations.length}`,
    );
  }
  for (const file of migrations) {
    const sql = fs.readFileSync(path.join(ROOT, file), "utf8");
    errors.push(...scanMigration(sql, file));
    selfTest(sql);
    scannedFiles++;
  }
  return { errors, scannedFiles, migrations: migrations.length };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = runScan();
  if (result.errors.length) {
    console.error(result.errors.join("\n"));
    process.exitCode = 1;
  } else {
    console.log(
      `E1/E2 passed: ${result.scannedFiles} files scanned; ${result.migrations} migration; ${PHASE4_SYNC_KEYS.length} dark keys matched`,
    );
  }
}
