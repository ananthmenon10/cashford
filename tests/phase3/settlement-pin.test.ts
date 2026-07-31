// Phase 3 — T-U11: the WC settlement engine and the Phase 2 gameweek engine must not change
// byte-for-byte while Phase 3 UI work lands. Blind from §12 cross-cutting.
// This is a checksum pin, not a behavioral test: any edit to these four files — even a
// whitespace change — fails this test and forces a deliberate re-pin (update the hash below
// and note why in the PR / docs/testing/phase3-cases.md, don't silently rubber-stamp it).
//
// Hashes captured at HEAD of feat/p1-foundation at the start of Phase 3 blind test authoring
// (via `shasum -a 256 <file>` on the committed files — reading these four files is explicitly
// allowed by the task brief since they predate Phase 3 and are the API being tested against).
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "../..");

const PINNED: Record<string, string> = {
  "lib/settlement.ts": "c800cb8c239f8d79686a2a6edd0313e2afa189b7007d1ed4dfdc3eebc514714e",
  "lib/settle-contest.ts": "04f21811f6b91eae0c070e4950e2d8d016d40090d472920cdb4b69318546f347",
  "lib/gameweek-points.ts": "4e9966b6f960efd44c8d449c331286e72e8de85ba81644265cef9f2d2707c960",
  "lib/gameweek-settle.ts": "d6ed146852a2e0a79a7e69ec63eb4115acebf84b269b1ee79aed3a446a6f2e61",
};

function sha256(filePath: string): string {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

describe("T-U11 — settlement/engine files are byte-unchanged during Phase 3", () => {
  for (const [rel, expected] of Object.entries(PINNED)) {
    it(`${rel} matches its pinned sha256`, () => {
      const actual = sha256(path.join(ROOT, rel));
      expect(actual).toBe(expected);
    });
  }
});
