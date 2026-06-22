import { describe, it, expect } from "vitest";
import { loadAnalyticsView } from "./home-analytics";
import { makeClient } from "../test/supabase-fake";

describe("loadAnalyticsView", () => {
  it("returns an empty global view when the viewer has no leagues", async () => {
    const supabase = makeClient((s) => (s.table === "leagues" ? { data: [] } : {})) as any;
    const view = await loadAnalyticsView(supabase, "u1");
    expect(view.leagues).toEqual([]);
    expect(view.global.net).toBe(0);
    expect(view.global.acc.graded).toBe(0);
  });

  it("aggregates the viewer's net, accuracy and per-league rank over finished contests", async () => {
    const supabase = makeClient((s) => {
      switch (s.table) {
        case "leagues": return { data: [{ id: "L", name: "KK", slug: "kk" }] };
        case "contests": return { data: [{
          id: "c1", league_id: "L", is_knockout: false, fixture_id: "F1",
          fixtures: { home_label: "GER", away_label: "FRA", home_team_id: "h1", kickoff_at: "2026-06-20T18:00:00Z", ft_home: 2, ft_away: 0, advancer_team_id: null },
        }] };
        case "league_members": return { data: [{ league_id: "L", user_id: "u1" }, { league_id: "L", user_id: "u2" }] };
        case "fixture_insights": return { data: [] };
        case "profiles": return { data: [{ id: "u1", display_name: "Me", username: "me" }, { id: "u2", display_name: "Riv", username: "riv" }] };
        case "predictions": return { data: [
          { contest_id: "c1", user_id: "u1", outcome: "home", pred_home: 2, pred_away: 0 }, // correct
          { contest_id: "c1", user_id: "u2", outcome: "away", pred_home: 0, pred_away: 1 }, // wrong
        ] };
        case "contest_results": return { data: [
          { contest_id: "c1", user_id: "u1", net_inr: 100 },
          { contest_id: "c1", user_id: "u2", net_inr: -100 },
        ] };
        case "transfers": return { data: [{ league_id: "L", from_user_id: "u2", to_user_id: "u1", amount_inr: 100 }] };
        default: return {};
      }
    }) as any;

    const view = await loadAnalyticsView(supabase, "u1");

    expect(view.global.net).toBe(100);
    expect(view.global.acc).toMatchObject({ graded: 1, correct: 1 });

    expect(view.leagues).toHaveLength(1);
    const lg = view.leagues[0];
    expect(lg).toMatchObject({ leagueName: "KK", net: 100, rank: 1, members: 2 });
    // rivalry money-flow: u2 has paid the viewer ₹100 net
    expect(lg.rivals.find((r) => r.userId === "u2")?.moneyFlow).toBe(100);
    // the viewer tops the sharpest board (1.0 = perfect over 1 graded pick)
    expect(lg.sharpest[0]).toMatchObject({ isMe: true, accuracyPct: 1 });
  });
});
