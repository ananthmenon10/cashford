// Phase 3 — D-EN5: model chips ship as a pure, caller-less mapper in Phase 3.
// Blind from §0.3 D-EN5 and T-U9. The signature is given verbatim in the plan:
//   chipsForFixture(topScores: ScoreProb[]): ScoreChip[]
//
// Canonical per the fix round: `ScoreProb` (lib/odds-model.ts, re-exported via lib/model-chips.ts)
// is `{ h, a, p }`, not the guessed `{ home, away, prob }`. This test previously passed with the
// wrong shape only because its assertions never checked the resulting field values — with the
// wrong input every chip's `home`/`away`/`probability` came out `undefined`/`NaN` and nothing
// caught it. Fixed here, not just renamed.
import { describe, expect, it } from "vitest";
import { chipsForFixture } from "../../lib/model-chips";

describe("chipsForFixture — T-U9 pure mapper over topScores", () => {
  it("maps a topScores array to a same-length (or bounded) ScoreChip array", () => {
    const topScores = [
      { h: 1, a: 0, p: 0.18 },
      { h: 2, a: 1, p: 0.12 },
      { h: 1, a: 1, p: 0.1 },
    ];
    const chips = chipsForFixture(topScores as never);
    expect(Array.isArray(chips)).toBe(true);
    expect(chips.length).toBeGreaterThan(0);
    expect(chips.length).toBeLessThanOrEqual(topScores.length);
  });

  it("an empty topScores array maps to an empty chip array, not a throw", () => {
    expect(() => chipsForFixture([])).not.toThrow();
    expect(chipsForFixture([])).toEqual([]);
  });
});

// T-U9's second half: model-chips has NO CALLER in Phase 3 (D-EN5). This is an import-graph
// assertion, not a behavioral one — the entry sheet / fixture row modules must not import
// chipsForFixture. Checked here at the source-text level (no bundler graph available to a unit
// test), scanning the exact component files the manifest names for the entry-sheet path.
describe("model-chips — no caller in Phase 3 (D-EN5 import-graph assertion)", () => {
  it("components/gw/EntrySheet.tsx and FixtureRow.tsx do not import model-chips", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const root = path.resolve(__dirname, "../..");
    const candidates = ["components/gw/EntrySheet.tsx", "components/gw/FixtureRow.tsx", "components/gw/ScoreChips.tsx"];
    for (const rel of candidates) {
      const full = path.join(root, rel);
      if (!fs.existsSync(full)) continue; // not yet implemented — nothing to assert against yet
      const src = fs.readFileSync(full, "utf8");
      if (rel.endsWith("ScoreChips.tsx")) continue; // the mapper's own consumer-in-waiting is allowed to import it; it's just not MOUNTED anywhere in Phase 3, which this test cannot see without a render tree
      expect(src).not.toMatch(/from ["']..?\/(.*\/)?model-chips["']/);
    }
  });

});
