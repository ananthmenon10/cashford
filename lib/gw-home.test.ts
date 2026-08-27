import { describe, expect, it } from "vitest";
import {
  analyticsViewHasHistory,
  analyticsVisibleForHomeCards,
  buildHomeLeagueCard,
  gwNavigatorTargets,
  homeCardsForScope,
  homeCompetitionScopes,
  homeScopeChipsVisible,
  resolveHomeEntryStatus,
  resolveHomeLeagueCardState,
  type HomeLeagueCard,
  type HomeLeagueCardInput,
} from "./gw-home";
import {
  C10,
  C14,
  C26,
  C45,
  C46,
  C47,
  C58,
  C59,
  C60,
  C66,
  C72,
  LEAGUE_CARD_COPY,
} from "./gw-copy";

const stateInput = {
  format: "gameweek" as const,
  archived: false,
  lifecycle: "CL1" as const,
  viewerParticipation: "VP1" as const,
  viewerNetInr: null,
  secondary: [],
  pendingPaymentCount: 0,
  liveMatchCount: 0,
};

const cardInput: HomeLeagueCardInput = {
  leagueId: "league-1",
  leagueName: "KK Bois",
  slug: "kk-bois",
  competitionName: "Premier League 2026-27",
  competitionSlug: "pl-2026-27",
  format: "gameweek",
  archived: false,
  lifecycle: "CL1",
  viewerParticipation: "VP1",
  gameweekNumber: 4,
  deadlineAt: "2026-08-17T13:42:00.000Z",
  upcomingAt: null,
  potInr: 900,
  enteredCount: 7,
  eligibleCount: 9,
  viewerRank: null,
  viewerNetInr: null,
  secondary: [],
  pendingPaymentCount: 0,
  netInr: 340,
  hasSettledHistory: false,
  liveMatchCount: 0,
};

function buildCard(overrides: Partial<HomeLeagueCardInput> = {}) {
  return buildHomeLeagueCard({ ...cardInput, ...overrides });
}

describe("resolveHomeLeagueCardState", () => {
  it("maps S1 open and not entered to the open action state", () => {
    expect(resolveHomeLeagueCardState(stateInput)).toBe("S1");
  });

  it("maps S2 open and entered to the edit state", () => {
    expect(resolveHomeLeagueCardState({ ...stateInput, viewerParticipation: "VP2" })).toBe("S2");
  });

  it("maps S3 locked with live matches to the live state", () => {
    expect(resolveHomeLeagueCardState({ ...stateInput, lifecycle: "CL3", viewerParticipation: "VP4", liveMatchCount: 3 })).toBe("S3");
  });

  it("does not call a matchday live when CL3 has no live matches", () => {
    expect(resolveHomeLeagueCardState({ ...stateInput, lifecycle: "CL3", viewerParticipation: "VP4", liveMatchCount: 0 })).toBe("OTHER");
  });

  it("keeps all-final CL4 out of the live state", () => {
    expect(resolveHomeLeagueCardState({ ...stateInput, lifecycle: "CL4", viewerParticipation: "VP4" })).toBe("OTHER");
  });

  it("maps S4 settled with a positive viewer result to the won state", () => {
    expect(resolveHomeLeagueCardState({ ...stateInput, lifecycle: "CL5", viewerParticipation: "VP4", viewerNetInr: 450 })).toBe("S4");
  });

  it("maps S5 settled with a negative viewer result to the lost state", () => {
    expect(resolveHomeLeagueCardState({ ...stateInput, lifecycle: "CL5", viewerParticipation: "VP4", viewerNetInr: -100 })).toBe("S5");
  });

  it("maps S6 settled history plus an open gameweek to the open state with a settled fact", () => {
    expect(resolveHomeLeagueCardState({
      ...stateInput,
      secondary: [{ gameweekNumber: 3, kind: "settled", viewerRank: 2, viewerNetInr: 450, liveMatchCount: 0 }],
    })).toBe("S6");
  });

  it("maps S7 live history plus an open gameweek to the open state with a live fact", () => {
    expect(resolveHomeLeagueCardState({
      ...stateInput,
      secondary: [{ gameweekNumber: 3, kind: "live", viewerRank: 4, viewerNetInr: null, liveMatchCount: 3 }],
    })).toBe("S7");
  });

  it("keeps a pending payment additive to the not-entered state", () => {
    expect(resolveHomeLeagueCardState({ ...stateInput, pendingPaymentCount: 1 })).toBe("S1");
  });

  it("maps an archived league to the read-only S9 state", () => {
    expect(resolveHomeLeagueCardState({ ...stateInput, archived: true, lifecycle: "CL0", viewerParticipation: "VP0" })).toBe("S9");
  });

  it("maps a first gameweek with no active contest to S10", () => {
    expect(resolveHomeLeagueCardState({ ...stateInput, lifecycle: "CL0", viewerParticipation: "VP1" })).toBe("S10");
  });
});

