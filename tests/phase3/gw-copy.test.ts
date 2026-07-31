// Phase 3 — §4 copy system: lib/gw-copy.ts. Blind from §4, T-U18, T-U6a/b/c.
// C-RULE: every user-visible literal is an export of this module. Rather than guess every one of
// C1-C72's individual export names (the plan gives IDs, not identifiers), this file scans the
// module's own exported values — string exports and the generated output of function exports —
// against the style rules in §4's first paragraph. This is deliberately name-agnostic for the
// bulk of the catalogue.
//
// Canonical per the fix round: the M3 re-settlement mapping is `correctionCopy(cause)`, not the
// guessed `settleCauseNote`. Below also invokes every C1-C72 export that is a function (not just
// `nudgeMessage`) with representative args, so the generated-output half of T-U18's style rules
// covers the whole catalogue, not only the one builder the plan names verbatim.
import { describe, expect, it } from "vitest";
import * as gwCopy from "../../lib/gw-copy";

// One representative call per C-ID function export (the other C-IDs are static strings, already
// covered by `staticStrings` below) plus the module's other builder functions. Kept explicit
// rather than a generic arity-based invoker because these functions mix string/number params in
// ways an arity guess would get wrong (e.g. toLocaleString on a non-number throws).
const SAMPLE_CALLS: Record<string, unknown[]> = {
  C1: [24],
  C2: ["Sat 3 Feb, 4:00 pm IST"],
  C3: [100],
  C5: [200, 3, 6],
  C5b: [200, 7, 10],
  C6: [24],
  C10: [24],
  C12: [24],
  C14: [2, 4],
  C15: [24],
  C16: [24],
  C17: [200],
  C18: [200],
  C21: [24],
  C22: [3, 10],
  C24: [100],
  C26: [24],
  C30: [24, "Sat 3 Feb, 4:00 pm IST"],
  C31: [200],
  C32: [200],
  C45: [24],
  C48: [24],
  C52: ["KK Bois", 100],
  C53: [2],
  C54: ["KK Bois"],
  C57: [24, 20],
  C58: [24],
  C65: [24],
  C67: ["KK Bois", 24, "Sat 3 Feb, 4:00 pm IST"],
  C68: [100, "KK Bois"],
  C80: ["KK Bois"],
  C81: ["KK Bois"],
  C82: ["KK Bois"],
  C83: ["KK Bois"],
  createLiveCopy: ["KK Bois"],
  shareInviteCopy: ["KK Bois", "https://cashford.vercel.app/x", "A1B2C3D4"],
  captainCopy: ["Ananth"],
  memberCountCopy: [3],
  competitionFormatCopy: ["gameweek"],
  competitionSummaryCopy: ["Premier League", "gameweek"],
  anteSummaryCopy: [100],
  joinAnteCopy: [100],
  manageLeagueCopy: ["KK Bois"],
  alreadyMemberCopy: ["KK Bois"],
  archivedLeagueCopy: ["KK Bois"],
  owesPersonCopy: ["Ananth"],
  owedByPersonCopy: ["Ananth"],
  lastWeekCopy: [24, 6],
  moneyCopy: [200],
  relativeDeadline: [3_600_000],
  voidReasonCopy: ["single_entrant"],
  correctionCopy: ["result_revision"],
  nudgeMessage: [{ league: "KK Bois", gw: 24, deadline: "Sat 3 Feb, 4:00 pm IST" }],
  // F5/F6 message → C-ID map builders (fix round 2): these return a GwMappedError object, not a
  // string, so the "other builder functions" generation test below skips their output (it only
  // pushes string results) — registered here so the SAMPLE_CALLS guard doesn't fail on them.
  // N6 fix round: the param was renamed firstSave → noEntryAtSave (C55b now requires the caller
  // to affirmatively know there's no entry at save time, not merely infer it from a page-load flag).
  entryErrorCopy: ["the deadline has passed", { noEntryAtSave: false, status: 400 }],
  mirrorErrorCopy: ["no fixtures to predict", 400],
  mirrorTargetErrorCopy: ["stake mismatch", "KK Bois"],
};

const BANNED_WORDS = /\b(bet|wager|gamble|punt)\b/i;
const STRAIGHT_APOSTROPHE = /[A-Za-z]'[A-Za-z]/; // a straight ' between letters (typographic is ’)
const HYPHEN_SCORELINE = /\b\d+-\d+\b/; // e.g. "2-1" — must be an en dash "2–1"

function collectStrings(value: unknown, depth = 0): string[] {
  if (depth > 3) return [];
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap((v) => collectStrings(v, depth + 1));
  if (value && typeof value === "object") return Object.values(value).flatMap((v) => collectStrings(v, depth + 1));
  return [];
}

