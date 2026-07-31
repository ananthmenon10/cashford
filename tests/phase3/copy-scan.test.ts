// Phase 3 — T-U18b/T-U18c: the checked-in manifest (tests/phase3/copy-scan-manifest.json) is
// scanned in both modes, and is itself checked against the enumerated candidate set. Blind from
// §4. Phase 3 is fully landed now, so every manifest entry (files and excluded) is required to
// exist on disk (N1) — a soft "not landed yet" skip would silently hide a typo'd path instead of
// failing the governance check it exists to run.
//
// B5 fix-round-2 rework: the previous version of this scan only ever detected four banned words
// (bet/wager/gamble/punt) in a quoted string literal. The reviewer proved (two live mutations,
// both went undetected) that this never actually enforced "copy comes from lib/gw-copy" — it
// enforced a four-word denylist, which is a much weaker property. The real §4 contract is
// structural: user-visible copy in a component must be sourced from lib/gw-copy (never written
// in place), and a "strings" producer file (lib/ist.ts, the two actions.ts files) must not embed
// sentence-shaped prose that belongs in lib/gw-copy instead.
//
// AST-REWRITE (round-4 fix round 5): the structural check above was implemented as two regex
// passes for two more fix rounds (N1-N10, then R4-1/R4-2/R4-8), and each round the reviewer found
// a fresh mutation the regex genuinely could not see — not a tuning miss, a category of syntax
// regex has no way to represent (a literal landed on a prop via `{"…"}` rather than `="…"`, text
// sitting after a `{expr}` sibling instead of after a tag, an interpolation with a nested brace,
// a ternary/throw carrying the literal instead of a bare `return`). `jsxLiteralViolations` and
// `stringsLiteralViolations` now live in ./copy-scan-ast.ts as a `typescript` compiler-API AST
// walk: JsxText nodes, JSX attribute/expression-container literals, and returned/thrown/assigned/
// object-property literals in strings-mode files are found by asking the real parse tree what
// kind of node a literal's parent is, not by guessing tag/keyword boundaries with a pattern. See
// that file's header comment for the full design, and docs/testing/phase3-cases.md for the
// prose-vs-structural rule this walk decides on (AST context, not a token-count ratio).
import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import manifest from "./copy-scan-manifest.json";
import { jsxLiteralViolations, stringsLiteralViolations } from "./copy-scan-ast";

const ROOT = path.resolve(__dirname, "../..");

describe("B5 fix — jsxLiteralViolations flags in-place copy, not just a banned-word denylist", () => {
  it("catches the reviewer's first mutation: a bare JSX text node with no surrounding quotes and no banned word", () => {
    // This is the exact literal the reviewer substituted for `{C60}` in RecalculatingNote.tsx:8
    // to prove the old scan (banned-word-in-quotes only) never noticed. It contains no banned
    // word — the violation is that it's copy written in place at all.
    const src = "function C() { return <p>Place your picks now.</p>; }";
    const violations = jsxLiteralViolations(src);
    expect(violations).toEqual(["Place your picks now."]);
  });

  it("catches a banned word too, since ANY in-place literal is now a violation, named in the output", () => {
    const src = "function C() { return <p>Place your bet now.</p>; }";
    expect(jsxLiteralViolations(src)).toEqual(["Place your bet now."]);
  });

  it("does NOT flag copy sourced from a lib/gw-copy import (a JSX expression, never a bare literal)", () => {
    const src = 'import { C60 } from "@/lib/gw-copy";\nfunction C() { return <p>{C60}</p>; }';
    expect(jsxLiteralViolations(src)).toEqual([]);
  });

  it("catches an in-place aria-label/placeholder/title/alt literal", () => {
    const src = 'function C() { return <button aria-label="Close this dialog">x</button>; }';
    expect(jsxLiteralViolations(src)).toEqual(["Close this dialog"]);
  });

  it("STRUCTURAL_ALLOW demonstrably suppresses known non-copy tokens in the same run (was unreachable dead code before B5)", () => {
    // "active" is a real §4 structural-allow entry (a status/discriminant literal). It has
    // letters and would be flagged like any other in-place literal above if the allowlist did
    // not suppress it.
    const statusLiteral = "function C() { return <span>active</span>; }";
    expect(jsxLiteralViolations(statusLiteral)).toEqual([]);
    // "en-IN" likewise — a locale code, not copy. Same shape, different allowlisted token, no
    // other bare text in the fixture so a non-empty result would prove the allowlist failed.
    const localeCode = 'function C() { return <time title="en-IN" />; }';
    expect(jsxLiteralViolations(localeCode)).toEqual([]);
  });

  it("N2 fix: catches the reviewer's wrapped-RecalculatingNote mutation — a JSX text node that Prettier split across multiple lines", () => {
    // Same substitution as the first B5 mutation above, but written the way Prettier actually
    // wraps a long line: the text node's content is split across three source lines. The old
    // `[^<>{}\n]+` capture excluded `\n` outright, so this was invisible to the scan even though
    // the un-wrapped single-line version (tested above) was already caught.
    const src = [
      "function C() {",
      "  return (",
      "    <p>",
      "      Recalculating potential winnings across the",
      "      gameweek right now.",
      "    </p>",
      "  );",
      "}",
    ].join("\n");
    expect(jsxLiteralViolations(src)).toEqual([
      "Recalculating potential winnings across the gameweek right now.",
    ]);
  });

  it("N3 fix: catches the reviewer's EmptyState mutation — a sentence-shaped literal on a non-a11y custom prop (`copy=`)", () => {
    // The real component takes `copy={C29}` (a lib/gw-copy import); this mutation substitutes a
    // bare string literal for the import to prove the old scan — which only ever looked at
    // aria-label/placeholder/title/alt — had no way to catch copy landed on any other prop name.
    const src = 'function C() { return <EmptyState copy="This library has no leagues yet." />; }';
    expect(jsxLiteralViolations(src)).toEqual(["This library has no leagues yet."]);
  });

  it("N3 regression: a long, multi-word className is NOT flagged — it's not sentence-shaped, just a utility list", () => {
    // Guards the N3 generalization: once ANY prop is a candidate, a typical Tailwind class list
    // (long, space-separated, often 8+ tokens) must not start reading as "sentence-shaped" copy.
    const src =
      'function C() { return <div className="flex items-center justify-center gap-1 rounded-control border border-border bg-surface px-5 py-2.5 text-[13px] font-semibold" />; }';
    expect(jsxLiteralViolations(src)).toEqual([]);
  });
});