describe("buildHomeLeagueCard", () => {
  it("renders CL2 as locked and awaiting results", () => {
    const card = buildCard({ lifecycle: "CL2", viewerParticipation: "VP4" });

    expect(card.state).toBe("OTHER");
    expect(card.badge).toBe(LEAGUE_CARD_COPY.lockedBadge);
    expect(card.primary.title).toBe(C10(4));
    expect(card.primary.detail).toBe(C58(4));
    expect(card.secondary).toBeUndefined();
  });

  it("renders CL4 as points final while the pot is being worked out", () => {
    const card = buildCard({
      lifecycle: "CL4",
      viewerParticipation: "VP4",
      finalMatchCount: 10,
      totalMatchCount: 10,
    });

    expect(card.state).toBe("OTHER");
    expect(card.badge).toBe(LEAGUE_CARD_COPY.lockedBadge);
    expect(card.tone).toBe("neutral");
    expect(card.primary.title).toBe(C59);
    expect(card.primary.detail).toBe(C14(10, 10));
    expect(card.primary.title).not.toContain("Live");
  });

  it("keeps an unrelated lifecycle fallback visible without a live or archive action", () => {
    const card = buildCard({ lifecycle: "CL6", viewerParticipation: "VP4" });

    expect(card.state).toBe("OTHER");
    expect(card.badge).toBe("RECALCULATING");
    expect(card.primary.detail).toBe(C60);
    expect(card.primary.action).toBeUndefined();
    expect(card.secondary).toBeUndefined();
  });

  it("surfaces needs-update as an action-needed card instead of a healthy edit card", () => {
    const card = buildCard({ lifecycle: "CL1", viewerParticipation: "VP3" });

    expect(card.state).toBe("OTHER");
    expect(card.badge).toBe(LEAGUE_CARD_COPY.actionNeededBadge);
    expect(card.primary.title).toBe(C45(4));
    expect(card.primary.detail).toBe(C46);
    expect(card.primary.action?.label).toBe(C47);
    expect(card.primary.action?.href).toBe("/leagues/kk-bois/enter?gw=4");
    expect(card.primary.title).not.toContain("Edit GW4");
  });

  it("does not offer entry to an ineligible viewer or edit to an invalid entry", () => {
    const ineligible = buildCard({ lifecycle: "CL1", viewerParticipation: "VP0" });
    const invalid = buildCard({ lifecycle: "CL1", viewerParticipation: "VP5" });

    expect(ineligible.primary.action).toBeUndefined();
    expect(ineligible.badge).toBe(LEAGUE_CARD_COPY.openBadge);
    expect(invalid.primary.action).toBeUndefined();
    expect(invalid.badge).toBe(LEAGUE_CARD_COPY.actionNeededBadge);
    expect(invalid.primary.title).not.toContain("Edit GW4");
  });

  it("adds the dues chip to a live card without replacing its live state or position", () => {
    const card = buildCard({
      lifecycle: "CL3",
      viewerParticipation: "VP4",
      viewerRank: 4,
      pendingPaymentCount: 1,
      liveMatchCount: 3,
    });

    expect(card.state).toBe("S3");
    expect(card.badge).toBe(LEAGUE_CARD_COPY.liveBadge);
    expect(card.primary.title).toBe(LEAGUE_CARD_COPY.liveGameweek(3));
    expect(card.rail.position).toBe("#4");
    expect(card.duesLabel).toBe(LEAGUE_CARD_COPY.duesChip(1));
  });

  it("keeps an entered open card intact when dues are pending", () => {
    const card = buildCard({
      lifecycle: "CL1",
      viewerParticipation: "VP2",
      viewerRank: 4,
      pendingPaymentCount: 1,
    });

    expect(card.state).toBe("S2");
    expect(card.primary.title).toBe(LEAGUE_CARD_COPY.editGameweek(4));
    expect(card.primary.action?.label).toBe(LEAGUE_CARD_COPY.editPredictions);
    expect(card.rail.position).toBe("#4");
    expect(card.duesLabel).toBe(LEAGUE_CARD_COPY.duesChip(1));
  });

  it("renders S6 for an entered viewer with the edit primary, not the enter one", () => {
    const card = buildCard({
      lifecycle: "CL1",
      viewerParticipation: "VP2",
      viewerRank: 4,
      secondary: [{ gameweekNumber: 3, kind: "settled", viewerRank: 2, viewerNetInr: 450, liveMatchCount: 0 }],
    });

    expect(card.state).toBe("S6");
    expect(card.badge).toBe(LEAGUE_CARD_COPY.enteredBadge);
    expect(card.primary.title).toBe(LEAGUE_CARD_COPY.editGameweek(4));
    expect(card.primary.action?.label).toBe(LEAGUE_CARD_COPY.editPredictions);
    expect(card.secondary).toBeDefined();
  });

  it("keeps the enter primary on S6 for a viewer who has not entered", () => {
    const card = buildCard({
      lifecycle: "CL1",
      viewerParticipation: "VP1",
      secondary: [{ gameweekNumber: 3, kind: "settled", viewerRank: 2, viewerNetInr: 450, liveMatchCount: 0 }],
    });

    expect(card.state).toBe("S6");
    expect(card.badge).toBe(LEAGUE_CARD_COPY.openBadge);
    expect(card.primary.title).toBe(LEAGUE_CARD_COPY.enterGameweek(4));
    expect(card.primary.action?.label).toBe(LEAGUE_CARD_COPY.makePredictions);
  });

  it("does not render a zero settled net as a loss", () => {
    const card = buildCard({ lifecycle: "CL5", viewerParticipation: "VP4", viewerNetInr: 0 });

    expect(card.state).toBe("OTHER");
    expect(card.primary.detail).toBe(LEAGUE_CARD_COPY.breakEvenDetail);
    expect(card.primary.detail).not.toContain("lost");
    expect(card.primary.detail).not.toContain("₹0");
  });

  it("uses sat-out copy when a settled viewer has no net result", () => {
    const card = buildCard({ lifecycle: "CL5", viewerParticipation: "VP1", viewerNetInr: null });

    expect(card.state).toBe("OTHER");
    expect(card.primary.detail).toBe(C66);
    expect(card.primary.detail).not.toContain("lost");
    expect(card.primary.detail).not.toContain("₹0");
  });

  it("uses the canonical void copy for CL7 and CL10", () => {
    const voidCard = buildCard({ lifecycle: "CL7", viewerParticipation: "VP4" });
    const allVoidCard = buildCard({ lifecycle: "CL10", viewerParticipation: "VP4" });

    expect(voidCard.badge).toBe(LEAGUE_CARD_COPY.voidBadge);
    expect(voidCard.primary.title).toBe(C26(4));
    expect(allVoidCard.badge).toBe(LEAGUE_CARD_COPY.voidBadge);
    expect(allVoidCard.primary.title).toBe(C72);
  });

  it("keeps the settled result amount available for strong emphasis", () => {
    const card = buildCard({ lifecycle: "CL5", viewerParticipation: "VP4", viewerNetInr: 450 });

    expect(card.state).toBe("S4");
    expect(card.primary.detail).toMatchObject({
      prefix: "You won ",
      amount: "₹450",
      suffix: " · result posted",
    });
  });
});

