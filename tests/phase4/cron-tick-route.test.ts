import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { rpc } = vi.hoisted(() => ({
  rpc: vi.fn(),
}));

vi.mock("@/lib/supabase/service", () => ({
  createServiceRoleClient: vi.fn(() => ({
    rpc,
  })),
}));
vi.mock("@/lib/settle-contest", () => ({
  lockDueContests: vi.fn(async () => ({})),
  settleFinishedContests: vi.fn(async () => ({})),
}));
vi.mock("@/lib/espn", () => ({
  pollScores: vi.fn(async () => ({})),
  resolveKnockoutBracket: vi.fn(async () => ({})),
}));
vi.mock("@/lib/espn-insights", () => ({
  pollInsights: vi.fn(async () => ({})),
}));
vi.mock("@/lib/sync-fpl", () => ({
  syncFpl: vi.fn(async () => ({})),
  gameweekMaintenance: vi.fn(async () => ({})),
}));
vi.mock("@/lib/gameweek-db", () => ({
  dispatchGameweekSettlements: vi.fn(async () => ({})),
}));
vi.mock("@/lib/espn-summary-fetch", () => ({
  createSummaryFetcher: vi.fn(() => ({ stats: () => ({}) })),
}));
vi.mock("@/lib/poll-insights", () => ({
  pollInsightsLeased: vi.fn(async () => ({})),
}));
vi.mock("@/lib/reconcile-match-cache", () => ({
  reconcileMatchCache: vi.fn(async () => ({})),
}));
vi.mock("@/lib/poll-match-data", () => ({
  pollMatchData: vi.fn(async () => ({})),
}));
vi.mock("@/lib/poll-commentary", () => ({
  pollCommentary: vi.fn(async () => ({})),
}));
vi.mock("@/lib/poll-standings", () => ({
  pollStandings: vi.fn(async () => ({})),
  deriveStandings: vi.fn(async () => ({})),
}));
vi.mock("@/lib/poll-team-news", () => ({
  pollTeamNews: vi.fn(async () => ({})),
}));
vi.mock("@/lib/poll-understat", () => ({
  pollUnderstat: vi.fn(async () => ({})),
}));
vi.mock("@/lib/poll-slow-providers", () => ({
  pollSlowProviders: vi.fn(async () => ({})),
}));

import { GET } from "../../app/api/cron/tick/route";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { settleFinishedContests } from "@/lib/settle-contest";
import { pollInsights } from "@/lib/espn-insights";
import { pollInsightsLeased } from "@/lib/poll-insights";
import { reconcileMatchCache } from "@/lib/reconcile-match-cache";
import { pollMatchData } from "@/lib/poll-match-data";
import { pollCommentary } from "@/lib/poll-commentary";
import { pollStandings, deriveStandings } from "@/lib/poll-standings";
import { pollTeamNews } from "@/lib/poll-team-news";
import { pollUnderstat } from "@/lib/poll-understat";
import { pollSlowProviders } from "@/lib/poll-slow-providers";

