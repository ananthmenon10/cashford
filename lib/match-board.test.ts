import { describe, it, expect } from "vitest";
import { buildBoard, type PlayerPick } from "./match-board";
import { settle, type Prediction } from "./settlement";

const S = 500;
const OPTS = { isKnockout: false, stake: S, homeShort: "BRA", awayShort: "ARG" };

// A PlayerPick whose id doubles as the settle() userId, so buildBoard and settle line up 1:1.
const pp = (id: string, outcome: PlayerPick["outcome"], h: number, a: number, isMe = false): PlayerPick =>
  ({ id, name: id.toUpperCase(), isMe, outcome, predHome: h, predAway: a });
const asPred = (p: PlayerPick): Prediction => ({ userId: p.id, outcome: p.outcome, predHome: p.predHome, predAway: p.predAway });
const netOf = (vm: ReturnType<typeof buildBoard>, id: string) => vm.rows.find((r) => r.id === id)!.net;

describe("P1 — cross-module invariant: buildBoard net ≡ settle() net, pot ≡ Σ transfers", () => {
  // Reuse settlement.test.ts's own golden scenarios. If buildBoard ever mis-maps a result,
  // these fail even when every other VM test passes — the one guard against mis-displayed money.
  const scenarios: { name: string; players: PlayerPick[]; score: { home: number; away: number }; ko?: "home" | "away" }[] = [
    { name: "C1 (1 winner, 3 losers)", players: [pp("a", "home", 2, 1), pp("b", "away", 0, 1), pp("c", "draw", 1, 1), pp("d", "away", 1, 2)], score: { home: 2, away: 0 } },
    { name: "C2 (3 winners, floor+remainder)", players: [pp("a", "home", 1, 0), pp("b", "home", 2, 0), pp("c", "home", 3, 0), pp("d", "away", 0, 1)], score: { home: 2, away: 0 } },
    { name: "C5 (2 winners ₹250 each)", players: [pp("a", "home", 2, 1), pp("b", "home", 1, 0), pp("c", "away", 0, 1)], score: { home: 1, away: 0 } },
    { name: "C9 (nobody right, closest)", players: [pp("a", "home", 2, 1), pp("b", "away", 1, 3), pp("c", "home", 3, 0), pp("d", "away", 0, 1)], score: { home: 2, away: 2 } },
    { name: "C15 (knockout, advancer decides)", players: [pp("a", "home", 0, 0), pp("b", "away", 0, 0), pp("c", "home", 5, 5), pp("d", "away", 9, 9)], score: { home: 1, away: 1 }, ko: "home" },
  ];

  for (const sc of scenarios) {
    it(sc.name, () => {
      const isKnockout = sc.ko != null;
      const actual = { isKnockout, ftHome: sc.score.home, ftAway: sc.score.away, advancer: sc.ko };
      const s = settle(sc.players.map(asPred), actual, S);
      const vm = buildBoard(sc.players, sc.score, { ...OPTS, isKnockout, advancerOverride: sc.ko });

      for (const r of s.results) expect(netOf(vm, r.userId)).toBe(r.net);
      expect(vm.pot).toBe(s.transfers.reduce((t, x) => t + x.amount, 0));
      // Σ(net) = 0 still holds at the VM layer.
      expect(vm.rows.reduce((t, r) => t + r.net, 0)).toBe(0);
    });
  }
});

describe("P2 — knockout undecided (board-only logic, settle() never called)", () => {
  it("level score, mixed picks → undecided, every net 0", () => {
    const players = [pp("a", "home", 2, 1), pp("b", "away", 1, 2), pp("c", "home", 1, 0)];
    const vm = buildBoard(players, { home: 1, away: 1 }, { ...OPTS, isKnockout: true });
    expect(vm.status).toBe("undecided");
    expect(vm.branch).toBe("undecided");
    expect(vm.rows.every((r) => r.net === 0)).toBe(true);
    expect(vm.reason).toMatch(/extra time/i);
    expect(vm.pot).toBe(0);
  });

  it("level score, everyone same outcome → still undecided (NOT no_separation void)", () => {
    const players = [pp("a", "home", 2, 1), pp("b", "home", 1, 0), pp("c", "home", 3, 2)];
    const vm = buildBoard(players, { home: 2, away: 2 }, { ...OPTS, isKnockout: true });
    expect(vm.status).toBe("undecided");
    expect(vm.rows.every((r) => r.net === 0)).toBe(true);
  });

  it("decisive knockout score → settles with the leading side advancing", () => {
    const players = [pp("a", "home", 2, 1), pp("b", "away", 0, 1)];
    const vm = buildBoard(players, { home: 2, away: 1 }, { ...OPTS, isKnockout: true });
    expect(vm.status).toBe("settled");
    expect(netOf(vm, "a")).toBe(S); // home advanced; a (home) wins b's stake
    expect(netOf(vm, "b")).toBe(-S);
  });

  it("advancerOverride reproduces a stored ET/penalties result at a level 90' score", () => {
    // 1–1 in regulation, decided on penalties for the away side (real advancer_team_id).
    const players = [pp("a", "away", 1, 1), pp("b", "home", 1, 1)];
    const vm = buildBoard(players, { home: 1, away: 1 }, { ...OPTS, isKnockout: true, advancerOverride: "away" });
    const s = settle(players.map(asPred), { isKnockout: true, ftHome: 1, ftAway: 1, advancer: "away" }, S);
    expect(vm.status).toBe("settled");
    expect(netOf(vm, "a")).toBe(s.results.find((r) => r.userId === "a")!.net);
    expect(netOf(vm, "a")).toBe(S);
  });
});

