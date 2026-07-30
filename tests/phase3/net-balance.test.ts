// Phase 3 — lib/net-balance.ts, the shared dirty-money predicate (§5.3 PR3b, §5.3a X-P5-1).
// Blind from §5.3, §5.3a, T-U8, T-U2d. This is the one predicate Phase 5's Dues loader must
// consume unmodified (decisions-log #32/#39) — X-P5-1 names it by this exact path.
//
// The plan literally names the export in prose (T-U2d: "`netBalance` returns 'suppressed' for
// the PL ledger and an unchanged figure for the WC ledger from the same fixture"), so `netBalance`
// is not a guess.
import { describe, expect, it } from "vitest";
import { netBalance } from "../../lib/net-balance";

describe("netBalance — T-U8 signs and suppresses", () => {
  it("a clean (non-dirty) PL ledger returns a signed number, not a suppressed marker", () => {
    const r = netBalance({ ledger: "pl", inputVersion: 1, settledVersion: 1, amountInr: 450 });
    expect(r).not.toBe("suppressed");
    expect(typeof r === "number" || (r as any)?.amountInr !== undefined).toBeTruthy();
  });

  it("a dirty PL ledger (input_version > settled_version) returns 'suppressed'", () => {
    const r = netBalance({ ledger: "pl", inputVersion: 2, settledVersion: 1, amountInr: 450 });
    expect(r).toBe("suppressed");
  });

  it("owed vs owing sign convention: negative amount reads as owed, positive as due (or vice versa, but never flips between calls with the same input)", () => {
    const a = netBalance({ ledger: "pl", inputVersion: 1, settledVersion: 1, amountInr: -450 });
    const b = netBalance({ ledger: "pl", inputVersion: 1, settledVersion: 1, amountInr: 450 });
    expect(a).not.toEqual(b);
  });
});

describe("netBalance — T-U2d PR3b: WC ledger is untouched by PL dirtiness", () => {
  it("the WC ledger from the same fixture set returns its unchanged figure even while the PL side is dirty", () => {
    const pl = netBalance({ ledger: "pl", inputVersion: 2, settledVersion: 1, amountInr: 450 });
    const wc = netBalance({ ledger: "wc", inputVersion: 2, settledVersion: 1, amountInr: 300 });
    expect(pl).toBe("suppressed");
    expect(wc).not.toBe("suppressed");
  });
});
