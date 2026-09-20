import { afterEach, describe, expect, it, vi } from "vitest";
import { pollScores } from "../../lib/espn";

// One due fixture kicking off "now": live, still `scheduled` in the DB.
const FIXTURE = {
  id: "fx-1",
  external_id: 401879276,
  status: "scheduled",
  is_knockout: false,
  home_team_id: "t-h",
  away_team_id: "t-a",
  kickoff_at: new Date().toISOString(),
  competitions: { espn_slug: "eng.1", format: "league", season: "2026-27" },
};

function makeAdmin() {
  const rpc = vi.fn(async () => ({ data: { applied: true }, error: null }));
  const update = vi.fn(() => ({ eq: async () => ({ error: null }) }));
  const from = vi.fn(() => {
    const builder: any = { update };
    builder.select = () => builder;
    builder.not = () => builder;
    builder.or = async () => ({ data: [FIXTURE] });
    return builder;
  });
  return { admin: { from, rpc } as any, rpc };
}

afterEach(() => vi.unstubAllGlobals());

describe("pollScores against ESPN's per-day scoreboard", () => {
  it("surfaces an error when ESPN answers 400 with a JSON body (the Sept 2026 outage shape)", async () => {
    // The regression this pins: the 400 body parses as JSON, so without a res.ok
    // check the poll read it as an empty day and reported a healthy zero.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ code: 400, message: "Failed to get events endpoint." }), {
          status: 400,
        }),
      ),
    );
    const { admin, rpc } = makeAdmin();
    const result = await pollScores(admin);
    expect(result.fetched).toBe(0);
    expect((result as any).error).toContain("eng.1: espn fetch failed");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("queries single days (never the range form) and applies the scores it gets", async () => {
    const urls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        urls.push(String(url));
        return new Response(
          JSON.stringify({
            events: [
              {
                id: "401879276",
                status: { type: { name: "STATUS_IN_PROGRESS", state: "in" }, displayClock: "63'" },
                competitions: [
                  {
                    competitors: [
                      { homeAway: "home", score: "2", team: { id: "1" } },
                      { homeAway: "away", score: "0", team: { id: "2" } },
                    ],
                  },
                ],
              },
            ],
          }),
          { status: 200 },
        );
      }),
    );
    const { admin, rpc } = makeAdmin();
    const result = await pollScores(admin);
    expect(urls.length).toBeGreaterThan(0);
    for (const url of urls) {
      expect(url).toMatch(/dates=\d{8}$/); // single day, no YYYYMMDD-YYYYMMDD range
    }
    expect(result.updated).toBe(1);
    expect((result as any).error).toBeUndefined();
    expect(rpc).toHaveBeenCalledWith(
      "apply_score_update",
      expect.objectContaining({ p_fixture_id: "fx-1", p_home: 2, p_away: 0, p_status: "live" }),
    );
  });
});
