import { describe, it, expect } from "vitest";
import {
  GEO,
  CIRCLE_MATCHES,
  key,
  parseKey,
  childrenOf,
  parentOf,
  pathToFinal,
  angleOf,
  nodePosition,
  geometry,
  links,
  at,
  feedersReady,
  isAutoLocked,
  promote,
  autoPicks,
  validate,
  completeBracket,
  score,
  chipColor,
  bracketSvg,
  bindBracket,
  type Picks,
  type Results,
  type KnockoutFixture,
} from "./knockout";

const FIELD = Array.from({ length: 32 }, (_, i) => `t${i}`); // 32 distinct entrants

describe("slot-key + tree helpers", () => {
  it("parseKey rejects malformed and out-of-range keys", () => {
    expect(() => parseKey("6:0")).toThrow(); // ring out of range
    expect(() => parseKey("0:32")).toThrow(); // idx out of range (ring 0 has 32)
    expect(() => parseKey("2:8")).toThrow(); // ring 2 has 8 nodes (0..7)
    expect(() => parseKey("abc")).toThrow();
    expect(parseKey("5:0")).toEqual([5, 0]);
  });

  it("childrenOf / parentOf follow the binary tree", () => {
    expect(childrenOf(1, 0)).toEqual(["0:0", "0:1"]);
    expect(childrenOf(5, 0)).toEqual(["4:0", "4:1"]);
    expect(parentOf(0, 7)).toBe("1:3");
    expect(parentOf(4, 1)).toBe("5:0");
    expect(parentOf(5, 0)).toBeNull(); // champion has no parent
    expect(() => childrenOf(0, 0)).toThrow(); // ring 0 has no children
  });

  it("pathToFinal is the node + ancestors to the champion, inclusive", () => {
    expect(pathToFinal("5:0")).toEqual(["5:0"]);
    expect(pathToFinal("0:5")).toEqual(["0:5", "1:2", "2:1", "3:0", "4:0", "5:0"]);
    expect(pathToFinal("0:0")).toHaveLength(6);
  });
});

describe("geometry — deterministic, pinned", () => {
  it("has 63 nodes (32+16+8+4+2+1) and 62 connector links", () => {
    expect(geometry()).toHaveLength(63);
    expect(links()).toHaveLength(CIRCLE_MATCHES * 2); // 31 parents × 2 feeders
  });

  it("pins ring-0 node 0 (top), ring-0 node 8 (right), and the champion (centre)", () => {
    const n0 = nodePosition(0, 0); // angle -90° → top
    expect(n0.x).toBeCloseTo(149, 5);
    expect(n0.y).toBeCloseTo(12, 5); // 149 - 137
    const n8 = nodePosition(0, 8); // angle 0° → right
    expect(n8.x).toBeCloseTo(286, 5); // 149 + 137
    expect(n8.y).toBeCloseTo(149, 5);
    expect(nodePosition(5, 0)).toEqual({ x: 149, y: 149 }); // champion = centre
  });

  it("ring-L nodes sit at the midpoint angle of their two children", () => {
    expect(angleOf(1, 0)).toBeCloseTo((angleOf(0, 0) + angleOf(0, 1)) / 2, 9);
    expect(angleOf(2, 3)).toBeCloseTo((angleOf(1, 6) + angleOf(1, 7)) / 2, 9);
  });

  it("is a pure function of the frozen GEO constants", () => {
    expect(GEO.counts).toEqual([32, 16, 8, 4, 2, 1]);
    expect(JSON.stringify(geometry())).toBe(JSON.stringify(geometry())); // stable
  });
});

describe("feedersReady + at", () => {
  it("ring-1 feeders (ring-0 entrants) are always ready", () => {
    expect(feedersReady({}, FIELD, 1, 0)).toBe(true);
    expect(feedersReady({}, FIELD, 1, 15)).toBe(true);
  });
  it("ring-2 needs both ring-1 picks filled", () => {
    expect(feedersReady({ "1:0": "t0" }, FIELD, 2, 0)).toBe(false); // 1:1 missing
    expect(feedersReady({ "1:0": "t0", "1:1": "t2" }, FIELD, 2, 0)).toBe(true);
  });
  it("at() reads the fixed field at ring 0 and picks above", () => {
    expect(at({}, FIELD, 0, 3)).toBe("t3");
    expect(at({ "2:0": "t0" }, FIELD, 2, 0)).toBe("t0");
    expect(at({}, FIELD, 2, 0)).toBeUndefined();
  });
});

