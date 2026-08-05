import { C29, C57, C60, GW_BADGE_COPY, LEAGUE_SCREEN_COPY, moneyCopy } from "@/lib/gw-copy";
import type { GameweekViewDTO } from "@/lib/gw-view";
import { DUES_COPY } from "@/lib/payment-copy";
import type { DuesView } from "@/lib/dues-view";
import type { SeasonView } from "@/lib/gw-season";
import type { StandingsView } from "@/lib/standings-view";
import { TableStandard, type TableStandardRow } from "@/components/TableStandard";
import { EmptyState } from "./EmptyState";
import { EntryCard } from "./EntryCard";
import { EntryCta } from "./EntryCta";
import { FixtureRow } from "./FixtureRow";
import { GameweekStrip } from "./GameweekStrip";
import { NeedsUpdateNudge } from "./NeedsUpdateNudge";
import { PotSummary } from "./PotSummary";
import { RecalculatingNote } from "./RecalculatingNote";
import { Standings } from "./Standings";
import { StateHeader } from "./StateHeader";
import { SeasonTable } from "./SeasonTable";
import { DuesHeader } from "@/components/dues/DuesHeader";
import { ActivityFeed } from "@/components/dues/ActivityFeed";
import { LedgerSyncIssue } from "@/components/dues/LedgerSyncIssue";
import { NetPositionTable } from "@/components/dues/NetPositionTable";
import { PendingPaymentCard } from "@/components/dues/PendingPaymentCard";
import { SettlePlan } from "@/components/dues/SettlePlan";
import { CompetitionTable } from "@/components/matches/CompetitionTable";

export function LeagueGameweekPane({ view }: { view: GameweekViewDTO }) {
  const now = new Date();
  if (!view.gameweek || !view.contest || view.lifecycle === "CL0") {
    return <EmptyState copy={C29} />;
  }
  return (
    <>
      <GameweekStrip
        slug={view.league.slug}
        gameweek={view.gameweek}
        adjacent={view.adjacentGameweeks}
      />
      <StateHeader view={view} />
      {view.lifecycle !== "CL9" && view.isDoubleGameweek ? (
        <p className="mt-3 rounded-cs2-md border border-cs2-line bg-cs2-paper px-4 py-3 text-[12px] font-semibold text-cs2-ink-2">
          {C57(
            view.gameweek.number,
            view.fixtures.filter((fixture) => fixture.state === "active").length,
          )}
        </p>
      ) : null}
      {view.lifecycle !== "CL9" && ["CL1", "CL2", "CL3", "CL4"].includes(view.lifecycle) ? (
        <PotSummary
          stakeInr={view.contest.stakeInr}
          potInr={view.potInr}
          entered={view.enteredCount}
          eligible={view.eligibleCount}
          contestStatus={view.contest.status}
          deadlineAt={view.contest.deadlineAt}
          now={now.getTime()}
        />
      ) : null}
      {view.lifecycle !== "CL9" && (view.viewerParticipation === "VP2" || view.viewerParticipation === "VP3") ? (
        <EntryCard fixtures={view.fixtures} picks={view.viewerPicks} />
      ) : null}
      {view.lifecycle !== "CL9" && view.viewerParticipation === "VP3" && view.lifecycle === "CL1" ? (
        <NeedsUpdateNudge />
      ) : null}
      {view.lifecycle !== "CL9" && view.render.showCta ? (
        <EntryCta
          slug={view.league.slug}
          gameweekNumber={view.gameweek.number}
          stakeInr={view.contest.stakeInr}
          participation={view.viewerParticipation}
        />
      ) : null}
      {view.lifecycle !== "CL9" && view.render.showStandings ? (
        <Standings rows={view.standings} showMoney={view.render.showMoney} />
      ) : null}
      {view.lifecycle !== "CL1" && view.lifecycle !== "CL9" && view.lifecycle !== "CL10" ? (
        <section id={`league-gw-${view.gameweek.number}-matches`} className="mt-5">
          <div className="mb-2 flex items-end justify-between gap-3">
            <h2 className="text-[13px] font-extrabold">{LEAGUE_SCREEN_COPY.matches(view.gameweek.number)}</h2>
            <span className="text-[10px] font-bold uppercase tracking-[.08em] text-cs2-ink-3">{LEAGUE_SCREEN_COPY.fixtures(view.fixtures.length)}</span>
          </div>
          <div className="rounded-cs2-md border border-cs2-line bg-cs2-paper px-4">
            {view.fixtures.map((fixture) => (
              <FixtureRow key={fixture.fixtureId} fixture={fixture} picks={view.revealedPicks} />
            ))}
          </div>
        </section>
      ) : null}
    </>
  );
}

export function LeagueSeasonPane({
  slug,
  view,
  viewerId,
  competitionName,
}: {
  slug: string;
  view: SeasonView;
  viewerId: string;
  competitionName: string;
}) {
  return (
    <SeasonTable
      slug={slug}
      view={view}
      viewerId={viewerId}
      competitionName={competitionName}
    />
  );
}

