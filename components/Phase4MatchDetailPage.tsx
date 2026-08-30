import Link from "next/link";
import type { ReactNode } from "react";
import { MATCH_COPY } from "@/lib/match-copy";
import type { MatchDetailView } from "@/lib/match-detail";
import { LocalTime } from "@/components/LocalTime";
import { LineupsBlock } from "@/components/matches/LineupsBlock";
import {
  CommentaryModule,
  FormModule,
  H2HModule,
  OddsModule,
  RatingsModule,
  RetrospectiveModule,
  ScorersLine,
  TableModule,
  TeamNewsModule,
  TeamStatsModule,
  TimelineModule,
  XgModule,
} from "@/components/matches/MatchInsightModules";
import { MatchTabs } from "@/components/matches/MatchTabs";
import { PlayerStatsBlock } from "@/components/matches/PlayerStatsBlock";
import { ShotsBlock } from "@/components/matches/ShotsBlock";

const card =
  "rounded-card border border-border bg-surface p-4 shadow-[0_2px_8px_rgba(15,23,42,.04)]";

function Calls({ view }: { view: MatchDetailView }) {
  if (!view.yourCalls.length) return null;
  return (
    <section className={card}>
      <h2 className="font-extrabold">{MATCH_COPY.yourCalls}</h2>
      {view.yourCalls.map((call) => (
        <div
          key={call.league.id}
          className="mt-3 border-t border-border pt-3 first:border-0 first:pt-0"
        >
          <div className="flex justify-between gap-3">
            <span className="font-bold">{call.league.name}</span>
            <span className="font-mono font-bold">
              {call.score ? `${call.score[0]}–${call.score[1]}` : "•–•"}
            </span>
          </div>
          <div className="mt-1 text-xs text-muted">
            {call.entered
              ? MATCH_COPY.inWithAnte(call.anteInr)
              : MATCH_COPY.notInYetWithAnte(call.anteInr)}
            {call.points != null ? ` · ${call.points} pts` : ""}
          </div>
        </div>
      ))}
      <div className="mt-3 text-xs text-muted">{MATCH_COPY.editRule}</div>
    </section>
  );
}

