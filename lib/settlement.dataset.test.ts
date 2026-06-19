// Data-driven settle-up check (plan §17.8). Reads the CSV golden datasets in
// /test-data and runs the REAL simplifyDebts against each row, checking two things:
//   1. correctness — output directed amounts match the expected owe_XY columns
//   2. reorder-invariance — the SAME plan results no matter what order players are
//      fed in (memberIds has no ORDER BY, so order varies between requests; if the
//      plan is order-sensitive, two viewers see contradictory amounts)
// "Pass" requires BOTH. The summary prints how many pass per dataset.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { simplifyDebts, type Transfer } from "./settlement";

type Row = {
  id: string;
  scenario: string;
  nets: Record<string, number>;
  expected: Record<string, number>; // "X->Y" -> amount, non-zero only
};

function parseCsv(file: string, players: string[]): Row[] {
  const text = readFileSync(new URL(file, import.meta.url), "utf8");
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
  const header = lines[0].split(",");
  const oweCols = header.filter((h) => h.startsWith("owe_"));
  return lines.slice(1).map((line) => {
    const cells = line.split(",");
    const rec: Record<string, string> = {};
    header.forEach((h, i) => (rec[h] = cells[i]));
    const nets: Record<string, number> = {};
    for (const p of players) nets[p] = Number(rec[`net_${p}`]);
    const expected: Record<string, number> = {};
    for (const c of oweCols) {
      const amt = Number(rec[c]);
      if (amt !== 0) {
        const pair = c.slice(4); // "owe_AB" -> "AB"
        expected[`${pair[0]}->${pair[1]}`] = amt;
      }
    }
    return { id: rec.case_id, scenario: rec.scenario, nets, expected };
  });
}

const permutations = <T,>(arr: T[]): T[][] =>
  arr.length <= 1
    ? [arr]
    : arr.flatMap((v, i) =>
        permutations([...arr.slice(0, i), ...arr.slice(i + 1)]).map((p) => [v, ...p]),
      );

function asMap(ts: Transfer[]): Record<string, number> {
  const m: Record<string, number> = {};
  for (const t of ts) m[`${t.from}->${t.to}`] = (m[`${t.from}->${t.to}`] ?? 0) + t.amount;
  return m;
}

const eqMap = (a: Record<string, number>, b: Record<string, number>) => {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) if ((a[k] ?? 0) !== (b[k] ?? 0)) return false;
  return true;
};

// Build nets in a SPECIFIC key order (object insertion order is what simplifyDebts
// sees via Object.entries) so we can probe order-sensitivity.
const orderedNets = (nets: Record<string, number>, order: string[]) => {
  const o: Record<string, number> = {};
  for (const p of order) o[p] = nets[p];
  return o;
};

function runSet(name: string, file: string, players: string[]) {
  const rows = parseCsv(file, players);
  const perms = permutations(players);
  let correct = 0, invariant = 0, sumZero = 0, bothPass = 0;
  const fails: string[] = [];

  for (const r of rows) {
    // dataset integrity: nets must sum to 0
    const total = players.reduce((t, p) => t + r.nets[p], 0);
    if (total === 0) sumZero++;

    // 1. correctness on the canonical (id-asc) ordering
    const canon = asMap(simplifyDebts(orderedNets(r.nets, players)));
    const isCorrect = eqMap(canon, r.expected);
    if (isCorrect) correct++;

    // 2. reorder-invariance: every permutation must produce the expected plan
    const isInvariant = perms.every((perm) => eqMap(asMap(simplifyDebts(orderedNets(r.nets, perm))), r.expected));
    if (isInvariant) invariant++;

    if (isCorrect && isInvariant && total === 0) bothPass++;
    else fails.push(`  ${r.id}  correct=${isCorrect} invariant=${isInvariant} sum0=${total === 0}  (${r.scenario})`);
  }

  console.log(`\n=== ${name}: ${rows.length} cases ===`);
  console.log(`  nets sum to 0:        ${sumZero}/${rows.length}`);
  console.log(`  correct (canonical):  ${correct}/${rows.length}`);
  console.log(`  reorder-invariant:    ${invariant}/${rows.length}`);
  console.log(`  PASS (all checks):    ${bothPass}/${rows.length}`);
  if (fails.length) console.log(`  failing rows:\n${fails.join("\n")}`);

  return { rows, correct, invariant, sumZero, bothPass, total: rows.length };
}

describe("settle-up golden dataset", () => {
  it("3-player league", () => {
    const r = runSet("3-player", "../test-data/settle-3p.csv", ["A", "B", "C"]);
    expect(r.sumZero).toBe(r.total);   // dataset integrity
    expect(r.correct).toBe(r.total);   // simplifyDebts produces the expected plan
    expect(r.invariant).toBe(r.total); // same plan for every viewer (needs id-asc tiebreak)
  });

  it("4-player league", () => {
    const r = runSet("4-player", "../test-data/settle-4p.csv", ["A", "B", "C", "D"]);
    expect(r.sumZero).toBe(r.total);
    expect(r.correct).toBe(r.total);
    expect(r.invariant).toBe(r.total);
  });
});
