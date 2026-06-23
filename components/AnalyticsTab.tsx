"use client";

// Home "Analytics" tab (PRD docs/prds/2026-06-21-home-analytics-tab-prd.md). Two honest lenses —
// 💰 money (stored net) and 🎯 skill (derived accuracy). A scope control switches between the
// GLOBAL view (you, across all leagues + tournament-wide match intelligence) and a PER-LEAGUE
// drill-down (adds rivalry: sharpest board + head-to-head). All data is computed server-side
// (lib/home-analytics); this component owns only the view state. Each card carries an ⓘ that opens
// a "how this is calculated" bubble — one shared, viewport-clamped popover so it never overflows.

import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import type { AnalyticsView, GlobalAnalytics, LeagueAnalytics } from "@/lib/analytics";
import { Avatar, inr } from "@/components/ui";
import { Reveal } from "@/components/motion";

// Measure-before-paint on the client (so the scope thumb lands in place, no blink); a no-op on the
// server render, which sidesteps React's useLayoutEffect-during-SSR warning.
const useIsoLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

const pct = (p: number | null) => (p == null ? "—" : `${Math.round(p * 100)}%`);
const CARD = "rounded-card border border-border bg-surface p-3.5 shadow-[0_2px_8px_rgba(15,23,42,.04)]";
const netColor = (n: number) => (n > 0 ? "text-win" : n < 0 ? "text-loss" : "text-muted");
const heroNet = (n: number) => (n > 0 ? "text-[#4ade80]" : n < 0 ? "text-[#f87171]" : "text-[#94a3b8]");

// ── info tooltip: a single shared popover, anchored near the tapped ⓘ and clamped to the viewport ─
const InfoCtx = createContext<(text: string, rect: DOMRect) => void>(() => {});

function InfoDot({ text }: { text: string }) {
  const open = useContext(InfoCtx);
  return (
    <button
      type="button"
      aria-label="How this is calculated"
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); open(text, e.currentTarget.getBoundingClientRect()); }}
      className="ml-1 inline-flex h-[15px] w-[15px] shrink-0 items-center justify-center rounded-full border border-border align-middle text-[9px] font-bold leading-none text-muted active:bg-subtle"
    >
      i
    </button>
  );
}

function Cell({ children, tint }: { children: React.ReactNode; tint?: string }) {
  return <div className={`flex-1 rounded-card border border-border p-3 ${tint ?? "bg-surface"} shadow-[0_2px_8px_rgba(15,23,42,.04)]`}>{children}</div>;
}

