import { describe, expect, it } from "vitest";
import {
  analyticsViewHasHistory,
  analyticsVisibleForHomeCards,
  buildHomeLeagueCard,
  resolveHomeLeagueCardState,
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
