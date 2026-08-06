"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  C21,
  C23,
  C24,
  C56,
  ENTRY_SHEET_COPY,
  GW_UI_COPY,
  entryErrorCopy,
} from "@/lib/gw-copy";
import type { GameweekViewDTO, MirrorTarget } from "@/lib/gw-view";
import { LocalTime } from "@/components/LocalTime";
import { ScoreStepper, clampScore } from "./ScoreStepper";
import { MirrorPrompt } from "./MirrorPrompt";

type Pick = { home: number; away: number; touched: boolean };
type PickState = Record<string, Pick>;

// Fixed common-score shortcuts per the reference frame — a one-tap alternative to the 0-0
// default, not odds-derived (that's ScoreChips, used elsewhere for insight-driven suggestions).
const QUICK_SCORES: readonly [number, number][] = [
  [0, 0],
  [1, 0],
  [1, 1],
  [2, 1],
];

export function EntrySheet({
  view,
  viewerId,
  mirrorTargets,
}: {
  view: GameweekViewDTO;
  viewerId: string;
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
        // A fixture with an already-saved pick is a real decision, even if that pick happens to
        // be 0-0 — the muted "untouched default" treatment only applies to a pick nobody has
        // looked at yet this session.
        return [
          fixture.fixtureId,
          pick
            ? { home: pick.predHome, away: pick.predAway, touched: true }
            : { home: 0, away: 0, touched: false },
        ];
      }),
    );
  }, [activeFixtures, view.viewerPicks]);
  const [picks, setPicks] = useState<PickState>(initial);
  const [confirmArmed, setConfirmArmed] = useState(false);
  const [pending, setPending] = useState(false);
  const [readOnly, setReadOnly] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [invalidFixtures, setInvalidFixtures] = useState<Set<string>>(
    () => new Set(),
  );
  const [reloadRequired, setReloadRequired] = useState(false);
  const [sessionExpired, setSessionExpired] = useState(false);
  const [saved, setSaved] = useState(false);
  // Keyed by viewer as well as contest: on a shared device, one account's unsaved draft must
  // never restore into another account's entry sheet (it would arrive pre-touched and bypass
  // the 0-0 confirm guard).
  const storageKey = view.contest ? `cf-gw-draft:${view.contest.id}:${viewerId}` : "";

  useEffect(() => {
    if (!storageKey) return;
    try {
      const cached = window.sessionStorage.getItem(storageKey);
      if (cached) {
        const parsed = JSON.parse(cached) as Record<
          string,
          { home: unknown; away: unknown; touched?: boolean }
        >;
        const merged: PickState = { ...initial };
        for (const [fixtureId, pick] of Object.entries(parsed)) {
          if (!(fixtureId in merged)) continue;
          // A previously-deployed draft format stored `{home: number|null, away: number|null}`
          // with no `touched` — coerce through clampScore and drop anything that isn't a real
          // number (a stale null-score draft must not restore a blank, wrongly-touched pick).
          // `typeof` guards first: `Number(null) === 0` and `Number(undefined) === NaN`, and
          // relying on Number.isFinite alone after coercion would let a null score silently
          // become a touched 0-0 instead of being dropped.
          if (typeof pick.home !== "number" || typeof pick.away !== "number") continue;
          if (!Number.isFinite(pick.home) || !Number.isFinite(pick.away)) continue;
          // A cached draft entry was, by definition, something the user was mid-edit on.
          merged[fixtureId] = { home: clampScore(pick.home), away: clampScore(pick.away), touched: true };
        }
        setPicks(merged);
      }
    } catch {
      window.sessionStorage.removeItem(storageKey);
    }
  }, [initial, storageKey]);

  useEffect(() => {
    if (!storageKey || saved) return;
    window.sessionStorage.setItem(storageKey, JSON.stringify(picks));
  }, [picks, saved, storageKey]);

  if (!view.gameweek || !view.contest) return null;
  const touchedCount = activeFixtures.filter((fixture) => picks[fixture.fixtureId]?.touched).length;
  const untouchedCount = activeFixtures.length - touchedCount;
  const firstSave = !view.viewerEntry;
  const leagueHref = `/leagues/${view.league.slug}?gw=${view.gameweek.number}`;
  const returnPath = `/leagues/${view.league.slug}/enter?gw=${view.gameweek.number}`;
  const loginHref = `/login?next=${encodeURIComponent(returnPath)}`;

  function setScore(fixtureId: string, side: "home" | "away", value: number) {
    setConfirmArmed(false);
    setPicks((current) => ({
      ...current,
      [fixtureId]: { ...current[fixtureId], [side]: value, touched: true },
    }));
  }

  function setQuickScore(fixtureId: string, home: number, away: number) {
    setConfirmArmed(false);
    setPicks((current) => ({
      ...current,
      [fixtureId]: { home, away, touched: true },
    }));
  }

  async function save() {
    if (pending || readOnly) return;
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
        predHome: picks[fixture.fixtureId].home,
        predAway: picks[fixture.fixtureId].away,
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

  function handleSaveClick() {
    if (pending || readOnly) return;
    // The 0-0 confirm guard: while any pick is untouched, Save only arms the guard (revealing the
    // confirm bar's own button below) and never itself submits — a double-tap on this same button
    // can only arm twice, never save, because the actual submit lives on a distinct control.
    if (untouchedCount > 0) {
      if (!confirmArmed) setConfirmArmed(true);
      return;
    }
    void save();
  }

  function handleConfirmClick() {
    if (pending || readOnly) return;
    setConfirmArmed(false);
    void save();
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

  const saveLabel = pending
    ? GW_UI_COPY.saving
    : firstSave
      ? C24(view.contest.stakeInr)
      : C23;

  return (
    <section className="overflow-hidden rounded-cs2-lg border border-cs2-line bg-cs2-paper">
      <div className="border-b border-cs2-line-2 px-5 py-4">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-[20px] font-extrabold">{C21(view.gameweek.number)}</h1>
          <span aria-live="polite" className="font-mono text-[12px] font-bold tabular text-cs2-ink-3">
            {ENTRY_SHEET_COPY.chosenProgress(touchedCount, activeFixtures.length)}
          </span>
        </div>
        <p className="mt-1.5 flex items-center gap-2 text-[11px] font-semibold text-cs2-ink-3">
          <span>{ENTRY_SHEET_COPY.tapHint}</span>
          <span className="font-mono tracking-wide text-cs2-ink-3">{ENTRY_SHEET_COPY.oneTapBadge}</span>
        </p>
      </div>
      <div className="divide-y divide-cs2-line-2">
        {activeFixtures.map((fixture) => {
          // The server can re-render with a new/changed fixture id (e.g. a void->active flip)
          // while client `picks` state is still keyed off the previous fixture list — fall back
          // to the untouched default rather than crash on a missing entry.
          const pick = picks[fixture.fixtureId] ?? { home: 0, away: 0, touched: false };
          return (
            <div
              key={fixture.fixtureId}
              aria-invalid={invalidFixtures.has(fixture.fixtureId) || undefined}
              className={`px-4 py-4 ${
                invalidFixtures.has(fixture.fixtureId) ? "bg-cs2-red-soft" : ""
              }`}
            >
              <div className="mb-2.5 flex items-center justify-between gap-3 text-[10px] font-semibold text-cs2-ink-3">
                <span>
                  {fixture.kickoffAt ? (
                    <>
                      <LocalTime iso={fixture.kickoffAt} variant="date" relative={false} includeYear={false} />
                      {" · "}
                      <LocalTime iso={fixture.kickoffAt} variant="time" relative={false} />
                    </>
                  ) : null}
                </span>
                {!pick.touched ? (
                  <span className="rounded-cs2-sm bg-cs2-amber-soft px-2 py-0.5 font-bold uppercase tracking-wide text-cs2-amber">
                    {ENTRY_SHEET_COPY.defaultTag}
                  </span>
                ) : null}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="text-center">
                  <div className="mb-2 text-[12px] font-bold">{fixture.homeName}</div>
                  <div className="mb-1 font-mono text-[8px] font-semibold uppercase tracking-[.02em] text-cs2-ink-3">
                    {ENTRY_SHEET_COPY.homeLabel}
                  </div>
                  <ScoreStepper
                    side="home"
                    value={pick.home}
                    muted={!pick.touched}
                    disabled={readOnly}
                    onChange={(value) => setScore(fixture.fixtureId, "home", clampScore(value))}
                  />
                </div>
                <div className="text-center">
                  <div className="mb-2 text-[12px] font-bold">{fixture.awayName}</div>
                  <div className="mb-1 font-mono text-[8px] font-semibold uppercase tracking-[.02em] text-cs2-ink-3">
                    {ENTRY_SHEET_COPY.awayLabel}
                  </div>
                  <ScoreStepper
                    side="away"
                    value={pick.away}
                    muted={!pick.touched}
                    disabled={readOnly}
                    onChange={(value) => setScore(fixture.fixtureId, "away", clampScore(value))}
                  />
                </div>
              </div>
              <div
                role="group"
                className="mt-3 flex justify-center gap-2"
                aria-label={ENTRY_SHEET_COPY.quickScoresAria(fixture.homeName, fixture.awayName)}
              >
                {QUICK_SCORES.map(([home, away]) => {
                  const selected = pick.home === home && pick.away === away;
                  return (
                    <button
                      key={`${home}-${away}`}
                      type="button"
                      aria-pressed={selected}
                      disabled={readOnly}
                      onClick={() => setQuickScore(fixture.fixtureId, home, away)}
                      className={`rounded-pill border px-3 py-1 font-mono text-[12px] font-bold tabular ${
                        selected
                          ? pick.touched
                            ? "border-cs2-green bg-mint text-cs2-green"
                            : "border-cs2-line-2 bg-cs2-paper text-cs2-ink-3"
                          : "border-cs2-line bg-cs2-paper text-cs2-ink-2"
                      }`}
                    >
                      {home}-{away}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      <div className="border-t border-cs2-line-2 bg-cs2-canvas p-4">
        {untouchedCount > 0 ? (
          <div
            role="status"
            aria-live="polite"
            className="mb-3 rounded-cs2-md border border-cs2-amber-line bg-cs2-amber-soft p-3"
          >
            <div className="flex items-center justify-between gap-3">
              <span className="font-mono text-[12px] font-bold tabular text-cs2-amber">
                {ENTRY_SHEET_COPY.picksLeftAtZero(untouchedCount)}
              </span>
              <span className="text-[10px] font-extrabold uppercase tracking-[.08em] text-cs2-amber">
                {ENTRY_SHEET_COPY.realPickLabel}
              </span>
            </div>
            <p className="mt-1 text-[11px] text-cs2-ink-2">{ENTRY_SHEET_COPY.confirmHint}</p>
            {confirmArmed ? (
              <button
                type="button"
                onClick={handleConfirmClick}
                disabled={pending || readOnly}
                className="mt-2.5 w-full rounded-cs2-md bg-cs2-green py-3 text-[14px] font-bold text-white disabled:bg-cs2-line disabled:text-cs2-ink-3"
              >
                {ENTRY_SHEET_COPY.confirmAgain(untouchedCount)}
              </button>
            ) : null}
          </div>
        ) : null}
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
          onClick={handleSaveClick}
          disabled={pending || readOnly || activeFixtures.length === 0}
          className="w-full rounded-cs2-md bg-cs2-green py-3.5 text-[15px] font-bold text-white disabled:bg-cs2-line disabled:text-cs2-ink-3"
        >
          {saveLabel}
        </button>
      </div>
    </section>
  );
}