describe("B5 fix — stringsLiteralViolations flags sentence-shaped prose in a strings producer file", () => {
  it("catches the reviewer's second mutation: a strings-mode function returning a full sentence", () => {
    // The reviewer's mutation replaced a real lib/ist.ts helper's body with this literal return
    // to prove the old scan (which ran the same banned-word-only check regardless of `mode`)
    // never noticed a sentence with no banned word landing in a formatting utility.
    const src =
      'export function deadlineBlurb(): string {\n  return "The deadline has passed. Set every scoreline to continue.";\n}';
    const violations = stringsLiteralViolations(src, "lib/ist.ts");
    expect(violations).toEqual(["The deadline has passed. Set every scoreline to continue."]);
  });

  it("does not flag short internal status/error tokens (regression: real code in app/leagues/join/actions.ts)", () => {
    const src = 'return { ok: false, error: "not signed in" };';
    expect(stringsLiteralViolations(src, "app/leagues/join/actions.ts")).toEqual([]);
  });

  it("does not flag template-literal interpolation (structural formatting, not hardcoded prose)", () => {
    const src = "return `${weekday} ${day} ${month}, ${hour}:${minute} ${period} IST`;";
    expect(stringsLiteralViolations(src, "lib/ist.ts")).toEqual([]);
  });

  it("lib/gw-copy.ts is exempt — it IS the copy module; its own style rules are covered by gw-copy.test.ts", () => {
    const src = 'export const C1 = "A full sentence of real copy lives here on purpose.";';
    expect(stringsLiteralViolations(src, "lib/gw-copy.ts")).toEqual([]);
  });

  it("N4(a) fix: strips ${...} interpolation and tests the literal remainder, instead of skipping the whole template literal", () => {
    // The reviewer's mutation: a template literal that mixes real interpolation with hardcoded
    // sentence-shaped prose. The old code's `if (s.includes(\"\\${\")) continue;` bailed on the
    // entire literal the moment it saw any interpolation at all, so this prose was never seen.
    const src =
      "export function reminderCopy(count) {\n  return `You have ${count} unset picks. Update your picks now.`;\n}";
    expect(stringsLiteralViolations(src, "app/leagues/new/actions.ts")).toEqual([
      "You have unset picks. Update your picks now.",
    ]);
  });

  it("N4(b) fix: lowers the sentence gate from 5 to 4 words so period-less imperative copy is still caught", () => {
    // "Update your picks now" — 4 words, no period. Under the old 5-word floor this read as
    // plausibly a short status/error code and was never flagged; it's real user-facing copy.
    const src = 'const nudge = "Update your picks now";';
    expect(stringsLiteralViolations(src, "app/leagues/new/actions.ts")).toEqual([
      "Update your picks now",
    ]);
  });
});

