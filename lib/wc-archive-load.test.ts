import { describe, expect, it } from "vitest";
import { resolveWcTransition, sortWcArchiveMatchRows } from "./wc-archive-load";
import { pickCurrentSeasonCompetition, pickLiveCompetitionLink } from "./wc-live-competition";

// Step 7B item 2/8 — this is the function the archive page, the manage page, and the home
// LeagueCard all actually call (lib/transition.ts's transitionState() has no caller of its own
// otherwise). Testing it here, wired to the {pl, participationStatus, otherActiveCompetition}
// shape the loaders build, exercises the real integration point instead of re-testing the pure
// state machine in isolation.
describe("resolveWcTransition", () => {
  it("is preparing when there is no league-format competition yet", () => {
    expect(resolveWcTransition({ pl: null, participationStatus: "none", otherActiveCompetition: false, leagueStatus: "active" }, true))
      .toBe("preparing");
  });

  it("offers the captain the adopt CTA when the competition is active and unjoined", () => {
    expect(resolveWcTransition({ pl: { status: "active" }, participationStatus: "none", otherActiveCompetition: false, leagueStatus: "active" }, true))
      .toBe("captain_adopt");
  });

  it("shows a non-captain the waiting state instead of a CTA", () => {
    expect(resolveWcTransition({ pl: { status: "active" }, participationStatus: "none", otherActiveCompetition: false, leagueStatus: "active" }, false))
      .toBe("member_waiting");
  });

  it("is adopted once the league has joined, regardless of role", () => {
    expect(resolveWcTransition({ pl: { status: "active" }, participationStatus: "active", otherActiveCompetition: false, leagueStatus: "active" }, false))
      .toBe("adopted");
  });

  it("is blocked when another competition is already active for the league", () => {
    expect(resolveWcTransition({ pl: { status: "active" }, participationStatus: "none", otherActiveCompetition: true, leagueStatus: "active" }, true))
      .toBe("blocked");
  });

  it("is archived when the competition itself is archived", () => {
    expect(resolveWcTransition({ pl: { status: "archived" }, participationStatus: "none", otherActiveCompetition: false, leagueStatus: "active" }, true))
      .toBe("archived");
  });

  // Dual-review fix (Blocker 2 / R2 F1): a league that archived its OWN participation in the
  // current-season competition must read as "archived", never "captain_adopt" — even though
  // the competition row itself is still globally active (competitionStatus: "active"). This is
  // exactly the real-data bug: a league with an archived pl-2026-27 participation and an
  // active zzp1-mock-pl participation must not be offered pl-2026-27 to (re-)adopt.
  it("is archived when the league's own participation is archived, even though the competition itself is still active", () => {
    expect(resolveWcTransition({ pl: { status: "active" }, participationStatus: "archived", otherActiveCompetition: true, leagueStatus: "active" }, true))
      .toBe("archived");
  });

  // Micro-round fix (D1): an archived LEAGUE must never offer captain_adopt, even when the
  // competition is active and the league never joined it — this is the "archived league, dead
  // CTA" bug both reviewers converged on. Checked ahead of the participation check.
  it("is archived when the league itself is archived, even with an active unjoined competition", () => {
    expect(resolveWcTransition({ pl: { status: "active" }, participationStatus: "none", otherActiveCompetition: false, leagueStatus: "archived" }, true))
      .toBe("archived");
  });
});

describe("sortWcArchiveMatchRows", () => {
  it("sorts an unsorted archive match list by kickoff ascending", () => {
    const rows = [
      { id: "contest-late", status: "settled", stake_inr: 100, fixtures: { id: "fixture-late", kickoff_at: "2026-08-15T15:00:00.000Z", external_id: 20 } },
      { id: "contest-early", status: "settled", stake_inr: 100, fixtures: { id: "fixture-early", kickoff_at: "2026-08-15T13:00:00.000Z", external_id: 10 } },
    ];

    expect(sortWcArchiveMatchRows(rows).map((row) => row.id)).toEqual([
      "contest-early",
      "contest-late",
    ]);
  });

  it("uses the fixture id as the string tie-break when external ids are absent", () => {
    const kickoffAt = "2026-08-15T13:00:00.000Z";
    const rows = [
      { id: "contest-a", status: "settled", stake_inr: 100, fixtures: { id: "fixture-z", kickoff_at: kickoffAt, external_id: null } },
      { id: "contest-z", status: "settled", stake_inr: 100, fixtures: { id: "fixture-a", kickoff_at: kickoffAt, external_id: null } },
    ];

    expect(sortWcArchiveMatchRows(rows).map((row) => row.id)).toEqual([
      "contest-z",
      "contest-a",
    ]);
  });
});

// Dual-review fix (Blocker 1): the adopt target must never be resolved by "globally newest
// active league-format competition" — that picks up a later-created QA mock over the real
// competition. It must be resolved by an explicit is_current_season flag, with no ordering
// fallback.
describe("pickCurrentSeasonCompetition", () => {
  it("picks the is_current_season-flagged competition regardless of creation order", () => {
    const older = { id: "real", slug: "pl-2026-27", created_at: "2026-07-27", is_current_season: true };
    const newer = { id: "mock", slug: "zzp1-mock-pl", created_at: "2026-08-05", is_current_season: false };
    expect(pickCurrentSeasonCompetition([newer, older])?.id).toBe("real");
    expect(pickCurrentSeasonCompetition([older, newer])?.id).toBe("real");
  });

  it("offers nothing when no competition is flagged is_current_season", () => {
    const a = { id: "a", created_at: "2026-07-27", is_current_season: false };
    const b = { id: "b", created_at: "2026-08-05", is_current_season: false };
    expect(pickCurrentSeasonCompetition([a, b])).toBeNull();
  });
});

// QC catch: the banner's exit link is "one exit to the league's own live season" — not
// necessarily the flagged current-season competition. ZZ-P1 has an archived participation in
// the current-season competition (pl-2026-27) and an ACTIVE participation in a different one
// (zzp1-mock-pl); the exit link must point at zzp1-mock-pl, not disappear.
describe("pickLiveCompetitionLink", () => {
  const currentSeason = { id: "real", slug: "pl-2026-27", name: "Premier League 2026-27" };
  const otherActive = { id: "mock", slug: "zzp1-mock-pl", name: "ZZ Mock Premier League" };

  it("own active current-season participation wins (the real-league post-adoption case)", () => {
    expect(pickLiveCompetitionLink("kk-bois", currentSeason, true, otherActive)).toEqual({
      id: "real",
      slug: "pl-2026-27",
      name: "Premier League 2026-27",
      href: "/leagues/kk-bois",
    });
  });

  it("falls back to the other active participation when the current-season one isn't active for this league", () => {
    expect(pickLiveCompetitionLink("zz-p1-test-league", currentSeason, false, otherActive)).toEqual({
      id: "mock",
      slug: "zzp1-mock-pl",
      name: "ZZ Mock Premier League",
      href: "/leagues/zz-p1-test-league",
    });
  });

  it("is null when neither participation is active", () => {
    expect(pickLiveCompetitionLink("kk-bois", currentSeason, false, null)).toBeNull();
  });
});
