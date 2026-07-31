// Phase 3 — U35 server-side IST formatting (lib/ist.ts). Blind from §10.
// Case: T-U7 — formats a known instant to the expected IST string across a full year (covering
// the no-DST edge: IST has no daylight-saving, so every month should format with the same
// fixed UTC+5:30 offset).
//
// Canonical export per the fix round: `formatIstDeadline` (there's also `formatIstCompact`,
// untested here — it's not named by U2/C2's absolute-deadline format, which is all T-U7 covers).
import { describe, expect, it } from "vitest";
import { formatIstDeadline } from "../../lib/ist";

describe("formatIstDeadline — Intl en-IN / Asia/Kolkata, no runtime color math equivalent for time", () => {
  const instants = [
    "2026-01-15T10:30:00.000Z", // Jan
    "2026-03-15T10:30:00.000Z", // Mar
    "2026-06-15T10:30:00.000Z", // Jun — where US/EU DST would differ; IST must not
    "2026-09-15T10:30:00.000Z", // Sep
    "2026-12-15T10:30:00.000Z", // Dec
  ];

  it("formats every month of the year without throwing and returns a non-empty string", () => {
    for (const iso of instants) {
      const out = formatIstDeadline(iso);
      expect(typeof out).toBe("string");
      expect(out.length).toBeGreaterThan(0);
    }
  });

  it("IST is UTC+5:30 year-round — 10:30 UTC is always 16:00 (4:00 pm) IST, no DST drift", () => {
    for (const iso of instants) {
      const out = formatIstDeadline(iso);
      expect(out).toMatch(/4:00\s*pm|16:00/i);
    }
  });

  it("a known instant matches the mockup's literal format family (C2: 'Sat 3 Feb, 4:00 pm IST')", () => {
    const out = formatIstDeadline("2026-02-03T10:30:00.000Z");
    expect(out).toContain("Feb");
    expect(out).toMatch(/pm/i);
  });
});
