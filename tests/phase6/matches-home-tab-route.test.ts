import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

const { requireUser, loadMatchesHomeTab } = vi.hoisted(() => ({
  requireUser: vi.fn(),
  loadMatchesHomeTab: vi.fn(),
}));

vi.mock("@/lib/gw-api", () => ({ requireUser }));
vi.mock("@/lib/matches-home-tab-load", () => ({ loadMatchesHomeTab }));

import { GET } from "../../app/api/matches/home-tab/route";

const fullPayload = {
  empty: false,
  requestedComp: null,
  requestedGw: null,
  selectedComp: "pl-2026-27",
  view: {},
  freshness: "pre",
  nextGw: null,
  receipt: null,
};

function request(query = "") {
  return new Request(`http://localhost/api/matches/home-tab${query}`);
}

describe("GET /api/matches/home-tab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireUser.mockResolvedValue({ ok: true, db: {}, userId: "user-1" });
    loadMatchesHomeTab.mockResolvedValue(fullPayload);
  });

  it("returns 401 with private no-store before loading", async () => {
    const response = NextResponse.json({ error: "not signed in" }, { status: 401 });
    requireUser.mockResolvedValue({ ok: false, res: response });

    const result = await GET(request());

    expect(result.status).toBe(401);
    expect(result.headers.get("Cache-Control")).toBe("private, no-store");
    expect(loadMatchesHomeTab).not.toHaveBeenCalled();
  });

  it.each(["?comp=", `?comp=${"x".repeat(65)}`])("rejects malformed comp %s", async (query) => {
    const response = await GET(request(query));
    expect(response.status).toBe(400);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(loadMatchesHomeTab).not.toHaveBeenCalled();
  });

  it.each(["?gw=0", "?gw=1.5", "?gw=abc", "?gw="])
    ("rejects malformed gameweek %s", async (query) => {
      const response = await GET(request(query));
      expect(response.status).toBe(400);
      expect(loadMatchesHomeTab).not.toHaveBeenCalled();
    });

  it("converts an absent comp param to undefined and echoes the full payload", async () => {
    const response = await GET(request());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(body).toEqual(fullPayload);
    expect(loadMatchesHomeTab).toHaveBeenCalledWith({}, "user-1", {
      requestedScopeSlug: undefined,
    });
  });

  it("passes a valid requested scope through and returns inline empty payloads as 200", async () => {
    loadMatchesHomeTab.mockResolvedValue({
      empty: true,
      requestedComp: "friends",
      selectedComp: null,
      freshness: "empty",
    });

    const response = await GET(request("?comp=friends"));

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await response.json()).toEqual({
      empty: true,
      requestedComp: "friends",
      selectedComp: null,
      freshness: "empty",
    });
    expect(loadMatchesHomeTab).toHaveBeenCalledWith({}, "user-1", {
      requestedScopeSlug: "friends",
    });
  });

  it("passes a valid requested gameweek through", async () => {
    await GET(request("?gw=7"));

    expect(loadMatchesHomeTab).toHaveBeenCalledWith({}, "user-1", {
      requestedScopeSlug: undefined,
      requestedGameweek: 7,
    });
  });

  it.each([
    ["unknown/foreign comp", "?comp=foreign", "foreign"],
    ["zero scopes", "", null],
  ])("returns 200 empty for %s", async (_label, query, requestedComp) => {
    loadMatchesHomeTab.mockResolvedValue({
      empty: true,
      requestedComp,
      selectedComp: null,
      freshness: "empty",
    });

    const response = await GET(request(query));

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await response.json()).toMatchObject({ empty: true, requestedComp, selectedComp: null });
  });

  it("maps loader failures to a generic 500 without leaking the error", async () => {
    loadMatchesHomeTab.mockRejectedValue(new Error("private database details"));

    const response = await GET(request());
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(body.error).not.toContain("private database details");
    expect(body.error).toBe("Matches are temporarily unavailable.");
  });
});
