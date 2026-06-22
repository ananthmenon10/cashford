import { describe, it, expect } from "vitest";
import { loadMatchesView } from "./home-matches";
import { makeClient, type QuerySpec } from "../test/supabase-fake";

const hasEq = (s: QuerySpec, col: string) => s.filters.some((f) => f[0] === "eq" && f[1] === col);
const hasIn = (s: QuerySpec, col: string) => s.filters.some((f) => f[0] === "in" && f[1] === col);

describe("loadMatchesView", () => {
  it("returns the empty view when the viewer has no leagues", async () => {
    const supabase = makeClient((s) => (s.table === "leagues" ? { data: [] } : {})) as any;
    const admin = makeClient(() => ({})) as any;
    const view = await loadMatchesView(supabase, admin, "u1");
    expect(view).toEqual({ live: [], upcoming: [], past: [], provisionalByFixture: {}, picksDue: null });
  });

  it("groups contests by phase, computes the live provisional net, and the picks-due nudge", async () => {
    const now = Date.now();
    const iso = (ms: number) => new Date(ms).toISOString();
    const in2h = now + 2 * 3600e3;
    const fixtureFields = { status_detail: null, minute: null, advancer_team_id: null };

    const contests = [
      // c1: open, unpicked, locks in 2h (group) → upcoming + needsPick → picksDue
      {
        id: "c1", league_id: "L", status: "open", lock_at: iso(in2h), stake_inr: 50, is_knockout: false, fixture_id: "F1",
        fixtures: { round: "group", home_label: "GER", away_label: "FRA", home_team_id: "h1", away_team_id: "a1", kickoff_at: iso(in2h), status: "scheduled", ft_home: null, ft_away: null, ...fixtureFields },
      },
      // c2: locked + fixture live (1–0) → live; viewer picked home
      {
        id: "c2", league_id: "L", status: "locked", lock_at: iso(now - 3600e3), stake_inr: 100, is_knockout: false, fixture_id: "F2",
        fixtures: { round: "group", home_label: "BRA", away_label: "ARG", home_team_id: "h2", away_team_id: "a2", kickoff_at: iso(now - 3600e3), status: "live", ft_home: 1, ft_away: 0, ...fixtureFields },
      },
    ];

    const supabase = makeClient((s) => {
      switch (s.table) {
        case "leagues": return { data: [{ id: "L", name: "KK", slug: "kk" }] };
        case "league_members": return { data: [{ league_id: "L", user_id: "u1" }, { league_id: "L", user_id: "u2" }, { league_id: "L", user_id: "u3" }] };
        case "contests": return { data: contests };
        case "teams": return { data: [{ id: "h2", short_name: "BRA" }, { id: "a2", short_name: "ARG" }] };
        case "contest_results": return { data: [] };
        case "predictions":
          if (hasEq(s, "user_id")) return { data: [{ contest_id: "c2", outcome: "home", pred_home: 1, pred_away: 0 }] }; // myPreds
          // live entrants for the provisional net (u1 home, u2 away) at 1–0 → u1 wins ₹100
          return { data: [
            { contest_id: "c2", user_id: "u1", outcome: "home", pred_home: 1, pred_away: 0 },
            { contest_id: "c2", user_id: "u2", outcome: "away", pred_home: 0, pred_away: 1 },
          ] };
        default: return {};
      }
    }) as any;

    // admin: entrant counts only (never the picks)
    const admin = makeClient((s) =>
      s.table === "predictions" && hasIn(s, "contest_id")
        ? { data: [{ contest_id: "c2" }, { contest_id: "c2" }, { contest_id: "c1" }] }
        : {},
    ) as any;

    const view = await loadMatchesView(supabase, admin, "u1");

    expect(view.live.map((g) => g.fixtureId)).toEqual(["F2"]);
    expect(view.upcoming.map((g) => g.fixtureId)).toEqual(["F1"]);
    expect(view.past).toEqual([]);

    // cross-league provisional: u1 is winning the live 1–0 → +₹100
    expect(view.provisionalByFixture["F2"]).toBe(100);

    // picks-due nudge points at the soonest-locking unpicked fixture
    expect(view.picksDue).toEqual({ count: 1, earliestLockIso: iso(in2h) });
  });
});