function Room({
  fixtureId,
  view,
}: {
  fixtureId: string;
  view: MatchDetailView;
}) {
  if (!view.room) return null;
  return (
    <section className={card}>
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-extrabold">{MATCH_COPY.room}</h2>
        <div className="flex flex-wrap justify-end gap-2">
          {view.room.leagueOptions.map((league) => (
            <Link
              key={league.id}
              href={`/m/${encodeURIComponent(fixtureId)}?league=${encodeURIComponent(league.slug)}`}
              className={`rounded-pill px-2 py-1 text-xs font-bold ${league.id === view.room?.league.id ? "bg-mint text-primary-press" : "bg-subtle text-muted"}`}
            >
              {league.name}
            </Link>
          ))}
        </div>
      </div>
      <div className="mt-2 text-xs text-muted">{MATCH_COPY.roomReveal}</div>
      <div className="mt-3">
        {view.room.entrants.map((entrant, index) => (
          <div
            key={`${entrant.name}-${index}`}
            className="flex items-center justify-between border-t border-border py-2 first:border-0"
          >
            <span className="text-sm font-semibold">{entrant.name}</span>
            <span className="font-mono text-sm font-bold">
              {entrant.hidden || !entrant.score
                ? "•–•"
                : `${entrant.score[0]}–${entrant.score[1]}`}
              {entrant.points != null ? ` · ${entrant.points} pts` : ""}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

function CashfordLayer({
  fixtureId,
  view,
}: {
  fixtureId: string;
  view: MatchDetailView;
}) {
  return (
    <>
      <Calls view={view} />
      {view.whatIf && (
        <section className={`${card} border-live`}>
          {view.whatIf.line}
        </section>
      )}
      {view.raceLink && (
        <Link href={view.raceLink.href} className={`block ${card}`}>
          <div className="font-bold">{view.raceLink.league.name}</div>
          <div className="mt-1 text-sm text-muted">
            {view.raceLink.standingLine} · {MATCH_COPY.liveRace}
          </div>
        </Link>
      )}
      <Room fixtureId={fixtureId} view={view} />
    </>
  );
}

export function Phase4MatchDetailPage({
  fixtureId,
  view,
  initialTab,
}: {
  fixtureId: string;
  view: MatchDetailView;
  initialTab?: string;
}) {
  const score = view.header.score;
  const postStatsAvailable = Boolean(view.teamStats || view.playerStats);
  const postPollNote = (
    <div className="text-xs text-muted">{MATCH_COPY.postPollNote}</div>
  );
  const tabs: Array<{ id: string; label: string; content: ReactNode }> = [
    {
      id: "overview",
      label: MATCH_COPY.tabOverview,
      content: (
        <>
          <CashfordLayer fixtureId={fixtureId} view={view} />
          {view.state === "live" && (
            <TimelineModule
              keyEvents={view.keyEvents}
              home={view.header.home}
              away={view.header.away}
            />
          )}
          {view.state === "post" && (
            <>
              <RetrospectiveModule retrospective={view.retrospective} />
              <TimelineModule
                keyEvents={view.keyEvents}
                home={view.header.home}
                away={view.header.away}
              />
            </>
          )}
        </>
      ),
    },
  ];

  if (view.state === "pre") {
    const hasInsights = Boolean(
      view.odds ||
        view.model ||
        view.form ||
        view.h2h ||
        view.table ||
        view.teamNews,
    );
    if (hasInsights) {
      tabs.push({
        id: "insights",
        label: MATCH_COPY.tabInsights,
        content: (
          <>
            <OddsModule
              odds={view.odds}
              model={view.model}
              home={view.header.home}
              away={view.header.away}
            />
            <FormModule
              form={view.form}
              home={view.header.home}
              away={view.header.away}
            />
            <H2HModule
              h2h={view.h2h}
              home={view.header.home}
              away={view.header.away}
            />
            <TableModule table={view.table} />
            <TeamNewsModule
              teamNews={view.teamNews}
              home={view.header.home}
              away={view.header.away}
            />
          </>
        ),
      });
    }
    if (view.lineups) {
      tabs.push({
        id: "lineups",
        label: MATCH_COPY.tabLineups,
        content: (
          <LineupsBlock
            lineups={view.lineups}
            home={view.header.home}
            away={view.header.away}
          />
        ),
      });
    }
  }

  if (view.state === "live") {
    if (view.lineups) {
      tabs.push({
        id: "lineups",
        label: MATCH_COPY.tabLineups,
        content: (
          <LineupsBlock
            lineups={view.lineups}
            home={view.header.home}
            away={view.header.away}
          />
        ),
      });
    }
    if (view.teamStats) {
      tabs.push({
        id: "stats",
        label: MATCH_COPY.tabStats,
        content: (
          <>
            <TeamStatsModule teamStats={view.teamStats} />
            {view.playerStats ? (
              <PlayerStatsBlock
                playerStats={view.playerStats}
                shotMap={view.shotMap}
                lineups={view.lineups}
                home={view.header.home}
                away={view.header.away}
              />
            ) : null}
          </>
        ),
      });
    }
    if (view.commentary) {
      tabs.push({
        id: "plays",
        label: MATCH_COPY.tabPlays,
        content: (
          <CommentaryModule commentary={view.commentary} state={view.state} />
        ),
      });
    }
  }

  if (view.state === "post") {
    if (view.lineups) {
      tabs.push({
        id: "lineups",
        label: MATCH_COPY.tabLineups,
        content: (
          <LineupsBlock
            lineups={view.lineups}
            home={view.header.home}
            away={view.header.away}
          />
        ),
      });
    }
    if (postStatsAvailable) {
      tabs.push({
        id: "stats",
        label: MATCH_COPY.tabStats,
        content: (
          <>
            {view.ratings ? postPollNote : null}
            <TeamStatsModule teamStats={view.teamStats} />
            {view.playerStats ? (
              <PlayerStatsBlock
                playerStats={view.playerStats}
                shotMap={view.shotMap}
                lineups={view.lineups}
                home={view.header.home}
                away={view.header.away}
              />
            ) : null}
            <RatingsModule
              ratings={view.ratings}
              home={view.header.home}
              away={view.header.away}
            />
          </>
        ),
      });
    }
    if (view.shotMap) {
      tabs.push({
        id: "shots",
        label: MATCH_COPY.tabShots,
        content: (
          <>
            {view.xg ? postPollNote : null}
            <ShotsBlock
              shotMap={view.shotMap}
              home={view.header.home}
              away={view.header.away}
            />
            <XgModule
              xg={view.xg}
              home={view.header.home}
              away={view.header.away}
            />
          </>
        ),
      });
    }
    if (view.commentary) {
      tabs.push({
        id: "plays",
        label: MATCH_COPY.tabPlays,
        content: (
          <CommentaryModule commentary={view.commentary} state={view.state} />
        ),
      });
    }
  }

  const compactScore = (
    <div className="flex min-w-0 items-center justify-between gap-3 px-4 py-2.5">
      <strong className="min-w-0 truncate text-[13px]">
        {view.header.home.name} {score ? `${score[0]}–${score[1]}` : MATCH_COPY.missingValue} {view.header.away.name}
      </strong>
      <span className="shrink-0 font-mono text-[10px] font-bold text-muted">
        {view.header.status}
      </span>
    </div>
  );

  return (
    <main className="min-h-screen overflow-x-hidden bg-bg">
      <div className="mx-auto min-w-0 max-w-[560px] space-y-4 px-4 py-5">
        <Link href="/matches" className="text-sm font-bold text-primary-press">
          ← {MATCH_COPY.fixturesAndResults}
        </Link>
        <header className={card}>
          <div className="mb-3 text-center text-xs font-bold text-muted">
            {view.header.kickoffAt
              ? <LocalTime iso={view.header.kickoffAt} relative={false} />
              : MATCH_COPY.dateTbc}
          </div>
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 text-center">
            <div className="font-extrabold">{view.header.home.name}</div>
            <div className="font-mono text-2xl font-extrabold">
              {score ? `${score[0]}–${score[1]}` : "—"}
            </div>
            <div className="font-extrabold">{view.header.away.name}</div>
          </div>
          <div className="mt-3 text-center text-xs font-bold text-muted">
            {view.header.status}
          </div>
          {view.room && (
            <div className="mt-3 border-t border-border pt-3 text-center text-xs text-muted">
              {MATCH_COPY.roomLocksPrefix(view.room.league.name)}{" "}
              <LocalTime iso={view.room.deadlineAt} variant="time" relative={false} />
            </div>
          )}
          <ScorersLine
            scorers={view.header.scorers}
            home={view.header.home}
            away={view.header.away}
          />
        </header>

        <MatchTabs tabs={tabs} initialTab={initialTab ?? "overview"}>
          {compactScore}
        </MatchTabs>

        {view.notes.map((note) => (
          <div key={note} className="text-xs text-muted">{note}</div>
        ))}
        {view.correctedAt ? (
          <div className="text-xs text-muted">
            {MATCH_COPY.correctedResult} · <LocalTime iso={view.correctedAt} relative={false} />
          </div>
        ) : null}
      </div>
    </main>
  );
}