describe("promote — one tap = one round, gating, path-based clear", () => {
  it("ring-0 tap writes to ring 1 (never a 0:* key)", () => {
    const r = promote({}, FIELD, {}, 0, 0);
    expect(r.picks["1:0"]).toBe("t0");
    expect(Object.keys(r.picks).some((k) => k.startsWith("0:"))).toBe(false);
  });

  it("gates when the sibling feeder is empty and returns a hint", () => {
    // Fill 1:0 but not 1:1, then try to promote 1:0 → parent 2:0 needs sibling 1:1.
    const picks: Picks = { "1:0": "t0" };
    const r = promote(picks, FIELD, {}, 1, 0);
    expect(r.hint).toBe("1:1"); // pulse the missing sibling
    expect(r.picks["2:0"]).toBeUndefined();
  });

  it("promotes when both feeders are present", () => {
    const picks: Picks = { "1:0": "t0", "1:1": "t2" };
    const r = promote(picks, FIELD, {}, 1, 0);
    expect(r.picks["2:0"]).toBe("t0");
  });

  it("re-picking the other feeder replaces the parent and clears the whole ancestor chain (path-based)", () => {
    // A full chain t0 → champion, then re-pick the sibling at ring 1.
    const picks: Picks = { "1:0": "t0", "1:1": "t2", "2:0": "t0", "3:0": "t0", "4:0": "t0", "5:0": "t0" };
    const r = promote(picks, FIELD, {}, 1, 1); // advance t2 (the other feeder) into 2:0
    expect(r.picks["2:0"]).toBe("t2"); // parent replaced
    // everything above the parent is cleared regardless of team identity
    expect(r.picks["3:0"]).toBeUndefined();
    expect(r.picks["4:0"]).toBeUndefined();
    expect(r.picks["5:0"]).toBeUndefined();
  });

  it("does not promote into an auto-locked (finished) parent slot", () => {
    const picks: Picks = { "1:0": "t0", "1:1": "t2" };
    const results: Results = { "2:0": "t99" }; // 2:0 already decided (real result)
    const r = promote(picks, FIELD, results, 1, 0);
    expect(r.noop).toBe(true);
    expect(r.picks["2:0"]).toBeUndefined(); // never overwrites a real result
  });

  it("is a no-op when the team is already through", () => {
    const picks: Picks = { "1:0": "t0", "1:1": "t2", "2:0": "t0" };
    const r = promote(picks, FIELD, {}, 1, 0);
    expect(r.noop).toBe(true);
  });

  it("does nothing for rings 5+ or an empty node", () => {
    expect(promote({}, FIELD, {}, 5, 0).noop).toBe(true);
    expect(promote({}, FIELD, {}, 2, 0).noop).toBe(true); // 2:0 empty → nothing to advance
  });
});

describe("autoPicks — display overlay, never null, circle-only", () => {
  it("fills finished slots and skips undecided ones", () => {
    const results: Results = { "1:0": "t0", "2:0": null, "3:0": "t9" };
    expect(autoPicks(results)).toEqual({ "1:0": "t0", "3:0": "t9" });
  });
});

describe("validate — stale-feeder cascade to the champion", () => {
  it("marks a whole downstream chain stale when a feeder resolved to a different team", () => {
    // User advanced 'X' from ring 2 up to the champion, but ring-1 feeders resolved to Y/Z.
    const picks: Picks = { "2:0": "X", "3:0": "X", "4:0": "X", "5:0": "X" };
    const results: Results = { "1:0": "Y", "1:1": "Z" }; // finished, neither is X
    const { stale } = validate(picks, FIELD, results);
    expect(stale.has("2:0")).toBe(true);
    expect(stale.has("3:0")).toBe(true);
    expect(stale.has("4:0")).toBe(true);
    expect(stale.has("5:0")).toBe(true);
  });

  it("does not mark an auto-locked slot stale, nor a pick still supported by a resolved feeder", () => {
    const picks: Picks = { "2:0": "Y" };
    const results: Results = { "1:0": "Y", "1:1": "Z", "2:0": "Y" }; // 2:0 finished = Y
    expect(validate(picks, FIELD, results).stale.size).toBe(0);
  });

  it("a pick supported by a resolved feeder is valid", () => {
    const picks: Picks = { "2:0": "Y" };
    const results: Results = { "1:0": "Y", "1:1": "Z" }; // feeder Y resolved → Y is reachable
    expect(validate(picks, FIELD, results).stale.has("2:0")).toBe(false);
  });
});

