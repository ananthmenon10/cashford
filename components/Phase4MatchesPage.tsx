"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { MATCH_COPY } from "@/lib/match-copy";
import { groupFixturesByLocalDay } from "@/lib/matches-tab";
import type {
  LeagueRowView,
  MatchesTabView,
  WinnersRecapView,
  FixtureDay,
} from "@/lib/matches-tab";
import type { StandingsView } from "@/lib/standings-view";
import { LocalTime } from "@/components/LocalTime";

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

function Standings({ view }: { view: StandingsView | null }) {
  if (!view) {
    return <div className={card}>{MATCH_COPY.noTableData}</div>;
  }
  return (
    <section className={card}>
      <div className="mb-3 text-xs text-muted">{view.sourceLine}</div>
      <div className="grid grid-cols-[2rem_1fr_repeat(3,2.5rem)] gap-2 border-b border-border pb-2 text-[10px] font-bold text-muted">
        <span>#</span><span>{MATCH_COPY.club}</span><span>{MATCH_COPY.played}</span><span>{MATCH_COPY.goalDifference}</span><span>{MATCH_COPY.points}</span>
      </div>
      {view.rows.map((row, index) =>
        row.kind === "gap" ? (
          <div key={`gap-${index}`} className="py-3 text-center text-xs text-muted">
            {row.label}
          </div>
        ) : (
          <div
            key={row.value.club_id}
            className="grid grid-cols-[2rem_1fr_repeat(3,2.5rem)] gap-2 border-b border-border py-2.5 text-[13px] last:border-0"
          >
            <span>{row.value.rank}</span>
            <span className="font-semibold">{row.value.club}</span>
            <span>{row.value.played}</span>
            <span>{row.value.gd}</span>
            <span className="font-bold">{row.value.points}</span>
          </div>
        ),
      )}
      {view.note && <div className="mt-3 text-xs text-muted">{view.note}</div>}
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
  const displayed = useMemo(() => limitDays(days, 7), [days]);

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
          {view.picker.prev ? (
            <Link href={`/matches?gw=${view.picker.prev}`} className="font-bold">
              {MATCH_COPY.previousGw(view.picker.prev)}
            </Link>
          ) : <span />}
          <span className="font-bold">{MATCH_COPY.gwLabel(view.gw.number)}</span>
          {view.picker.next ? (
            <Link href={`/matches?gw=${view.picker.next}`} className="font-bold">
              {MATCH_COPY.nextGw(view.picker.next)}
            </Link>
          ) : <span />}
        </div>

        {segment === "table" ? (
          <Standings view={standings} />
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
            {displayed.days.map((day) => (
              <section key={day.dayKey}>
                <h2 className="mb-2 text-xs font-extrabold uppercase tracking-wide text-muted">
                  {day.dateAt ? <LocalTime iso={day.dateAt} variant="date" includeYear={false} relative={false} /> : MATCH_COPY.dateTbc}
                </h2>
                <div className="space-y-2">
                  {day.fixtures.map((fixture) => (
                    <Link key={fixture.id} href={fixture.matchHref} className={`block ${card}`}>
                      <div className="mb-2 flex items-center justify-between text-xs text-muted">
                        <span>{fixture.scheduled && fixture.kickoffAt ? <LocalTime iso={fixture.kickoffAt} variant="time" relative={false} /> : fixture.state}</span>
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
                  ))}
                </div>
              </section>
            ))}
            {displayed.overflow && (
              <div className="text-center text-xs text-muted">
                {MATCH_COPY.overflow(
                  displayed.overflow.count,
                  displayed.overflow.label,
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </main>
  );
}

function limitDays(
  days: readonly FixtureDay[],
  limit: number,
): {
  days: FixtureDay[];
  overflow: { count: number; label: string } | null;
} {
  const visible: FixtureDay[] = [];
  const hiddenLabels: string[] = [];
  let remaining = limit;
  let hidden = 0;
  for (const day of days) {
    const visibleFixtures = day.fixtures.slice(0, remaining);
    if (visibleFixtures.length) {
      visible.push({ ...day, fixtures: visibleFixtures });
      remaining -= visibleFixtures.length;
    }
    const hiddenHere = day.fixtures.length - visibleFixtures.length;
    if (hiddenHere > 0) {
      hidden += hiddenHere;
      hiddenLabels.push(day.dayKey);
    }
  }
  const labels = [...new Set(hiddenLabels)];
  const label =
    labels.length <= 1
      ? (labels[0] ?? "")
      : `${labels.slice(0, -1).join(", ")} and ${labels.at(-1)}`;
  return {
    days: visible,
    overflow: hidden > 0 ? { count: hidden, label } : null,
  };
}

function verdictCopy(verdict: "exact" | "result" | "miss") {
  return verdict === "exact"
    ? MATCH_COPY.exact
    : verdict === "result"
      ? MATCH_COPY.result
      : MATCH_COPY.miss;
}
