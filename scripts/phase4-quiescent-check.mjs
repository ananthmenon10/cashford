import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { PHASE4_SYNC_KEYS } from "../lib/poll-keys.ts";

export const FULLY_ALLOWED = [
  "fixture_insights",
  "competition_standings",
  "fixture_match_data",
  "fixture_provider_data",
  "fixture_provider_ids",
  "provider_samples",
  "sync_issues",
];
export const PHASE4_KEYS = [...PHASE4_SYNC_KEYS];

export function protectedTables(allTables) {
  const excluded = new Set([...FULLY_ALLOWED, "sync_state"]);
  return [...allTables].filter((table) => !excluded.has(table)).sort();
}

export function compareSnapshots(before, after) {
  const changed = [];
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) {
      changed.push(key);
    }
  }
  return changed.sort();
}

async function snapshot(client) {
  const tableRows = await client.query(
    `select table_name from information_schema.tables
      where table_schema = 'cashford' and table_type = 'BASE TABLE'
      order by table_name`,
  );
  const output = {};
  for (const table of protectedTables(tableRows.rows.map((row) => row.table_name))) {
    if (!/^[a-z_][a-z0-9_]*$/.test(table)) {
      throw new Error(`Unsafe table identifier: ${table}`);
    }
    const result = await client.query(
      `select count(*)::int as count,
              md5(coalesce(string_agg(row_json, '' order by row_json), '')) as checksum
         from (select row_to_json(t)::text as row_json from cashford.${table} t) s`,
    );
    output[`table:${table}`] = result.rows[0];
  }
  const sync = await client.query(
    `select key, row_to_json(s)::text as row_json
       from cashford.sync_state s
      where not (key = any($1::text[]))
      order by key`,
    [PHASE4_KEYS],
  );
  output["sync_state:non_phase4"] = sync.rows;
  return output;
}

async function main() {
  if (process.argv.includes("--self-test")) {
    const derived = protectedTables([
      "fixtures",
      "gameweek_results",
      "fixture_insights",
      "sync_state",
      "later_money_table",
    ]);
    if (
      JSON.stringify(derived) !==
      JSON.stringify(["fixtures", "gameweek_results", "later_money_table"])
    ) {
      throw new Error(`E3 derivation failed: ${JSON.stringify(derived)}`);
    }
    if (
      compareSnapshots({ a: { count: 1 } }, { a: { count: 2 } }).join() !== "a"
    ) {
      throw new Error("E3 diff failed");
    }
    console.log(
      "E3 snapshot self-test passed (not the database gate): protected-set derivation and diff detection work",
    );
    return;
  }
  const urlIndex = process.argv.indexOf("--database-url");
  const outputIndex = process.argv.indexOf("--output");
  const compareIndex = process.argv.indexOf("--compare");
  if (urlIndex < 0 || outputIndex < 0) {
    throw new Error(
      "Use --database-url <url> --output <file> [--compare <before.json>]",
    );
  }
  const client = new pg.Client({ connectionString: process.argv[urlIndex + 1] });
  await client.connect();
  try {
    const current = await snapshot(client);
    const output = path.resolve(process.argv[outputIndex + 1]);
    fs.writeFileSync(output, `${JSON.stringify(current, null, 2)}\n`);
    if (compareIndex >= 0) {
      const before = JSON.parse(
        fs.readFileSync(path.resolve(process.argv[compareIndex + 1]), "utf8"),
      );
      const changed = compareSnapshots(before, current);
      if (changed.length) throw new Error(`E3 changed: ${changed.join(", ")}`);
      console.log("E3 green: no protected state changed");
    }
  } finally {
    await client.end();
  }
}

await main();