describe("analyticsVisibleForHomeCards", () => {
  it("shows for any card with settled history, regardless of competition format", () => {
    expect(
      analyticsVisibleForHomeCards([
        { hasSettledHistory: false },
        { hasSettledHistory: false },
      ]),
    ).toBe(false);
    expect(
      analyticsVisibleForHomeCards([
        { hasSettledHistory: true },
      ]),
    ).toBe(true);
  });

  it("recognizes archived history from the existing analytics view", () => {
    expect(
      analyticsViewHasHistory({
        global: { acc: { graded: 0 }, pot: { entered: 0 } },
      } as never),
    ).toBe(false);
    expect(
      analyticsViewHasHistory({
        global: { acc: { graded: 1 }, pot: { entered: 0 } },
      } as never),
    ).toBe(false);
    expect(
      analyticsViewHasHistory({
        global: { acc: { graded: 0 }, pot: { entered: 1 } },
      } as never),
    ).toBe(true);
  });
});

// ── Step 6A: home hub — scope chips, GW navigator, entry-status copy ────────────────

function scopeCard(overrides: Partial<HomeLeagueCard> = {}): HomeLeagueCard {
  return {
    leagueId: "l1",
    leagueName: "League",
    slug: "league",
    competitionName: "Premier League",
    competitionSlug: "pl",
    gameweekNumber: 4,
    allGameweekNumbers: [1, 2, 3, 4, 5],
    format: "gameweek",
    archived: false,
    state: "OTHER",
    tone: "neutral",
    badge: "",
    primary: { kicker: "", title: "", countdown: false },
    rail: { net: "₹0", netTone: "neutral", positionLabel: "", position: "—", positionTone: "muted" },
    context: [],
    netInr: 0,
    hasSettledHistory: false,
    pendingPaymentCount: 0,
    entryStatus: null,
    ...overrides,
  };
}

