// Disposable-only E3 driver. It records the derived protected set before and
// after the caller runs the nine Phase 4 pollers against its scratch fixture.
import { spawnSync } from "node:child_process";
import path from "node:path";

const databaseUrl = process.env.PHASE4_DISPOSABLE_DATABASE_URL;
const mode = process.argv[2];
if (!databaseUrl) {
  throw new Error("PHASE4_DISPOSABLE_DATABASE_URL is required");
}
if (mode !== "before" && mode !== "after") {
  throw new Error("Use: tsx scripts/disposable-db/phase4-quiescent.mts before|after");
}
const before = path.resolve("/tmp/cashford-phase4-quiescent-before.json");
const output =
  mode === "before"
    ? before
    : path.resolve("/tmp/cashford-phase4-quiescent-after.json");
const args = [
  "scripts/phase4-quiescent-check.mjs",
  "--database-url",
  databaseUrl,
  "--output",
  output,
];
if (mode === "after") args.push("--compare", before);
const result = spawnSync("node", args, { stdio: "inherit" });
process.exit(result.status ?? 1);
