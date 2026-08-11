import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StrictMode } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AnalyticsModules } from "../../components/analytics/AnalyticsModules";
import type { AnalyticsModulesView } from "../../lib/analytics-modules";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

type RequestRecord = {
  url: string;
  signal: AbortSignal;
  resolve: (value: { ok: boolean; json: () => Promise<AnalyticsModulesView> }) => void;
  reject: (reason: unknown) => void;
};

function payload(leagueId: string, competitionId: string, rate: number): AnalyticsModulesView {
  return {
    leagueId,
    competitionId,
    modules: {
      youVsRoom: {
        windowGameweeks: [1],
        otherMemberCount: 2,
        metrics: {
          exactRate: { viewer: rate, otherAverage: rate + 0.11, difference: -0.11, otherCount: 2 },
          resultRate: { viewer: rate + 0.01, otherAverage: rate + 0.12, difference: -0.11, otherCount: 2 },
          avgGoalMiss: { viewer: 1, otherAverage: 2, difference: -1, otherCount: 2 },
          last5Form: { viewer: 1, otherAverage: 2, difference: -1, otherCount: 2 },
        },
        exactRateBars: [{ userId: "viewer", rate }],
        sentence: null,
      },
      rivalry: null,
      habits: null,
      weeklyLabels: null,
      clubReads: null,
      receipts: null,
    },
  };
}

function installFetch() {
  const requests: RequestRecord[] = [];
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
    new Promise<{ ok: boolean; json: () => Promise<AnalyticsModulesView> }>((resolve, reject) => {
      requests.push({
        url: String(input),
        signal: init?.signal as AbortSignal,
        resolve,
        reject,
      });
    }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, requests };
}

function resolveRequest(request: RequestRecord, data: AnalyticsModulesView) {
  request.resolve({ ok: true, json: async () => data });
}

describe("AnalyticsModules client lifecycle", () => {
  it("does not fetch before Analytics activation", () => {
    const { fetchMock } = installFetch();
    render(<AnalyticsModules leagueId="league-a" competitionId="competition-a" activated={false} />);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryByText("Loading modules…")).not.toBeInTheDocument();
  });

  it("does not fetch when the active tab has no resolved scope", () => {
    const { fetchMock } = installFetch();
    render(<AnalyticsModules leagueId={null} competitionId={null} activated />);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryByText("Loading modules…")).not.toBeInTheDocument();
  });

  it("fetches once on activation and renders the response", async () => {
    const { fetchMock, requests } = installFetch();
    const view = render(<AnalyticsModules leagueId="league-a" competitionId="competition-a" activated={false} />);
    view.rerender(<AnalyticsModules leagueId="league-a" competitionId="competition-a" activated />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(requests[0]?.url).toContain("leagueId=league-a");
    expect(requests[0]?.url).toContain("competitionId=competition-a");
    resolveRequest(requests[0]!, payload("league-a", "competition-a", 0.11));
    await waitFor(() => expect(screen.getByText("11% · 22% · -11%")).toBeInTheDocument());
  });

  it("refetches on a pair change and returns to the pair cache without a third fetch", async () => {
    const { fetchMock, requests } = installFetch();
    const view = render(<AnalyticsModules leagueId="league-a" competitionId="competition-a" activated />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    resolveRequest(requests[0]!, payload("league-a", "competition-a", 0.11));
    await waitFor(() => expect(screen.getByText("11% · 22% · -11%")).toBeInTheDocument());

    view.rerender(<AnalyticsModules leagueId="league-b" competitionId="competition-a" activated />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    resolveRequest(requests[1]!, payload("league-b", "competition-a", 0.33));
    await waitFor(() => expect(screen.getByText("33% · 44% · -11%")).toBeInTheDocument());

    view.rerender(<AnalyticsModules leagueId="league-a" competitionId="competition-a" activated />);
    await waitFor(() => expect(screen.getByText("11% · 22% · -11%")).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("shows a quiet retry line after a failed request", async () => {
    const { fetchMock, requests } = installFetch();
    render(<AnalyticsModules leagueId="league-a" competitionId="competition-a" activated />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    requests[0]!.reject(new Error("network"));
    await waitFor(() => expect(screen.getByText("Modules could not be loaded.")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    resolveRequest(requests[1]!, payload("league-a", "competition-a", 0.11));
    await waitFor(() => expect(screen.getByText("11% · 22% · -11%")).toBeInTheDocument());
  });

  it("drops an out-of-order response for the old pair", async () => {
    const { fetchMock, requests } = installFetch();
    const view = render(<AnalyticsModules leagueId="league-a" competitionId="competition-a" activated />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    view.rerender(<AnalyticsModules leagueId="league-b" competitionId="competition-b" activated />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    resolveRequest(requests[1]!, payload("league-b", "competition-b", 0.33));
    await waitFor(() => expect(screen.getByText("33% · 44% · -11%")).toBeInTheDocument());
    resolveRequest(requests[0]!, payload("league-a", "competition-a", 0.11));
    await waitFor(() => expect(screen.getByText("33% · 44% · -11%")).toBeInTheDocument());
    expect(screen.queryByText("11% · 22% · -11%")).not.toBeInTheDocument();
  });

  it("survives StrictMode effect replay and populates the module", async () => {
    const { fetchMock, requests } = installFetch();
    render(
      <StrictMode>
        <AnalyticsModules leagueId="league-a" competitionId="competition-a" activated />
      </StrictMode>,
    );
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(requests[0]?.signal.aborted).toBe(true);
    resolveRequest(requests[1]!, payload("league-a", "competition-a", 0.55));
    await waitFor(() => expect(screen.getByText("55% · 66% · -11%")).toBeInTheDocument());
  });

  it("keeps settled A after a late normal response for B in an A to B to A switch", async () => {
    const { fetchMock, requests } = installFetch();
    const view = render(<AnalyticsModules leagueId="league-a" competitionId="competition-a" activated />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    view.rerender(<AnalyticsModules leagueId="league-b" competitionId="competition-b" activated />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    view.rerender(<AnalyticsModules leagueId="league-a" competitionId="competition-a" activated />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));

    expect(requests[0]?.signal.aborted).toBe(true);
    expect(requests[1]?.signal.aborted).toBe(true);
    requests[0]!.reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
    resolveRequest(requests[2]!, payload("league-a", "competition-a", 0.11));
    await waitFor(() => expect(screen.getByText("11% · 22% · -11%")).toBeInTheDocument());

    resolveRequest(requests[1]!, payload("league-b", "competition-b", 0.33));
    await waitFor(() => expect(screen.getByText("11% · 22% · -11%")).toBeInTheDocument());
    expect(screen.queryByText("33% · 44% · -11%")).not.toBeInTheDocument();
    expect(screen.queryByText("Modules could not be loaded.")).not.toBeInTheDocument();
  });
});