// Per-matchday net as up/down bars around a ₹0 line: green = a winning day, red = a losing day.
function DayBars({ days }: { days: { dayKey: string; net: number }[] }) {
  if (days.length < 1) {
    return <div className="flex h-[92px] items-center justify-center text-[11px] text-muted">Your daily net appears as matches settle.</div>;
  }
  const maxAbs = Math.max(1, ...days.map((d) => Math.abs(d.net)));
  const barH = (n: number) => Math.max(2, Math.round((Math.abs(n) / maxAbs) * 38));
  const dayNum = (k: string) => k.split(" ")[1] ?? "";
  return (
    <div>
      <div className="relative flex items-stretch gap-[3px]" style={{ height: 92 }}>
        <div className="pointer-events-none absolute inset-x-0 top-1/2 border-t border-dashed border-border" />
        {days.map((d, i) => {
          const up = d.net >= 0;
          return (
            <div key={i} className="flex flex-1 flex-col" title={`${d.dayKey}: ${inr(d.net)}`}>
              <div className="flex flex-1 items-end justify-center">
                {up && d.net !== 0 && <div className="w-full max-w-[16px] rounded-t-[3px] bg-win" style={{ height: barH(d.net) }} />}
              </div>
              <div className="flex flex-1 items-start justify-center">
                {!up && <div className="w-full max-w-[16px] rounded-b-[3px] bg-loss" style={{ height: barH(d.net) }} />}
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-1.5 flex gap-[3px]">
        {days.map((d, i) => (
          <div key={i} className="flex-1 text-center font-mono text-[8px] text-muted">{dayNum(d.dayKey)}</div>
        ))}
      </div>
    </div>
  );
}

function HeadlineNet({ label, net, info }: { label: string; net: number; info: string }) {
  return (
    <div className="flex-1 rounded-card border border-border bg-[#0F172A] p-3.5 dark:bg-surface">
      <div className="flex items-center text-[9px] font-bold tracking-[.05em] text-[#94a3b8]">{label}<InfoDot text={info} /></div>
      <div className={`mt-1 font-mono text-[21px] font-bold tabular ${heroNet(net)}`}>{inr(net)}</div>
    </div>
  );
}
function HeadlineStat({ label, value, info }: { label: string; value: string; info: string }) {
  return (
    <div className={`flex-1 ${CARD}`}>
      <div className="flex items-center text-[9px] font-bold tracking-[.05em] text-muted">{label}<InfoDot text={info} /></div>
      <div className="mt-1 font-mono text-[21px] font-bold tabular">{value}</div>
    </div>
  );
}

function CellLabel({ children, info }: { children: React.ReactNode; info: string }) {
  return <div className="flex items-center text-[10px] font-bold text-muted">{children}<InfoDot text={info} /></div>;
}

// ── GLOBAL panel ─────────────────────────────────────────────────────────────────────────────
function GlobalPanel({ g }: { g: GlobalAnalytics }) {
  if (g.acc.graded === 0 && g.pot.entered === 0) {
    return <div className="rounded-card border border-dashed border-border p-8 text-center text-[13px] text-muted">Your analytics appear here as matches settle.</div>;
  }
  const bias = g.acc.goalBias;
  const biasTxt = bias == null ? "—" : `${bias >= 0 ? "+" : "−"}${Math.abs(bias).toFixed(1)}`;
  const biasLabel = bias == null ? "" : bias > 0.15 ? "you predict high" : bias < -0.15 ? "you predict low" : "on the money";
  return (
    <Reveal stagger className="flex flex-col gap-3">
      <div className="flex gap-2.5">
        <HeadlineNet label="💰 NET" net={g.net} info="Your total winnings minus losses across every settled match in all your leagues." />
        <HeadlineStat label="🎯 CORRECT" value={pct(g.acc.correctPct)} info="Share of your settled predictions where you picked the right result — home win, draw, or away. The scoreline doesn't matter here." />
      </div>

      <div className={CARD}>
        <div className="mb-2.5 flex items-center justify-between">
          <span className="flex items-center text-[12px] font-bold">Net by matchday<InfoDot text="Your net ₹ won or lost on each matchday — bars up (green) on winning days, down (red) on losing ones, around the ₹0 line." /></span>
          <span className="rounded-pill bg-mint px-2 py-0.5 text-[9px] font-bold text-primary-press">💰 MONEY</span>
        </div>
        <DayBars days={g.daily} />
      </div>

      <div className="flex gap-2.5">
        <Cell>
          <div className="text-center font-mono text-[18px] font-bold">{pct(g.acc.exactPct)}</div>
          <div className="mt-0.5 flex items-center justify-center text-[10px] text-muted">Exact score 🎯<InfoDot text="How often your predicted scoreline exactly matched the final 90-minute score." /></div>
        </Cell>
        <Cell>
          <div className="text-center font-mono text-[18px] font-bold">{g.pot.won}/{g.pot.entered}</div>
          <div className="mt-0.5 flex items-center justify-center text-[10px] text-muted">Pot win 💰<InfoDot text="Pots you took money from, out of all the pots you entered." /></div>
        </Cell>
        <Cell>
          <div className="text-center font-mono text-[18px] font-bold text-win">{g.streak}</div>
          <div className="mt-0.5 flex items-center justify-center text-[10px] text-muted">Streak 🎯<InfoDot text="Your current run of correct results in a row, counting back from your latest settled match." /></div>
        </Cell>
      </div>

      {(g.lucky || g.biggest) && (
        <div className="flex gap-2.5">
          <Cell>
            <CellLabel info="The team you've netted the most ₹ on — across every settled match they played that you predicted.">Lucky team 💰</CellLabel>
            <div className="mt-1 text-[14px] font-extrabold">{g.lucky?.team ?? "—"}</div>
            {g.lucky && <div className={`font-mono text-[12px] font-bold ${netColor(g.lucky.net)}`}>{inr(g.lucky.net)}</div>}
          </Cell>
          <Cell>
            <CellLabel info="Your best single matchday, by total net ₹ won that day.">Biggest night 💰</CellLabel>
            <div className="mt-1 text-[14px] font-extrabold">{g.biggest?.dayKey ?? "—"}</div>
            {g.biggest && <div className={`font-mono text-[12px] font-bold ${netColor(g.biggest.net)}`}>{inr(g.biggest.net)}</div>}
          </Cell>
        </div>
      )}

      <div className="flex gap-2.5">
        <Cell tint={g.best && g.best.slug ? "bg-[#F0FDF4] dark:bg-[#16a34a1a] border-[#bbf7d0] dark:border-[#16a34a55]" : undefined}>
          <CellLabel info="Your single biggest ₹ win in one match. Tap the match name to open it.">Best result 💰</CellLabel>
          {g.best ? (
            <>
              <div className="mt-1 font-mono text-[16px] font-bold text-win">{inr(g.best.net)}</div>
              {g.best.slug ? (
                <Link href={`/leagues/${g.best.slug}/m/${g.best.contestId}`} className="block truncate text-[10px] text-muted">{g.best.label} ›</Link>
              ) : (
                <div className="truncate text-[10px] text-muted">{g.best.label}</div>
              )}
            </>
          ) : (
            <div className="mt-1 text-[14px] text-muted">—</div>
          )}
        </Cell>
        <Cell>
          <CellLabel info="Average of your predicted total goals minus the actual total, across settled matches. Positive = you tend to predict more goals than happen.">Goals bias 🎯</CellLabel>
          <div className="mt-1 font-mono text-[16px] font-bold text-away">{biasTxt}</div>
          <div className="text-[10px] text-muted">{biasLabel}</div>
        </Cell>
      </div>

      {(g.favouritesWonPct != null || g.calledUpsets > 0) && (
        <div className={CARD}>
          <div className="mb-2 flex items-center text-[12px] font-bold">Match intelligence<InfoDot text="Favourites won: how often the pre-match odds favourite actually won, across all WC matches we have odds for. Called upsets: your correct picks that went against that favourite." /></div>
          {g.favouritesWonPct != null && (
            <div className="flex items-center justify-between text-[11px] text-label"><span>Favourites have won</span><span className="font-mono font-bold text-fg">{pct(g.favouritesWonPct)}</span></div>
          )}
          <div className="mt-1.5 flex items-center justify-between text-[11px] text-label"><span>Your called upsets 🎯</span><span className="font-mono font-bold text-win">{g.calledUpsets}</span></div>
        </div>
      )}
    </Reveal>
  );
}

// ── PER-LEAGUE panel (rivalry) ───────────────────────────────────────────────────────────────
function LeaguePanel({ lg, myCorrect }: { lg: LeagueAnalytics; myCorrect: number | null }) {
  const [rivalId, setRivalId] = useState<string | null>(lg.rivals[0]?.userId ?? null);
  const rival = lg.rivals.find((r) => r.userId === rivalId) ?? null;

  const rivAcc = rival?.accuracyPct ?? null;
  const skill: "you" | "them" | "level" =
    !rival || myCorrect == null || rivAcc == null ? "level" : myCorrect > rivAcc ? "you" : myCorrect < rivAcc ? "them" : "level";
  const flow = rival?.moneyFlow ?? 0;
  const youUp = flow > 0;
  const moneyLevel = flow === 0;
  const verdict = !rival
    ? ""
    : skill === "you"
      ? youUp ? "You read these games better — and the money agrees." : moneyLevel ? "You're the sharper predictor here." : `Skill ≠ luck: you predict better, but ${rival.name} is up on variance.`
      : skill === "them"
        ? youUp ? `${rival.name} is sharper, yet you're up on the money.` : `${rival.name} has the edge both ways here.`
        : youUp ? "Evenly matched on skill — you're ahead on the money." : moneyLevel ? "Neck and neck, both ways." : `Level on skill; ${rival.name} edges the money.`;

  return (
    <Reveal stagger className="flex flex-col gap-3">
      <div className="flex gap-2.5">
        <div className="flex-1 rounded-card border border-border bg-[#0F172A] p-3.5 dark:bg-surface">
          <div className="flex items-center text-[9px] font-bold tracking-[.05em] text-[#94a3b8]">💰 NET · RANK {lg.rank}/{lg.members}<InfoDot text="Your net ₹ in this league, and where that ranks you among its members." /></div>
          <div className={`mt-1 font-mono text-[20px] font-bold tabular ${heroNet(lg.net)}`}>{inr(lg.net)}</div>
        </div>
        <HeadlineStat label="🎯 CORRECT" value={pct(lg.acc.correctPct)} info="Your correct-result rate on settled matches in this league." />
      </div>

      <div className={CARD}>
        <div className="mb-2 flex items-center justify-between">
          <span className="flex items-center text-[12px] font-bold">Sharpest predictor<InfoDot text="League members ranked by how often they pick the right result (skill) — not by money. Members with no settled picks yet show a dash." /></span>
          <span className="rounded-pill bg-subtle px-2 py-0.5 text-[9px] font-bold text-label">🎯 SKILL · not money</span>
        </div>
        {lg.sharpest.filter((s) => s.graded > 0).length === 0 ? (
          <div className="py-2 text-center text-[11px] text-muted">Rankings appear once matches settle.</div>
        ) : (
          lg.sharpest.map((s, i) => (
            <div key={s.userId} className={`flex items-center gap-2.5 rounded-lg px-1.5 py-1.5 ${s.isMe ? "bg-mint" : ""}`}>
              <span className={`w-4 text-[11px] ${s.isMe ? "font-bold text-primary-press" : "text-muted"}`}>{i + 1}</span>
              <Avatar label={s.name} size={20} />
              <span className={`flex-1 truncate text-[13px] ${s.isMe ? "font-extrabold text-primary-press" : "font-semibold"}`}>{s.isMe ? "You" : s.name}</span>
              <span className={`font-mono text-[12px] font-bold ${s.isMe ? "text-primary-press" : ""}`}>{pct(s.accuracyPct)}</span>
            </div>
          ))
        )}
      </div>

      {lg.rivals.length > 0 && (
        <div className={CARD}>
          <div className="flex items-center text-[12px] font-bold">Head-to-head<InfoDot text="Accuracy compares each person's correct-result rate. Money flow is the net ₹ that's passed directly between you and them across settled matches." /></div>
          <div className="mb-2.5 text-[10px] text-muted">Tap a leaguemate to compare</div>
          <div className="mb-3 flex gap-2 overflow-x-auto pb-1">
            {lg.rivals.map((r) => (
              <button key={r.userId} type="button" onClick={() => setRivalId(r.userId)}
                className={`flex shrink-0 flex-col items-center gap-1.5 rounded-control border px-2.5 py-2 ${r.userId === rivalId ? "border-fg bg-fg text-bg" : "border-border bg-surface text-label"}`}>
                <Avatar label={r.name} size={24} />
                <span className="text-[11px] font-bold">{r.name}</span>
              </button>
            ))}
          </div>
          {rival && (
            <>
              <div className="mb-3 flex items-center gap-2.5">
                <div className="flex-1 text-center"><Avatar label="You" size={34} /><div className="mt-1 text-[11px] font-bold">You</div></div>
                <span className="text-[11px] font-extrabold text-muted">VS</span>
                <div className="flex-1 text-center"><Avatar label={rival.name} size={34} /><div className="mt-1 text-[11px] font-bold">{rival.name}</div></div>
              </div>
              <div className="flex gap-2.5">
                <div className="flex-1 rounded-control bg-subtle p-2.5 text-center">
                  <div className="text-[9px] text-muted">🎯 Accuracy</div>
                  <div className={`mt-1 text-[12px] font-bold ${skill === "you" ? "text-win" : skill === "them" ? "text-loss" : "text-muted"}`}>
                    {skill === "you" ? "You sharper" : skill === "them" ? `${rival.name} sharper` : "Evenly matched"}
                  </div>
                  <div className="mt-0.5 font-mono text-[10px] text-muted">{pct(myCorrect)} vs {pct(rival.accuracyPct)}</div>
                </div>
                <div className="flex-1 rounded-control bg-subtle p-2.5 text-center">
                  <div className="text-[9px] text-muted">💰 Money flow</div>
                  <div className={`mt-1 font-mono text-[13px] font-bold ${youUp ? "text-win" : moneyLevel ? "text-muted" : "text-loss"}`}>
                    {moneyLevel ? "Even" : youUp ? `You ${inr(flow)}` : `${rival.name} +₹${Math.abs(flow).toLocaleString("en-IN")}`}
                  </div>
                  <div className="mt-0.5 text-[9px] text-muted">across settled matches</div>
                </div>
              </div>
              <div className="mt-2.5 text-[10px] leading-snug text-muted">{verdict}</div>
            </>
          )}
        </div>
      )}
    </Reveal>
  );
}

export function AnalyticsTab({ view }: { view: AnalyticsView }) {
  const [scope, setScope] = useState<string>("global"); // "global" | leagueId
  const [tip, setTip] = useState<{ text: string; left: number; top: number } | null>(null);
  const league = view.leagues.find((l) => l.leagueId === scope) ?? null;

  // Anchor the shared bubble just below the tapped ⓘ, clamped so it never overflows the viewport.
  const openTip = useCallback((text: string, rect: DOMRect) => {
    const W = 230;
    const left = Math.min(Math.max(8, rect.right - W + 8), window.innerWidth - W - 8);
    setTip({ text, left, top: rect.bottom + 6 });
  }, []);

  // Sliding scope thumb. The pills are variable-width and horizontally scrollable, so the
  // equal-width <SlideTrack> doesn't fit — measure the active pill and glide the thumb to it.
  const scopeRef = useRef<HTMLDivElement>(null);
  const [thumb, setThumb] = useState<{ left: number; width: number } | null>(null);
  const activeIndex = scope === "global" ? 0 : view.leagues.findIndex((l) => l.leagueId === scope) + 1;
  const measure = useCallback(() => {
    const el = scopeRef.current?.querySelectorAll<HTMLElement>("[data-seg]")[activeIndex];
    if (el) setThumb({ left: el.offsetLeft, width: el.offsetWidth });
  }, [activeIndex]);
  useIsoLayoutEffect(measure, [measure, view.leagues.length]);
  // Re-measure when the bar resizes — covers viewport changes AND the panel becoming visible (the
  // home Analytics tab mounts display:none, so the initial measure reads 0 until it's shown).
  useEffect(() => {
    const c = scopeRef.current;
    if (!c || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => measure());
    ro.observe(c);
    return () => ro.disconnect();
  }, [measure]);

  const seg = (active: boolean) =>
    `relative z-[1] shrink-0 whitespace-nowrap rounded-[9px] px-3 py-1.5 text-[12px] transition-colors ${active ? "font-bold text-fg" : "font-semibold text-muted"}`;

  return (
    <InfoCtx.Provider value={openTip}>
      <div className="flex flex-col gap-3">
        <div ref={scopeRef} className="relative flex gap-1 overflow-x-auto rounded-control bg-subtle p-1">
          {thumb && thumb.width > 0 && <span aria-hidden className="cf-seg-thumb" style={{ width: thumb.width, transform: `translateX(${thumb.left}px)` }} />}
          <button type="button" data-seg className={seg(scope === "global")} onClick={() => setScope("global")}>Global</button>
          {view.leagues.map((l) => (
            <button key={l.leagueId} type="button" data-seg className={seg(scope === l.leagueId)} onClick={() => setScope(l.leagueId)}>{l.leagueName}</button>
          ))}
        </div>

        {league ? <LeaguePanel lg={league} myCorrect={league.acc.correctPct} /> : <GlobalPanel g={view.global} />}
      </div>

      {tip && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setTip(null)} />
          <div role="tooltip" onClick={() => setTip(null)} style={{ position: "fixed", left: tip.left, top: tip.top, width: 230 }}
            className="z-50 rounded-control border border-border bg-surface p-3 text-[11px] font-medium leading-snug text-label shadow-[0_12px_32px_-8px_rgba(15,23,42,.4)]">
            {tip.text}
          </div>
        </>
      )}
    </InfoCtx.Provider>
  );
}
