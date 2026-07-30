// Phase 3 — §1 U1: resolveLeagueParticipation, lib/gw-participation.ts. Blind from §1, T-U36.
// Both the function name and its file are given verbatim in the plan text (§1.1 lists
// "lib/gw-participation.ts  resolveLeagueParticipation (U1)"), so this is not a naming guess.
//
// Canonical per the fix round: ONE array argument (no leagueId — the caller already scopes the
// query by league before calling this), and each row is the real `LeagueParticipationRow` shape:
// snake_case `competition_id`/`joined_at`/`status`, with a nested `competitions` object/array
// carrying `format`/`name`/`slug`. `row()` below builds that real shape from a flat convenience
// input so each test case still reads as one intent.
import { describe, expect, it } from "vitest";
import { resolveLeagueParticipation, type LeagueParticipationRow } from "../../lib/gw-participation";

function row(overrides: {
  status?: "active" | "archived";
  format?: "cup" | "league" | "gameweek";
  competitionId?: string;
  joinedAt?: string;
} = {}): LeagueParticipationRow {
  const { status = "active", format = "gameweek", competitionId = "c1", joinedAt = "2026-01-01" } = overrides;
  return {
    competition_id: competitionId,
    status,
    joined_at: joinedAt,
    competitions: { id: competitionId, name: competitionId, slug: competitionId, format, status: "active" },
  };
}

describe("resolveLeagueParticipation — T-U36 precedence", () => {
  it("active-PL: an active league_competitions row wins, format 'gameweek'", () => {
    const r = resolveLeagueParticipation([row({ status: "active", format: "gameweek" })]);
    expect(r.format).toBe("gameweek");
  });

  it("archived-WC-only: no active row, falls back to the most recently joined archived row", () => {
    const r = resolveLeagueParticipation([row({ status: "archived", format: "cup", joinedAt: "2022-01-01" })]);
    expect(r.format).toBe("cup");
  });

  it("both present: active row wins over an archived row regardless of join date", () => {
    const r = resolveLeagueParticipation([
      row({ status: "archived", format: "cup", joinedAt: "2026-06-01" }),
      row({ status: "active", format: "gameweek", joinedAt: "2022-01-01" }),
    ]);
    expect(r.format).toBe("gameweek");
  });

  it("multiple archived rows: the most recently joined one is used", () => {
    const r = resolveLeagueParticipation([
      row({ status: "archived", format: "cup", competitionId: "old", joinedAt: "2022-01-01" }),
      row({ status: "archived", format: "cup", competitionId: "new", joinedAt: "2026-01-01" }),
    ]);
    expect(r.competitionId).toBe("new");
  });

  it("none: no row at all renders the empty-league state (C70), not an error", () => {
    const r = resolveLeagueParticipation([]);
    expect(r.format).toBe("none");
  });

  it("at most one active row is possible (partial unique index) — a second active row is not a case this function needs to arbitrate, but must not throw if seen", () => {
    expect(() =>
      resolveLeagueParticipation([
        row({ status: "active", format: "gameweek", competitionId: "a" }),
        row({ status: "active", format: "cup", competitionId: "b" }),
      ]),
    ).not.toThrow();
  });
});
