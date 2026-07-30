// Phase 3 — R4-9: safeReturnPath regression set. MINOR-2 moved this helper out of the
// "use server" login action into lib/safe-return-path.ts (a plain module) so the server-actions
// file exports only real actions; MINOR-1 changed its safe-path return value from the raw input
// string to the URL-normalized pathname+search+hash. This file pins both: the open-redirect guard
// itself (SEC-1 — only a same-origin, leading-slash path may be returned; anything else falls back
// to "/") and the normalization (a safe path is never echoed back verbatim).
import { describe, expect, it } from "vitest";
import { safeReturnPath } from "../../lib/safe-return-path";

describe("R4-9 — safeReturnPath: normalization (MINOR-1)", () => {
  it("a safe local path with query and hash returns the normalized pathname+search+hash, not the raw string", () => {
    expect(safeReturnPath("/leagues/kk-bois/enter?gw=24#top")).toBe(
      "/leagues/kk-bois/enter?gw=24#top",
    );
  });

  it("a safe path with a dot-segment is returned via its resolved pathname, not echoed raw — pinning that the function returns the PARSED path, not `raw` itself", () => {
    expect(safeReturnPath("/leagues/../login")).toBe("/login");
  });

  it("leading/trailing whitespace on an otherwise-safe path is trimmed before parsing", () => {
    expect(safeReturnPath("  /leagues/kk-bois  ")).toBe("/leagues/kk-bois");
  });
});

describe("R4-9 — safeReturnPath: open-redirect bypass regression set (SEC-1)", () => {
  it("a protocol-relative URL (//evil.com) is rejected — it does not start with a single '/' followed by a non-slash", () => {
    expect(safeReturnPath("//evil.com")).toBe("/");
  });

  it("a protocol-relative URL with a path (//evil.com/phish) is rejected", () => {
    expect(safeReturnPath("//evil.com/phish")).toBe("/");
  });

  it("an absolute http URL is rejected outright (does not start with '/')", () => {
    expect(safeReturnPath("http://evil.com")).toBe("/");
  });

  it("an absolute https URL disguised with a leading slash-like character is rejected", () => {
    expect(safeReturnPath("https://evil.com/leagues/kk-bois")).toBe("/");
  });

  it("a backslash bypass (/\\evil.com) is rejected — a backslash is treated as a path separator for a special scheme, so this resolves to the evil.com host, not a local path", () => {
    // Browsers historically treat backslashes as forward slashes in a URL; `/\evil.com` reads as
    // `//evil.com` (protocol-relative) even though it starts with a single '/'.
    expect(safeReturnPath("/\\evil.com")).toBe("/");
  });

  it("a leading tab character before the path is trimmed like ordinary whitespace, not treated as part of the bypass surface", () => {
    // `trim()` strips edge whitespace (including tab) before the leading-slash check runs, so a
    // stray tab pasted in front of an otherwise-safe path does not cause a false rejection.
    expect(safeReturnPath("\t/leagues/kk-bois")).toBe("/leagues/kk-bois");
  });

  it("embedded control characters (tab, LF, CR) inside an otherwise same-origin-looking path are rejected", () => {
    // `/\t/evil.com`, `/\n/evil.com`, `/\r/evil.com` — WHATWG URL parsing strips ASCII tab/LF/CR
    // from anywhere in the input before parsing, which is exactly the class of trick that can
    // make `/\t\evil.com` parse as `/\evil.com` (the backslash bypass above) if the leading-slash
    // check ran on the raw string instead of the parsed result. Each must land on the safe "/"
    // fallback or resolve to a same-origin path — never a foreign origin.
    for (const raw of ["/\t/evil.com", "/\n/evil.com", "/\r/evil.com", "/\t\\evil.com"]) {
      const result = safeReturnPath(raw);
      expect(result === "/" || result.startsWith("/")).toBe(true);
      expect(result).not.toContain("evil.com");
    }
  });

  it("mixed-case scheme tricks (jAvAsCrIpT:, HTTP://) are rejected because they don't start with '/' at all", () => {
    expect(safeReturnPath("javascript:alert(1)")).toBe("/");
    expect(safeReturnPath("JAVASCRIPT:alert(1)")).toBe("/");
    expect(safeReturnPath("HTTP://evil.com")).toBe("/");
  });

  it("a fullwidth-Unicode homoglyph slash (U+FF0F) does not satisfy the leading-slash gate", () => {
    // "／" (fullwidth solidus) looks like '/' but is a distinct code point; `raw.startsWith("/")`
    // must not be tricked by a lookalike character.
    expect(safeReturnPath("／evil.com")).toBe("/");
  });

  it("an overlong same-origin path does not crash the helper and is not rejected merely for its length", () => {
    // The try/catch exists to guard the (rare) case a leading-slash string still fails URL
    // parsing; an overlong-but-well-formed path is not that case — it must resolve normally
    // rather than throwing out of the helper or being penalized just for being long.
    const overlong = "/" + "a".repeat(5000);
    expect(safeReturnPath(overlong)).toBe(overlong);
  });

  it("an empty string and a bare '/' both resolve to '/'", () => {
    expect(safeReturnPath("")).toBe("/");
    expect(safeReturnPath("/")).toBe("/");
  });

  it("a path without a leading slash is rejected even if it looks like a relative route", () => {
    expect(safeReturnPath("leagues/kk-bois")).toBe("/");
  });
});
