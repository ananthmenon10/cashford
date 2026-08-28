import { CompetitionTable } from "@/components/matches/CompetitionTable";
import { LocalTime } from "@/components/LocalTime";
import {
  fplStatusLabel,
  MATCH_COPY,
  matchStatLabel,
  timelineEventLabel,
} from "@/lib/match-copy";
import type { Club, MatchDetailView, MatchTimelineEvent, TeamNewsItem } from "@/lib/match-detail";
import type { CompetitionStanding } from "@/lib/espn-standings";
import { buildStandingsView } from "@/lib/standings-view";

// Designed insight modules for the gameweek match-detail screen (#16). Each module consumes the
// typed Sourced<> blocks match-detail.ts already builds — it never reshapes the fixture_insights
// row itself. Every module returns null (hidden) when its block is absent; a present block whose
// individual fields are missing falls back to an em-dash, never `undefined`/NaN on screen.

// Card shell + source footer match the convention every match-detail card already uses
// (components/Phase4MatchDetailPage.tsx) — kept local, same as each screen owning its own copy.
const card =
  "rounded-card border border-border bg-surface p-4 shadow-[0_2px_8px_rgba(15,23,42,.04)]";

function Source({ block }: { block: { source: string; age: string } }) {
  return (
    <div className="mt-3 border-t border-border pt-2 text-[11px] text-muted">
      {block.source} · {block.age}
    </div>
  );
}

function pctOrDash(value: number | null | undefined): string {
  return value == null || !Number.isFinite(value)
    ? MATCH_COPY.missingValue
    : `${Math.round(value * 100)}%`;
}

function Stat({ value, caption }: { value: string; caption: string }) {
  return (
    <div className="flex flex-1 flex-col items-center gap-1 px-1">
      <span className="font-mono text-[17px] font-bold">{value}</span>
      <span className="text-center text-[10px] leading-tight text-muted">{caption}</span>
    </div>
  );
}

function Sep() {
  return <div className="w-px self-stretch bg-border" />;
}

// ---- Odds module (1X2 probabilities + model scorelines/BTTS/clean sheets/pOver) --------------

export function OddsModule({
  odds,
  model,
  home,
  away,
}: {
  odds?: MatchDetailView["odds"];
  model?: MatchDetailView["model"];
  home: Club;
  away: Club;
}) {
  if (!odds && !model) return null;
  const block = model ?? odds!;
  return (
    <section className={card}>
      <h2 className="font-extrabold">{MATCH_COPY.odds}</h2>

      {odds && (
        <div className="mt-3">
          <div className="mb-2 text-[11px] font-bold uppercase tracking-[.04em] text-muted">
            {MATCH_COPY.oneXTwo}
          </div>
          <div className="flex">
            <Stat value={pctOrDash(odds.pHome)} caption={home.name} />
            <Sep />
            <Stat value={pctOrDash(odds.pDraw)} caption={MATCH_COPY.draw} />
            <Sep />
            <Stat value={pctOrDash(odds.pAway)} caption={away.name} />
          </div>
        </div>
      )}

      {model && (
        <div className="mt-3 border-t border-border pt-3">
          <div className="mb-2 text-[11px] font-bold uppercase tracking-[.04em] text-muted">
            {MATCH_COPY.mostLikelyScore}
          </div>
          <div className="flex flex-col gap-1.5">
            {model.topScores.slice(0, 3).map((s, i) => (
              <div key={i} className="flex items-center justify-between text-[13px]">
                <span className="font-mono font-bold">
                  {s.h}–{s.a}
                </span>
                <span className="font-mono text-muted">{pctOrDash(s.p)}</span>
              </div>
            ))}
          </div>
          <div className="mt-3 flex justify-center">
            <Stat value={pctOrDash(model.btts)} caption={MATCH_COPY.bothScore} />
          </div>
          <div className="mb-2 mt-3 text-[11px] font-bold uppercase tracking-[.04em] text-muted">
            {MATCH_COPY.cleanSheets}
          </div>
          <div className="flex">
            <Stat value={pctOrDash(model.cleanSheets[0])} caption={home.name} />
            <Sep />
            <Stat value={pctOrDash(model.cleanSheets[1])} caption={away.name} />
          </div>
          <div className="mt-3 flex items-center justify-between text-[12px] text-muted">
            <span>{model.totalLine != null ? MATCH_COPY.overGoals(model.totalLine) : MATCH_COPY.overGoalsModel}</span>
            <span className="font-mono font-bold text-fg">{pctOrDash(model.pOver)}</span>
          </div>
        </div>
      )}

      {odds && (
        <div className="mt-3 text-center text-[11px] text-muted">
          {odds.book} · {MATCH_COPY.guidanceOnly}
        </div>
      )}
      <Source block={block} />
    </section>
  );
}