describe("completeBracket", () => {
  it("is false with a gap, true when all 31 slots are filled", () => {
    const full: Picks = {};
    for (let ring = 1; ring <= 5; ring++) {
      for (let idx = 0; idx < GEO.counts[ring]; idx++) full[key(ring, idx)] = "x";
    }
    expect(completeBracket(full)).toBe(true);
    delete full["2:3"];
    expect(completeBracket(full)).toBe(false);
  });
});

describe("score — decided-and-predicted only", () => {
  it("counts only decided slots the user actually picked", () => {
    const picks: Picks = { "1:0": "a", "1:1": "b", "2:0": "a" };
    const results: Results = { "1:0": "a", "1:1": "c", "2:0": null };
    expect(score(picks, results)).toEqual({ correct: 1, decided: 2 }); // 2:0 undecided → excluded
  });
  it("empty picks → 0/0 (no throw)", () => {
    expect(score({}, {})).toEqual({ correct: 0, decided: 0 });
  });
  it("a pick whose match's real winner is a different team scores as wrong", () => {
    expect(score({ "3:0": "x" }, { "3:0": "y" })).toEqual({ correct: 0, decided: 1 });
  });
  it("a fully-correct complete bracket scores 31/31", () => {
    const picks: Picks = {};
    const results: Results = {};
    for (let ring = 1; ring <= 5; ring++) {
      for (let idx = 0; idx < GEO.counts[ring]; idx++) {
        const t = `w${ring}_${idx}`;
        picks[key(ring, idx)] = t;
        results[key(ring, idx)] = t;
      }
    }
    expect(score(picks, results)).toEqual({ correct: 31, decided: 31 });
  });
});

describe("bracketSvg — pure, self-contained, animation-free", () => {
  const view = {
    slots: {
      "0:0": { code: "BRA", state: "empty" as const },
      "1:0": { code: "BRA", state: "user-pick" as const },
      "2:0": { code: "BRA", state: "correct" as const },
      "3:0": { code: null, state: "upcoming" as const }, // TBD slot — no code
    },
  };

  it("is deterministic and carries no animation (reduced-motion stays in CSS)", () => {
    const a = bracketSvg(view);
    expect(a).toBe(bracketSvg(view)); // byte-stable
    expect(a).not.toMatch(/animation:/);
    expect(a).not.toMatch(/@keyframes/);
    expect(a.startsWith("<svg")).toBe(true);
  });

  it("never emits a 'null'/'undefined' label for a codeless slot", () => {
    const s = bracketSvg(view);
    expect(s).not.toContain(">null<");
    expect(s).not.toContain(">undefined<");
    expect(s).toContain(">BRA<"); // real codes still render
  });

  it("scales with the size option", () => {
    expect(bracketSvg(view, { size: 596 })).toContain('viewBox="0 0 596 596"');
  });
});

describe("chipColor", () => {
  it("is deterministic per code and falls back for null", () => {
    expect(chipColor("BRA")).toBe(chipColor("BRA"));
    expect(chipColor(null)).toBe("#334155");
  });
});

