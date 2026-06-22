import { describe, it, expect, vi, beforeEach } from "vitest";
import { makeClient, type QuerySpec } from "../../../../../test/supabase-fake";

// Mock the server supabase client + Next cache; use the real prediction-validation.
const createClient = vi.fn();
vi.mock("@/lib/supabase/server", () => ({ createClient: () => createClient() }));
const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: (p: string) => revalidatePath(p) }));

import { submitPrediction } from "./actions";

const USER = { id: "u1" };

// Build a fake client with auth + a resolver, and point createClient at it.
function mount(resolve: (s: QuerySpec) => any, user: any = USER) {
  const c = makeClient(resolve);
  createClient.mockResolvedValue(Object.assign(c, { auth: { getUser: async () => ({ data: { user } }) } }));
  return c;
}

const baseInput = { contestId: "c1", slug: "kk", outcome: "home" as const, predHome: 2, predAway: 1 };
const upsertOf = (c: ReturnType<typeof makeClient>, contestId: string) =>
  c.calls.find((s) => s.table === "predictions" && s.op === "upsert" && (s.payload as any)?.contest_id === contestId);

beforeEach(() => {
  createClient.mockReset();
  revalidatePath.mockReset();
});

describe("submitPrediction — guards", () => {
  it("rejects negative scores before touching the DB", async () => {
    const c = mount(() => ({}));
    expect(await submitPrediction({ ...baseInput, predAway: -1 })).toEqual({ error: "Scores can't be negative." });
    expect(c.calls).toHaveLength(0);
  });

  it("rejects when not signed in", async () => {
    mount(() => ({}), null);
    expect(await submitPrediction(baseInput)).toEqual({ error: "Not signed in." });
  });

  it("reports a missing contest", async () => {
    mount((s) => (s.table === "contests" ? { data: null, error: { message: "no rows" } } : {}));
    expect(await submitPrediction(baseInput)).toEqual({ error: "Contest not found." });
  });

  it("rejects a scoreline that contradicts the selected outcome (group)", async () => {
    mount((s) => (s.table === "contests" ? { data: { fixture_id: "F", is_knockout: false } } : {}));
    // outcome "home" but 0–1 is an away win
    const r = await submitPrediction({ ...baseInput, predHome: 0, predAway: 1 });
    expect(r.error).toMatch(/Scoreline doesn't match/i);
  });
});

describe("submitPrediction — primary write", () => {
  const primaryOk = (s: QuerySpec) =>
    s.table === "contests" && s.op === "select" ? { data: { fixture_id: "F", is_knockout: false } } : {};

  it("writes the prediction and revalidates on success", async () => {
    const c = mount(primaryOk);
    const r = await submitPrediction(baseInput);
    expect(r).toEqual({ error: null, ok: true, mirrored: [] });

    const up = upsertOf(c, "c1")!;
    expect(up.payload).toMatchObject({ contest_id: "c1", user_id: "u1", outcome: "home", pred_home: 2, pred_away: 1 });
    expect(up.upsertOpts).toEqual({ onConflict: "contest_id,user_id" });
    expect(revalidatePath).toHaveBeenCalledWith("/leagues/kk");
    expect(revalidatePath).toHaveBeenCalledWith("/leagues/kk/m/c1");
  });

  it("maps an RLS denial to a friendly 'locked' message", async () => {
    const c = mount((s) =>
      s.table === "predictions" && s.op === "upsert"
        ? { error: { message: "new row violates row-level security policy" } }
        : primaryOk(s),
    );
    expect(await submitPrediction(baseInput)).toEqual({ error: "This contest is locked." });
    expect(c.calls.some((s) => s.table === "predictions" && s.op === "upsert")).toBe(true);
  });

  it("maps trigger errors (knockout / scoreline) to friendly messages", async () => {
    const withErr = (msg: string) => (s: QuerySpec) =>
      s.table === "predictions" && s.op === "upsert" ? { error: { message: msg } } : primaryOk(s);

    mount(withErr("no draws in a knockout"));
    expect((await submitPrediction(baseInput)).error).toMatch(/pick a side/i);

    mount(withErr("scoreline contradicts selected result"));
    expect((await submitPrediction(baseInput)).error).toMatch(/doesn't match/i);
  });
});

describe("submitPrediction — cross-league mirroring", () => {
  it("mirrors into eligible siblings and reports per-target outcomes", async () => {
    // Sibling c2 succeeds; c3 is locked (RLS). Both are bound to the same fixture F.
    const valid = [
      { id: "c2", is_knockout: false, leagues: { slug: "pes" } },
      { id: "c3", is_knockout: false, leagues: { slug: "other" } },
    ];
    const c = mount((s) => {
      if (s.table === "contests" && s.op === "select" && s.filters.some((f) => f[0] === "in")) return { data: valid }; // mirror lookup
      if (s.table === "contests" && s.op === "select") return { data: { fixture_id: "F", is_knockout: false } }; // primary
      if (s.table === "predictions" && s.op === "upsert") {
        const id = (s.payload as any).contest_id;
        return id === "c3" ? { error: { message: "row-level security" } } : { error: null };
      }
      return {};
    });

    const r = await submitPrediction({ ...baseInput, alsoTargets: ["c2", "c3", "c1"] });
    expect(r.ok).toBe(true);
    expect(r.mirrored).toEqual([
      { contestId: "c2", ok: true, reason: null },
      { contestId: "c3", ok: false, reason: "locked" },
    ]);
    // the primary id is filtered out of the mirror set (neq guard) and a successful
    // mirror revalidates its own league paths
    expect(upsertOf(c, "c1")).toBeDefined();
    expect(revalidatePath).toHaveBeenCalledWith("/leagues/pes");
    expect(revalidatePath).not.toHaveBeenCalledWith("/leagues/other");
  });

  it("skips a sibling whose consistency check fails for its own format", async () => {
    // c2 is a knockout; mirroring a draw into it is invalid → reported, never written.
    const c = mount((s) => {
      if (s.table === "contests" && s.op === "select" && s.filters.some((f) => f[0] === "in"))
        return { data: [{ id: "c2", is_knockout: true, leagues: { slug: "pes" } }] };
      if (s.table === "contests" && s.op === "select") return { data: { fixture_id: "F", is_knockout: false } };
      return { error: null };
    });
    const r = await submitPrediction({ ...baseInput, outcome: "draw", predHome: 1, predAway: 1, alsoTargets: ["c2"] });
    expect(r.mirrored).toEqual([{ contestId: "c2", ok: false, reason: "invalid" }]);
    expect(upsertOf(c, "c2")).toBeUndefined();
  });
});