// ---- Form module (last five results as W/D/L chips) -------------------------------------------

function FormChip({ result }: { result: "W" | "L" | "D" | null }) {
  const cls =
    result === "W"
      ? "bg-mint text-win"
      : result === "L"
        ? "bg-[#FEE2E2] text-loss dark:bg-[#ef44441f]"
        : "bg-subtle text-muted";
  return (
    <span className={`flex h-[22px] w-[22px] items-center justify-center rounded-full font-mono text-[10px] font-bold ${cls}`}>
      {result ?? "·"}
    </span>
  );
}

function FormRow({ team, games }: { team: Club; games: readonly { result: "W" | "L" | "D" | null }[] }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="flex-1 truncate text-[13px] font-semibold">{team.name}</span>
      <div className="flex gap-1">
        {games.length === 0 ? (
          <span className="text-[12px] text-muted">{MATCH_COPY.noFormYet}</span>
        ) : (
          games.slice(0, 5).map((g, i) => <FormChip key={i} result={g.result} />)
        )}
      </div>
    </div>
  );
}

export function FormModule({
  form,
  home,
  away,
}: {
  form?: MatchDetailView["form"];
  home: Club;
  away: Club;
}) {
  if (!form) return null;
  const homeGames = Array.isArray(form.home) ? (form.home as { result: "W" | "L" | "D" | null }[]) : [];
  const awayGames = Array.isArray(form.away) ? (form.away as { result: "W" | "L" | "D" | null }[]) : [];
  return (
    <section className={card}>
      <h2 className="font-extrabold">{MATCH_COPY.form}</h2>
      <div className="mt-3 flex flex-col gap-2.5">
        <FormRow team={home} games={homeGames} />
        <FormRow team={away} games={awayGames} />
      </div>
      <Source block={form} />
    </section>
  );
}

// ---- H2H module (recent meetings, oriented to the current fixture's home team) ----------------

type H2HGame = {
  date: string | null;
  competition: string | null;
  homeScore: number;
  awayScore: number;
};

export function H2HModule({
  h2h,
  home,
  away,
}: {
  h2h?: MatchDetailView["h2h"];
  home: Club;
  away: Club;
}) {
  if (!h2h) return null;
  const games = Array.isArray(h2h.games) ? (h2h.games as H2HGame[]) : [];
  return (
    <section className={card}>
      <h2 className="font-extrabold">{MATCH_COPY.headToHead}</h2>
      <div className="mt-2 text-[13px] font-bold">{h2h.summary}</div>
      <div className="mt-2">
        {games.length === 0 ? (
          <div className="py-2 text-[12px] text-muted">{MATCH_COPY.noMeetingsYet}</div>
        ) : (
          games.map((g, i) => (
            <div key={i} className="flex items-center justify-between border-t border-border py-1.5 text-[12px] first:border-0">
              <span className="text-muted">
                {g.date ? <LocalTime iso={g.date} variant="date" relative={false} includeYear /> : MATCH_COPY.missingValue}
                {g.competition ? ` · ${g.competition}` : ""}
              </span>
              <span className="font-mono font-bold">
                {home.name} {g.homeScore}–{g.awayScore} {away.name}
              </span>
            </div>
          ))
        )}
      </div>
      <Source block={h2h} />
    </section>
  );
}

// ---- Table module (mirrors CompetitionTable — the app's one table standard) -------------------

