import { describe, expect, it } from "vitest";
import { selectXg, type ProviderXgRow } from "../../lib/xg-select";

const kickoff = "2026-02-03T15:00:00.000Z";
const now = new Date("2026-02-03T18:00:00.000Z");
const row = (
  provider: "fotmob" | "understat",
  home: number | null,
  away: number | null,
  fetchedAt = "2026-02-03T17:00:00.000Z",
): ProviderXgRow => ({
  provider,
  xg_home: home,
  xg_away: away,
  xg_model: `${provider}-2026`,
  xg_fetched_at: fetchedAt,
  xg_ok: true,
  fixtureKickoffAt: kickoff,
});

describe("xG precedence", () => {
  it("prefers fresh FotMob then falls back to Understat", () => {
    expect(
      selectXg([row("understat", 1.5, 1.1), row("fotmob", 1.8, 0.9)], now)
        ?.provider,
    ).toBe("FotMob");
    expect(selectXg([row("understat", 1.5, 1.1)], now)?.provider).toBe(
      "Understat",
    );
  });

  it("rejects a partial row", () => {
    expect(selectXg([row("fotmob", 1.8, null)], now)).toBeUndefined();
  });

  it("a stale FotMob row (fetched before kickoff) loses to a valid Understat row", () => {
    const result = selectXg(
      [
        row("fotmob", 1.8, 0.9, "2026-02-03T14:59:59.000Z"),
        row("understat", 1.5, 1.1),
      ],
      now,
    );
    expect(result?.provider).toBe("Understat");
    expect(result?.home).toBe(1.5);
    expect(result?.away).toBe(1.1);
  });

  it("returns undefined when nothing valid is available", () => {
    expect(
      selectXg(
        [
          row("fotmob", 1.8, 0.9, "2026-02-03T14:59:59.000Z"),
          row("understat", null, null),
        ],
        now,
      ),
    ).toBeUndefined();
  });
});
