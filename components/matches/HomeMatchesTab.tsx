"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Countdown, LocalTime } from "@/components/LocalTime";
import { useHomeTabsContext } from "@/components/HomeTabsContext";
import {
  groupFixturesByLocalDay,
  isLiveFixtureState,
  liveMinuteFromState,
  type FixtureRowView,
  type LeagueRowView,
} from "@/lib/matches-tab";
import type { MatchesHomeTabPayload } from "@/lib/matches-home-tab";
import { MATCH_COPY } from "@/lib/match-copy";
import { verdictCopy } from "@/lib/matches-verdict";

const DEFAULT_KEY = "__default";
const TTL_MS = {
  settled: 10 * 60_000,
  pre: 5 * 60_000,
  unresolved: 60_000,
  empty: 10 * 60_000,
} as const;

type CacheEntry = {
  data: MatchesHomeTabPayload;
  receivedAt: number;
};

type LoadState = {
  key: string;
  status: "idle" | "loading" | "ready" | "error";
  data: MatchesHomeTabPayload | null;
};

type LastData = {
  key: string;
  requested: string | null;
  data: MatchesHomeTabPayload;
};

function ttlFor(data: MatchesHomeTabPayload): number {
  return TTL_MS[data.freshness];
}

function stale(entry: CacheEntry): boolean {
  return Date.now() - entry.receivedAt > ttlFor(entry.data);
}

function rowDetail(row: LeagueRowView): string {
  switch (row.kind) {
    case "open-not-entered":
      return MATCH_COPY.notEnteredShort;
    case "open-entered":
      return MATCH_COPY.entryStarted;
    case "open-locked-in":
      return MATCH_COPY.lockedIn;
    case "open-needs-update":
      return MATCH_COPY.entryNeedsUpdate;
    case "locked-awaiting":
      return MATCH_COPY.lockedAwaiting;
    case "closed-not-entered":
      return MATCH_COPY.satOut;
    case "ineligible":
      return MATCH_COPY.ineligible;
    case "invalid":
      return row.reason || MATCH_COPY.invalid;
    case "provisional":
      return `${row.ordinal ?? MATCH_COPY.pointsPending} · ${MATCH_COPY.pointsValue(row.points)}${row.netInr == null ? "" : ` · ${MATCH_COPY.moneyValue(row.netInr)}`}`;
    case "recalculating":
      return `${MATCH_COPY.recalculating}${row.points == null ? "" : ` · ${MATCH_COPY.pointsValue(row.points)}`}`;
    case "settled":
      return `${MATCH_COPY.ordinal(row.ordinal, row.fieldSize)} · ${MATCH_COPY.pointsValue(row.points)} · ${MATCH_COPY.moneyValue(row.netInr)}`;
    case "void":
      return `${MATCH_COPY.gameweekVoid} · ${row.voidReason}`;
    case "all-called-off":
      return MATCH_COPY.calledOffSettling;
    case "sync-issue":
      return MATCH_COPY.syncIssue;
  }
}

function LeagueRow({ row }: { row: LeagueRowView }) {
  const cta = "cta" in row ? row.cta : null;
  return (
    <div className="border-t border-cs2-line-2 py-3 first:border-t-0 first:pt-0 last:pb-0">
      <div className="flex items-center justify-between gap-3">
        <Link href={row.raceHref} className="min-w-0 truncate text-[13px] font-extrabold text-cs2-green">
          {row.league.name}
        </Link>
        {cta ? (
          <Link
            href={cta.href}
            className="shrink-0 rounded-cs2-sm bg-cs2-green px-2.5 py-2 text-[10px] font-extrabold text-white cf-press"
          >
            {cta.label}
          </Link>
        ) : null}
      </div>
      <p className="mt-1 text-[11px] font-semibold text-cs2-ink-3">{rowDetail(row)}</p>
    </div>
  );
}