export function TableModule({ table }: { table?: MatchDetailView["table"] }) {
  if (!table) return null;
  const rows = table.window as CompetitionStanding[];
  // buildStandingsView is the one place the Champions League / relegation cutoffs — and the
  // properly-cased source line ("ESPN · updated 2h ago") — are computed. CompetitionTable only
  // ever renders `view.note`, never `view.sourceLine` directly, so fold sourceLine into note
  // instead of hand-formatting table.source/table.age (which would print the raw lowercase
  // "espn" and skip the "updated" wording).
  const base = buildStandingsView({ rows, source: table.source, fetchedAt: table.fetchedAt, note: null });
  const view = {
    ...base,
    note: table.note ? `${table.note} · ${base.sourceLine}` : base.sourceLine,
  };
  return (
    <section className={card}>
      <CompetitionTable view={view} />
    </section>
  );
}

function textOrDash(value: string | null | undefined): string {
  return typeof value === "string" && value.trim()
    ? value
    : MATCH_COPY.missingValue;
}

function sideClub(
  side: "home" | "away",
  home: Club,
  away: Club,
): Club {
  return side === "home" ? home : away;
}

// ---- Scorers line (kept inside the match header rather than as its own card) -----------------

export function ScorersLine({
  scorers,
  home,
  away,
}: {
  scorers?: MatchDetailView["header"]["scorers"];
  home: Club;
  away: Club;
}) {
  if (!scorers) return null;
  return (
    <div className="mt-3">
      <div className="flex flex-col gap-1.5">
        {scorers.lines.map((line, index) => (
          <div
            key={`${line.team}-${line.player}-${index}`}
            className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 text-[12px]"
          >
            <span className="truncate text-left font-semibold">
              {line.team === "home" ? textOrDash(line.player) : null}
            </span>
            <span className="whitespace-nowrap font-mono text-[11px] text-muted">
              {line.minutes.length
                ? line.minutes.map((minute) => MATCH_COPY.minute(minute)).join(", ")
                : MATCH_COPY.missingValue}
            </span>
            <span className="truncate text-right font-semibold">
              {line.team === "away" ? textOrDash(line.player) : null}
            </span>
          </div>
        ))}
      </div>
      <Source block={scorers} />
    </div>
  );
}

// ---- Team-news module (one column per club) --------------------------------------------------

