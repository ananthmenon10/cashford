"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { MATCH_COPY } from "@/lib/match-copy";
import {
  groupFixturesByLocalDay,
  isLiveFixtureState,
  liveClubMinutes,
  liveMinuteFromState,
} from "@/lib/matches-tab";
import type { LeagueRowView, MatchesTabView, WinnersRecapView } from "@/lib/matches-tab";
import type { StandingsView } from "@/lib/standings-view";
import { formatFriendlyDate } from "@/lib/datetime";
import { LocalTime } from "@/components/LocalTime";
import { CompetitionTable } from "@/components/matches/CompetitionTable";
import { verdictCopy } from "@/lib/matches-verdict";

const card =
  "rounded-card border border-border bg-surface p-4 shadow-[0_2px_8px_rgba(15,23,42,.04)]";

function money(value: number) {
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  return `${sign}₹${Math.abs(value).toLocaleString("en-IN")}`;
}

function LeagueRow({ row }: { row: LeagueRowView }) {
  let detail: string;
  switch (row.kind) {
    case "open-not-entered":
      detail = MATCH_COPY.notEnteredShort;
      break;
    case "open-entered":
      detail = MATCH_COPY.entryStarted;
      break;
    case "open-locked-in":
      detail = MATCH_COPY.lockedIn;
      break;
    case "open-needs-update":
      detail = MATCH_COPY.entryNeedsUpdate;
      break;
    case "locked-awaiting":
      detail = MATCH_COPY.lockedAwaiting;
      break;
    case "closed-not-entered":
      detail = MATCH_COPY.satOut;
      break;
    case "ineligible":
      detail = MATCH_COPY.ineligible;
      break;
    case "invalid":
      detail = row.reason || MATCH_COPY.invalid;
      break;
    case "provisional":
      detail = `${row.ordinal ?? "—"} of ${row.fieldSize} · ${row.points} pts${row.netInr == null ? "" : ` · ${money(row.netInr)}`}`;
      break;
    case "recalculating":
      detail = `${MATCH_COPY.recalculating}${row.points == null ? "" : ` · ${row.points} pts`}`;
      break;
    case "settled":
      detail = `${row.ordinal} of ${row.fieldSize} · ${row.points} pts · ${money(row.netInr)}`;
      break;
    case "void":
      detail = `${MATCH_COPY.gameweekVoid} · ${row.voidReason}`;
      break;
    case "all-called-off":
      detail = MATCH_COPY.calledOffSettling;
      break;
    case "sync-issue":
      detail = MATCH_COPY.syncIssue;
      break;
  }
  const cta = "cta" in row ? row.cta : null;
  return (
    <div className="border-t border-border py-3 first:border-0 first:pt-0 last:pb-0">
      <div className="flex items-center justify-between gap-3">
        <Link href={row.raceHref} className="font-bold text-primary-press">
          {row.league.name}
        </Link>
        {cta && (
          <Link
            href={cta.href}
            className="rounded-control bg-primary px-3 py-1.5 text-xs font-bold text-white"
          >
            {cta.label}
          </Link>
        )}
      </div>
      <div className="mt-1 text-[13px] text-muted">{detail}</div>
    </div>
  );
}

function Winners({ recap }: { recap: WinnersRecapView[] }) {
  return (
    <section className={card}>
      <h2 className="text-sm font-extrabold">{MATCH_COPY.winners}</h2>
      {recap.map((row) => (
        <div
          key={row.league.id}
          className="mt-3 border-t border-border pt-3 text-[13px]"
        >
          <Link href={row.href} className="font-bold text-primary-press">
            {row.league.name}
          </Link>
          {row.kind === "settled" && (
            <>
              <div className="mt-1 text-muted">
                ₹{row.potInr.toLocaleString("en-IN")} ·{" "}
                {row.winners.map((winner) => winner.name).join(", ")}
              </div>
              {row.tiebreakUsed !== "none" && (
                <div className="mt-1 text-xs text-muted">
                  {MATCH_COPY.tiebreak(row.tiebreakUsed)}
                </div>
              )}
            </>
          )}
          {row.kind === "void" && (
            <div className="mt-1 text-muted">
              {MATCH_COPY.gameweekVoid} · {row.voidReason}
            </div>
          )}
          {row.kind === "recalculating" && (
            <div className="mt-1 text-muted">{MATCH_COPY.recalculating}</div>
          )}
        </div>
      ))}
    </section>
  );
}