describe("cron tick missing-writer-RPC regression", () => {
  beforeEach(() => {
    vi.stubEnv("CRON_SECRET", "phase4-test-secret");
    rpc.mockImplementation(async (name: string) =>
      name === "claim_insights_writer"
        ? { data: null, error: { code: "PGRST202", message: "function does not exist" } }
        : { data: true, error: null },
    );
    vi.mocked(settleFinishedContests).mockResolvedValue({ candidates: 0, settled: 0 });
    vi.mocked(pollInsights).mockResolvedValue({ checked: 0, updated: 0 });
    vi.mocked(pollInsightsLeased).mockResolvedValue({
      lease: "not_due",
      fetches: 0,
      writes: 0,
    });
    for (const [name, step] of [
      ["reconcile", reconcileMatchCache],
      ["matchData", pollMatchData],
      ["commentary", pollCommentary],
      ["standings", pollStandings],
      ["derivedStandings", deriveStandings],
      ["teamNews", pollTeamNews],
      ["understat", pollUnderstat],
      ["fotmob", pollSlowProviders],
    ] as const) {
      vi.mocked(step).mockRejectedValue(new Error(`${name} dark failure`));
    }
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("returns 200, runs legacy insights once, and keeps every Phase 4 step dark", async () => {
    // Route regression: removing the missing-RPC fallback or its caught step outcome breaks this proof.
    const response = await GET(
      new NextRequest("http://localhost/api/cron/tick?secret=phase4-test-secret"),
    );
    const body = (await response.json()) as {
      phase4: Record<string, { error?: string }>;
    };

    expect(response.status).toBe(200);
    expect(vi.mocked(pollInsights)).toHaveBeenCalledTimes(1);
    const admin = vi.mocked(createServiceRoleClient).mock.results[0]?.value as {
      rpc: ReturnType<typeof vi.fn>;
    };
    expect(admin.rpc).toHaveBeenCalledWith("claim_insights_writer", {
      p_lease_seconds: 300,
    });

    const phase4Keys = [
      "insights",
      "reconcile",
      "matchData",
      "commentary",
      "standings",
      "derivedStandings",
      "teamNews",
      "understat",
      "fotmob",
    ];
    expect(Object.keys(body.phase4)).toEqual(phase4Keys);
    for (const key of phase4Keys) {
      expect(body.phase4[key]?.error, `${key} must be a caught dark outcome`).toEqual(
        expect.any(String),
      );
    }
  });

  it("keeps the tick alive when the rejected legacy poll is the fallback failure", async () => {
    // Route regression: running legacy polling outside phase4Step makes this rejection return 500 and skip later steps.
    const legacyError = new Error("legacy poll failed");
    rpc.mockImplementation(async (name: string) =>
      name === "claim_insights_writer"
        ? { data: null, error: { code: "PGRST202", message: "function does not exist" } }
        : { data: true, error: null },
    );
    vi.mocked(pollInsights).mockRejectedValue(legacyError);

    const response = await GET(
      new NextRequest("http://localhost/api/cron/tick?secret=phase4-test-secret"),
    );
    const body = (await response.json()) as {
      insights: { error?: string };
      phase4: Record<string, { error?: string }>;
    };

    expect(response.status).toBe(200);
    expect(body.insights.error).toBe(legacyError.message);
    expect(vi.mocked(pollInsights)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(reconcileMatchCache)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(pollMatchData)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(pollCommentary)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(pollStandings)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(deriveStandings)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(pollTeamNews)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(pollUnderstat)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(pollSlowProviders)).toHaveBeenCalledTimes(1);
    expect(Object.keys(body.phase4)).toEqual([
      "insights",
      "reconcile",
      "matchData",
      "commentary",
      "standings",
      "derivedStandings",
      "teamNews",
      "understat",
      "fotmob",
    ]);
  });

  it("keeps the tick alive when legacy lease release rejects after polling", async () => {
    // Route regression: releasing the legacy lease outside phase4Step makes a release failure return 500 and skip later steps.
    rpc.mockImplementation(async (name: string) => {
      if (name === "claim_insights_writer") {
        return {
          data: { writer: "legacy", token: "legacy-token" },
          error: null,
        };
      }
      if (name === "release_sync_lease") {
        return { data: null, error: { message: "release failed" } };
      }
      return { data: true, error: null };
    });

    const response = await GET(
      new NextRequest("http://localhost/api/cron/tick?secret=phase4-test-secret"),
    );
    const body = (await response.json()) as {
      insights: { error?: string };
      phase4: Record<string, { error?: string }>;
    };

    expect(response.status).toBe(200);
    expect(body.insights.error).toBe("release lease(espn_insights): release failed");
    expect(vi.mocked(pollInsights)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(reconcileMatchCache)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(pollMatchData)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(pollCommentary)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(pollStandings)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(deriveStandings)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(pollTeamNews)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(pollUnderstat)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(pollSlowProviders)).toHaveBeenCalledTimes(1);
    expect(Object.keys(body.phase4)).toEqual([
      "insights",
      "reconcile",
      "matchData",
      "commentary",
      "standings",
      "derivedStandings",
      "teamNews",
      "understat",
      "fotmob",
    ]);
  });

  it("does not start either writer after an ambiguous claim error", async () => {
    // Route regression: treating every claim error as an absent function starts an unleased legacy writer.
    const claimError = { code: "ETIMEDOUT", message: "claim network failure" };
    rpc.mockImplementation(async (name: string) =>
      name === "claim_insights_writer"
        ? { data: null, error: claimError }
        : { data: true, error: null },
    );

    const response = await GET(
      new NextRequest("http://localhost/api/cron/tick?secret=phase4-test-secret"),
    );
    const body = (await response.json()) as {
      phase4: Record<string, { error?: string }>;
    };

    expect(response.status).toBe(200);
    expect(vi.mocked(pollInsights)).toHaveBeenCalledTimes(0);
    expect(vi.mocked(pollInsightsLeased)).toHaveBeenCalledTimes(0);
    expect(body.phase4.insights?.error).toContain("claim network failure");
    expect(Object.keys(body.phase4)).toEqual([
      "insights",
      "reconcile",
      "matchData",
      "commentary",
      "standings",
      "derivedStandings",
      "teamNews",
      "understat",
      "fotmob",
    ]);
  });

  it.each(["PGRST202", "42883"] as const)(
    "uses legacy polling exactly once for absent-function code %s",
    async (code) => {
      // Route regression: removing either supported absent-function code from the classifier stops the pre-migration writer.
      rpc.mockImplementation(async (name: string) =>
        name === "claim_insights_writer"
          ? { data: null, error: { code, message: "function does not exist" } }
          : { data: true, error: null },
      );

      const response = await GET(
        new NextRequest("http://localhost/api/cron/tick?secret=phase4-test-secret"),
      );

      expect(response.status).toBe(200);
      expect(vi.mocked(pollInsights)).toHaveBeenCalledTimes(1);
      expect(vi.mocked(pollInsightsLeased)).toHaveBeenCalledTimes(0);
    },
  );

  it("treats an un-coded plain claim Error as ambiguous", async () => {
    // Route regression: using a message-only fallback for every plain Error can run legacy after an unknown claim failure.
    rpc.mockImplementation(async (name: string) =>
      name === "claim_insights_writer"
        ? { data: null, error: new Error("claim network failure") }
        : { data: true, error: null },
    );

    const response = await GET(
      new NextRequest("http://localhost/api/cron/tick?secret=phase4-test-secret"),
    );
    const body = (await response.json()) as {
      phase4: Record<string, { error?: string }>;
    };

    expect(response.status).toBe(200);
    expect(vi.mocked(pollInsights)).toHaveBeenCalledTimes(0);
    expect(body.phase4.insights?.error).toContain("claim network failure");
  });

  it("does not use legacy polling for a code-less missing-function Error", async () => {
    // This fails if anyone reintroduces message-based classification.
    const claimError = new Error("claim_insights_writer: function does not exist");
    rpc.mockImplementation(async (name: string) =>
      name === "claim_insights_writer"
        ? { data: null, error: claimError }
        : { data: true, error: null },
    );

    const response = await GET(
      new NextRequest("http://localhost/api/cron/tick?secret=phase4-test-secret"),
    );
    const body = (await response.json()) as {
      phase4: Record<string, { error?: string }>;
    };

    expect(response.status).toBe(200);
    expect(vi.mocked(pollInsights)).toHaveBeenCalledTimes(0);
    expect(body.phase4.insights?.error).toContain(claimError.message);
  });

  it("settles finished contests before claiming the insights writer", async () => {
    // Route regression: moving the claim before settlement violates the required settlement-before-writer handoff.
    const order: string[] = [];
    vi.mocked(settleFinishedContests).mockImplementation(async () => {
      await Promise.resolve();
      order.push("settlement-complete");
      return { candidates: 0, settled: 0 };
    });
    rpc.mockImplementation(async (name: string) => {
      if (name === "claim_insights_writer") {
        order.push("claim-invoked");
        return { data: null, error: { message: "function does not exist" } };
      }
      return { data: true, error: null };
    });

    const response = await GET(
      new NextRequest("http://localhost/api/cron/tick?secret=phase4-test-secret"),
    );

    expect(response.status).toBe(200);
    expect(order).toEqual(["settlement-complete", "claim-invoked"]);
  });
});
