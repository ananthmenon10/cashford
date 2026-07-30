// Phase 3 — §4 copy governance scan, AST-based rewrite (round-4 fix round 5).
//
// Round-1/2 of this scan were regex-based (see copy-scan.test.ts's header comment for the B5
// history). The reviewer proved TWO further rounds of regex patches (N1-N10, then R4-1/R4-2/R4-8)
// each lost ground to a fresh mutation the regex couldn't see: Prettier's `{" "}` spacer breaking
// tag-boundary anchoring, text sitting after a JSX expression instead of after a tag, a literal
// landed on a prop via `{"…"}` instead of `="…"`, a ternary/throw/object-property carrying the
// literal instead of a bare `return`, and interpolation-stripping regex (`\$\{[^}]*\}`) breaking on
// nested braces. Regex pattern-matches syntax it can guess at; it can't know what a node actually
// IS. A real parse tree can. This file replaces both regex passes with a `typescript` compiler-API
// walk over the actual JsxText / JsxExpression / string-and-template-literal nodes, so "is this
// node prose, and is it sitting somewhere copy isn't allowed to sit" is answered from the tree
// shape (what kind of node is the parent — a JSX text run, an attribute, a return statement, an
// object property, a throw) instead of from a regex's guess at token boundaries.
import ts from "typescript";

// Exact-match allowlist for tokens that read as English words but are structural, not copy: the
// contest/entry/fixture status-machine discriminants and lib/ist.ts's Intl.DateTimeFormat/locale
// option values. Unchanged from the regex-era scan — this list is a business-rule allowlist, not
// part of what the AST rewrite fixes.
const STRUCTURAL_ALLOW =
  /^(en-IN|Asia\/Kolkata|2-digit|numeric|short|long|active|archived|none|notfound|revoked|entered|needs_update|invalid|locked_in|open|closed|settling|settled|void|gameweek|cup)$/;

// A11Y props are copy-shaped by construction: a non-empty literal in one of these slots is always
// wrong (screen-reader/placeholder/title/alt text is always user-visible), so they're an ANY-literal
// candidate regardless of how prose-like the string reads. Every other prop (the EmptyState `copy=`
// idiom, or any future custom prop) only becomes a candidate when the AST-context prose gate below
// says the text reads as copy, not a class list or a route fragment.
const A11Y_PROPS = new Set(["aria-label", "placeholder", "title", "alt"]);

