import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { HomeMatchesTab } from "../../components/matches/HomeMatchesTab";
import { HomeTabs } from "../../components/HomeTabs";
import { HomeTabsContext } from "../../components/HomeTabsContext";
import type { FixtureRowView, GameweekSwitchOption, MatchesTabView } from "../../lib/matches-tab";
import type { MatchesHomeTabPayload } from "../../lib/matches-home-tab";
import { MATCH_COPY } from "../../lib/match-copy";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value: "visible",
  });
});

type RequestRecord = {
  url: string;
  signal: AbortSignal;
  resolve: (value: { ok: boolean; json: () => Promise<MatchesHomeTabPayload> }) => void;
  reject: (reason: unknown) => void;
  jsonSignalAborted?: boolean;
};

function view(
  selectedComp: string,
  scopes = [{ slug: selectedComp, name: selectedComp }],
  fixtures: FixtureRowView[] = [],
  switcher: GameweekSwitchOption[] = [
    { role: "previous", number: null, name: null, openingAt: null, state: "unavailable", lifecycle: null, disabled: true },
    { role: "current", number: 1, name: "Gameweek 1", openingAt: "2026-08-20T12:00:00.000Z", state: "open", lifecycle: "CL1", disabled: false },
    { role: "next", number: null, name: null, openingAt: null, state: "unavailable", lifecycle: null, disabled: true },
  ],
): MatchesTabView {
  const current = switcher.find((option) => option.role === "current") ?? switcher[1];
  return {
    competition: {
      id: selectedComp,
      slug: selectedComp,
      name: selectedComp,
      archived: false,
    },
    scopes,
    selectedScope: selectedComp,
    gw: {
      id: current?.number == null ? "gw1" : `gw${current.number}`,
      number: current?.number ?? 1,
      label: current?.name ?? "Gameweek 1",
      state: "pre",
      deadlineAt: current?.openingAt ?? "2026-08-20T12:00:00.000Z",
      isCurrent: true,
    },
    picker: { range: [1], futureCaveat: true, switcher },
    yourGw: null,
    winnersRecap: null,
    fixtures,
  };
}

function fixture(state = "FT"): FixtureRowView {
  return {
    id: "fixture-1",
    state,
    scheduled: false,
    kickoffAt: "2026-08-10T12:00:00.000Z",
    home: { name: "Home" },
    away: { name: "Away" },
    score: [1, 0],
    matchHref: "/m/fixture-1",
    insightsMark: false,
    yourCall: { kind: "none" },
  };
}

function full(
  freshness: "settled" | "pre" | "unresolved" = "pre",
  selectedComp = "pl-2026-27",
  requestedComp: string | null = null,
  scopes = [{ slug: selectedComp, name: selectedComp }],
  nextGw: Extract<MatchesHomeTabPayload, { empty: false }>["nextGw"] = null,
  switcher?: GameweekSwitchOption[],
  requestedGw: number | null = null,
): Extract<MatchesHomeTabPayload, { empty: false }> {
  return {
    empty: false,
    requestedComp,
    requestedGw,
    selectedComp,
    view: view(selectedComp, scopes, [], switcher),
    freshness,
    nextGw,
    receipt: null,
  };
}

function empty(requestedComp: string | null, selectedComp: string | null = null, requestedGw: number | null = null): MatchesHomeTabPayload {
  return { empty: true, requestedComp, requestedGw, selectedComp, freshness: "empty" };
}

