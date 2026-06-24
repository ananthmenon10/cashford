import { describe, it, expect } from "vitest";
import {
  USERNAME_RE,
  normalizeUsername,
  validateUsername,
  validatePassword,
} from "./validation";

describe("USERNAME_RE", () => {
  it("accepts valid usernames", () => {
    expect(USERNAME_RE.test("ab3")).toBe(true);
    expect(USERNAME_RE.test("a_b-c")).toBe(true);
    expect(USERNAME_RE.test("a".repeat(20))).toBe(true);
  });

  it("rejects invalid usernames", () => {
    expect(USERNAME_RE.test("ab")).toBe(false); // too short
    expect(USERNAME_RE.test("a".repeat(21))).toBe(false); // too long
    expect(USERNAME_RE.test("has space")).toBe(false);
    expect(USERNAME_RE.test("has@char")).toBe(false);
    expect(USERNAME_RE.test("HasUpper")).toBe(false); // uppercase not in regex
  });
});

describe("normalizeUsername", () => {
  it("trims and lowercases", () => {
    expect(normalizeUsername("  Alice  ")).toBe("alice");
    expect(normalizeUsername("BOB")).toBe("bob");
  });
});

describe("validateUsername", () => {
  it("returns ok + value for valid usernames", () => {
    const result = validateUsername("ab3");
    expect(result).toEqual({ ok: true, value: "ab3" });
  });

  it("normalizes uppercase to lowercase and passes", () => {
    const result = validateUsername("AbC123");
    expect(result).toEqual({ ok: true, value: "abc123" });
  });

  it("normalizes leading/trailing spaces and passes if valid after trim", () => {
    const result = validateUsername("  abc  ");
    expect(result).toEqual({ ok: true, value: "abc" });
  });

  it("rejects too-short username", () => {
    const result = validateUsername("ab");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/3/);
    }
  });

  it("rejects 21-char username", () => {
    const result = validateUsername("a".repeat(21));
    expect(result.ok).toBe(false);
  });

  it("rejects username with spaces", () => {
    const result = validateUsername("has space");
    expect(result.ok).toBe(false);
  });

  it("rejects username with @", () => {
    const result = validateUsername("user@name");
    expect(result.ok).toBe(false);
  });

  it("accepts exactly 20 chars", () => {
    const result = validateUsername("a".repeat(20));
    expect(result).toEqual({ ok: true, value: "a".repeat(20) });
  });
});

describe("validatePassword", () => {
  it("rejects passwords shorter than 8 chars", () => {
    const result = validatePassword("short");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/8/);
    }
  });

  it("rejects 7-char password", () => {
    const result = validatePassword("1234567");
    expect(result.ok).toBe(false);
  });

  it("accepts exactly 8 chars", () => {
    const result = validatePassword("12345678");
    expect(result).toEqual({ ok: true });
  });

  it("accepts password longer than 8 chars", () => {
    const result = validatePassword("averylongpassword");
    expect(result).toEqual({ ok: true });
  });
});
