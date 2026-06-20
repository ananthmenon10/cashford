import { Avatar } from "./ui";
import type { InsightsView, FormGame, H2HData, StandingsGroup } from "@/lib/espn-insights";

// "Full insight" tab content (plan 2026-06-20-003). Server-safe; each section renders only when its
// data exists. All colours via semantic tokens (dark-aware). Odds shown "for guidance only".
const CARD = "rounded-card border border-border bg-surface p-4 shadow-[0_2px_8px_rgba(15,23,42,.04)]";
const LABEL = "mb-3 text-[11px] font-bold uppercase tracking-[.04em] text-muted";

type Team = { label: string; short: string };

export function MatchInsights({
  d,
  home,
  away,
  groupLabel,
  highlightTeamIds = [],
}: {
  d: InsightsView;
  home: Team;
  away: Team;
  groupLabel?: string | null;
  highlightTeamIds?: string[];
}) {
  const hasStats = d.oddsAvailable && (d.btts != null || d.cleanSheet.home != null || d.cleanSheet.away != null);
  const hasForm = d.formHome.length > 0 || d.formAway.length > 0;
  const hasH2H = !!d.h2h && d.h2h.games.length > 0;
  const hasStandings = !!d.standings && d.standings.rows.length > 0;

  if (!hasStats && !hasForm && !hasH2H && !hasStandings && !d.oddsAvailable) {
    return (
      <div className={`${CARD} text-center text-[13px] text-muted`}>
        Insights appear closer to kickoff.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {hasStats && (
        <div className={`${CARD} flex`}>
          <Stat value={pctTxt(d.btts)} caption="Both score" />
          <Sep />
          <Stat value={pctTxt(d.cleanSheet.home)} caption={`${home.short} clean sheet`} />
          <Sep />
          <Stat value={pctTxt(d.cleanSheet.away)} caption={`${away.short} clean sheet`} />
        </div>
      )}

      {hasForm && (
        <div className={CARD}>
          <div className={LABEL}>Recent form · last 5</div>
          <FormRow team={home} games={d.formHome} />
          <div className="h-2.5" />
          <FormRow team={away} games={d.formAway} />
        </div>
      )}

      {hasH2H && <H2HCard h2h={d.h2h!} home={home} away={away} />}

      {hasStandings && (
        <StandingsCard standings={d.standings!} groupLabel={groupLabel} highlightTeamIds={highlightTeamIds} />
      )}

      {d.oddsAvailable && d.ml && (
        <div className="px-2 text-center text-[11px] text-muted">
          Odds: {d.provider ?? "market"} · {dec(d.ml.home)} / {dec(d.ml.draw)} / {dec(d.ml.away)} · for guidance only
        </div>
      )}
    </div>
  );
}

// ---- helpers ------------------------------------------------------------------------------

function pctTxt(n: number | null | undefined) {
  return n == null ? "—" : `${Math.round(n * 100)}%`;
}

// American → decimal odds, 2dp (e.g. -195 → 1.51, +370 → 4.70).
function dec(american: number) {
  const d = american > 0 ? american / 100 + 1 : 100 / Math.abs(american) + 1;
  return d.toFixed(2);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
// Deterministic "Mon YYYY" straight from the ISO string (no timezone/hydration surprises).
function monthYear(iso: string | null) {
  if (!iso || iso.length < 7) return "";
  const y = iso.slice(0, 4);
  const m = Number(iso.slice(5, 7));
  return m >= 1 && m <= 12 ? `${MONTHS[m - 1]} ${y}` : y;
}

function gdTxt(gd: number | null) {
  if (gd == null) return "—";
  return gd > 0 ? `+${gd}` : gd < 0 ? `−${Math.abs(gd)}` : "0";
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

function FormRow({ team, games }: { team: Team; games: FormGame[] }) {
  // Most-recent on the right: sort ascending by date when dates are present.
  const ordered = [...games].sort((a, b) => (a.date ?? "").localeCompare(b.date ?? "")).slice(-5);
  return (
    <div className="flex items-center gap-2.5">
      <Avatar label={team.short || team.label} size={24} />
      <span className="flex-1 truncate text-[13px] font-semibold">{team.label}</span>
      <div className="flex gap-1">
        {ordered.length === 0 ? (
          <span className="text-[12px] text-muted">—</span>
        ) : (
          ordered.map((g, i) => <FormChip key={i} r={g.result} />)
        )}
      </div>
    </div>
  );
}

function FormChip({ r }: { r: FormGame["result"] }) {
  const cls =
    r === "W"
      ? "bg-mint text-win"
      : r === "L"
        ? "bg-[#FEE2E2] text-loss dark:bg-[#ef44441f]"
        : "bg-subtle text-muted";
  return (
    <span className={`flex h-[22px] w-[22px] items-center justify-center rounded-full font-mono text-[10px] font-bold ${cls}`}>
      {r ?? "·"}
    </span>
  );
}

function H2HCard({ h2h, home, away }: { h2h: H2HData; home: Team; away: Team }) {
  const { w, d, l } = h2h.tally;
  const n = h2h.games.length;
  const summary =
    w > l
      ? `${home.short} lead ${w}–${l} in last ${n}`
      : l > w
        ? `${away.short} lead ${l}–${w} in last ${n}`
        : `Level ${w}–${l} in last ${n}`;
  return (
    <div className={CARD}>
      <div className={LABEL}>Head-to-head</div>
      <div className="mb-2.5 text-[13px] font-bold">{summary}</div>
      {h2h.games.map((g, i) => (
        <div key={i} className="flex items-center justify-between border-t border-border py-1.5 text-[12px]">
          <span className="text-muted">
            {monthYear(g.date)}
            {g.competition ? ` · ${g.competition}` : ""}
          </span>
          <span className="font-mono font-bold">
            {home.short} {g.homeScore}–{g.awayScore} {away.short}
          </span>
        </div>
      ))}
    </div>
  );
}

function StandingsCard({
  standings,
  groupLabel,
  highlightTeamIds,
}: {
  standings: StandingsGroup;
  groupLabel?: string | null;
  highlightTeamIds: string[];
}) {
  const head = "w-6 text-center";
  return (
    <div className={CARD}>
      <div className={LABEL}>{groupLabel ? `Group ${groupLabel}` : "Group standings"}</div>
      <div className="flex items-center pb-1.5 font-mono text-[10px] font-bold text-muted">
        <span className="flex-1">TEAM</span>
        <span className={head}>P</span>
        <span className={head}>W</span>
        <span className={head}>D</span>
        <span className={head}>L</span>
        <span className="w-7 text-center">GD</span>
        <span className="w-8 text-center">PTS</span>
      </div>
      {standings.rows.map((r, i) => {
        const me = r.id != null && highlightTeamIds.includes(r.id);
        return (
          <div
            key={r.id ?? i}
            className={`flex items-center border-t border-border py-1.5 text-[12px] ${me ? "font-bold" : "font-medium text-label"}`}
          >
            <span className="flex-1 truncate pr-1">{r.team ?? "—"}</span>
            <span className={`${head} font-mono`}>{r.gp ?? "—"}</span>
            <span className={`${head} font-mono`}>{r.w ?? "—"}</span>
            <span className={`${head} font-mono`}>{r.d ?? "—"}</span>
            <span className={`${head} font-mono`}>{r.l ?? "—"}</span>
            <span className="w-7 text-center font-mono">{gdTxt(r.gd)}</span>
            <span className="w-8 text-center font-mono">{r.pts ?? "—"}</span>
          </div>
        );
      })}
    </div>
  );
}