describe("bindBracket — label-recursion + advancer-match", () => {
  // Canonical SEQUENTIAL full bracket (32 teams). r16[j] fed by r32[2j],r32[2j+1];
  // home always advances. qf/sf/final reference children by "<round> N Winner" labels.
  // (Sequentiality is just for the generator — bindBracket reads the labels, which is
  // what makes it work for the real non-sequential draw too.)
  function fullBracket(opts: { r16Resolved?: boolean; dropR32?: number } = {}): KnockoutFixture[] {
    const { r16Resolved = true, dropR32 = -1 } = opts;
    const fx: KnockoutFixture[] = [];
    const F = (externalId: number, round: KnockoutFixture["round"], o: Partial<KnockoutFixture>): KnockoutFixture => ({
      externalId, round, homeTeamId: null, awayTeamId: null, homeLabel: null, awayLabel: null, advancerTeamId: null, ...o,
    });
    // r32: ext 100..115; home "H{i}" advances
    for (let i = 0; i < 16; i++) {
      const resolved = i !== dropR32;
      fx.push(F(100 + i, "r32", {
        homeTeamId: `H${i}`, awayTeamId: `A${i}`,
        advancerTeamId: resolved ? `H${i}` : null,
      }));
    }
    // r16: ext 200..207; feeders r32[2j],r32[2j+1]; home team = H{2j}
    for (let j = 0; j < 8; j++) {
      const homeT = r16Resolved && j * 2 !== dropR32 ? `H${2 * j}` : null;
      const awayT = r16Resolved && j * 2 + 1 !== dropR32 ? `H${2 * j + 1}` : null;
      fx.push(F(200 + j, "r16", {
        homeLabel: `Round of 32 ${2 * j + 1} Winner`, awayLabel: `Round of 32 ${2 * j + 2} Winner`,
        homeTeamId: homeT, awayTeamId: awayT, advancerTeamId: homeT,
      }));
    }
    // qf: ext 300..303; feeders r16[2k],r16[2k+1]
    for (let k = 0; k < 4; k++)
      fx.push(F(300 + k, "qf", { homeLabel: `Round of 16 ${2 * k + 1} Winner`, awayLabel: `Round of 16 ${2 * k + 2} Winner` }));
    // sf: ext 400..401
    for (let m = 0; m < 2; m++)
      fx.push(F(400 + m, "sf", { homeLabel: `Quarterfinal ${2 * m + 1} Winner`, awayLabel: `Quarterfinal ${2 * m + 2} Winner` }));
    // final + a third-place (must be ignored)
    fx.push(F(500, "final", { homeLabel: "Semifinal 1 Winner", awayLabel: "Semifinal 2 Winner" }));
    fx.push(F(501, "third", { homeLabel: "Semifinal 1 Loser", awayLabel: "Semifinal 2 Loser" }));
    return fx;
  }

  it("places all 31 slots + 32 entrants, no pending, when the tree is fully derivable", () => {
    const b = bindBracket(fullBracket());
    expect(Object.keys(b.slotFixtureExternalId)).toHaveLength(31);
    expect(Object.keys(b.ring0TeamId)).toHaveLength(32);
    expect(b.pending).toHaveLength(0);
  });

  it("reconstructs the tree from labels (champion=final, ring-1=r32, ring-0=entrants)", () => {
    const b = bindBracket(fullBracket());
    expect(b.slotFixtureExternalId["5:0"]).toBe(500); // final at champion slot
    expect(b.slotFixtureExternalId["4:0"]).toBe(400); // sf1
    expect(b.slotFixtureExternalId["3:0"]).toBe(300); // qf1
    expect(b.slotFixtureExternalId["2:0"]).toBe(200); // r16[0]
    expect(b.slotFixtureExternalId["1:0"]).toBe(100); // r32[0]
    expect(b.slotFixtureExternalId["1:1"]).toBe(101); // r32[1]
    expect(b.ring0TeamId[0]).toBe("H0");
    expect(b.ring0TeamId[1]).toBe("A0");
    // third-place fixture is never placed
    expect(Object.values(b.slotFixtureExternalId)).not.toContain(501);
  });

  it("leaves a ring-1 slot pending when its feeding R32 hasn't resolved", () => {
    const b = bindBracket(fullBracket({ dropR32: 0 })); // r32[0] unresolved → r16[0] home TBD
    expect(b.pending).toContain("1:0");
    expect(b.slotFixtureExternalId["1:0"]).toBeUndefined();
    // the rest of the tree is unaffected
    expect(b.slotFixtureExternalId["1:1"]).toBe(101);
    expect(b.slotFixtureExternalId["5:0"]).toBe(500);
  });

  it("uses advancer-match for higher rounds too when they've resolved", () => {
    // Resolve qf1's home team to r16[0]'s advancer so the qf uses advancer-match, not the label.
    const fx = fullBracket();
    const qf1 = fx.find((f) => f.externalId === 300)!;
    qf1.homeTeamId = "H0"; // = advancer of r16[0] (200)
    qf1.homeLabel = "Some Country"; // label no longer a "Winner" pattern
    const b = bindBracket(fx);
    expect(b.slotFixtureExternalId["2:0"]).toBe(200); // still resolved via advancer-match
    expect(b.pending).toHaveLength(0);
  });
});
