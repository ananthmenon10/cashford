"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  C21,
  C22,
  C23,
  C24,
  C56,
  GW_UI_COPY,
  entryErrorCopy,
} from "@/lib/gw-copy";
import type { GameweekViewDTO, MirrorTarget } from "@/lib/gw-view";
import { ScoreStepper } from "./ScoreStepper";
import { MirrorPrompt } from "./MirrorPrompt";

type PickState = Record<string, { home: number | null; away: number | null }>;

export function EntrySheet({
  view,
  mirrorTargets,
}: {
  view: GameweekViewDTO;
  mirrorTargets: MirrorTarget[];
}) {
  const router = useRouter();
  const activeFixtures = useMemo(
    () => view.fixtures.filter((fixture) => fixture.state === "active"),
    [view.fixtures],
  );
  const initial = useMemo<PickState>(() => {
    const existing = new Map(view.viewerPicks.map((pick) => [pick.fixtureId, pick]));
    return Object.fromEntries(
      activeFixtures.map((fixture) => {
        const pick = existing.get(fixture.fixtureId);
        return [
          fixture.fixtureId,
          { home: pick?.predHome ?? null, away: pick?.predAway ?? null },
        ];
      }),
    );
  }, [activeFixtures, view.viewerPicks]);
  const [picks, setPicks] = useState<PickState>(initial);
  const [pending, setPending] = useState(false);
  const [readOnly, setReadOnly] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [invalidFixtures, setInvalidFixtures] = useState<Set<string>>(
    () => new Set(),
  );
  const [reloadRequired, setReloadRequired] = useState(false);
  const [sessionExpired, setSessionExpired] = useState(false);
  const [saved, setSaved] = useState(false);
  const storageKey = view.contest ? `cf-gw-draft:${view.contest.id}` : "";

  useEffect(() => {
    if (!storageKey) return;
    try {
      const cached = window.sessionStorage.getItem(storageKey);
      if (cached) setPicks({ ...initial, ...(JSON.parse(cached) as PickState) });
    } catch {
      window.sessionStorage.removeItem(storageKey);
    }
  }, [initial, storageKey]);

  useEffect(() => {
    if (!storageKey || saved) return;
    window.sessionStorage.setItem(storageKey, JSON.stringify(picks));
  }, [picks, saved, storageKey]);

  if (!view.gameweek || !view.contest) return null;
  const completeCount = activeFixtures.filter((fixture) => {
    const pick = picks[fixture.fixtureId];
    return pick?.home != null && pick.away != null;
  }).length;
  const complete = completeCount === activeFixtures.length && activeFixtures.length > 0;
  const firstSave = !view.viewerEntry;
  const leagueHref = `/leagues/${view.league.slug}?gw=${view.gameweek.number}`;
  const returnPath = `/leagues/${view.league.slug}/enter?gw=${view.gameweek.number}`;
  const loginHref = `/login?next=${encodeURIComponent(returnPath)}`;

  function setScore(fixtureId: string, side: "home" | "away", value: number) {
    setPicks((current) => ({
      ...current,
      [fixtureId]: { ...current[fixtureId], [side]: value },
    }));
  }

  async function save() {
    if (!complete || pending || readOnly) return;
    setPending(true);
    setError(null);
    setInvalidFixtures(new Set());
    setReloadRequired(false);
    setSessionExpired(false);
    const payload = {
      leagueId: view.league.id,
      gameweekId: view.gameweek!.id,
      picks: activeFixtures.map((fixture) => ({
        fixtureId: fixture.fixtureId,
        predHome: picks[fixture.fixtureId].home!,
        predAway: picks[fixture.fixtureId].away!,
      })),
    };
    try {
      const response = await fetch(firstSave ? "/api/gw/enter" : "/api/gw/picks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        const routineMessage = body.error?.trim() ?? "";
        let mapped = entryErrorCopy(routineMessage, {
          noEntryAtSave: false,
          status: response.status,
        });
        if (firstSave && mapped.id === "C55") {
          setReloadRequired(mapped.reload);
          setError(mapped.copy);
          setReadOnly(mapped.readOnly);
          setSessionExpired(mapped.sessionExpired);
          let noEntryAtSave = false;
          try {
            const query = new URLSearchParams({
              league: view.league.id,
              gw: view.gameweek!.id,
            });
            const verification = await fetch(`/api/gw/contest?${query}`, {
              signal: AbortSignal.timeout(3000),
            });
            if (verification.ok) {
              const contest = (await verification.json()) as {
                myEntry?: { status?: unknown } | null;
              };
              noEntryAtSave =
                contest.myEntry === null || contest.myEntry?.status === "invalid";
            }
          } catch {
            // An unknown entry state must use the neutral deadline copy.
          }
          mapped = entryErrorCopy(routineMessage, {
            noEntryAtSave,
            status: response.status,
          });
        }
        if (response.status === 400) {
          const rejected = new Set<string>();
          const pathIndex = routineMessage.match(/picks\.(\d+)/)?.[1];
          if (pathIndex != null) {
            const fixture = activeFixtures[Number(pathIndex)];
            if (fixture) rejected.add(fixture.fixtureId);
          }
          for (const fixture of activeFixtures) {
            if (routineMessage.includes(fixture.fixtureId)) {
              rejected.add(fixture.fixtureId);
            }
          }
          setInvalidFixtures(rejected);
        }
        setReloadRequired(mapped.reload);
        setError(mapped.copy);
        setReadOnly(mapped.readOnly);
        setSessionExpired(mapped.sessionExpired);
        return;
      }
      window.sessionStorage.removeItem(storageKey);
      setSaved(true);
      if (!firstSave || mirrorTargets.length === 0) {
        router.push(`/leagues/${view.league.slug}?gw=${view.gameweek!.number}`);
        router.refresh();
      }
    } catch {
      setError(C56);
    } finally {
      setPending(false);
    }
  }

  if (saved && firstSave && mirrorTargets.length) {
    return (
      <MirrorPrompt
        sourceLeagueId={view.league.id}
        gameweekId={view.gameweek.id}
        targets={mirrorTargets}
        returnPath={returnPath}
        onDone={() => {
          router.push(`/leagues/${view.league.slug}?gw=${view.gameweek!.number}`);
          router.refresh();
        }}
      />
    );
  }

  return (
    <section className="overflow-hidden rounded-cs2-lg border border-cs2-line bg-cs2-paper">
      <div className="border-b border-cs2-line-2 px-5 py-4">
        <h1 className="text-[20px] font-extrabold">{C21(view.gameweek.number)}</h1>
        <p aria-live="polite" className="mt-1 font-mono text-[12px] font-bold tabular text-cs2-ink-3">
          {C22(completeCount, activeFixtures.length)}
        </p>
      </div>
      <div className="divide-y divide-cs2-line-2">
        {activeFixtures.map((fixture) => (
          <div
            key={fixture.fixtureId}
            aria-invalid={invalidFixtures.has(fixture.fixtureId) || undefined}
            className={`px-4 py-4 ${
              invalidFixtures.has(fixture.fixtureId) ? "bg-cs2-red-soft" : ""
            }`}
          >
            <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
              <div className="text-right">
                <div className="mb-2 text-[12px] font-bold">{fixture.homeName}</div>
                <ScoreStepper
                  side="home"
                  value={picks[fixture.fixtureId]?.home ?? null}
                  onChange={(value) => setScore(fixture.fixtureId, "home", value)}
                  disabled={readOnly}
                />
              </div>
              <span className="pt-7 text-cs2-ink-3">–</span>
              <div>
                <div className="mb-2 text-[12px] font-bold">{fixture.awayName}</div>
                <ScoreStepper
                  side="away"
                  value={picks[fixture.fixtureId]?.away ?? null}
                  onChange={(value) => setScore(fixture.fixtureId, "away", value)}
                  disabled={readOnly}
                />
              </div>
            </div>
          </div>
        ))}
      </div>
      <div className="border-t border-cs2-line-2 bg-cs2-canvas p-4">
        <p
          aria-live="polite"
          className={error ? "mb-3 text-[12px] font-semibold text-cs2-red" : ""}
        >
          {error ?? ""}
        </p>
        {reloadRequired ? (
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mb-3 w-full rounded-cs2-md border border-cs2-line bg-cs2-paper py-2.5 text-[13px] font-bold text-cs2-green"
          >
            {GW_UI_COPY.reloadGameweek}
          </button>
        ) : null}
        {sessionExpired ? (
          <a
            href={loginHref}
            className="mb-3 block w-full rounded-cs2-md border border-cs2-line bg-cs2-paper py-2.5 text-center text-[13px] font-bold text-cs2-green"
          >
            {GW_UI_COPY.signInAgain}
          </a>
        ) : null}
        {readOnly ? (
          <a
            href={leagueHref}
            className="mb-3 block w-full rounded-cs2-md border border-cs2-line bg-cs2-paper py-2.5 text-center text-[13px] font-bold text-cs2-green"
          >
            {GW_UI_COPY.backToLeague}
          </a>
        ) : null}
        <button
          type="button"
          onClick={save}
          disabled={!complete || pending || readOnly}
          className="w-full rounded-cs2-md bg-cs2-green py-3.5 text-[15px] font-bold text-white disabled:bg-cs2-line disabled:text-cs2-ink-3"
        >
          {pending
            ? GW_UI_COPY.saving
            : firstSave
              ? C24(view.contest.stakeInr)
              : C23}
        </button>
        {!complete ? (
          <p className="mt-2 text-center text-[11px] font-semibold text-cs2-ink-3">
            {GW_UI_COPY.entryIncomplete}
          </p>
        ) : null}
      </div>
    </section>
  );
}