// All 20 rows, always — the "…N more" summary row this replaced (Step 6B) is gone for good.
// Delegates to the shared CompetitionTable (matches variant) so the sticky club column, the
// LIVE-badge placement, and the GD sign all come from one implementation instead of a second
// hand-rolled copy (Step 6B round 2, must-fix 6).
function Standings({
  view,
  competitionName,
  playedMeta,
  liveMinutes,
}: {
  view: StandingsView | null;
  competitionName: string;
  playedMeta: string;
  liveMinutes: Map<string, number | null>;
}) {
  if (!view) {
    return <div className={card}>{MATCH_COPY.noTableData}</div>;
  }
  return (
    <section className={card}>
      <div className="mb-3 flex items-center justify-between text-xs text-muted">
        <span>{view.sourceLine}</span>
        <span className="font-mono font-bold">{MATCH_COPY.tableRowsTotal(view.rows.length)}</span>
      </div>
      <CompetitionTable
        view={view}
        variant="matches"
        competitionName={competitionName}
        playedMeta={playedMeta}
        liveMinutes={liveMinutes}
      />
    </section>
  );
}

export function Phase4MatchesPage({
  view,
  standings,
  segment,
}: {
  view: MatchesTabView;
  standings: StandingsView | null;
  segment: "fixtures" | "table";
}) {
  const [timeZone, setTimeZone] = useState<string | null>(null);
  useEffect(() => {
    setTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone);
  }, []);
  const days = useMemo(
    () => (timeZone ? groupFixturesByLocalDay(view.fixtures, timeZone) : []),
    [timeZone, view.fixtures],
  );
  const totalFixtures = view.fixtures.length;
  const liveMinutes = useMemo(() => liveClubMinutes(view.fixtures), [view.fixtures]);
  const previousOption = view.picker.switcher.find((option) => option.role === "previous");
  const nextOption = view.picker.switcher.find((option) => option.role === "next");
  // Every day loads expanded (frame decision: no pagination, the day header is the only collapse
  // handle) — this set holds only the days a viewer has actively chosen to collapse.
  const [collapsedDays, setCollapsedDays] = useState<Set<string>>(new Set());
  const toggleDay = (dayKey: string) =>
    setCollapsedDays((prev) => {
      const next = new Set(prev);
      if (next.has(dayKey)) next.delete(dayKey);
      else next.add(dayKey);
      return next;
    });

  return (
    <main className="min-h-screen bg-bg">
      <div className="mx-auto max-w-[560px] px-4 py-5">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <div className="text-xs font-bold text-muted">
              {view.competition.name}
            </div>
            <h1 className="text-2xl font-extrabold">{view.gw.label}</h1>
          </div>
          <Link href="/" className="text-sm font-bold text-primary-press">
            {MATCH_COPY.home}
          </Link>
        </div>

        {view.scopes.length > 1 && (
          <div
            role="tablist"
            aria-label={MATCH_COPY.competitionScope}
            className="mb-4 flex gap-2 overflow-x-auto"
          >
            {view.scopes.map((scope) => {
              const active = scope.slug === view.selectedScope;
              return (
                <Link
                  key={scope.slug}
                  href={`/matches?comp=${scope.slug}`}
                  role="tab"
                  aria-selected={active}
                  className={`shrink-0 rounded-pill border px-3 py-1.5 text-xs font-extrabold whitespace-nowrap ${
                    active
                      ? "border-primary bg-primary/10 text-primary-press"
                      : "border-border text-muted"
                  }`}
                >
                  {scope.name}
                </Link>
              );
            })}
          </div>
        )}

        <nav className="mb-4 grid grid-cols-2 rounded-control bg-subtle p-1">
          <Link
            href={`/matches?gw=${view.gw.number}`}
            className={`rounded-control py-2 text-center text-sm font-bold ${segment === "fixtures" ? "bg-surface shadow-sm" : "text-muted"}`}
          >
            {MATCH_COPY.fixturesAndResults}
          </Link>
          <Link
            href={`/matches?gw=${view.gw.number}&view=table`}
            className={`rounded-control py-2 text-center text-sm font-bold ${segment === "table" ? "bg-surface shadow-sm" : "text-muted"}`}
          >
            {MATCH_COPY.table}
          </Link>
        </nav>

        <div className="mb-4 flex items-center justify-between text-sm">
          {previousOption?.number != null && !previousOption.disabled ? (
            <Link href={`/matches?gw=${previousOption.number}`} className="font-bold">
              {MATCH_COPY.previousGw(previousOption.number)}
            </Link>
          ) : <span />}
          <span className="font-bold">{MATCH_COPY.gwLabel(view.gw.number)}</span>
          {nextOption?.number != null && !nextOption.disabled ? (
            <Link href={`/matches?gw=${nextOption.number}`} className="font-bold">
              {MATCH_COPY.nextGw(nextOption.number)}
            </Link>
          ) : <span />}
        </div>

        {segment === "table" ? (
          <Standings
            view={standings}
            competitionName={view.competition.name}
            playedMeta={MATCH_COPY.tablePlayedMeta(
              standings?.rows.length
                ? Math.max(...standings.rows.map((row) => row.played))
                : 0,
              view.gw.number,
              view.gw.state === "live" ? "live" : view.gw.state === "settled" ? "settled" : "open",
            )}
            liveMinutes={liveMinutes}
          />
        ) : (
          <div className="space-y-4">
            {view.picker.futureCaveat && (
              <div className="text-xs text-muted">{MATCH_COPY.futureCaveat}</div>
            )}
            {view.yourGw?.recap && (
              <Link
                href={view.yourGw.recap.href}
                className={`${card} block text-sm font-bold text-primary-press`}
              >
                {MATCH_COPY.settledRecap(view.yourGw.recap.gwNumber)}{" "}
                {MATCH_COPY.viewRecap}
              </Link>
            )}
            {view.yourGw && (
              <section className={card}>
                <div className="mb-3 flex items-start justify-between">
                  <div>
                    <h2 className="font-extrabold">
                      {MATCH_COPY.yourGw(view.gw.number)}
                    </h2>
                    <div className="mt-1 text-xs text-muted">
                      {view.yourGw.toGo == null
                        ? MATCH_COPY.leagues(
                            view.yourGw.enteredCount,
                            view.yourGw.leagueCount,
                          )
                        : MATCH_COPY.entered(
                            view.yourGw.enteredCount,
                            view.yourGw.leagueCount,
                            view.yourGw.toGo,
                          )}
                    </div>
                  </div>
                  {view.yourGw.headerPoints != null && (
                    <span className="font-mono font-bold">
                      {MATCH_COPY.pointsValue(view.yourGw.headerPoints)}
                    </span>
                  )}
                </div>
                {view.yourGw.headerPoints == null &&
                  view.yourGw.rows.length > 1 && (
                    <div className="mb-3 rounded-control bg-subtle p-2 text-xs text-muted">
                      {MATCH_COPY.pointsDiffer}
                    </div>
                  )}
                {view.yourGw.rows.map((row) => (
                  <LeagueRow key={row.league.id} row={row} />
                ))}
                {view.yourGw.provisional && (
                  <div className="mt-3 border-t border-border pt-3 text-xs font-bold text-live">
                    {MATCH_COPY.provisional}
                  </div>
                )}
              </section>
            )}
            {view.winnersRecap && <Winners recap={view.winnersRecap} />}
            {days.length > 0 && (
              <div className="flex items-center justify-between text-xs text-muted">
                <span className="font-bold uppercase tracking-wide">
                  {MATCH_COPY.fixturesAndResults}
                </span>
                <span className="font-mono font-bold">{MATCH_COPY.fixturesTotal(totalFixtures)}</span>
              </div>
            )}
            {days.length > 0 && (
              <div className="flex items-start gap-2 rounded-control bg-subtle p-2 text-xs text-muted">
                <span aria-hidden>⌄</span>
                <span>{MATCH_COPY.fixturesCallout}</span>
              </div>
            )}
            {days.map((day) => {
              const collapsed = collapsedDays.has(day.dayKey);
              const dayLabel = day.dateAt
                ? formatFriendlyDate(day.dateAt, {
                    timeZone: timeZone ?? undefined,
                    includeYear: false,
                  })
                : MATCH_COPY.dateTbc;
              return (
                <section key={day.dayKey} className={`${card} !p-0 overflow-hidden`}>
                  <button
                    type="button"
                    onClick={() => toggleDay(day.dayKey)}
                    aria-expanded={!collapsed}
                    aria-label={
                      collapsed
                        ? MATCH_COPY.expandDay(dayLabel)
                        : MATCH_COPY.collapseDay(dayLabel)
                    }
                    className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left"
                  >
                    <span className="text-xs font-extrabold uppercase tracking-wide text-muted">
                      {day.dateAt ? (
                        <LocalTime iso={day.dateAt} variant="date" includeYear={false} relative={false} />
                      ) : (
                        MATCH_COPY.dateTbc
                      )}
                    </span>
                    <span className="flex items-center gap-2">
                      <span className="text-xs font-bold text-muted">
                        {MATCH_COPY.dayFixtureCount(day.fixtures.length)}
                      </span>
                      <span aria-hidden className="text-xs text-muted">
                        {collapsed ? "⌄" : "⌃"}
                      </span>
                    </span>
                  </button>
                  {!collapsed && (
                    <div className="space-y-2 border-t border-border p-4">
                      {day.fixtures.map((fixture) => {
                        const live = isLiveFixtureState(fixture.state);
                        return (
                          <Link
                            key={fixture.id}
                            href={fixture.matchHref}
                            className={`block ${card}`}
                          >
                            <div className="mb-2 flex items-center justify-between text-xs text-muted">
                              <span
                                className={live ? "font-bold text-live" : undefined}
                              >
                                {fixture.scheduled && fixture.kickoffAt ? (
                                  <LocalTime iso={fixture.kickoffAt} variant="time" relative={false} />
                                ) : live ? (
                                  MATCH_COPY.liveMinute(liveMinuteFromState(fixture.state))
                                ) : (
                                  fixture.state
                                )}
                              </span>
                              {fixture.insightsMark && <span>{MATCH_COPY.insightsMark}</span>}
                            </div>
                            <div className="grid grid-cols-[1fr_auto] gap-y-2 text-[15px]">
                              <span className="font-semibold">{fixture.home.name}</span>
                              <span className="font-mono font-bold">
                                {fixture.score?.[0] ?? "—"}
                              </span>
                              <span className="font-semibold">{fixture.away.name}</span>
                              <span className="font-mono font-bold">
                                {fixture.score?.[1] ?? "—"}
                              </span>
                            </div>
                            {fixture.yourCall.kind === "same" && (
                              <div className="mt-3 border-t border-border pt-2 text-xs text-muted">
                                {MATCH_COPY.sameCall(
                                  fixture.yourCall.score[0],
                                  fixture.yourCall.score[1],
                                )} · {fixture.yourCall.leagues.map((league) => league.name).join(", ")}
                                {" · "}
                                {fixture.score
                                  ? `${fixture.yourCall.points} pts${fixture.yourCall.verdict ? ` · ${verdictCopy(fixture.yourCall.verdict)}` : ""}`
                                  : MATCH_COPY.pointsPending}
                              </div>
                            )}
                            {fixture.yourCall.kind === "varies" && (
                              <div className="mt-3 border-t border-border pt-2 text-xs text-muted">
                                {MATCH_COPY.twoWays} ·{" "}
                                {fixture.yourCall.calls
                                  .map(
                                    (call) =>
                                      `${call.league.name} ${call.score[0]}–${call.score[1]}${
                                        fixture.score
                                          ? ` · ${call.points} pts${call.verdict ? ` · ${verdictCopy(call.verdict)}` : ""}`
                                          : ` · ${MATCH_COPY.pointsPending}`
                                      }`,
                                  )
                                  .join(" · ")}
                              </div>
                            )}
                          </Link>
                        );
                      })}
                    </div>
                  )}
                </section>
              );
            })}
            {days.length > 0 && (
              <div className="text-center text-xs font-semibold text-muted">
                {MATCH_COPY.fixturesScrollFoot(totalFixtures)}
              </div>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
