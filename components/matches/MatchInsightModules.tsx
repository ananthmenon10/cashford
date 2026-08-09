import { CompetitionTable } from "@/components/matches/CompetitionTable";
import { LocalTime } from "@/components/LocalTime";
import { MATCH_COPY } from "@/lib/match-copy";
import type { Club, MatchDetailView } from "@/lib/match-detail";
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
  return value == null || !Number.isFinite(value) ? "—" : `${Math.round(value * 100)}%`;
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
                {g.date ? <LocalTime iso={g.date} variant="date" relative={false} includeYear /> : "—"}
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