function NextGameweekBanner({
  nextGw,
}: {
  nextGw: Extract<MatchesHomeTabPayload, { empty: false }>["nextGw"];
}) {
  if (!nextGw) return null;
  const missing = nextGw.leagues.filter(
    (league) => league.status === "none" || league.status === "needs_update",
  );
  const eligible = nextGw.leagues.filter((league) => league.status !== "ineligible");
  if (missing.length === 0 && eligible.length === 0) return null;

  return (
    <section className="rounded-cs2-lg border border-cs2-amber-line bg-cs2-amber-soft p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-extrabold uppercase tracking-[.08em] text-cs2-amber">
            {missing.length ? MATCH_COPY.nextGwOpen(nextGw.number) : MATCH_COPY.nextGwPicksIn(nextGw.number)}
          </p>
          <p className="mt-1 text-[11px] font-semibold text-cs2-ink-2">
            {MATCH_COPY.locks} {" "}
            <LocalTime iso={nextGw.deadlineAt} variant="time" relative={false} includeWeekday />
          </p>
        </div>
        <Countdown iso={nextGw.deadlineAt} prefix={MATCH_COPY.locksIn} />
      </div>
      {missing.length ? (
        <div className="mt-3 divide-y divide-cs2-amber-line rounded-cs2-sm border border-cs2-amber-line">
          {missing.map((league) => (
            <div key={league.leagueSlug} className="flex items-center justify-between gap-3 px-3 py-2.5">
              <div className="min-w-0">
                <p className="truncate text-[12px] font-extrabold text-cs2-ink">{league.leagueName}</p>
                <p className="mt-0.5 text-[10px] font-semibold text-cs2-amber">
                  {league.status === "needs_update" ? MATCH_COPY.nextGwNeedsUpdate : MATCH_COPY.nextGwNotEntered}
                </p>
              </div>
              <Link
                href={league.enterHref}
                className="shrink-0 rounded-cs2-sm border border-cs2-amber-line px-2.5 py-2 text-[10px] font-extrabold text-cs2-amber cf-press"
              >
                {league.status === "needs_update" ? MATCH_COPY.nextGwUpdate : MATCH_COPY.nextGwEnter}
              </Link>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function Receipt({
  receipt,
}: {
  receipt: Extract<MatchesHomeTabPayload, { empty: false }>["receipt"];
}) {
  if (!receipt) return null;
  return (
    <details className="rounded-cs2-lg border border-cs2-line bg-cs2-paper">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-[12px] font-extrabold text-cs2-ink">
        <span className="min-w-0 truncate">
          <span className="mr-2 text-[10px] uppercase tracking-[.08em] text-cs2-ink-3">{MATCH_COPY.matchesReceiptLabel}</span>
          {receipt.summary}
        </span>
        <span aria-hidden="true" className="text-cs2-ink-3">⌄</span>
      </summary>
      <div className="border-t border-cs2-line-2 px-4">
        {receipt.rows.map((row) => <LeagueRow key={row.league.id} row={row} />)}
      </div>
    </details>
  );
}

function FixtureRow({ fixture }: { fixture: FixtureRowView }) {
  const live = isLiveFixtureState(fixture.state);
  return (
    <Link
      href={fixture.matchHref}
      className="block rounded-cs2-md border border-cs2-line bg-cs2-paper p-3.5 cf-press"
    >
      <div className="mb-2 flex items-center justify-between gap-3 text-[10px] font-semibold text-cs2-ink-3">
        <span className={live ? "font-extrabold text-cs2-red" : undefined}>
          {fixture.scheduled && fixture.kickoffAt ? (
            <LocalTime iso={fixture.kickoffAt} variant="time" relative={false} />
          ) : live ? (
            MATCH_COPY.liveMinute(liveMinuteFromState(fixture.state))
          ) : (
            fixture.state
          )}
        </span>
        {fixture.insightsMark ? <span>{MATCH_COPY.insightsMark}</span> : null}
      </div>
      <div className="grid grid-cols-[1fr_auto] gap-y-1 text-[14px]">
        <span className="font-bold text-cs2-ink">{fixture.home.name}</span>
        <span className="font-mono font-extrabold tabular text-cs2-ink">{fixture.score?.[0] ?? "—"}</span>
        <span className="font-bold text-cs2-ink">{fixture.away.name}</span>
        <span className="font-mono font-extrabold tabular text-cs2-ink">{fixture.score?.[1] ?? "—"}</span>
      </div>
      {fixture.yourCall.kind === "same" ? (
        <div className="mt-3 border-t border-cs2-line-2 pt-2 text-[10px] font-semibold text-cs2-ink-3">
          {MATCH_COPY.sameCall(fixture.yourCall.score[0], fixture.yourCall.score[1])} {" · "}
          {fixture.yourCall.leagues.map((league) => league.name).join(", ")} {" · "}
          {fixture.score
            ? `${MATCH_COPY.pointsValue(fixture.yourCall.points)}${fixture.yourCall.verdict ? ` · ${verdictCopy(fixture.yourCall.verdict)}` : ""}`
            : MATCH_COPY.pointsPending}
        </div>
      ) : null}
      {fixture.yourCall.kind === "varies" ? (
        <div className="mt-3 border-t border-cs2-line-2 pt-2 text-[10px] font-semibold text-cs2-ink-3">
          {MATCH_COPY.twoWays} {" · "}
          {fixture.yourCall.calls.map((call) =>
            `${call.league.name} ${call.score[0]}–${call.score[1]}${fixture.score ? ` · ${MATCH_COPY.pointsValue(call.points)}${call.verdict ? ` · ${verdictCopy(call.verdict)}` : ""}` : ` · ${MATCH_COPY.pointsPending}`}`,
          ).join(" · ")}
        </div>
      ) : null}
    </Link>
  );
}

function ScopeTabs({
  scopes,
  selectedScope,
  onScope,
}: {
  scopes: Array<{ slug: string; name: string }>;
  selectedScope: string;
  onScope: (scope: string) => void;
}) {
  if (scopes.length <= 1) return null;
  return (
    <div role="tablist" aria-label={MATCH_COPY.competitionScope} className="mb-4 flex gap-2 overflow-x-auto">
      {scopes.map((scope) => (
        <button
          key={scope.slug}
          type="button"
          role="tab"
          aria-selected={scope.slug === selectedScope}
          onClick={() => onScope(scope.slug)}
          className={`shrink-0 rounded-pill border px-3 py-1.5 text-[10px] font-extrabold whitespace-nowrap ${scope.slug === selectedScope ? "border-cs2-green-line bg-cs2-green-soft text-cs2-green" : "border-cs2-line text-cs2-ink-3"}`}
        >
          {scope.name}
        </button>
      ))}
    </div>
  );
}

function HomeMatchesBody({
  data,
  onScope,
}: {
  data: Extract<MatchesHomeTabPayload, { empty: false }>;
  onScope: (scope: string) => void;
}) {
  const [timeZone, setTimeZone] = useState<string | null>(null);
  useEffect(() => {
    setTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone);
  }, []);
  const days = useMemo(
    () => (timeZone ? groupFixturesByLocalDay(data.view.fixtures, timeZone) : []),
    [data.view.fixtures, timeZone],
  );

  return (
    <main className="px-4 py-4">
      <div className="sticky top-0 z-10 -mx-4 mb-4 border-b border-cs2-line bg-cs2-canvas/95 px-4 py-3 backdrop-blur">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-[10px] font-extrabold uppercase tracking-[.08em] text-cs2-green">{MATCH_COPY.homeMatchesKicker}</p>
            <h1 className="truncate text-[20px] font-extrabold tracking-[-.03em] text-cs2-ink">{data.view.gw.label}</h1>
          </div>
          <div className="shrink-0 text-right font-mono text-[10px] font-semibold text-cs2-ink-3">
            <LocalTime iso={data.view.gw.deadlineAt} variant="time" relative={false} includeWeekday />
            {data.view.gw.state === "pre" ? (
              <span className="mt-0.5 block text-cs2-amber">
                <Countdown iso={data.view.gw.deadlineAt} prefix={MATCH_COPY.locksIn} />
              </span>
            ) : null}
          </div>
        </div>
      </div>

      <ScopeTabs scopes={data.view.scopes} selectedScope={data.view.selectedScope} onScope={onScope} />

      <div className="space-y-3">
        <NextGameweekBanner nextGw={data.nextGw} />
        <Receipt receipt={data.receipt} />
        {data.view.yourGw ? (
          <section className="rounded-cs2-lg border border-cs2-line bg-cs2-paper p-4">
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <h2 className="text-[15px] font-extrabold text-cs2-ink">{MATCH_COPY.yourGw(data.view.gw.number)}</h2>
                <p className="mt-1 text-[10px] font-semibold text-cs2-ink-3">
                  {MATCH_COPY.leagues(data.view.yourGw.enteredCount, data.view.yourGw.leagueCount)}
                </p>
              </div>
              {data.view.yourGw.headerPoints != null ? (
                <span className="font-mono text-[13px] font-extrabold tabular text-cs2-ink">{MATCH_COPY.pointsValue(data.view.yourGw.headerPoints)}</span>
              ) : null}
            </div>
            {data.view.yourGw.rows.map((row) => <LeagueRow key={row.league.id} row={row} />)}
            {data.view.yourGw.provisional ? (
              <p className="mt-3 border-t border-cs2-line-2 pt-3 text-[10px] font-extrabold text-cs2-red">{MATCH_COPY.provisional}</p>
            ) : null}
          </section>
        ) : null}

        {data.view.winnersRecap ? (
          <section className="rounded-cs2-lg border border-cs2-line bg-cs2-paper p-4">
            <h2 className="text-[12px] font-extrabold text-cs2-ink">{MATCH_COPY.winners}</h2>
            {data.view.winnersRecap.map((row) => (
              <Link key={row.league.id} href={row.href} className="mt-2 block border-t border-cs2-line-2 pt-2 text-[11px] font-semibold text-cs2-green">
                {row.league.name}
              </Link>
            ))}
          </section>
        ) : null}

        {days.length ? (
          <div className="flex items-center justify-between text-[10px] font-extrabold uppercase tracking-[.08em] text-cs2-ink-3">
            <span>{MATCH_COPY.fixturesAndResults}</span>
            <span className="font-mono normal-case tracking-normal">{MATCH_COPY.fixturesTotal(data.view.fixtures.length)}</span>
          </div>
        ) : null}
        {days.length ? days.map((day) => (
          <section key={day.dayKey} className="overflow-hidden rounded-cs2-lg border border-cs2-line bg-cs2-paper">
            <div className="flex items-center justify-between border-b border-cs2-line-2 px-4 py-3">
              <span className="text-[10px] font-extrabold uppercase tracking-[.08em] text-cs2-ink-3">
                {day.dateAt ? <LocalTime iso={day.dateAt} variant="date" relative={false} includeYear={false} includeWeekday /> : MATCH_COPY.dateTbc}
              </span>
              <span className="font-mono text-[10px] font-bold text-cs2-ink-3">{MATCH_COPY.dayFixtureCount(day.fixtures.length)}</span>
            </div>
            <div className="space-y-2 p-3">
              {day.fixtures.map((fixture) => <FixtureRow key={fixture.id} fixture={fixture} />)}
            </div>
          </section>
        )) : <div className="rounded-cs2-lg border border-dashed border-cs2-line p-5 text-center text-[12px] font-semibold text-cs2-ink-3">{MATCH_COPY.matchesNoFixtures}</div>}

        <Link href="/matches" className="block rounded-cs2-md border border-cs2-line bg-cs2-paper px-4 py-3 text-center text-[12px] font-extrabold text-cs2-green cf-press">
          {MATCH_COPY.allMatchesAndTable}
        </Link>
      </div>
    </main>
  );
}

export function HomeMatchesTab() {
  const { activeIndex } = useHomeTabsContext();
  const [activated, setActivated] = useState(false);
  const [requestedComp, setRequestedComp] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [load, setLoad] = useState<LoadState>({ key: DEFAULT_KEY, status: "idle", data: null });
  const cacheRef = useRef<Map<string, CacheEntry>>(new Map());
  const inFlightRef = useRef<Map<string, AbortController>>(new Map());
  const lastDataRef = useRef<LastData | null>(null);
  const currentKeyRef = useRef(DEFAULT_KEY);
  const currentRequestedCompRef = useRef<string | null>(null);
  const defaultResolvedKeyRef = useRef<string | null>(null);
  const retryKeyRef = useRef<string | null>(null);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    if (activeIndex === 1) setActivated(true);
  }, [activeIndex]);

  const requestKey = requestedComp ?? defaultResolvedKeyRef.current ?? DEFAULT_KEY;
  currentKeyRef.current = requestKey;
  currentRequestedCompRef.current = requestedComp;

  const clearTimer = useCallback(() => {
    if (timerRef.current != null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const fetchFor = useCallback(
    (requested: string | null, key: string, force: boolean): AbortController | null => {
      const cached = cacheRef.current.get(key);
      if (!force && cached && !stale(cached)) {
        lastDataRef.current = { key, requested, data: cached.data };
        setLoad({ key, status: "ready", data: cached.data });
        return null;
      }
      const existing = inFlightRef.current.get(key);
      if (existing && !existing.signal.aborted) {
        const carryData =
          lastDataRef.current?.key === key &&
          lastDataRef.current.requested === requested
            ? lastDataRef.current.data
            : null;
        setLoad({ key, status: "loading", data: carryData });
        return existing;
      }

      const carryData =
        lastDataRef.current?.key === key &&
        lastDataRef.current.requested === requested
          ? lastDataRef.current.data
          : null;
      const controller = new AbortController();
      inFlightRef.current.set(key, controller);
      setLoad({ key, status: "loading", data: carryData });
      const query = requested == null ? "" : `?comp=${encodeURIComponent(requested)}`;
      fetch(`/api/matches/home-tab${query}`, { cache: "no-store", signal: controller.signal })
        .then(async (response) => {
          if (!response.ok) throw new Error("home matches request failed");
          return (await response.json()) as MatchesHomeTabPayload;
        })
        .then((data) => {
          if (inFlightRef.current.get(key) !== controller) return;
          if (data.requestedComp !== requested) return;
          const canonicalKey = data.selectedComp ?? data.requestedComp ?? DEFAULT_KEY;
          const entry = { data, receivedAt: Date.now() };
          cacheRef.current.set(canonicalKey, entry);
          if (requested == null && data.selectedComp) {
            defaultResolvedKeyRef.current = canonicalKey;
            if (key === DEFAULT_KEY) cacheRef.current.delete(DEFAULT_KEY);
          }
          if (
            currentKeyRef.current !== key ||
            currentRequestedCompRef.current !== requested
          ) {
            return;
          }
          lastDataRef.current = { key: canonicalKey, requested, data };
          setLoad({ key: canonicalKey, status: "ready", data });
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted || (error as { name?: string })?.name === "AbortError") return;
          if (inFlightRef.current.get(key) !== controller) return;
          if (currentKeyRef.current === key && currentRequestedCompRef.current === requested) {
            setLoad({ key, status: "error", data: null });
          }
        })
        .finally(() => {
          if (inFlightRef.current.get(key) === controller) inFlightRef.current.delete(key);
        });
      return controller;
    },
    [],
  );

  useEffect(() => {
    if (!activated || activeIndex !== 1) return;
    const force = retryKeyRef.current === requestKey;
    if (force) retryKeyRef.current = null;
    const controller = fetchFor(requestedComp, requestKey, force);
    return () => {
      if (controller && inFlightRef.current.get(requestKey) === controller) {
        controller.abort();
        inFlightRef.current.delete(requestKey);
      }
    };
  }, [activated, activeIndex, fetchFor, requestedComp, requestKey, retry]);

  const freshnessData = load.key === requestKey ? load.data : null;
  useEffect(() => {
    clearTimer();
    if (
      !activated ||
      activeIndex !== 1 ||
      !freshnessData ||
      freshnessData.empty ||
      freshnessData.freshness !== "unresolved"
    ) {
      return;
    }
    const checkStale = () => {
      if (document.visibilityState === "hidden") return;
      const cached = cacheRef.current.get(requestKey);
      if (!cached || stale(cached)) fetchFor(requestedComp, requestKey, false);
    };
    const tick = () => {
      if (document.visibilityState !== "hidden") {
        fetchFor(requestedComp, requestKey, true);
      }
    };
    const start = () => {
      clearTimer();
      if (document.visibilityState === "hidden") return;
      checkStale();
      timerRef.current = window.setInterval(tick, 60_000);
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") clearTimer();
      else start();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    start();
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      clearTimer();
    };
  }, [activeIndex, activated, clearTimer, fetchFor, freshnessData, requestedComp, requestKey]);

  useEffect(() => () => {
    clearTimer();
    for (const [key, controller] of inFlightRef.current) {
      if (inFlightRef.current.get(key) === controller) controller.abort();
    }
    inFlightRef.current.clear();
  }, [clearTimer]);

  if (!activated) return null;
  const lastScopeData = lastDataRef.current?.data;
  const lastScopeView = lastScopeData?.empty === false ? lastScopeData.view : null;
  const loadingScopes = lastScopeView?.scopes ?? [];
  const dataForKey = load.key === requestKey ? load.data : null;
  if (
    (load.status === "loading" || load.status === "idle" || load.key !== requestKey) &&
    !dataForKey
  ) {
    return (
      <>
        <div className="px-4 pt-4">
          <ScopeTabs
            scopes={loadingScopes}
            selectedScope={requestedComp ?? lastScopeView?.selectedScope ?? ""}
            onScope={setRequestedComp}
          />
        </div>
        <section aria-busy="true" className="mx-4 my-4 rounded-cs2-lg border border-cs2-line bg-cs2-paper p-4 text-[12px] font-semibold text-cs2-ink-3">{MATCH_COPY.homeMatchesLoading}</section>
      </>
    );
  }
  if (load.status === "error" && load.key === requestKey) {
    return (
      <section className="mx-4 my-4 rounded-cs2-lg border border-cs2-line bg-cs2-paper p-4">
        <p className="text-[12px] font-semibold text-cs2-ink-3">{MATCH_COPY.homeMatchesError}</p>
        <button
          type="button"
          className="mt-2 rounded-cs2-sm border border-cs2-line px-2.5 py-2 text-[11px] font-extrabold text-cs2-green cf-press"
          onClick={() => {
            retryKeyRef.current = requestKey;
            setRetry((value) => value + 1);
          }}
        >
          {MATCH_COPY.homeMatchesRetry}
        </button>
      </section>
    );
  }
  if (!dataForKey || dataForKey.empty) {
    return <section className="mx-4 my-4 rounded-cs2-lg border border-cs2-line bg-cs2-paper p-4 text-[12px] font-semibold text-cs2-ink-3">{MATCH_COPY.homeMatchesEmpty}</section>;
  }

  const data = dataForKey;
  return <HomeMatchesBody data={data} onScope={setRequestedComp} />;
}