describe("R4 round-4 mutation set — jsxLiteralViolations proof of teeth (each is a category the regex-era scan genuinely could not represent)", () => {
  it("Prettier {\" \"} spacer: an explicit space-string JSX child sitting next to prose does not hide the prose or get itself flagged as a violation", () => {
    // Prettier sometimes emits `<p>Enter your{" "}picks now.</p>` when a line wraps mid-sentence.
    // The regex era anchored on tag boundaries; the injected `{" "}` JsxExpression broke that
    // anchor so the trailing JsxText run was never reached. Here each JsxText run is walked on
    // its own node, so the spacer contributes nothing (it's a single space, not a candidate) and
    // the surrounding prose is still caught on its own runs.
    const src = 'function C() { return <p>Enter your{" "}picks now.</p>; }';
    const violations = jsxLiteralViolations(src);
    expect(violations).toContain("Enter your");
    expect(violations).toContain("picks now.");
  });

  it("expression-adjacent text: a JsxText run sitting after a {expr} sibling (not after a tag) is still caught", () => {
    // `<p>{count} picks left to set.</p>` — the prose run follows a JsxExpression, not a `>`. A
    // regex anchored on `>...<` never sees this run at all.
    const src = "function C({ count }) { return <p>{count} picks left to set.</p>; }";
    expect(jsxLiteralViolations(src)).toEqual(["picks left to set."]);
  });

  it("braced string prop (`copy={\"…\"}` instead of `copy=\"…\"`): still caught as an in-place literal", () => {
    const src = 'function C() { return <EmptyState copy={"This library has no leagues yet."} />; }';
    expect(jsxLiteralViolations(src)).toEqual(["This library has no leagues yet."]);
  });

  it("braced template prop with interpolation: the static remainder is caught, the interpolation is stripped", () => {
    const src = 'function C({ n }) { return <EmptyState copy={`You have ${n} unset picks. Update your picks now.`} />; }';
    expect(jsxLiteralViolations(src)).toEqual(["You have unset picks. Update your picks now."]);
  });
});

describe("R4 round-4 mutation set — stringsLiteralViolations proof of teeth (sink-role climbing, not a bare `return` keyword match)", () => {
  it("object-property literal: a prose string assigned to an object property key is caught, not just a bare `return`", () => {
    const src = 'export function errorBody() {\n  return { ok: false, message: "Something went wrong while saving your picks." };\n}';
    expect(stringsLiteralViolations(src, "app/leagues/join/actions.ts")).toEqual([
      "Something went wrong while saving your picks.",
    ]);
  });

  it("ternary return: a prose literal reached only through a conditional's branch is caught by climbing through the ConditionalExpression to the ReturnStatement", () => {
    const src =
      'export function blurb(ok) {\n  return ok ? "All picks are in for this gameweek." : "short";\n}';
    expect(stringsLiteralViolations(src, "app/leagues/new/actions.ts")).toEqual([
      "All picks are in for this gameweek.",
    ]);
  });

  it("throw statement: a prose literal passed to `throw new Error(...)` is caught by climbing through the call/new expression to the ThrowStatement", () => {
    const src = 'export function guard(ok) {\n  if (!ok) throw new Error("Your session has expired, please sign in again.");\n}';
    expect(stringsLiteralViolations(src, "app/leagues/join/actions.ts")).toEqual([
      "Your session has expired, please sign in again.",
    ]);
  });

  it("multi-line template literal: a prose template spanning multiple source lines is caught, not skipped because it isn't single-line", () => {
    const src = [
      "export function blurb(name) {",
      "  return `Hey ${name},",
      "the deadline for this gameweek is almost here.`;",
      "}",
    ].join("\n");
    expect(stringsLiteralViolations(src, "app/leagues/new/actions.ts")).toEqual([
      "Hey ,\nthe deadline for this gameweek is almost here.",
    ]);
  });

  it("short 3-token CTA with no terminal period: caught by the capital-letter + 2-word gate, not a word-count floor", () => {
    const src = 'const cta = "Enter your picks";';
    expect(stringsLiteralViolations(src, "app/leagues/new/actions.ts")).toEqual(["Enter your picks"]);
  });

  it("does NOT flag a plain call-expression argument (e.g. a console.error log tag) — no sink between the literal and the call", () => {
    // Guards against the sink-role climb over-firing: a literal argument to an ordinary function
    // call (not itself thrown) has no role, by design — no denylist needed for internal log tags.
    const src = 'export function log(err) {\n  console.error("Something went wrong while saving your picks.", err);\n}';
    expect(stringsLiteralViolations(src, "app/leagues/join/actions.ts")).toEqual([]);
  });
});