describe("P3 — me-first tiebreak is deterministic", () => {
  it("on a net tie, the me-row sorts first even when its id sorts last", () => {
    // Both pick home and win the split; tied net. me-row id "z" sorts after "a".
    const players = [pp("a", "home", 1, 0), pp("z", "home", 2, 0, true), pp("c", "away", 0, 1)];
    const vm = buildBoard(players, { home: 2, away: 0 }, OPTS);
    expect(netOf(vm, "a")).toBe(netOf(vm, "z")); // tied winners
    expect(vm.rows[0].isMe).toBe(true);
    expect(vm.rows[0].id).toBe("z");
  });
});

describe("P4 — you.net sign", () => {
  it("me as loser → negative; me as winner → positive", () => {
    const losing = buildBoard([pp("a", "away", 0, 1, true), pp("b", "home", 2, 0)], { home: 2, away: 0 }, OPTS);
    expect(losing.you!.net).toBeLessThan(0);
    expect(losing.you!.result).toBe("loss");

    const winning = buildBoard([pp("a", "home", 2, 0, true), pp("b", "away", 0, 1)], { home: 2, away: 0 }, OPTS);
    expect(winning.you!.net).toBeGreaterThan(0);
    expect(winning.you!.result).toBe("win");
  });
});

describe("P5 — winnerNames wiring", () => {
  it("'you' appears when meId is among the winners; absent otherwise", () => {
    const iWin = buildBoard([pp("a", "home", 2, 0, true), pp("b", "home", 1, 0), pp("c", "away", 0, 1)], { home: 2, away: 0 }, OPTS);
    expect(iWin.winnerNames).toContain("you");

    const iLose = buildBoard([pp("a", "away", 0, 1, true), pp("b", "home", 1, 0), pp("c", "home", 2, 0)], { home: 2, away: 0 }, OPTS);
    expect(iLose.winnerNames).not.toContain("you");
  });
});

describe("branch classification + void + counts", () => {
  it("split: some-but-not-all correct outcome", () => {
    const vm = buildBoard([pp("a", "home", 2, 1), pp("b", "away", 0, 1), pp("c", "draw", 1, 1), pp("d", "away", 1, 2)], { home: 2, away: 0 }, OPTS);
    expect(vm.branch).toBe("split");
    expect(vm.reasonIcon).toBe("✓");
    expect(vm.ahead).toBe(1);
    expect(vm.behind).toBe(3);
  });

  it("closest-all: everyone right → tiebreak", () => {
    const vm = buildBoard([pp("a", "home", 2, 1), pp("b", "home", 3, 1), pp("c", "home", 1, 0), pp("d", "home", 3, 2)], { home: 2, away: 1 }, OPTS);
    expect(vm.branch).toBe("closest-all");
    expect(vm.reasonIcon).toBe("◎");
  });

  it("closest-none: nobody right → tiebreak", () => {
    const vm = buildBoard([pp("a", "home", 2, 1), pp("b", "away", 1, 3), pp("c", "home", 3, 0), pp("d", "away", 0, 1)], { home: 2, away: 2 }, OPTS);
    expect(vm.branch).toBe("closest-none");
  });

  it("void: <2 players → insufficient", () => {
    const vm = buildBoard([pp("a", "home", 1, 0)], { home: 1, away: 0 }, OPTS);
    expect(vm.status).toBe("void");
    expect(vm.branch).toBe("void");
    expect(vm.reason).toMatch(/not enough players/i);
  });

  it("void: no_separation (all identical, non-knockout)", () => {
    const vm = buildBoard([pp("a", "home", 2, 1), pp("b", "away", 1, 2)], { home: 1, away: 1 }, OPTS);
    expect(vm.status).toBe("void");
    expect(vm.reason).toMatch(/too level/i);
  });

  it("N=2 minimum non-void: ahead 1, behind 1, pot = stake", () => {
    const vm = buildBoard([pp("a", "home", 2, 0), pp("b", "away", 0, 1)], { home: 2, away: 0 }, OPTS);
    expect(vm.ahead).toBe(1);
    expect(vm.behind).toBe(1);
    expect(vm.pot).toBe(S);
  });

  it("outcomeShort reflects the score", () => {
    expect(buildBoard([pp("a", "home", 2, 0), pp("b", "away", 0, 1)], { home: 2, away: 0 }, OPTS).outcomeShort).toBe("BRA WIN");
    expect(buildBoard([pp("a", "away", 0, 2), pp("b", "home", 1, 0)], { home: 0, away: 2 }, OPTS).outcomeShort).toBe("ARG WIN");
    expect(buildBoard([pp("a", "draw", 1, 1), pp("b", "home", 2, 0)], { home: 1, away: 1 }, OPTS).outcomeShort).toBe("DRAW");
  });
});
