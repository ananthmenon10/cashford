import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

const { requireUser, createServiceRoleClient, loadSeasonView, loadSeasonPickCorpus } = vi.hoisted(() => ({
  requireUser: vi.fn(),
  createServiceRoleClient: vi.fn(),
  loadSeasonView: vi.fn(),
  loadSeasonPickCorpus: vi.fn(),
}));

vi.mock("@/lib/gw-api", () => ({ requireUser }));
vi.mock("@/lib/supabase/service", () => ({ createServiceRoleClient }));
vi.mock("@/lib/gw-season", () => ({ loadSeasonView }));
vi.mock("@/lib/analytics-corpus-load", () => ({ loadSeasonPickCorpus }));

import { GET } from "../../app/api/analytics/modules/route";
import { emptyCorpus } from "../fixtures/analytics-corpus";

const leagueId = "11111111-1111-4111-8111-111111111111";
const competitionId = "22222222-2222-4222-8222-222222222222";

let memberExists = true;
let pairData: any = {
  league_id: leagueId,
  status: "active",
  competitions: { format: "league" },
};
const queryCalls: { table: string; method: string; args: unknown[] }[] = [];

function db() {
  return {
    from(table: string) {
      const query: any = {
        select: (...args: unknown[]) => {
          queryCalls.push({ table, method: "select", args });
          return query;
        },
        eq: (...args: unknown[]) => {
          queryCalls.push({ table, method: "eq", args });
          return query;
        },
        is: (...args: unknown[]) => {
          queryCalls.push({ table, method: "is", args });
          return query;
        },
        maybeSingle: async () => ({
          data: table === "league_members" ? (memberExists ? { user_id: "user-1" } : null) : pairData,
          error: null,
        }),
      };
      return query;
    },
  };
}

function request(overrides: { leagueId?: string; competitionId?: string } = {}) {
  const params = new URLSearchParams({
    leagueId: overrides.leagueId ?? leagueId,
    competitionId: overrides.competitionId ?? competitionId,
  });
  return new Request(`http://localhost/api/analytics/modules?${params}`);
}

describe("GET /api/analytics/modules", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    memberExists = true;
    pairData = { league_id: leagueId, status: "active", competitions: { format: "league" } };
    queryCalls.length = 0;
    requireUser.mockResolvedValue({ ok: true, db: db(), userId: "user-1" });
    createServiceRoleClient.mockReturnValue({});
    loadSeasonView.mockResolvedValue({ rows: [], totals: [], memberGameweeks: [], viewerName: null });
    loadSeasonPickCorpus.mockResolvedValue(emptyCorpus({ leagueId, competitionId }));
  });

  it("returns 400 for missing or non-UUID scope params", async () => {
    const missing = await GET(new Request("http://localhost/api/analytics/modules"));
    const malformed = await GET(request({ competitionId: "not-a-uuid" }));
    expect(missing.status).toBe(400);
    expect(malformed.status).toBe(400);
  });

  it("returns 401 before reading the scope when there is no session", async () => {
    requireUser.mockResolvedValue({
      ok: false,
      res: NextResponse.json({ error: "not signed in" }, { status: 401 }),
    });
    const response = await GET(request());
    expect(response.status).toBe(401);
    expect(createServiceRoleClient).not.toHaveBeenCalled();
  });

  it("returns 404 for a non-member", async () => {
    memberExists = false;
    const response = await GET(request());
    expect(response.status).toBe(404);
  });

  it("returns 404 for a member whose left_at is set", async () => {
    memberExists = false;
    const response = await GET(request());
    expect(response.status).toBe(404);
    expect(queryCalls).toContainEqual({ table: "league_members", method: "is", args: ["left_at", null] });
  });

  it("returns 404 when the league-competition pair is absent", async () => {
    pairData = null;
    const response = await GET(request());
    expect(response.status).toBe(404);
  });

  it("accepts an archived pair without filtering on status", async () => {
    pairData = { league_id: leagueId, status: "archived", competitions: { format: "cup" } };
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(loadSeasonView).not.toHaveBeenCalled();
    expect(loadSeasonPickCorpus).not.toHaveBeenCalled();
  });

  it("echoes both IDs, returns all module keys, and sets private no-store", async () => {
    const response = await GET(request());
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.leagueId).toBe(leagueId);
    expect(body.competitionId).toBe(competitionId);
    expect(Object.keys(body.modules)).toEqual([
      "youVsRoom",
      "rivalry",
      "habits",
      "weeklyLabels",
      "clubReads",
      "receipts",
    ]);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });
});