describe("N1 fix — every manifest entry, scanned or excluded, is a real path on disk", () => {
  // Phase 3 is fully landed, so a manifest entry with no matching file is either a typo or a
  // stale reference — either way it silently disables governance for whatever it was supposed
  // to point at, so this must fail loud rather than being treated as "not landed yet".
  function missingManifestPaths(m: typeof manifest): string[] {
    return [...m.files.map((f) => f.path), ...m.excluded].filter((p) => !existsSync(path.join(ROOT, p)));
  }

  it("every path in `files` and `excluded` exists", () => {
    expect(missingManifestPaths(manifest)).toEqual([]);
  });

  it("proof of teeth: renaming one manifest entry to a typo'd path is caught, not silently skipped", () => {
    // The exact failure mode this fixes: the reviewer renamed a real `files` entry (e.g.
    // `lib/gw-copy.ts` -> `lib/gw-cpy.ts`) and the old soft-skip treated the resulting missing
    // file as "not landed yet" — a pass, not a failure — which is how a typo can silently
    // disable governance for a real file indefinitely.
    const mutated = {
      ...manifest,
      files: [...manifest.files.slice(1), { path: "lib/gw-cpy.ts", mode: "strings" as const, note: "" }],
    };
    expect(missingManifestPaths(mutated)).toEqual(["lib/gw-cpy.ts"]);
  });
});

describe("T-U18b — source scan over the manifest, both jsx and strings modes", () => {
  for (const entry of manifest.files) {
    const full = path.join(ROOT, entry.path);
    it(`${entry.path} (${entry.mode}) contains no in-place user-visible copy`, () => {
      const src = readFileSync(full, "utf8");
      const violations =
        entry.mode === "jsx" ? jsxLiteralViolations(src) : stringsLiteralViolations(src, entry.path);
      expect(violations).toEqual([]);
    });
  }
});

