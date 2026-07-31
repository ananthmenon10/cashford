import { beforeEach, describe, expect, it, vi } from "vitest";

const { getUser, rateLimitQuery, insert, from } = vi.hoisted(() => {
  const getUser = vi.fn();
  const rateLimitQuery = vi.fn();
  const insert = vi.fn();
  const from = vi.fn(() => ({
    select: vi.fn(() => ({
      eq: vi.fn(() => ({ gte: rateLimitQuery })),
    })),
    insert,
  }));
  return { getUser, rateLimitQuery, insert, from };
});

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({ auth: { getUser } })),
}));
vi.mock("@/lib/supabase/service", () => ({
  createServiceRoleClient: vi.fn(() => ({ from })),
}));

import {
  isFeedbackRateLimited,
  validateFeedbackMessage,
} from "@/lib/feedback";
import { submitFeedback } from "@/app/feedback/actions";

describe("feedback server action validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
    rateLimitQuery.mockResolvedValue({ count: 0, error: null });
    insert.mockResolvedValue({ error: null });
  });

  it("accepts one through 2,000 characters and rejects empty or overlong messages", () => {
    expect(validateFeedbackMessage("").ok).toBe(false);
    expect(validateFeedbackMessage("   ").ok).toBe(false);
    expect(validateFeedbackMessage("a")).toEqual({ ok: true, message: "a" });
    expect(validateFeedbackMessage("a".repeat(2000)).ok).toBe(true);
    expect(validateFeedbackMessage("a".repeat(2001)).ok).toBe(false);
  });

  it("rejects the eleventh report in the one-hour window before inserting", async () => {
    rateLimitQuery.mockResolvedValue({ count: 11, error: null });

    const result = await submitFeedback({
      message: "The score did not save.",
      pathname: "/leagues/test-league/enter",
    });

    expect(isFeedbackRateLimited(10)).toBe(false);
    expect(isFeedbackRateLimited(11)).toBe(true);
    expect(result).toEqual({
      ok: false,
      error: "Too many reports. Please try again later.",
    });
    expect(insert).not.toHaveBeenCalled();
  });
});
