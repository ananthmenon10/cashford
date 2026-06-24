import { describe, it, expect } from "vitest";
import { generateToken, generateShortCode } from "./invite";

const CROCKFORD_ALPHABET = new Set("0123456789ABCDEFGHJKMNPQRSTVWXYZ");
const URL_SAFE_RE = /^[A-Za-z0-9_-]+$/;

describe("generateToken", () => {
  it("is URL-safe (base64url alphabet only)", () => {
    for (let i = 0; i < 20; i++) {
      expect(generateToken()).toMatch(URL_SAFE_RE);
    }
  });

  it("is at least 22 characters long", () => {
    for (let i = 0; i < 20; i++) {
      expect(generateToken().length).toBeGreaterThanOrEqual(22);
    }
  });

  it("generates distinct values", () => {
    const tokens = new Set(Array.from({ length: 100 }, generateToken));
    expect(tokens.size).toBe(100);
  });
});

describe("generateShortCode", () => {
  it("is exactly 8 characters", () => {
    for (let i = 0; i < 20; i++) {
      expect(generateShortCode()).toHaveLength(8);
    }
  });

  it("uses only Crockford base32 alphabet chars", () => {
    for (let i = 0; i < 20; i++) {
      const code = generateShortCode();
      for (const ch of code) {
        expect(CROCKFORD_ALPHABET.has(ch)).toBe(true);
      }
    }
  });

  it("does not contain ambiguous chars I, L, O, U", () => {
    for (let i = 0; i < 50; i++) {
      const code = generateShortCode();
      expect(code).not.toMatch(/[ILOU]/);
    }
  });

  it("1000 generated codes have no collisions", () => {
    const codes = new Set(Array.from({ length: 1000 }, generateShortCode));
    // With 32^8 ≈ 1.1×10^12 space, collisions in 1000 draws are astronomically unlikely.
    expect(codes.size).toBe(1000);
  });
});
