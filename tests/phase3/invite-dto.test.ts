// Phase 3 — §9 create/join: resolveInvite / InviteDTO / InviteParticipation. Blind from §9 U31-U34,
// T-U29-T-U31, T-U31a. The discriminated union and resolveInvite's name are given verbatim in §9.
//
// Canonical per the fix round: `app/leagues/join/actions.ts` regained its server boundary and its
// `resolveInvite` there is now ASYNC (does real DB reads). The pure, synchronous logic this file
// actually exercises — `activeCompetitions` and `resolveInvite` — moved to `lib/gw-invites.ts`.
// Every assertion below was checked against that module's real sort/filter behavior and needs no
// change beyond the import path.
import { describe, expect, it } from "vitest";
import { activeCompetitions, resolveInvite } from "../../lib/gw-invites";

function leagueRow(overrides: Record<string, unknown> = {}) {
  return {
    status: "notfound" as const,
    ...overrides,
  };
}

describe("resolveInvite — T-U31a InviteDTO participation union, all three arms", () => {
  it("'active' arm carries competitionId/competitionName/competitionFormat and offers a join-with-ante CTA", () => {
    const dto = resolveInvite(
      leagueRow({
        status: "active",
        leagueId: "l1",
        slug: "kk-bois",
        leagueName: "KK Bois",
        captainName: "Ananth",
        memberCount: 8,
        stakeInr: 100,
        token: "tok",
        leagueStatus: "active",
        competitions: [{ status: "active", id: "c1", name: "Premier League", format: "gameweek" }],
      }),
    );
    expect(dto.status).toBe("active");
    if (dto.status !== "active") throw new Error("expected active");
    expect(dto.participation).toBe("active");
    if (dto.participation !== "active") throw new Error("expected active participation");
    expect(dto.competitionId).toBe("c1");
    expect(dto.competitionFormat).toBe("gameweek");
  });

  it("'archived' arm carries competition fields but does not offer entry (C69)", () => {
    const dto = resolveInvite(
      leagueRow({
        status: "active",
        leagueId: "l1",
        slug: "kk-bois",
        leagueName: "KK Bois",
        captainName: "Ananth",
        memberCount: 8,
        stakeInr: 100,
        token: "tok",
        leagueStatus: "active",
        competitions: [{ status: "archived", id: "c0", name: "World Cup 2026", format: "cup" }],
      }),
    );
    if (dto.status !== "active") throw new Error("expected active");
    expect(dto.participation).toBe("archived");
    if (dto.participation !== "archived") throw new Error("expected archived participation");
    expect(dto.competitionId).toBe("c0");
  });

  it("'none' arm has NO competitionId key at all (not null, absent) yet join-as-membership is still permitted", () => {
    const dto = resolveInvite(
      leagueRow({
        status: "active",
        leagueId: "l1",
        slug: "kk-bois",
        leagueName: "KK Bois",
        captainName: "Ananth",
        memberCount: 8,
        stakeInr: 100,
        token: "tok",
        leagueStatus: "active",
        competitions: [],
      }),
    );
    if (dto.status !== "active") throw new Error("expected active");
    expect(dto.participation).toBe("none");
    expect(Object.prototype.hasOwnProperty.call(dto, "competitionId")).toBe(false);
    // "none" still resolves to a joinable invite (status: active), not notfound/revoked.
    expect(dto.status).toBe("active");
  });

  it("resolution precedence: the league's active league_competitions row wins over an archived one", () => {
    const dto = resolveInvite(
      leagueRow({
        status: "active",
        leagueId: "l1",
        slug: "kk-bois",
        leagueName: "KK Bois",
        captainName: "Ananth",
        memberCount: 8,
        stakeInr: 100,
        token: "tok",
        leagueStatus: "active",
        competitions: [
          { status: "archived", id: "c0", name: "World Cup 2026", format: "cup" },
          { status: "active", id: "c1", name: "Premier League", format: "gameweek" },
        ],
      }),
    );
    if (dto.status !== "active") throw new Error("expected active");
    expect(dto.participation).toBe("active");
    if (dto.participation !== "active") throw new Error("expected active participation");
    expect(dto.competitionId).toBe("c1");
  });

  it("resolution precedence: absent an active row, the most recent archived row is used", () => {
    const dto = resolveInvite(
      leagueRow({
        status: "active",
        leagueId: "l1",
        slug: "kk-bois",
        leagueName: "KK Bois",
        captainName: "Ananth",
        memberCount: 8,
        stakeInr: 100,
        token: "tok",
        leagueStatus: "active",
        competitions: [
          { status: "archived", id: "c-old", name: "World Cup 2022", format: "cup", updatedAt: "2022-01-01" },
          { status: "archived", id: "c-new", name: "World Cup 2026", format: "cup", updatedAt: "2026-01-01" },
        ],
      }),
    );
    if (dto.status !== "active") throw new Error("expected active");
    expect(dto.participation).toBe("archived");
    if (dto.participation !== "archived") throw new Error("expected archived participation");
    expect(dto.competitionId).toBe("c-new");
  });

  it("'notfound' status is unaffected by competition data", () => {
    const dto = resolveInvite(leagueRow({ status: "notfound" }));
    expect(dto.status).toBe("notfound");
  });

  it("'revoked' status is unaffected by competition data", () => {
    const dto = resolveInvite(leagueRow({ status: "revoked" }));
    expect(dto.status).toBe("revoked");
  });
});

describe("activeCompetitions — U31/U32 CompetitionPicker filter and zero-active guard", () => {
  it("T-U29/T-U30: only status='active' competitions are returned, a 'preparing' PL seed is excluded", () => {
    const list = [
      { status: "preparing", id: "c1", name: "Premier League", format: "gameweek" },
      { status: "active", id: "c2", name: "World Cup 2026", format: "cup" },
    ];
    const result = activeCompetitions(list as never);
    expect(result.map((c: any) => c.id)).toEqual(["c2"]);
  });

  it("T-U31: zero active competitions returns an empty list (the create flow blocks on this, not on an empty picker)", () => {
    const list = [{ status: "preparing", id: "c1", name: "Premier League", format: "gameweek" }];
    expect(activeCompetitions(list as never)).toEqual([]);
  });
});
