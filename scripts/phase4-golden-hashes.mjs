import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const EXPECTED = {
  "lib/settlement.ts":
    "c800cb8c239f8d79686a2a6edd0313e2afa189b7007d1ed4dfdc3eebc514714e",
  "lib/settle-contest.ts":
    "04f21811f6b91eae0c070e4950e2d8d016d40090d472920cdb4b69318546f347",
  "lib/gameweek-points.ts":
    "4e9966b6f960efd44c8d449c331286e72e8de85ba81644265cef9f2d2707c960",
  "lib/gameweek-settle.ts":
    "d6ed146852a2e0a79a7e69ec63eb4115acebf84b269b1ee79aed3a446a6f2e61",
};

const failures = [];
for (const [file, expected] of Object.entries(EXPECTED)) {
  const actual = crypto
    .createHash("sha256")
    .update(fs.readFileSync(path.join(ROOT, file)))
    .digest("hex");
  if (actual !== expected) failures.push(`${file}: ${actual} != ${expected}`);
}
if (failures.length) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`E4 green: ${Object.keys(EXPECTED).length} money files byte-identical`);
}
