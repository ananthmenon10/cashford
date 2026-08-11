"use client";

import { useEffect, useRef, useState } from "react";
import { ANALYTICS_COPY } from "@/lib/analytics-copy";
import type { AnalyticsModulesView } from "@/lib/analytics-modules";
import { Rivalry } from "./Rivalry";
import { PredictionHabits } from "./PredictionHabits";
import { YouVsRoom } from "./YouVsRoom";

type LoadState = {
  pairKey: string | null;
  status: "idle" | "loading" | "ready" | "error";
  data: AnalyticsModulesView | null;
};

function pairKeyFor(leagueId: string | null, competitionId: string | null): string | null {
  return leagueId && competitionId ? `${leagueId}:${competitionId}` : null;
}

export function AnalyticsModules({
  leagueId,
  competitionId,
  activated,
}: {
  leagueId: string | null;
  competitionId: string | null;
  activated: boolean;
}) {
  const pairKey = pairKeyFor(leagueId, competitionId);
  const cacheRef = useRef<Map<string, AnalyticsModulesView>>(new Map());
  const inFlightRef = useRef<Map<string, AbortController>>(new Map());
  const currentPairRef = useRef<string | null>(pairKey);
  const [retry, setRetry] = useState(0);
  const [load, setLoad] = useState<LoadState>({ pairKey: null, status: "idle", data: null });

  currentPairRef.current = pairKey;

  useEffect(() => {
    if (!activated || !pairKey || !leagueId || !competitionId) {
      setLoad({ pairKey, status: "idle", data: null });
      return;
    }

    const cached = cacheRef.current.get(pairKey);
    if (cached) {
      setLoad({ pairKey, status: "ready", data: cached });
      return;
    }

    const existing = inFlightRef.current.get(pairKey);
    if (existing && !existing.signal.aborted) {
      setLoad({ pairKey, status: "loading", data: null });
      return;
    }

    const controller = new AbortController();
    inFlightRef.current.set(pairKey, controller);
    setLoad({ pairKey, status: "loading", data: null });

    fetch(
      `/api/analytics/modules?leagueId=${encodeURIComponent(leagueId)}&competitionId=${encodeURIComponent(competitionId)}`,
      { cache: "no-store", signal: controller.signal },
    )
      .then(async (response) => {
        if (!response.ok) throw new Error("analytics request failed");
        return (await response.json()) as AnalyticsModulesView;
      })
      .then((data) => {
        if (inFlightRef.current.get(pairKey) !== controller) return;
        if (data.leagueId !== leagueId || data.competitionId !== competitionId) return;
        cacheRef.current.set(pairKey, data);
        if (currentPairRef.current !== pairKey) return;
        setLoad({ pairKey, status: "ready", data });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted || (error as { name?: string })?.name === "AbortError") return;
        if (inFlightRef.current.get(pairKey) !== controller) return;
        if (currentPairRef.current === pairKey) setLoad({ pairKey, status: "error", data: null });
      })
      .finally(() => {
        if (inFlightRef.current.get(pairKey) === controller) inFlightRef.current.delete(pairKey);
      });

    return () => {
      controller.abort();
      if (inFlightRef.current.get(pairKey) === controller) inFlightRef.current.delete(pairKey);
    };
  }, [activated, competitionId, leagueId, pairKey, retry]);

  if (!activated || !pairKey) return null;
  const current = load.pairKey === pairKey ? load : { pairKey, status: "loading" as const, data: null };
  if (current.status === "loading" || current.status === "idle") {
    return (
      <section aria-busy="true" className="rounded-cs2-lg border border-cs2-line bg-cs2-paper p-4 dark:bg-white/[0.03]">
        <p className="text-[12px] text-cs2-ink-3">{ANALYTICS_COPY.modulesLoading}</p>
      </section>
    );
  }
  if (current.status === "error") {
    return (
      <section className="rounded-cs2-lg border border-cs2-line bg-cs2-paper p-4 dark:bg-white/[0.03]">
        <p className="text-[12px] text-cs2-ink-3">{ANALYTICS_COPY.modulesError}</p>
        <button
          type="button"
          className="mt-2 text-[12px] font-bold text-cs2-green"
          onClick={() => setRetry((value) => value + 1)}
        >
          {ANALYTICS_COPY.modulesRetry}
        </button>
      </section>
    );
  }
  if (!current.data) return null;
  const modules = current.data.modules;
  if (!modules.youVsRoom && !modules.rivalry && !modules.habits) return null;

  return (
    <div className="flex flex-col gap-3">
      <YouVsRoom module={modules.youVsRoom} />
      <Rivalry module={modules.rivalry} />
      <PredictionHabits module={modules.habits} />
    </div>
  );
}