function TeamNewsColumn({
  team,
  rows,
}: {
  team: Club;
  rows: TeamNewsItem[];
}) {
  return (
    <div className="min-w-0">
      <div className="mb-2 truncate text-[11px] font-bold uppercase tracking-[.04em] text-muted">
        {team.name}
      </div>
      {rows.length === 0 ? (
        <div className="py-2 text-[12px] text-muted">{MATCH_COPY.noNews}</div>
      ) : (
        <div className="flex flex-col gap-2.5">
          {rows.map((row, index) => (
            <div key={`${row.player}-${index}`}>
              <div className="flex items-start justify-between gap-2">
                <span className="min-w-0 truncate text-[13px] font-semibold">
                  {textOrDash(row.player)}
                </span>
                <span className="shrink-0 rounded-pill bg-subtle px-2 py-0.5 text-[10px] font-bold text-muted">
                  {fplStatusLabel(row.status)}
                </span>
              </div>
              <div className="mt-0.5 text-[12px] leading-snug text-muted">
                {textOrDash(row.reason)}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function TeamNewsModule({
  teamNews,
  home,
  away,
}: {
  teamNews?: MatchDetailView["teamNews"];
  home: Club;
  away: Club;
}) {
  if (!teamNews) return null;
  return (
    <section className={card}>
      <h2 className="font-extrabold">{MATCH_COPY.teamNews}</h2>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <TeamNewsColumn team={home} rows={teamNews.home} />
        <TeamNewsColumn team={away} rows={teamNews.away} />
      </div>
      <Source block={teamNews} />
    </section>
  );
}

// ---- Timeline module (text labels keep event copy and accessibility token-safe) ---------------

const TIMELINE_EVENT_CLASSES: Record<MatchTimelineEvent["type"], string> = {
  goal: "bg-mint text-primary-press",
  own_goal: "bg-amber-bg text-amber-fg",
  pen: "bg-mint text-primary-press",
  miss_pen: "bg-amber-bg text-amber-fg",
  yellow: "bg-amber-bg text-amber-fg",
  red: "bg-[#FEE2E2] text-loss dark:bg-[#ef44441f]",
  sub: "bg-subtle text-muted",
  var: "bg-subtle text-muted",
};

function timelineEventClass(type: MatchTimelineEvent["type"]): string {
  return TIMELINE_EVENT_CLASSES[type];
}

export function TimelineModule({
  keyEvents,
  home,
  away,
}: {
  keyEvents?: MatchDetailView["keyEvents"];
  home: Club;
  away: Club;
}) {
  if (!keyEvents) return null;
  return (
    <section className={card}>
      <h2 className="font-extrabold">{MATCH_COPY.timeline}</h2>
      <div className="mt-3 flex flex-col gap-2">
        {keyEvents.timeline.map((event, index) => (
          <div
            key={`${event.minute}-${event.type}-${event.player}-${index}`}
            className="grid grid-cols-[auto_auto_minmax(0,1fr)_auto] items-center gap-2 text-[12px]"
          >
            <span className="font-mono text-[11px] text-muted">
              {textOrDash(event.clock || MATCH_COPY.minute(event.minute))}
            </span>
            <span className={`rounded-pill px-2 py-0.5 text-[10px] font-bold ${timelineEventClass(event.type)}`}>
              {timelineEventLabel(event.type)}
            </span>
            <span className="min-w-0 truncate font-semibold">
              {textOrDash(event.player)}
            </span>
            <span className="max-w-[92px] truncate text-right text-[11px] text-muted">
              {sideClub(event.team, home, away).name}
            </span>
          </div>
        ))}
      </div>
      <Source block={keyEvents} />
    </section>
  );
}

// ---- Match-stats module (paired values with a two-tone comparison bar) ------------------------

function statBarWidths(value: { h: number; a: number }): [number, number] {
  const home = Number.isFinite(value.h) ? Math.max(0, value.h) : 0;
  const away = Number.isFinite(value.a) ? Math.max(0, value.a) : 0;
  const total = home + away;
  return total > 0 ? [(home / total) * 100, (away / total) * 100] : [0, 0];
}

export function TeamStatsModule({
  teamStats,
}: {
  teamStats?: MatchDetailView["teamStats"];
}) {
  if (!teamStats) return null;
  return (
    <section className={card}>
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-extrabold">{MATCH_COPY.matchStats}</h2>
        {teamStats.phase === "live" && teamStats.minute ? (
          <span className="font-mono text-[11px] text-muted">{teamStats.minute}</span>
        ) : null}
      </div>
      <div className="mt-3 flex flex-col gap-3">
        {teamStats.rows.map((row) => {
          const [homeWidth, awayWidth] = statBarWidths(row.value);
          return (
            <div key={row.label}>
              <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 text-[12px]">
                <span className="font-mono font-bold">
                  {MATCH_COPY.statValue(row.value.h)}
                </span>
                <span className="text-center text-[11px] text-muted">
                  {matchStatLabel(row.label)}
                </span>
                <span className="text-right font-mono font-bold">
                  {MATCH_COPY.statValue(row.value.a)}
                </span>
              </div>
              <div className="mt-1 flex h-1.5 overflow-hidden rounded-full bg-subtle">
                <div className="bg-primary" style={{ width: `${homeWidth}%` }} />
                <div className="bg-away" style={{ width: `${awayWidth}%` }} />
              </div>
            </div>
          );
        })}
      </div>
      <Source block={teamStats} />
    </section>
  );
}

// ---- Commentary module (feed order follows the match state) ---------------------------------

function commentaryMinute(value: string): number | null {
  const match = value.match(/(\d+)(?:\+(\d+))?/);
  return match ? Number(match[1]) + Number(match[2] ?? 0) : null;
}

export function CommentaryModule({
  commentary,
  state,
}: {
  commentary?: MatchDetailView["commentary"];
  state: "live" | "post";
}) {
  if (!commentary) return null;
  const lines = commentary.lines
    .map((line, index) => ({
      line,
      index,
      minute: commentaryMinute(line.minute),
    }))
    .sort((a, b) => {
      const aMinute = a.minute ?? Number.NEGATIVE_INFINITY;
      const bMinute = b.minute ?? Number.NEGATIVE_INFINITY;
      if (aMinute !== bMinute) {
        return state === "live" ? bMinute - aMinute : aMinute - bMinute;
      }
      return state === "live" ? b.index - a.index : a.index - b.index;
    });
  return (
    <section className={card}>
      <h2 className="font-extrabold">{MATCH_COPY.commentary}</h2>
      <div className="mt-3 flex flex-col">
        {lines.map(({ line, index }) => (
          <div
            key={`${line.minute}-${line.text}-${index}`}
            className="grid grid-cols-[auto_minmax(0,1fr)] gap-3 border-t border-border py-2 text-[12px] first:border-0 first:pt-0"
          >
            <span className="font-mono text-[11px] text-muted">
              {textOrDash(line.minute)}
            </span>
            <span>{textOrDash(line.text)}</span>
          </div>
        ))}
      </div>
      <Source block={commentary} />
    </section>
  );
}

// ---- Expected-goals module --------------------------------------------------------------------

export function XgModule({
  xg,
  home,
  away,
}: {
  xg?: MatchDetailView["xg"];
  home: Club;
  away: Club;
}) {
  if (!xg) return null;
  return (
    <section className={card}>
      <h2 className="font-extrabold">{MATCH_COPY.expectedGoals}</h2>
      <div className="mt-3 grid grid-cols-2 gap-3 text-center">
        <div>
          <div className="font-mono text-3xl font-extrabold">
            {MATCH_COPY.xgValue(xg.home)}
          </div>
          <div className="mt-1 truncate text-[11px] text-muted">{home.name}</div>
        </div>
        <div>
          <div className="font-mono text-3xl font-extrabold">
            {MATCH_COPY.xgValue(xg.away)}
          </div>
          <div className="mt-1 truncate text-[11px] text-muted">{away.name}</div>
        </div>
      </div>
      <div className="mt-3 text-center text-[11px] text-muted">
        {MATCH_COPY.xgMetadata(xg.provider, xg.model, xg.afterFt)}
      </div>
      <Source block={xg} />
    </section>
  );
}

// ---- Ratings module (held until a valid provider PotM row exists) -----------------------------

function ratingTeamName(
  team: "home" | "away",
  home: Club,
  away: Club,
): string {
  return sideClub(team, home, away).name;
}

export function RatingsModule({
  ratings,
  home,
  away,
}: {
  ratings?: MatchDetailView["ratings"];
  home: Club;
  away: Club;
}) {
  if (!ratings) return null;
  return (
    <section className={card}>
      <h2 className="font-extrabold">{MATCH_COPY.playerOfMatch}</h2>
      <div className="mt-3 flex items-center justify-between gap-3 rounded-control bg-mint px-3 py-2.5">
        <div className="min-w-0">
          <div className="truncate text-[14px] font-extrabold">
            {textOrDash(ratings.potm.player)}
          </div>
          <div className="mt-0.5 truncate text-[11px] text-muted">
            {ratingTeamName(ratings.potm.team, home, away)}
          </div>
        </div>
        <span className="font-mono text-xl font-extrabold">
          {MATCH_COPY.ratingValue(ratings.potm.rating)}
        </span>
      </div>
      {ratings.others.length > 0 && (
        <div className="mt-3 flex flex-col">
          {ratings.others.slice(0, 4).map((rating, index) => (
            <div
              key={`${rating.player}-${index}`}
              className="flex items-center justify-between gap-3 border-t border-border py-2 text-[12px] first:border-0"
            >
              <div className="min-w-0">
                <div className="truncate font-semibold">{textOrDash(rating.player)}</div>
                <div className="truncate text-[11px] text-muted">
                  {ratingTeamName(rating.team, home, away)}
                </div>
              </div>
              <span className="shrink-0 font-mono font-bold">
                {MATCH_COPY.ratingValue(rating.rating)}
              </span>
            </div>
          ))}
        </div>
      )}
      <Source block={ratings} />
    </section>
  );
}

// ---- Retrospective module ---------------------------------------------------------------------

export function RetrospectiveModule({
  retrospective,
}: {
  retrospective?: MatchDetailView["retrospective"];
}) {
  if (!retrospective) return null;
  return (
    <section className={card}>
      <h2 className="font-extrabold">{MATCH_COPY.retrospective}</h2>
      <p className="mt-2 text-[13px] leading-relaxed">
        {textOrDash(retrospective.line)}
      </p>
      <Source block={retrospective} />
    </section>
  );
}
