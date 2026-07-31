import { spawnSync } from "node:child_process";

const checks = [
  ["E1/E2", "node", ["scripts/phase4-write-scan.mjs"]],
  [
    "E3 snapshot self-test",
    "node",
    ["scripts/phase4-quiescent-check.mjs", "--self-test"],
  ],
  ["E4", "node", ["scripts/phase4-golden-hashes.mjs"]],
];
for (const [name, command, args] of checks) {
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.status !== 0) {
    console.error(`${name} failed`);
    process.exit(result.status ?? 1);
  }
}
console.log(
  "Phase 4 static safety checks passed. E3's database gate runs only through the disposable-db driver.",
);
