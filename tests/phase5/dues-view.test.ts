import { describe, expect, it } from "vitest";
import { loadDuesView } from "../../lib/dues-view";
import type { LeagueIdentity } from "../../lib/gw-view";

type TableData = Record<string, readonly unknown[]>;

function fakeAdmin(tables: TableData) {
  return {
    from(table: string) {
      const result = { data: tables[table] ?? [], error: null };
      const chain: Record<string, unknown> = {};
      chain.select = () => chain;
      chain.eq = () => chain;
      chain.in = () => chain;
      chain.order = () => chain;
      chain.then = (resolve: (value: typeof result) => unknown, reject?: (reason: unknown) => unknown) =>
        Promise.resolve(result).then(resolve, reject);
      return chain;
    },
  };
}

const identity = {
  league: { id: "league-1", name: "Test League", slug: "test-league", createdBy: "alice", status: "active" },
  participation: { status: "none" },
} as unknown as LeagueIdentity;

describe("dues-view — §2 and §4 read-side contracts", () => {
  it("T-U26: keeps a departed member's non-zero balance and marks the member as past", async () => {
    // §2.1 and DS10 worked example:
    // World Cup result fold: alice −50, departed bob +50; −50 + 50 = ₹0.
    // The departed member stays in the financial participant set and in the settle plan.
    const view = await loadDuesView(
      {} as never,
      fakeAdmin({
        league_members: [
          { user_id: "alice", left_at: null },
          { user_id: "bob", left_at: "2026-07-01T00:00:00.000Z" },
        ],
        member_competitions: [{ user_id: "alice" }, { user_id: "bob" }],
        contest_results: [
          { user_id: "alice", net_inr: -50, contests: {} },
          { user_id: "bob", net_inr: 50, contests: {} },
        ],
        gameweek_entries: [],
        gameweek_entry_results: [],
        gameweek_contests: [],
        transfers: [{ id: "wc-transfer", from_user_id: "alice", to_user_id: "bob", amount_inr: 50, reversed: false, contest_id: "contest-1", gameweek_contest_id: null, created_at: "2026-06-20T12:00:00.000Z" }],
        payments: [],
        payment_confirmations: [],
        profiles: [
          { id: "alice", display_name: "Alice", username: "alice" },
          { id: "bob", display_name: "Bob", username: "bob" },
        ],
      }) as never,
      identity,
      "alice",
    );

    expect(view.ledger.status).toBe("clean");
    expect(view.ledger.status === "clean" ? view.ledger.plan : null).toEqual([{ from: "alice", to: "bob", amount: 50 }]);
    expect(view.people).toEqual([
      { id: "bob", name: "Bob", netInr: 50, isViewer: false, departed: true },
      { id: "alice", name: "Alice", netInr: -50, isViewer: true, departed: false },
    ]);
  });

  it("T-U21: leaves the original confirmed payment visible beside its confirmed reversal", async () => {
    // §4.1 DS6–DS7 and CC13–CC14: a reversal does not erase the original fact.
    // Hand ledger effect: original alice→bob ₹40 is +40/−40; reversal is −40/+40; total is 0/0.
    const view = await loadDuesView(
      {} as never,
      fakeAdmin({
        league_members: [{ user_id: "alice", left_at: null }, { user_id: "bob", left_at: null }],
        member_competitions: [],
        contest_results: [],
        gameweek_entries: [],
        gameweek_entry_results: [],
        gameweek_contests: [],
        transfers: [],
        payments: [
          {
            id: "payment-1",
            kind: "payment",
            payer_user_id: "alice",
            receiver_user_id: "bob",
            amount_inr: 40,
            paid_on: "2026-07-20",
            note: null,
            logged_by: "alice",
            logged_at: "2026-07-20T10:00:00.000Z",
            status: "confirmed",
            required_payer_confirmation: false,
            required_receiver_confirmation: true,
            reverses_payment_id: null,
          },
          {
            id: "reversal-1",
            kind: "reversal",
            payer_user_id: "alice",
            receiver_user_id: "bob",
            amount_inr: 40,
            paid_on: "2026-07-20",
            note: "entered in error",
            logged_by: "alice",
            logged_at: "2026-07-21T10:00:00.000Z",
            status: "confirmed",
            required_payer_confirmation: false,
            required_receiver_confirmation: true,
            reverses_payment_id: "payment-1",
          },
        ],
        payment_confirmations: [],
        profiles: [
          { id: "alice", display_name: "Alice", username: "alice" },
          { id: "bob", display_name: "Bob", username: "bob" },
        ],
      }) as never,
      identity,
      "alice",
    );

    expect(view.ledger.status).toBe("clean");
    expect(view.ledger.status === "clean" ? view.ledger.netByUser : null).toEqual({ alice: 0, bob: 0 });
    expect(view.activity.map((item) => item.id)).toEqual(["reversal-1", "payment-1"]);
    expect(view.activity.find((item) => item.id === "payment-1")).toMatchObject({ reversedByPaymentId: "reversal-1" });
    expect(view.activity.find((item) => item.id === "reversal-1")).toMatchObject({ kind: "reversal", reversesPaymentId: "payment-1" });
  });
});