describe("T-U18c — the manifest matches the enumerated candidate set", () => {
  it("every manifest path exists and declares a valid mode (once the file lands)", () => {
    for (const entry of manifest.files) {
      expect(["jsx", "strings"]).toContain(entry.mode);
      const isTsx = entry.path.endsWith(".tsx");
      if (entry.mode === "jsx") expect(isTsx || entry.path === "components/ui.tsx").toBe(true);
    }
  });

  // R4-3: the check above only ran jsx ⇒ .tsx. It never validated the OTHER direction — a
  // strings-mode entry that's actually a .tsx component would be scanned with the wrong pass
  // (stringsLiteralViolations looks for returned/thrown/assigned/property literals; a component
  // file's copy lives in JSX text and attributes, which that pass never looks at, so a mismatched
  // entry would go quietly unscanned for the violations that matter). `modeMismatches` checks
  // both directions at once — jsx must be .tsx (or the ui.tsx carve-out), strings must never be
  // .tsx — and returns the offending paths, so a real assertion and its flip-mutation proof can
  // share one implementation instead of duplicating the direction logic.
  function modeMismatches(files: typeof manifest.files): string[] {
    return files
      .filter((entry) => {
        const isTsx = entry.path.endsWith(".tsx");
        if (entry.mode === "jsx") return !(isTsx || entry.path === "components/ui.tsx");
        return isTsx;
      })
      .map((entry) => entry.path);
  }

  it("manifest mode is validated in both directions: jsx entries are .tsx, strings entries are never .tsx", () => {
    expect(modeMismatches(manifest.files)).toEqual([]);
  });

  it('proof of teeth (R4-3): flipping a real strings-mode .ts entry\'s mode to "jsx" is caught, not silently accepted', () => {
    // lib/ist.ts is a real strings-mode .ts entry. Flipping its mode to "jsx" is the direction the
    // manifest-wide jsx-⇒-.tsx check never ran before R4-3 — it only checked jsx entries, so a
    // strings entry could carry any mode value undetected. Run the SAME `modeMismatches` helper
    // used by the real assertion above against this one mutated entry and confirm it now flags it.
    const mutated = manifest.files.map((entry) =>
      entry.path === "lib/ist.ts" ? { ...entry, mode: "jsx" as const } : entry,
    );
    expect(modeMismatches(mutated)).toEqual(["lib/ist.ts"]);
  });

  // R4-4: `excluded` is a business ruling (which surfaces are deliberately out of the Phase 3
  // copy contract and why — see the manifest's `_excludedNote`), not something a future edit
  // should be able to grow or shrink as a side effect. Freezing the exact list here means any
  // addition or removal shows up as a failing assertion that has to be edited deliberately,
  // rather than silently changing what governance covers.
  it("R4-4: `excluded` is frozen to the checked-in list — any addition or removal requires editing this assertion", () => {
    expect(manifest.excluded).toEqual([
      "app/leagues/[slug]/_cup/CupLeagueView.tsx",
      "components/LeagueTabs.tsx",
      "lib/settlement.ts",
      "lib/settle-contest.ts",
      "lib/gameweek-points.ts",
      "lib/gameweek-settle.ts",
      "app/dev/gameweeks/page.tsx",
      "app/login/page.tsx",
      "app/login/actions.ts",
      "app/leagues/[slug]/manage/page.tsx",
      "app/leagues/[slug]/m/[id]/page.tsx",
    ]);
  });

  it("baseRef is a fixed commit, not resolved at run time", () => {
    expect(typeof manifest.baseRef).toBe("string");
    expect(manifest.baseRef.length).toBeGreaterThan(0);
    expect(manifest.baseRef).not.toContain("PLACEHOLDER");
  });

  // B6 fix: the previous version diffed `baseRef...HEAD` — a *committed* range. With Phase 3
  // still uncommitted on top of ac419f2 (which IS HEAD), that range is empty, so the candidate
  // set was empty and every assertion below it ran zero times. The real Phase 3 changes live in
  // the working tree (tracked modifications + untracked new files), not in commits after
  // baseRef — so the candidate set has to be enumerated against the working tree instead:
  // `git diff --name-only <baseRef>` (working tree vs baseRef) UNION untracked files, filtered to
  // changed .tsx/.ts files under app/ or components/ (the two actions.ts files fall under this
  // filter naturally; lib/gw-copy.ts and lib/ist.ts are out of scope for the live-candidate check
  // — they're covered directly by the T-U18b file-existence loop above instead).
  function workingTreeCandidates(): string[] {
    const diffed = execSync(`git diff --name-only ${manifest.baseRef}`, { cwd: ROOT, encoding: "utf8" })
      .split("\n")
      .filter(Boolean);
    const untracked = execSync("git ls-files --others --exclude-standard", { cwd: ROOT, encoding: "utf8" })
      .split("\n")
      .filter(Boolean);
    const filterRe = /^(app|components)\/.*\.tsx?$/;
    return [...new Set([...diffed, ...untracked])].filter((p) => filterRe.test(p));
  }

  it("every live candidate (changed .tsx/.ts under app/ or components/) is covered by manifest ∪ excluded", () => {
    const candidates = workingTreeCandidates();
    expect(candidates.length).toBeGreaterThan(0); // sanity: Phase 3 is genuinely uncommitted right now
    const filterRe = /^(app|components)\/.*\.tsx?$/;
    const covered = new Set([
      ...manifest.files.map((f) => f.path).filter((p) => filterRe.test(p)),
      ...manifest.excluded.filter((p) => filterRe.test(p)),
    ]);
    // N10 fix: assert on the collected list of uncovered paths, not a per-candidate loop of
    // `expect(...).toBe(true)` — the old form's failure message named neither the candidate nor
    // how many were missing, just "expected false to be true" with no path attached.
    const uncovered = candidates.filter((c) => !covered.has(c));
    expect(uncovered).toEqual([]);
  });

  it("proof of teeth: removing one manifest entry makes a real candidate fall out of coverage", () => {
    const candidates = workingTreeCandidates();
    const filterRe = /^(app|components)\/.*\.tsx?$/;
    // components/gw/EntrySheet.tsx is a real, currently-changed candidate — pick it directly
    // rather than assuming array order/position in the manifest.
    const target = "components/gw/EntrySheet.tsx";
    expect(candidates).toContain(target);
    const coveredWithoutTarget = new Set([
      ...manifest.files.map((f) => f.path).filter((p) => p !== target && filterRe.test(p)),
      ...manifest.excluded.filter((p) => filterRe.test(p)),
    ]);
    // With the entry removed, the live check above would fail on this candidate — this is the
    // mutation the reviewer required proof against (a vacuous check would still pass here).
    expect(coveredWithoutTarget.has(target)).toBe(false);
  });
});
