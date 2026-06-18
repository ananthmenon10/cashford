// Stamp lib/version.ts with the (about-to-be) git commit count.
// Run before each deploy commit: node scripts/stamp-version.mjs
import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";
const n = parseInt(execSync("git rev-list --count HEAD").toString().trim(), 10) + 1;
writeFileSync(
  "lib/version.ts",
  `// Auto-stamped at deploy time by scripts/stamp-version.mjs (git commit count).\n// Increments on every fresh prod deploy so a new number = a new change is live.\nexport const APP_VERSION = "${n}";\n`,
);
console.log("stamped v" + n);
