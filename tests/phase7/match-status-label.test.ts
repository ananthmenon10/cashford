import { describe, expect, it } from "vitest";
import { matchStatusLabel } from "@/lib/contest-state";

describe("matchStatusLabel", () => {
  it("never shows the raw ESPN enum", () => {
    expect(matchStatusLabel("finished", "STATUS_FULL_TIME", 90)).toBe("Full time");
    expect(matchStatusLabel("finished", "STATUS_FINAL_PEN", null)).toBe("Full time · Pens");
    expect(matchStatusLabel("scheduled", "STATUS_SCHEDULED", null)).toBe("Kick-off to come");
    expect(matchStatusLabel("postponed", "STATUS_POSTPONED", null)).toBe("Postponed");
  });
  it("keeps the live minute and frozen break labels", () => {
    expect(matchStatusLabel("live", "STATUS_IN_PROGRESS", 62)).toBe("62' · LIVE");
    expect(matchStatusLabel("live", "STATUS_HALFTIME", 45)).toBe("HT · LIVE");
  });
  it("humanises unknown enum names", () => {
    expect(matchStatusLabel("weird", "STATUS_SOMETHING_NEW", null)).toBe("Something new");
  });
});