describe("homeCompetitionScopes / homeScopeChipsVisible", () => {
  it("hides scope chips when every league is in the same competition", () => {
    const cards = [scopeCard(), scopeCard({ leagueId: "l2", competitionSlug: "pl" })];
    expect(homeScopeChipsVisible(cards)).toBe(false);
    expect(homeCompetitionScopes(cards)).toEqual([
      { competitionSlug: "pl", competitionName: "Premier League", gameweekNumber: 4 },
    ]);
  });

  it("shows scope chips once leagues span more than one competition", () => {
    const cards = [
      scopeCard(),
      scopeCard({ leagueId: "l2", competitionSlug: "laliga", competitionName: "LaLiga", gameweekNumber: 3 }),
    ];
    expect(homeScopeChipsVisible(cards)).toBe(true);
    expect(homeCompetitionScopes(cards)).toEqual([
      { competitionSlug: "pl", competitionName: "Premier League", gameweekNumber: 4 },
      { competitionSlug: "laliga", competitionName: "LaLiga", gameweekNumber: 3 },
    ]);
  });

  it("excludes archived and format:none cards from the scope list", () => {
    const cards = [
      scopeCard(),
      scopeCard({ leagueId: "archived", archived: true, competitionSlug: "wc2026", competitionName: "World Cup 2026" }),
      scopeCard({ leagueId: "none", format: "none", competitionSlug: null as never, competitionName: "" }),
      scopeCard({ leagueId: "l3", competitionSlug: "laliga", competitionName: "LaLiga" }),
    ];
    expect(homeCompetitionScopes(cards)).toEqual([
      { competitionSlug: "pl", competitionName: "Premier League", gameweekNumber: 4 },
      { competitionSlug: "laliga", competitionName: "LaLiga", gameweekNumber: 4 },
    ]);
  });

  it("always keeps archived and format:none cards regardless of the selected scope", () => {
    const archived = scopeCard({ leagueId: "archived", archived: true, competitionSlug: "wc2026" });
    const none = scopeCard({ leagueId: "none", format: "none", competitionSlug: null as never });
    const pl = scopeCard({ leagueId: "pl-league" });
    const laliga = scopeCard({ leagueId: "laliga-league", competitionSlug: "laliga" });
    const cards = [archived, none, pl, laliga];
    expect(homeCardsForScope(cards, "pl").map((c) => c.leagueId)).toEqual(["none", "pl-league", "archived"]);
    expect(homeCardsForScope(cards, "laliga").map((c) => c.leagueId)).toEqual(["none", "laliga-league", "archived"]);
    expect(homeCardsForScope(cards, null).map((c) => c.leagueId)).toEqual([
      "none",
      "pl-league",
      "laliga-league",
      "archived",
    ]);
  });

  it("puts archived cards after non-archived cards while preserving each group's order", () => {
    const archivedFirst = scopeCard({ leagueId: "archived-first", archived: true, competitionSlug: "wc2022" });
    const activeBefore = scopeCard({ leagueId: "active-before" });
    const none = scopeCard({ leagueId: "none", format: "none", competitionSlug: null as never });
    const archivedLast = scopeCard({ leagueId: "archived-last", archived: true, competitionSlug: "wc2026" });
    const activeAfter = scopeCard({ leagueId: "active-after" });

    expect(homeCardsForScope([archivedFirst, activeBefore, none, archivedLast, activeAfter], "pl").map((c) => c.leagueId)).toEqual([
      "active-before",
      "none",
      "active-after",
      "archived-first",
      "archived-last",
    ]);
  });
});