function installFetch() {
  const requests: RequestRecord[] = [];
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
    new Promise<{ ok: boolean; json: () => Promise<MatchesHomeTabPayload> }>((resolve, reject) => {
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

function resolveRequest(request: RequestRecord, data: MatchesHomeTabPayload) {
  request.resolve({
    ok: true,
    json: async () => {
      request.jsonSignalAborted = request.signal.aborted;
      return data;
    },
  });
}

function renderAt(activeIndex: number) {
  return render(
    <HomeTabsContext.Provider value={{ activeIndex, analyticsActivated: false }}>
      <HomeMatchesTab />
    </HomeTabsContext.Provider>,
  );
}

async function activate(rendered: ReturnType<typeof render>) {
  rendered.rerender(
    <HomeTabsContext.Provider value={{ activeIndex: 1, analyticsActivated: false }}>
      <HomeMatchesTab />
    </HomeTabsContext.Provider>,
  );
}

async function resolveAndWait(request: RequestRecord, data: MatchesHomeTabPayload, text: string) {
  resolveRequest(request, data);
  await waitFor(() => expect(screen.getByText(text)).toBeInTheDocument());
}

describe("HomeMatchesTab activation and cache", () => {
  it("does not fetch before activation and fetches once on first activation", async () => {
    const { fetchMock, requests } = installFetch();
    const rendered = renderAt(0);
    expect(fetchMock).not.toHaveBeenCalled();

    await activate(rendered);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(requests[0]?.url).toBe("/api/matches/home-tab");
    await resolveAndWait(requests[0]!, full(), MATCH_COPY.matchesNoFixtures);
  });

  it("renders a stable three-way switch and disables an unavailable next week", async () => {
    const switcher: GameweekSwitchOption[] = [
      { role: "previous", number: 2, name: "Gameweek 2", openingAt: "2026-08-17T12:00:00.000Z", state: "settled", lifecycle: "CL5", disabled: false },
      { role: "current", number: 3, name: "Gameweek 3", openingAt: "2026-08-24T12:00:00.000Z", state: "live", lifecycle: "CL3", disabled: false },
      { role: "next", number: null, name: null, openingAt: null, state: "unavailable", lifecycle: null, disabled: true },
    ];
    const { fetchMock, requests } = installFetch();
    const rendered = renderAt(0);
    await activate(rendered);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await resolveAndWait(requests[0]!, full("unresolved", "pl-2026-27", null, undefined, null, switcher), MATCH_COPY.matchesNoFixtures);

    expect(screen.getByRole("button", { name: "GW2 · Settled" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "GW3 · Live" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("button", { name: "No next week yet" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "GW2 · Settled" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(requests[1]?.url).toBe("/api/matches/home-tab?gw=2");
  });

  it("uses the next game's opening weekday as its state label", async () => {
    const switcher: GameweekSwitchOption[] = [
      { role: "previous", number: 2, name: "Gameweek 2", openingAt: "2026-08-17T12:00:00.000Z", state: "settled", lifecycle: "CL5", disabled: false },
      { role: "current", number: 3, name: "Gameweek 3", openingAt: "2026-08-24T12:00:00.000Z", state: "live", lifecycle: "CL3", disabled: false },
      { role: "next", number: 4, name: "Gameweek 4", openingAt: "2026-08-25T12:00:00.000Z", state: "open", lifecycle: "CL1", disabled: false },
    ];
    const { fetchMock, requests } = installFetch();
    const rendered = renderAt(0);
    await activate(rendered);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await resolveAndWait(requests[0]!, full("pre", "pl-2026-27", null, undefined, null, switcher), MATCH_COPY.matchesNoFixtures);

    expect(screen.getByRole("button", { name: "GW4 · Tue" })).toBeInTheDocument();
  });

  it.each([
    ["settled", 10 * 60_000],
    ["pre", 5 * 60_000],
    ["unresolved", 60_000],
    ["empty", 10 * 60_000],
  ] as const)("refetches on re-activation after the %s TTL", async (freshness, ttl) => {
    const now = vi.spyOn(Date, "now").mockReturnValue(1_000);
    const { fetchMock, requests } = installFetch();
    const rendered = renderAt(0);
    await activate(rendered);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const data = freshness === "empty" ? empty(null) : full(freshness);
    await resolveAndWait(
      requests[0]!,
      data,
      freshness === "empty" ? MATCH_COPY.homeMatchesEmpty : MATCH_COPY.matchesNoFixtures,
    );

    now.mockReturnValue(1_000 + ttl + 1);
    await act(async () => {
      rendered.rerender(
        <HomeTabsContext.Provider value={{ activeIndex: 0, analyticsActivated: false }}>
          <HomeMatchesTab />
        </HomeTabsContext.Provider>,
      );
      await Promise.resolve();
    });
    await activate(rendered);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });

  it("does not refetch on tab away and back within TTL", async () => {
    const { fetchMock, requests } = installFetch();
    const rendered = renderAt(0);
    await activate(rendered);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await resolveAndWait(requests[0]!, full("pre"), MATCH_COPY.matchesNoFixtures);

    rendered.rerender(
      <HomeTabsContext.Provider value={{ activeIndex: 0, analyticsActivated: false }}>
        <HomeMatchesTab />
      </HomeTabsContext.Provider>,
    );
    await activate(rendered);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([false, true])("keeps Matches at index 1 with analyticsVisible=%s", async (analyticsVisible) => {
    const { fetchMock, requests } = installFetch();
    render(
      <HomeTabs
        leagues={<div>leagues</div>}
        matches={<HomeMatchesTab />}
        analytics={<div>analytics</div>}
        analyticsVisible={analyticsVisible}
      />,
    );
    fireEvent.click(screen.getByRole("tab", { name: "Matches" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    resolveRequest(requests[0]!, full());
    await waitFor(() => expect(screen.getByText(MATCH_COPY.matchesNoFixtures)).toBeInTheDocument());
  });

  it("rekeys the default request by selectedComp and reuses it after a scope round trip", async () => {
    const scopes = [
      { slug: "pl-2026-27", name: "Premier League" },
      { slug: "friends", name: "Friends" },
    ];
    const { fetchMock, requests } = installFetch();
    const rendered = renderAt(0);
    await activate(rendered);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await resolveAndWait(requests[0]!, full("pre", "pl-2026-27", null, scopes), MATCH_COPY.matchesNoFixtures);

    fireEvent.click(screen.getByRole("tab", { name: "Friends" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(requests[1]?.url).toBe("/api/matches/home-tab?comp=friends");
    await resolveAndWait(requests[1]!, full("pre", "friends", "friends", scopes), MATCH_COPY.matchesNoFixtures);

    fireEvent.click(screen.getByRole("tab", { name: "Premier League" }));
    await waitFor(() => expect(screen.getByText(MATCH_COPY.matchesNoFixtures)).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("ignores a late response across an A to B to A switch", async () => {
    const scopes = [
      { slug: "alpha", name: "Alpha" },
      { slug: "beta", name: "Beta" },
    ];
    const now = vi.spyOn(Date, "now").mockReturnValue(1_000);
    const { fetchMock, requests } = installFetch();
    const rendered = renderAt(0);
    await activate(rendered);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await resolveAndWait(requests[0]!, full("unresolved", "alpha", null, scopes), MATCH_COPY.matchesNoFixtures);

    fireEvent.click(screen.getByRole("tab", { name: "Beta" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    now.mockReturnValue(62_001);
    fireEvent.click(screen.getByRole("tab", { name: "Alpha" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    await resolveAndWait(requests[2]!, full("pre", "alpha", "alpha", scopes), MATCH_COPY.matchesNoFixtures);

    resolveRequest(requests[1]!, full("pre", "beta", "beta", scopes));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.queryByText("beta")).not.toBeInTheDocument();
    expect(requests[1]?.signal.aborted).toBe(true);
  });

  it("does not carry a B payload into C after a rapid A to B to C switch", async () => {
    const scopes = [
      { slug: "alpha", name: "Alpha" },
      { slug: "beta", name: "Beta" },
      { slug: "gamma", name: "Gamma" },
    ];
    const betaNextGw = {
      number: 7,
      deadlineAt: "2026-08-21T12:00:00.000Z",
      leagues: [{
        leagueSlug: "beta",
        leagueName: "Beta",
        status: "none" as const,
        enterHref: "/leagues/beta/enter?gw=7",
      }],
    };
    vi.useFakeTimers();
    vi.spyOn(Date, "now").mockReturnValue(1_000);
    const { fetchMock, requests } = installFetch();
    const rendered = renderAt(0);
    await activate(rendered);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    resolveRequest(requests[0]!, full("pre", "alpha", null, scopes));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByText(MATCH_COPY.matchesNoFixtures)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Beta" }));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    resolveRequest(requests[1]!, full("unresolved", "beta", "beta", scopes, betaNextGw));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByText(MATCH_COPY.nextGwOpen(7))).toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(60_000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);

    const gammaButton = screen.getByRole("tab", { name: "Gamma" });
    fireEvent.click(gammaButton);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    resolveRequest(requests[2]!, full("unresolved", "beta", "beta", scopes, betaNextGw));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(requests[2]?.jsonSignalAborted).toBe(false);
    expect(requests[2]?.signal.aborted).toBe(false);
    expect(screen.queryByText(MATCH_COPY.nextGwOpen(7))).not.toBeInTheDocument();

    requests[3]!.reject(new Error("gamma failed"));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByText(MATCH_COPY.homeMatchesError)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: MATCH_COPY.homeMatchesRetry }));
    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(screen.queryByText(MATCH_COPY.nextGwOpen(7))).not.toBeInTheDocument();
    expect(screen.getByText(MATCH_COPY.homeMatchesLoading)).toBeInTheDocument();

    resolveRequest(requests[4]!, full("pre", "gamma", "gamma", scopes));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByText(MATCH_COPY.matchesNoFixtures)).toBeInTheDocument();
    expect(screen.queryByText(MATCH_COPY.nextGwOpen(7))).not.toBeInTheDocument();
  });

  it("keys an empty invalid-comp response by requestedComp when selectedComp is null", async () => {
    const scopes = [
      { slug: "pl-2026-27", name: "Premier League" },
      { slug: "foreign", name: "Foreign" },
    ];
    const { fetchMock, requests } = installFetch();
    const rendered = renderAt(0);
    await activate(rendered);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await resolveAndWait(requests[0]!, full("pre", "pl-2026-27", null, scopes), MATCH_COPY.matchesNoFixtures);

    fireEvent.click(screen.getByRole("tab", { name: "Foreign" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(requests[1]?.url).toBe("/api/matches/home-tab?comp=foreign");
    await resolveAndWait(requests[1]!, empty("foreign"), MATCH_COPY.homeMatchesEmpty);

    rendered.rerender(
      <HomeTabsContext.Provider value={{ activeIndex: 0, analyticsActivated: false }}>
        <HomeMatchesTab />
      </HomeTabsContext.Provider>,
    );
    await activate(rendered);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("keeps an all-ineligible nextGw in cached data while hiding its banner", async () => {
    const nextGw = {
      number: 2,
      deadlineAt: "2026-08-21T12:00:00.000Z",
      leagues: [{
        leagueSlug: "friends",
        leagueName: "Friends",
        status: "ineligible" as const,
        enterHref: "/leagues/friends/enter?gw=2",
      }],
    };
    const { fetchMock, requests } = installFetch();
    const rendered = renderAt(0);
    await activate(rendered);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await resolveAndWait(requests[0]!, full("pre", "pl-2026-27", null, undefined, nextGw), MATCH_COPY.matchesNoFixtures);
    expect(screen.queryByText(MATCH_COPY.nextGwOpen(2))).not.toBeInTheDocument();
    expect(screen.queryByText(MATCH_COPY.nextGwPicksIn(2))).not.toBeInTheDocument();

    rendered.rerender(
      <HomeTabsContext.Provider value={{ activeIndex: 0, analyticsActivated: false }}>
        <HomeMatchesTab />
      </HomeTabsContext.Provider>,
    );
    await activate(rendered);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("shows the quiet picks-in line when every eligible league is complete", async () => {
    const nextGw = {
      number: 2,
      deadlineAt: "2026-08-21T12:00:00.000Z",
      leagues: [
        {
          leagueSlug: "complete",
          leagueName: "Complete",
          status: "complete" as const,
          enterHref: "/leagues/complete/enter?gw=2",
        },
        {
          leagueSlug: "later",
          leagueName: "Later",
          status: "ineligible" as const,
          enterHref: "/leagues/later/enter?gw=2",
        },
      ],
    };
    const { fetchMock, requests } = installFetch();
    const rendered = renderAt(0);
    await activate(rendered);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await resolveAndWait(requests[0]!, full("pre", "pl-2026-27", null, undefined, nextGw), MATCH_COPY.matchesNoFixtures);
    expect(screen.getByText(MATCH_COPY.nextGwPicksIn(2))).toBeInTheDocument();
    expect(screen.queryByText(MATCH_COPY.nextGwOpen(2))).not.toBeInTheDocument();
  });

  it("shows an error with a retry action", async () => {
    const { fetchMock, requests } = installFetch();
    const rendered = renderAt(0);
    await activate(rendered);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    requests[0]!.reject(new Error("network"));
    await waitFor(() => expect(screen.getByText(MATCH_COPY.homeMatchesError)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: MATCH_COPY.homeMatchesRetry }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await resolveAndWait(requests[1]!, full(), MATCH_COPY.matchesNoFixtures);
  });
});

describe("HomeMatchesTab unresolved freshness timer", () => {
  it("refreshes unresolved data while visible and clears the interval on tab-away or hidden", async () => {
    vi.useFakeTimers();
    const { fetchMock, requests } = installFetch();
    const rendered = renderAt(0);
    await activate(rendered);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    resolveRequest(requests[0]!, full("unresolved"));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      vi.advanceTimersByTime(60_000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    resolveRequest(requests[1]!, full("unresolved"));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    rendered.rerender(
      <HomeTabsContext.Provider value={{ activeIndex: 0, analyticsActivated: false }}>
        <HomeMatchesTab />
      </HomeTabsContext.Provider>,
    );
    await act(async () => {
      vi.advanceTimersByTime(60_000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    rendered.rerender(
      <HomeTabsContext.Provider value={{ activeIndex: 1, analyticsActivated: false }}>
        <HomeMatchesTab />
      </HomeTabsContext.Provider>,
    );
    await act(async () => {
      Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
      document.dispatchEvent(new Event("visibilitychange"));
      vi.advanceTimersByTime(60_000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does an immediate stale check on visibility resume and keeps one timer", async () => {
    vi.useFakeTimers();
    const activeTimers = new Set<number>();
    const realSetInterval = window.setInterval.bind(window);
    const realClearInterval = window.clearInterval.bind(window);
    vi.spyOn(window, "setInterval").mockImplementation(((handler: TimerHandler, timeout?: number, ...args: any[]) => {
      const id = realSetInterval(handler, timeout, ...args);
      if (timeout === 60_000) activeTimers.add(id);
      return id;
    }) as typeof window.setInterval);
    vi.spyOn(window, "clearInterval").mockImplementation(((id?: number) => {
      if (id != null) activeTimers.delete(id);
      return realClearInterval(id);
    }) as typeof window.clearInterval);

    const { fetchMock, requests } = installFetch();
    const rendered = renderAt(0);
    await activate(rendered);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    resolveRequest(requests[0]!, full("unresolved"));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(activeTimers.size).toBe(1);

    await act(async () => {
      vi.advanceTimersByTime(30_000);
      Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
      document.dispatchEvent(new Event("visibilitychange"));
      vi.advanceTimersByTime(40_000);
    });
    expect(activeTimers.size).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
      document.dispatchEvent(new Event("visibilitychange"));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    resolveRequest(requests[1]!, full("unresolved"));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(activeTimers.size).toBe(1);
  });

  it("resumes after an unresolved refresh resolves while hidden without duplicate timers", async () => {
    vi.useFakeTimers();
    const activeTimers = new Set<number>();
    const realSetInterval = window.setInterval.bind(window);
    const realClearInterval = window.clearInterval.bind(window);
    vi.spyOn(window, "setInterval").mockImplementation(((handler: TimerHandler, timeout?: number, ...args: any[]) => {
      const id = realSetInterval(handler, timeout, ...args);
      if (timeout === 60_000) activeTimers.add(id);
      return id;
    }) as typeof window.setInterval);
    vi.spyOn(window, "clearInterval").mockImplementation(((id?: number) => {
      if (id != null) activeTimers.delete(id);
      return realClearInterval(id);
    }) as typeof window.clearInterval);
    vi.setSystemTime(new Date("2026-08-13T12:00:00.000Z"));

    const { fetchMock, requests } = installFetch();
    const rendered = renderAt(0);
    await activate(rendered);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    resolveRequest(requests[0]!, full("unresolved"));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(activeTimers.size).toBe(1);

    await act(async () => {
      vi.advanceTimersByTime(60_000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await act(async () => {
      Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(activeTimers.size).toBe(0);

    resolveRequest(requests[1]!, full("unresolved"));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(activeTimers.size).toBe(0);

    await act(async () => {
      vi.advanceTimersByTime(60_001);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await act(async () => {
      Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
      document.dispatchEvent(new Event("visibilitychange"));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(activeTimers.size).toBe(1);

    resolveRequest(requests[2]!, full("unresolved"));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(activeTimers.size).toBe(1);
    rendered.unmount();
  });
});