describe("lib/gw-copy.ts — T-U18 style rules over every exported string and function output", () => {
  const staticStrings: string[] = [];
  const functionExports: Array<[string, (...args: unknown[]) => unknown]> = [];

  for (const [name, value] of Object.entries(gwCopy)) {
    if (typeof value === "function") {
      functionExports.push([name, value as (...args: unknown[]) => unknown]);
    } else {
      staticStrings.push(...collectStrings(value));
    }
  }

  it("the module exports at least one string and at least one function (nudgeMessage-style builder)", () => {
    expect(staticStrings.length).toBeGreaterThan(0);
    expect(functionExports.length).toBeGreaterThan(0);
  });

  it("no static export contains a banned word (bet/wager/gamble/punt)", () => {
    for (const s of staticStrings) expect(s).not.toMatch(BANNED_WORDS);
  });

  it("no static export contains an exclamation mark", () => {
    for (const s of staticStrings) expect(s).not.toContain("!");
  });

  it("no static export uses a straight apostrophe where a typographic one belongs", () => {
    for (const s of staticStrings) expect(s).not.toMatch(STRAIGHT_APOSTROPHE);
  });

  it("no static export renders a scoreline with a hyphen instead of an en dash", () => {
    for (const s of staticStrings) expect(s).not.toMatch(HYPHEN_SCORELINE);
  });

  it("nudgeMessage({ league, gw, deadline }) generates output free of the same banned patterns (T-U18 generated-output requirement)", () => {
    const fn = (gwCopy as Record<string, unknown>)["nudgeMessage"] as
      | ((args: { league: string; gw: number; deadline: string }) => string)
      | undefined;
    expect(typeof fn).toBe("function");
    const out = fn!({ league: "KK Bois", gw: 24, deadline: "Sat 3 Feb, 4:00 pm IST" });
    expect(typeof out).toBe("string");
    expect(out).not.toMatch(BANNED_WORDS);
    expect(out).not.toContain("!");
    expect(out).not.toMatch(STRAIGHT_APOSTROPHE);
    // C67 names league, gameweek number and deadline in the generated sentence.
    expect(out).toContain("KK Bois");
    expect(out).toContain("24");
  });

  it("every C1-C72 identifier that is a function export has a registered sample call (no silent skip)", () => {
    const cIdFnNames = functionExports.map(([name]) => name).filter((name) => /^C\d+$/.test(name));
    expect(cIdFnNames.length).toBeGreaterThan(0);
    for (const name of cIdFnNames) {
      expect(SAMPLE_CALLS).toHaveProperty(name);
    }
  });

  it("every non-C-ID builder function export also has a registered sample call (no silent skip)", () => {
    // Previously only the C-ID guard above existed; the two generation tests below both did
    // `if (!args) continue`, so a new non-C-ID builder landing without a SAMPLE_CALLS entry was
    // silently never invoked rather than failing the suite. This guard makes that a hard failure,
    // mirroring the C-ID guard above.
    const nonCIdFnNames = functionExports.map(([name]) => name).filter((name) => !/^C\d+$/.test(name));
    expect(nonCIdFnNames.length).toBeGreaterThan(0);
    for (const name of nonCIdFnNames) {
      expect(SAMPLE_CALLS).toHaveProperty(name);
    }
  });

  it("every C1-C72 function export's generated output is free of the same banned patterns", () => {
    const generated: string[] = [];
    for (const [name, fn] of functionExports) {
      if (!/^C\d+$/.test(name)) continue;
      const args = SAMPLE_CALLS[name];
      if (!args) continue;
      const out = fn(...args);
      expect(typeof out).toBe("string");
      generated.push(out as string);
    }
    expect(generated.length).toBeGreaterThan(0);
    for (const s of generated) {
      expect(s).not.toMatch(BANNED_WORDS);
      expect(s).not.toContain("!");
      expect(s).not.toMatch(STRAIGHT_APOSTROPHE);
      expect(s).not.toMatch(HYPHEN_SCORELINE);
    }
  });

  it("the other (non-C-ID) builder functions also generate output free of the same banned patterns", () => {
    const generated: string[] = [];
    for (const [name, fn] of functionExports) {
      if (/^C\d+$/.test(name)) continue;
      const args = SAMPLE_CALLS[name];
      if (!args) continue;
      const out = fn(...args);
      if (typeof out === "string") generated.push(out);
    }
    expect(generated.length).toBeGreaterThan(0);
    for (const s of generated) {
      expect(s).not.toMatch(BANNED_WORDS);
      expect(s).not.toContain("!");
      expect(s).not.toMatch(STRAIGHT_APOSTROPHE);
      expect(s).not.toMatch(HYPHEN_SCORELINE);
    }
  });
});

describe("M3 re-settlement cause mapping — T-U6a/T-U6b/T-U6c (§5.4)", () => {
  // Canonical export per the fix round: `correctionCopy(cause)`, not the guessed
  // `settleCauseNote`. Behavior (initial → no note, the three causes → C61/C62/C63) is unchanged
  // from what this block already asserted — only the name was wrong.
  const correctionCopy = (gwCopy as Record<string, unknown>)["correctionCopy"] as
    | ((cause: "initial" | "result_revision" | "membership_change" | "combined") => string | null | undefined)
    | undefined;

  it("T-U6a: cause 'initial' produces no note", () => {
    expect(typeof correctionCopy).toBe("function");
    expect(correctionCopy!("initial")).toBeFalsy();
  });

  it("T-U6b: cause 'result_revision' maps to C61 ('Updated after a score correction')", () => {
    expect(correctionCopy!("result_revision")).toBe("Updated after a score correction");
  });

  it("T-U6c: cause 'membership_change' maps to C62 ('Updated after a fixture change')", () => {
    expect(correctionCopy!("membership_change")).toBe("Updated after a fixture change");
  });

  it("cause 'combined' maps to C63 ('Updated after a correction')", () => {
    expect(correctionCopy!("combined")).toBe("Updated after a correction");
  });
});