describe("gwNavigatorTargets", () => {
  it("returns every gameweek as a reachable target, sorted, with the current one flagged", () => {
    expect(gwNavigatorTargets([3, 1, 5, 2, 4], 3)).toEqual([
      { gameweekNumber: 1, isCurrent: false },
      { gameweekNumber: 2, isCurrent: false },
      { gameweekNumber: 3, isCurrent: true },
      { gameweekNumber: 4, isCurrent: false },
      { gameweekNumber: 5, isCurrent: false },
    ]);
  });

  it("dedupes gameweek numbers and marks none current when the current GW isn't in the list", () => {
    expect(gwNavigatorTargets([1, 1, 2], 9)).toEqual([
      { gameweekNumber: 1, isCurrent: false },
      { gameweekNumber: 2, isCurrent: false },
    ]);
  });
});

describe("resolveHomeEntryStatus — canonical eight-state mapping", () => {
  const base = {
    lifecycle: "CL1" as const,
    viewerParticipation: "VP1" as const,
    viewerRank: null as number | null,
    eligibleCount: 12,
    viewerNetInr: null as number | null,
    deadlineAt: "2026-08-22T13:42:00.000Z",
    liveMatchCount: 0,
    archived: false,
  };

  it("notEnteredOpen: CL1 + VP1", () => {
    expect(resolveHomeEntryStatus(base)).toEqual({ key: "notEnteredOpen", deadlineAt: base.deadlineAt });
  });

  it("enteredOpen: CL1 + VP2/VP3/VP4", () => {
    expect(resolveHomeEntryStatus({ ...base, viewerParticipation: "VP2" })).toEqual({
      key: "enteredOpen",
      deadlineAt: base.deadlineAt,
    });
  });

  it("submittedLocked: locked/live-eligible lifecycle with no live match", () => {
    expect(resolveHomeEntryStatus({ ...base, lifecycle: "CL3", viewerParticipation: "VP4" })).toEqual({
      key: "submittedLocked",
      deadlineAt: base.deadlineAt,
    });
  });

  it("live: locked lifecycle with a live match and a known rank", () => {
    expect(
      resolveHomeEntryStatus({
        ...base,
        lifecycle: "CL3",
        viewerParticipation: "VP4",
        liveMatchCount: 2,
        viewerRank: 3,
      }),
    ).toEqual({ key: "live", rank: 3, total: 12 });
  });

  it("won: CL5 with a positive net", () => {
    expect(
      resolveHomeEntryStatus({ ...base, lifecycle: "CL5", viewerParticipation: "VP4", viewerRank: 1, viewerNetInr: 480 }),
    ).toEqual({ key: "won", rank: 1, total: 12, amountInr: 480 });
  });

  it("lost: CL5 with a negative net", () => {
    expect(
      resolveHomeEntryStatus({ ...base, lifecycle: "CL5", viewerParticipation: "VP4", viewerRank: 9, viewerNetInr: -100 }),
    ).toEqual({ key: "lost", rank: 9, total: 12, amountInr: -100 });
  });

  it("void: CL7 (settled result outcome not settled)", () => {
    expect(resolveHomeEntryStatus({ ...base, lifecycle: "CL7" })).toEqual({ key: "void" });
  });

  // Step 6A round 2 — item 4 regression: CL10 (all fixtures void, lib/gw-state.ts:83) was
  // incorrectly grouped with CL2/CL3/CL4 into submittedLocked. It must map to void, consistent
  // with the league screen's badge mapping (homeBadgeState treats CL7/CL10 identically).
  it("void: CL10 (all fixtures voided) maps to void, not submittedLocked — regression for the round-2 fix", () => {
    expect(resolveHomeEntryStatus({ ...base, lifecycle: "CL10", viewerParticipation: "VP4" })).toEqual({
      key: "void",
    });
  });

  it("syncIssue: CL6/CL8 (dirty) and CL9 (corrupt)", () => {
    expect(resolveHomeEntryStatus({ ...base, lifecycle: "CL6" })).toEqual({ key: "syncIssue" });
    expect(resolveHomeEntryStatus({ ...base, lifecycle: "CL8" })).toEqual({ key: "syncIssue" });
    expect(resolveHomeEntryStatus({ ...base, lifecycle: "CL9" })).toEqual({ key: "syncIssue" });
  });

  // Item 14: CL5 with a net of exactly zero previously returned null (no row at all). It now
  // returns a settled brokeEven row instead of silently dropping the entry-status line.
  it("brokeEven: CL5 with a net of exactly zero — regression for the round-2 fix", () => {
    expect(
      resolveHomeEntryStatus({ ...base, lifecycle: "CL5", viewerParticipation: "VP4", viewerRank: 5, viewerNetInr: 0 }),
    ).toEqual({ key: "brokeEven", rank: 5, total: 12 });
  });

  // Item 15: a live lifecycle whose provisional standing hasn't produced this viewer's rank yet
  // must still show a live-state row (degraded rank), not fall back to submittedLocked.
  it("live: locked lifecycle with a live match but no rank yet degrades the rank segment instead of falling back to Locked", () => {
    expect(
      resolveHomeEntryStatus({
        ...base,
        lifecycle: "CL3",
        viewerParticipation: "VP4",
        liveMatchCount: 2,
        viewerRank: null,
      }),
    ).toEqual({ key: "live", rank: null, total: 12 });
  });

  it("returns null for archived cards and for a blank CL0 lifecycle", () => {
    expect(resolveHomeEntryStatus({ ...base, archived: true })).toBeNull();
    expect(resolveHomeEntryStatus({ ...base, lifecycle: "CL0" })).toBeNull();
  });
});
