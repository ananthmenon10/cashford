import Link from "next/link";
import { MATCH_COPY } from "@/lib/match-copy";
import type { MatchDetailView } from "@/lib/match-detail";
import type { Sourced } from "@/lib/match-blocks";
import { LocalTime } from "@/components/LocalTime";
import { OddsModule, FormModule, H2HModule, TableModule } from "@/components/matches/MatchInsightModules";

const card =
  "rounded-card border border-border bg-surface p-4 shadow-[0_2px_8px_rgba(15,23,42,.04)]";

function Source({ block }: { block: { source: string; age: string } }) {
  return (
    <div className="mt-3 border-t border-border pt-2 text-[11px] text-muted">
      {block.source} · {block.age}
    </div>
  );
}

function JsonRows({ value }: { value: unknown }) {
  return (
    <pre className="mt-3 overflow-x-auto whitespace-pre-wrap text-xs leading-5 text-label">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

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

function Block({
  title,
  block,
  value,
}: {
  title: string;
  block: Sourced<object>;
  value: unknown;
}) {
  return (
    <section className={card}>
      <h2 className="font-extrabold">{title}</h2>
      <JsonRows value={value} />
      <Source block={block} />
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
          {view.header.scorers && (
            <JsonRows value={view.header.scorers.lines} />
          )}
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
            {view.teamNews && <Block title={MATCH_COPY.teamNews} block={view.teamNews} value={{ home: view.teamNews.home, away: view.teamNews.away }} />}
            {view.predictedXi && <Block title={MATCH_COPY.predictedXi} block={view.predictedXi} value={{ home: view.predictedXi.home, away: view.predictedXi.away }} />}
          </>
        )}

        {view.state === "post" && view.retrospective && (
          <Block title={MATCH_COPY.retrospective} block={view.retrospective} value={view.retrospective.line} />
        )}

        {view.state !== "pre" && (
          <>
            {view.keyEvents && <Block title={MATCH_COPY.timeline} block={view.keyEvents} value={view.keyEvents.timeline} />}
            {view.teamStats && <Block title={MATCH_COPY.matchStats} block={view.teamStats} value={view.teamStats.rows} />}
            {view.playerStats && <Block title={MATCH_COPY.playerStats} block={view.playerStats} value={view.playerStats.rows} />}
            {view.commentary && <Block title={MATCH_COPY.commentary} block={view.commentary} value={view.commentary.lines} />}
          </>
        )}

        {view.state === "post" && (
          <>
            {(view.xg || view.shotMap || view.ratings || view.momentum) && (
              <div className="text-xs text-muted">{MATCH_COPY.postPollNote}</div>
            )}
            {view.xg && <Block title={MATCH_COPY.expectedGoals} block={view.xg} value={{ home: view.xg.home, away: view.xg.away, model: view.xg.model, afterFt: view.xg.afterFt }} />}
            {view.shotMap && <Block title={MATCH_COPY.shotMap} block={view.shotMap} value={view.shotMap.shots} />}
            {view.ratings && <Block title={MATCH_COPY.playerOfMatch} block={view.ratings} value={{ potm: view.ratings.potm, others: view.ratings.others }} />}
            {view.momentum && <Block title={MATCH_COPY.momentum} block={view.momentum} value={view.momentum.series} />}
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
