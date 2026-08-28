import Link from "next/link";
import { MATCH_COPY } from "@/lib/match-copy";
import type { MatchDetailView } from "@/lib/match-detail";
import { LocalTime } from "@/components/LocalTime";
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

export function Phase4MatchDetailPage({
  fixtureId,
  view,
}: {
  fixtureId: string;
  view: MatchDetailView;
}) {
  const score = view.header.score;
  return (
    <main className="min-h-screen bg-bg">
      <div className="mx-auto max-w-[560px] space-y-4 px-4 py-5">
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

        {view.state === "pre" && (
          <>
            {(view.odds || view.model || view.form || view.h2h || view.table || view.teamNews) && (
              <div className="text-xs font-extrabold uppercase tracking-wide text-muted">
                {MATCH_COPY.insights}
              </div>
            )}
            <OddsModule odds={view.odds} model={view.model} home={view.header.home} away={view.header.away} />
            <FormModule form={view.form} home={view.header.home} away={view.header.away} />
            <H2HModule h2h={view.h2h} home={view.header.home} away={view.header.away} />
            <TableModule table={view.table} />
            <TeamNewsModule
              teamNews={view.teamNews}
              home={view.header.home}
              away={view.header.away}
            />
          </>
        )}

        {view.state === "post" && view.retrospective && (
          <RetrospectiveModule retrospective={view.retrospective} />
        )}

        {view.state !== "pre" && (
          <>
            <TimelineModule
              keyEvents={view.keyEvents}
              home={view.header.home}
              away={view.header.away}
            />
            <TeamStatsModule teamStats={view.teamStats} />
            <CommentaryModule
              commentary={view.commentary}
              state={view.state}
            />
          </>
        )}

        {view.state === "post" && (
          <>
            {(view.xg || view.ratings) && (
              <div className="text-xs text-muted">{MATCH_COPY.postPollNote}</div>
            )}
            <XgModule
              xg={view.xg}
              home={view.header.home}
              away={view.header.away}
            />
            <RatingsModule
              ratings={view.ratings}
              home={view.header.home}
              away={view.header.away}
            />
          </>
        )}
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
