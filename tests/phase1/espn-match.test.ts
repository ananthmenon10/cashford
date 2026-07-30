// Phase 1 — lib/espn-match.ts matching rule (pure decision only). Plan §5.
// Cases: docs/testing/phase1-cases.md P1-U16–U20.
// DB-side effects (upsert team_provider_ids, never-overwrite external_id) are persistence
// cases P1-P25–P31, not covered here.
import { describe, expect, it } from "vitest";
import { matchFixture } from "../../lib/espn-match";

const HOME = "arsenal";
const AWAY = "chelsea";
const KICKOFF = "2026-09-19T14:00:00Z";
const SEASON = "2026-27";

function candidate(overrides: Partial<{ id: string; homeKey: string; awayKey: string; kickoffAt: string; season: string }> = {}) {
  return {
    id: "espn-1",
    homeKey: HOME,
    awayKey: AWAY,
    kickoffAt: KICKOFF,
    season: SEASON,
    ...overrides,
  };
}
const target = { teamHKey: HOME, teamAKey: AWAY, kickoffAt: KICKOFF, season: SEASON };

describe("matchFixture (§5)", () => {
  it("P1-U16: exactly one candidate matching teams (ordered) + kickoff window + season → matched", () => {
    const result = matchFixture([candidate()], target);
    expect(result.status).toBe("matched");
    if (result.status === "matched") expect(result.externalId).toBe("espn-1");
  });

  it("P1-U16b: a kickoff within ±3h of the target still matches", () => {
    const twoHoursLater = new Date(new Date(KICKOFF).getTime() + 2 * 3600e3).toISOString();
    const result = matchFixture([candidate({ kickoffAt: twoHoursLater })], target);
    expect(result.status).toBe("matched");
  });

  it("P1-U17: same two teams but home/away reversed is NOT a match — the rule is ordered", () => {
    const reversed = candidate({ homeKey: AWAY, awayKey: HOME });
    const result = matchFixture([reversed], target);
    expect(result.status).not.toBe("matched");
  });

  it("P1-U18: two candidates both satisfying the rule → multiple, never picks one arbitrarily", () => {
    const result = matchFixture([candidate({ id: "espn-1" }), candidate({ id: "espn-2" })], target);
    expect(result).toEqual({ status: "multiple", count: 2 });
  });

  it("P1-U19a: zero candidates when kickoff is 4h outside the ±3h window", () => {
    const fourHoursLater = new Date(new Date(KICKOFF).getTime() + 4 * 3600e3).toISOString();
    const result = matchFixture([candidate({ kickoffAt: fourHoursLater })], target);
    expect(result).toEqual({ status: "zero" });
  });

  it("P1-U19b: zero candidates when the season doesn't match", () => {
    const result = matchFixture([candidate({ season: "2025-26" })], target);
    expect(result).toEqual({ status: "zero" });
  });

  it("P1-U20: candidates spanning multiple fetched pages are all considered — a page-2/3-only match is not truncated", () => {
    const page1 = Array.from({ length: 100 }, (_, i) => candidate({ id: `filler-${i}`, homeKey: "team-x", awayKey: "team-y" }));
    const page2 = Array.from({ length: 100 }, (_, i) => candidate({ id: `filler2-${i}`, homeKey: "team-x", awayKey: "team-y" }));
    const page3RealMatch = candidate({ id: "espn-real" });
    const merged = [...page1, ...page2, page3RealMatch];
    const result = matchFixture(merged, target);
    expect(result.status).toBe("matched");
    if (result.status === "matched") expect(result.externalId).toBe("espn-real");
  });
});
