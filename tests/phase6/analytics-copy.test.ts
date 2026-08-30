// Step 8 item 4/5 — lib/analytics-copy.ts is a real copy destination module, exactly like
// lib/gw-copy.ts and lib/payment-copy.ts. Mirrors payment-copy.test.ts's core style checks
// (banned words, no exclamation marks, typographic apostrophe, real minus sign) over every string
// this module exports or generates, so the new Analytics feed copy is under the same governance
// as the rest of the app's copy — the AST copy-scan (tests/phase3/copy-scan.test.ts) only walks
// app/ and components/ files for in-place literals and never looks inside lib/ copy modules.
import { describe, expect, it } from "vitest";
import { ANALYTICS_COPY } from "../../lib/analytics-copy";

const BANNED_WORDS = /\b(comprehensive|robust|seamless|leverage|delve|ensure|easy|simple|quick)\b/i;
const STRAIGHT_APOSTROPHE = /[A-Za-z]'[A-Za-z]/; // a straight ' between letters (typographic is ’)
const ASCII_MINUS_BEFORE_RUPEE = /-₹/; // negative amounts must use U+2212 minus (−₹), never a hyphen

function collectStrings(value: unknown, depth = 0): string[] {
  if (depth > 3) return [];
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap((v) => collectStrings(v, depth + 1));
  if (value && typeof value === "object") return Object.values(value).flatMap((v) => collectStrings(v, depth + 1));
  return [];
}

const SAMPLE_CALLS: Record<string, unknown[]> = {
  liveThrough: [2, 6],
  myFormSub: ["KK Bois", "Premier League 2026-27"],
  recordLine: [14, 5, 1],
  sampleNote: [30],
  gameweekNote: [6],
  allTimeStrip: [3, 2, 36],
  trendHead: [6],
  trendRange: [1, 6],
  netTrendSub: [6],
  netTrendSubStarted: [6, "+₹920"],
  trendAria: [1, 6, "0.72", "0.94"],
  trendExcludedVoid: [2],
  trendExcludedNotEntered: [2],
  trendExcludedDirty: [2],
  trendExcludedNoFixtures: [2],
  youVsRoomWindow: [5, 3],
  roomExcluded: ["GW3"],
  roomAverage: [3],
  roomSentence: ["exact rate", "ahead"],
  rivalryFootnote: [7, 8],
  rivalryExcluded: ["GW3"],
  rivalryRun: ["rival", 2],
  rivalrySwing: [7, "Everton", 2, 2, "Chelsea", 3, 0],
  weeklyLabelsSub: [8, 4, 10],
  oracleReason: [3, 1],
  nearlyReason: [2],
  crowdReason: [6, 10],
  maverickReason: [2],
  weeklyLabelTie: ["Oracle"],
  weeklyLabelNoBar: ["Maverick"],
  weeklyLabelsFootnote: [8, 4],
  habitsPicks: [20],
  habitsScoreline: [2, 1],
  habitsMostCalledValue: [2, 1, 8, 20],
  habitsGoalsSummary: ["2.7", "2.9"],
  habitsAgainstSentence: [4, 5],
  habitsExcluded: ["GW3 (void)"],
};

describe("lib/analytics-copy.ts — style rules over every exported string and function output", () => {
  const staticStrings: string[] = [];
  const functionExports: Array<[string, (...args: unknown[]) => unknown]> = [];

  for (const [name, value] of Object.entries(ANALYTICS_COPY)) {
    if (typeof value === "function") {
      functionExports.push([name, value as (...args: unknown[]) => unknown]);
    } else {
      staticStrings.push(...collectStrings(value));
    }
  }

  it("the module exports at least one static string and at least one function", () => {
    expect(staticStrings.length).toBeGreaterThan(0);
    expect(functionExports.length).toBeGreaterThan(0);
  });

  it("no static export contains a banned word", () => {
    for (const s of staticStrings) expect(s).not.toMatch(BANNED_WORDS);
  });

  it("no static export contains an exclamation mark", () => {
    for (const s of staticStrings) expect(s).not.toContain("!");
  });

  it("no static export uses a straight apostrophe where a typographic one belongs", () => {
    for (const s of staticStrings) expect(s).not.toMatch(STRAIGHT_APOSTROPHE);
  });

  it("no static export renders a negative amount with an ASCII hyphen instead of U+2212", () => {
    for (const s of staticStrings) expect(s).not.toMatch(ASCII_MINUS_BEFORE_RUPEE);
  });

  it("every function export has a registered sample call (no silent skip)", () => {
    for (const [name] of functionExports) {
      expect(SAMPLE_CALLS).toHaveProperty(name);
    }
  });

  it("every function export's generated output is free of the same banned patterns", () => {
    const generated: string[] = [];
    for (const [name, fn] of functionExports) {
      const args = SAMPLE_CALLS[name];
      if (!args) continue;
      generated.push(...collectStrings(fn(...args)));
    }
    expect(generated.length).toBeGreaterThan(0);
    for (const s of generated) {
      expect(s).not.toMatch(BANNED_WORDS);
      expect(s).not.toContain("!");
      expect(s).not.toMatch(STRAIGHT_APOSTROPHE);
      expect(s).not.toMatch(ASCII_MINUS_BEFORE_RUPEE);
    }
  });
});