function collapse(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

// The prose gate, decided on shape rather than a token-count ratio: a sentence-ending period (a
// letter immediately followed by `.` then whitespace/EOS — this deliberately excludes the decimal
// point in Tailwind utilities like `py-2.5`, digit-before-dot rather than letter-before-dot) always
// reads as copy. Absent a period, a string that opens on a capital letter and has 2+ plain-English
// words reads as copy too (an imperative CTA like "Update your picks" or "Enter your picks" has no
// terminal period and can be as short as 2-3 words — a word-count floor of 4/5 is what let those
// through in the regex era). Internal status/error tokens ("not signed in", "inactive", "not
// authenticated") are lowercase by convention and fail the capital-letter test, so this doesn't
// require a separate denylist for them.
function isProseText(s: string): boolean {
  if (!s) return false;
  const hasSentencePeriod = /[a-zA-Z]\.(\s|$)/.test(s);
  const words = s.split(/\s+/).filter((w) => {
    const stripped = w.replace(/[.,!?]$/, "");
    return /^[A-Za-z][a-zA-Z'’]*$/.test(stripped) && stripped.length >= 2;
  });
  if (hasSentencePeriod) return words.length >= 1;
  return /^[A-Z]/.test(s) && words.length >= 2;
}

function isCandidateText(s: string): boolean {
  if (!s) return false;
  if (!/[a-zA-Z]/.test(s)) return false; // punctuation-only / numeric-only
  if (s.length < 2) return false;
  if (STRUCTURAL_ALLOW.test(s)) return false;
  return true;
}

function isTransparentWrapper(
  node: ts.Node,
): node is ts.ParenthesizedExpression | ts.AsExpression | ts.NonNullExpression {
  return ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isNonNullExpression(node);
}

// Reads the static text of a string or template literal, with `${...}` interpolations removed —
// via the real template-span structure (head + each span's trailing literal chunk), not a
// `\$\{[^}]*\}` regex. The regex era's version broke on nested braces inside an interpolation
// (`` `${cond ? "a" : "b"}` `` bridges past the first `}`); reading `head`/`templateSpans` directly
// can't have that failure mode because the parser has already resolved the nesting.
function literalText(node: ts.StringLiteralLike | ts.TemplateExpression): string {
  if (ts.isTemplateExpression(node)) {
    return node.head.text + node.templateSpans.map((s) => s.literal.text).join("");
  }
  return node.text;
}

function isLiteralLike(
  node: ts.Node,
): node is ts.StringLiteral | ts.NoSubstitutionTemplateLiteral | ts.TemplateExpression {
  return (
    ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateExpression(node)
  );
}

function parseSource(src: string, fileName: string, kind: ts.ScriptKind): ts.SourceFile {
  return ts.createSourceFile(fileName, src, ts.ScriptTarget.Latest, /* setParentNodes */ true, kind);
}

function forEachNode(root: ts.Node, visit: (node: ts.Node) => void): void {
  visit(root);
  root.forEachChild((child) => forEachNode(child, visit));
}

// ---------------------------------------------------------------------------------------------
// jsx mode — a component must never render user-visible copy written in place; it must come from
// a lib/gw-copy import (a JSX expression referencing an identifier/property, never a bare literal).
// ---------------------------------------------------------------------------------------------

export function jsxLiteralViolations(src: string): string[] {
  const sf = parseSource(src, "fixture.tsx", ts.ScriptKind.TSX);
  const violations: string[] = [];

  // A literal sitting directly in `{}` — either as a JSX child (`<p>{"…"}</p>`) or as an
  // attribute's braced value (`copy={"…"}`, `copy={`template ${x}`}`) — is exactly as much a
  // hardcoded-in-place violation as a plain quoted string. It's the ONE thing the regex era could
  // never see at all: both its passes required the matched span to contain no `{`/`}`, which is
  // what made "not sourced from a lib/gw-copy import" true by construction there. Here it's true
  // by construction for a different reason: this only fires when the expression inside the braces
  // IS a literal — a reference to an import (`{C60}`) or any other expression (`{someFn()}`,
  // `{a && b}`) is left alone.
  function unwrapToLiteral(expr: ts.Expression): ts.Expression {
    let e = expr;
    while (isTransparentWrapper(e)) e = e.expression;
    return e;
  }

  forEachNode(sf, (node) => {
    if (ts.isJsxText(node)) {
      const s = collapse(node.text);
      if (isCandidateText(s)) violations.push(s);
      return;
    }

    if (ts.isJsxAttribute(node)) {
      const attrName = node.name.getText(sf);
      const init = node.initializer;
      if (!init) return;

      let literal: ts.Expression | null = null;
      if (ts.isStringLiteral(init)) {
        literal = init;
      } else if (ts.isJsxExpression(init) && init.expression) {
        const inner = unwrapToLiteral(init.expression);
        if (isLiteralLike(inner)) literal = inner;
      }
      if (!literal || !isLiteralLike(literal)) return;

      const raw = collapse(literalText(literal));
      if (!isCandidateText(raw)) return;
      const isA11y = A11Y_PROPS.has(attrName);
      if (isA11y || isProseText(raw)) violations.push(raw);
      return;
    }

    // A literal sitting as a JSX child's expression container, e.g. `<p>{"Hardcoded text"}</p>`
    // or `<p>{`Hardcoded ${x} text`}</p>` — as opposed to the attribute case above. Only fires
    // when this container is a JSX CHILD, not an attribute's initializer (that's handled above
    // and would otherwise be visited twice, once here and once as the attribute's initializer).
    if (ts.isJsxExpression(node) && node.expression && !ts.isJsxAttribute(node.parent)) {
      const inner = unwrapToLiteral(node.expression);
      if (isLiteralLike(inner)) {
        const raw = collapse(literalText(inner));
        if (isCandidateText(raw) && isProseText(raw)) violations.push(raw);
      }
    }
  });

  return violations;
}

// ---------------------------------------------------------------------------------------------
// strings mode — a "strings" producer file (lib/ist.ts, the two actions.ts files) formats
// structural values or gates/validates; full sentence-shaped prose belongs in lib/gw-copy.ts.
// lib/gw-copy.ts is itself exempt (it IS the destination module; gw-copy.test.ts covers its
// style rules directly).
// ---------------------------------------------------------------------------------------------

// AST context a candidate literal sits in: reached by climbing from the literal up through
// "transparent" connectors (parens, a ternary's branches, the right side of `??`/`||`/`&&`) to
// the nearest node that actually DOES something with the value — returns it, throws it, assigns
// it, or uses it as an object property. This is what "decide on AST context, not token counts"
// means concretely: `return cond ? "A message." : "B";` (a round-4 mutation) is reached by
// climbing through the ConditionalExpression to the ReturnStatement; a plain call argument like
// `console.error("[tag]", err)` is NOT reached (no sink between the literal and the call), so
// internal log tags are never candidates in the first place — no denylist needed for them.
function climbToSinkRole(literal: ts.Node): "returned" | "thrown" | "assigned" | "property" | null {
  let node: ts.Node = literal;
  let parent: ts.Node | undefined = node.parent;

  while (parent) {
    if (isTransparentWrapper(parent)) {
      node = parent;
      parent = node.parent;
      continue;
    }
    if (
      ts.isConditionalExpression(parent) &&
      (parent.whenTrue === node || parent.whenFalse === node)
    ) {
      node = parent;
      parent = node.parent;
      continue;
    }
    if (
      ts.isBinaryExpression(parent) &&
      parent.right === node &&
      [
        ts.SyntaxKind.QuestionQuestionToken,
        ts.SyntaxKind.BarBarToken,
        ts.SyntaxKind.AmpersandAmpersandToken,
      ].includes(parent.operatorToken.kind)
    ) {
      node = parent;
      parent = node.parent;
      continue;
    }
    break;
  }
  if (!parent) return null;

  if (ts.isReturnStatement(parent)) return "returned";
  if (ts.isThrowStatement(parent)) return "thrown";
  if (ts.isVariableDeclaration(parent) && parent.initializer === node) return "assigned";
  if (
    ts.isBinaryExpression(parent) &&
    parent.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
    parent.right === node
  ) {
    return "assigned";
  }
  if (ts.isPropertyAssignment(parent) && parent.initializer === node) return "property";

  // `throw new Error("…")` / `throw Error("…")`: the literal is a call/new-expression argument,
  // and that call is (through optional parens) the throw statement's own expression.
  if ((ts.isCallExpression(parent) || ts.isNewExpression(parent)) && parent.arguments?.includes(node as ts.Expression)) {
    let callNode: ts.Node = parent;
    let callParent: ts.Node | undefined = callNode.parent;
    while (callParent && ts.isParenthesizedExpression(callParent)) {
      callNode = callParent;
      callParent = callNode.parent;
    }
    if (callParent && ts.isThrowStatement(callParent)) return "thrown";
  }

  return null;
}

export function stringsLiteralViolations(src: string, filePath: string): string[] {
  if (filePath === "lib/gw-copy.ts") return [];

  const sf = parseSource(src, "fixture.ts", ts.ScriptKind.TS);
  const violations: string[] = [];

  forEachNode(sf, (node) => {
    if (!isLiteralLike(node)) return;
    const role = climbToSinkRole(node);
    if (!role) return;

    const raw = literalText(node).replace(/\s{2,}/g, " ").trim();
    if (!isCandidateText(raw)) return;
    if (isProseText(raw)) violations.push(raw);
  });

  return violations;
}