export function LeagueDuesPane({ view }: { view: DuesView }) {
  const names = new Map(view.people.map((person) => [person.id, person.name]));
  return (
    <>
      <DuesHeader />
      {view.ledger.status === "recalculating" ? (
        <RecalculatingNote />
      ) : view.ledger.status === "sync_issue" ? (
        <LedgerSyncIssue leagueId={view.league.id} fingerprint={view.ledger.detailFingerprint} />
      ) : null}
      {view.pending.filter((payment) => payment.viewerMustAnswer).map((payment) => (
        <div key={payment.id} className="mt-3">
          <PendingPaymentCard payment={payment} names={names} />
        </div>
      ))}
      {view.ledger.status === "clean" ? (
        <>
          <NetPositionTable people={view.people} />
          <SettlePlan plan={view.ledger.plan} names={names} slug={view.league.slug} viewerId={view.viewerId} />
        </>
      ) : null}
      {view.ledger.status !== "clean" ? <p className="mt-5 text-[12px] text-cs2-ink-3">{DUES_COPY.boundary}</p> : null}
      <a href={`/leagues/${view.league.slug}/dues/log`} className="mt-5 block rounded-cs2-md bg-cs2-green py-3 text-center text-[13px] font-bold text-white">
        {DUES_COPY.logPayment}
      </a>
      <ActivityFeed items={view.activity} names={names} />
    </>
  );
}

export function LeagueTablePane({
  view,
  current,
  season,
}: {
  view: StandingsView | null;
  current: GameweekViewDTO;
  season: SeasonView;
}) {
  const liveClubs = current.fixtures
    .filter((fixture) => fixture.status.toLowerCase() === "live")
    .flatMap((fixture) => [fixture.homeName, fixture.awayName]);
  const isLive = current.lifecycle === "CL3";
  const recalculating = season.totals.some((row) => row.points === "suppressed" || row.netInr === "suppressed");
  const rows: TableStandardRow[] = season.totals.map((row) => ({
    key: row.userId,
    tone: row.isViewer ? "viewer" : isLive ? "live" : "default",
    liveLabel: isLive ? GW_BADGE_COPY.live : undefined,
    cells: [
      <span key="name" className="flex min-w-0 items-center gap-2">
        <span className="truncate font-bold">{row.name}</span>
      </span>,
      row.points === "suppressed" ? (
        <span key="recalculating-points" title={C60} className="rounded-pill border border-cs2-amber-line bg-cs2-amber-soft px-1.5 py-0.5 text-[9px] font-extrabold tracking-[.04em] text-cs2-amber">{GW_BADGE_COPY.recalculating}</span>
      ) : row.points,
      row.gameweeksEntered,
      row.netInr === "suppressed" ? (
        <span key="recalculating-net" title={C60} className="rounded-pill border border-cs2-amber-line bg-cs2-amber-soft px-1.5 py-0.5 text-[9px] font-extrabold tracking-[.04em] text-cs2-amber">{GW_BADGE_COPY.recalculating}</span>
      ) : moneyCopy(row.netInr),
    ],
  }));
  return (
    <>
      <section>
        <div className="mb-3 flex items-end justify-between gap-3">
          <div>
            <p className="text-[10px] font-extrabold uppercase tracking-[.1em] text-cs2-green">{LEAGUE_SCREEN_COPY.playerTableTitle}</p>
            <p className="mt-1 text-[12px] text-cs2-ink-3">{LEAGUE_SCREEN_COPY.playerTableSource}</p>
          </div>
          <span className="shrink-0 text-[10px] font-bold uppercase tracking-[.08em] text-cs2-ink-3">{LEAGUE_SCREEN_COPY.players(rows.length)}</span>
        </div>
        <div className="mb-2 rounded-cs2-sm border border-cs2-line-2 bg-cs2-canvas px-3 py-2 text-[11px] font-semibold text-cs2-ink-3">⌖ {LEAGUE_SCREEN_COPY.playerStickyHint}</div>
        {recalculating ? <RecalculatingNote /> : null}
        <TableStandard
          ariaLabel={LEAGUE_SCREEN_COPY.playerTableAria}
          columns={[
            { key: "player", label: LEAGUE_SCREEN_COPY.player, basis: 178, grow: 1 },
            { key: "points", label: LEAGUE_SCREEN_COPY.pointsShort, basis: 48, align: "center", numeric: true },
            { key: "entered", label: LEAGUE_SCREEN_COPY.enteredShort, basis: 42, align: "center", numeric: true },
            { key: "net", label: LEAGUE_SCREEN_COPY.netShort, basis: 72, align: "right", numeric: true },
          ]}
          rows={rows}
        />
        <p className="mt-2 text-[10px] font-semibold text-cs2-ink-3">{LEAGUE_SCREEN_COPY.playerTableFoot(rows.length)}</p>
      </section>
      <div className="mt-7">
        <CompetitionTable view={view} liveClubs={liveClubs} />
      </div>
    </>
  );
}
