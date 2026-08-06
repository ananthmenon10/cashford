// Step 7B item 8 — lib/payment-copy.ts (ARCHIVE_COPY/TRANSITION_COPY/PHASE5_UI_COPY) is a real
// copy destination module, exactly like lib/gw-copy.ts, but it had no style governance of its
// own: gw-copy.test.ts only ever scanned gw-copy.ts's exports, and the AST copy-scan
// (tests/phase3/copy-scan.test.ts) only walks app/ and components/ files for in-place literals —
// neither one ever looked inside this file. This mirrors gw-copy.test.ts's core style checks
// (banned words, no exclamation marks, typographic apostrophe, real minus sign) over every
// string this module exports or generates, so a future edit here can't silently regress the
// same conventions the rest of the app's copy already enforces.
import { describe, expect, it } from "vitest";
import * as paymentCopy from "../../lib/payment-copy";

const BANNED_WORDS = /\b(bet|wager|gamble|punt|comprehensive|robust|seamless|leverage|delve|ensure|easy|simple|quick)\b/i;
const STRAIGHT_APOSTROPHE = /[A-Za-z]'[A-Za-z]/; // a straight ' between letters (typographic is ’)
const ASCII_MINUS_BEFORE_RUPEE = /-₹/; // negative amounts must use U+2212 minus (−₹), never a hyphen

function collectStrings(value: unknown, depth = 0): string[] {
  if (depth > 3) return [];
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap((v) => collectStrings(v, depth + 1));
  if (value && typeof value === "object") return Object.values(value).flatMap((v) => collectStrings(v, depth + 1));
  return [];
}

// One representative call per function export in the module, so generated output is checked
// too, not just the static string literals.
const SAMPLE_CALLS: Record<string, unknown[]> = {
  planCount: [3],
  pendingAnswer: [1],
  partial: ["Ananth", "Bala", 1000, 400, 600],
  exact: [500],
  overpayment: [200],
  debtorShortcut: [500, "Bala"],
  creditorShortcut: [500, "Ananth"],
  thirdPartyShortcut: ["Ananth", "Bala", 500],
  payerSubmit: [500, "Bala"],
  receiverSubmit: [500, "Ananth"],
  thirdPartySubmit: [500],
  matching: ["Ananth"],
  matchingPayments: [1],
  pendingReceived: ["Ananth", 500],
  pendingPayer: ["Bala", 500],
  thirdPartyPending: ["Chandu", "Ananth", "Bala"],
  waitingOne: ["Ananth"],
  waitingTwo: ["Ananth", "Bala"],
  reversalFeed: ["duplicate entry"],
  loggedBy: ["Ananth", "19 Jul"],
  share: ["https://cashford.vercel.app/p/abc"],
  freeze: ["19 Jul 2026"],
  openLive: ["Premier League 2026-27"],
  archiveBannerLabel: ["World Cup 2026"],
  staleTable: ["2:14 pm"],
  consequence: [500],
  firstGameweek: [1, "Sat 3 Feb, 4:00 pm IST"],
  firstGameweekPrefix: [1],
  memberHeading: ["Ananth"],
  adopted: ["KK Bois"],
  otherActive: ["Premier League 2026-27"],
  archivedTarget: ["World Cup 2026"],
  adoptionHeading: ["Premier League 2026-27"],
  paid: ["Ananth", "Bala"],
  arrow: ["Ananth", "Bala"],
  finish: [1, 5, 2],
  firstDeadlineCopy: [1, "Sat 3 Feb, 4:00 pm IST"],
  firstDeadlinePrefix: [1],
  createConsequenceCopy: [500],
  beforeTimeCopy: [4],
};

describe("lib/payment-copy.ts — style rules over every exported string and function output", () => {
  const staticStrings: string[] = [];
  const functionExports: Array<[string, (...args: unknown[]) => unknown]> = [];

  for (const [exportName, exportValue] of Object.entries(paymentCopy)) {
    if (typeof exportValue === "function") {
      functionExports.push([exportName, exportValue as (...args: unknown[]) => unknown]);
    } else if (exportValue && typeof exportValue === "object") {
      // A namespace object (ARCHIVE_COPY/TRANSITION_COPY/PHASE5_UI_COPY) — walk its own entries.
      for (const [name, value] of Object.entries(exportValue as Record<string, unknown>)) {
        if (typeof value === "function") {
          functionExports.push([name, value as (...args: unknown[]) => unknown]);
        } else {
          staticStrings.push(...collectStrings(value));
        }
      }
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
      const out = fn(...args);
      if (typeof out === "string") generated.push(out);
      else if (out && typeof out === "object") generated.push(...collectStrings(out));
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
