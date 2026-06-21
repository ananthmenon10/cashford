"use client";

// Home "Analytics" tab (PRD docs/prds/2026-06-21-home-analytics-tab-prd.md). Two honest lenses —
// 💰 money (stored net) and 🎯 skill (derived accuracy). A scope control switches between the
// GLOBAL view (you, across all leagues + tournament-wide match intelligence) and a PER-LEAGUE
// drill-down (adds rivalry: sharpest board + head-to-head). All data is computed server-side
// (lib/home-analytics); this component owns only the view state.

import { useState } from "react";
import Link from "next/link";
import type { AnalyticsView, GlobalAnalytics, LeagueAnalytics } from "@/lib/analytics";
import { Avatar, inr } from "@/components/ui";

const pct = (p: number | null) => (p == null ? "—" : `${Math.round(p * 100)}%`);

// ── shared bits ──────────────────────────────────────────────────────────────────────────────
const CARD = "rounded-card border border-border bg-surface p-3.5 shadow-[0_2px_8px_rgba(15,23,42,.04)]";
const netColor = (n: number) => (n > 0 ? "text-win" : n < 0 ? "text-loss" : "text-muted");
// Bright variants for the dark hero NET tile (sign-aware: not always green).
const heroNet = (n: number) => (n > 0 ? "text-[#4ade80]" : n < 0 ? "text-[#f87171]" : "text-[#94a3b8]");

function Cell({ children, tint }: { children: React.ReactNode; tint?: string }) {
  return <div className={`flex-1 rounded-card border border-border p-3 ${tint ?? "bg-surface"} shadow-[0_2px_8px_rgba(15,23,42,.04)]`}>{children}</div>;
}

// Inline cumulative-net chart (no chart lib — RSC/dark-mode friendly).
function NetChart({ points }: { points: { x: number; y: number }[] }) {
  if (points.length < 2) {
    return <div className="flex h-16 items-center justify-center text-[11px] text-muted">Your net line appears as matches settle.</div>;
  }
  const W = 280, H = 64, pad = 5;
  const ys = points.map((p) => p.y);
  const minY = Math.min(0, ...ys), maxY = Math.max(0, ...ys);
  const range = maxY - minY || 1;
  const n = points.length;
  const sx = (i: number) => (i / (n - 1)) * W;
  const sy = (y: number) => H - pad - ((y - minY) / range) * (H - 2 * pad);
  const line = points.map((p, i) => `${sx(i).toFixed(1)},${sy(p.y).toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="block w-full" style={{ height: 64 }}>
      <defs>
        <linearGradient id="netfill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--color-primary)" stopOpacity=".18" />
          <stop offset="1" stopColor="var(--color-primary)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={`0,${H} ${line} ${W},${H}`} fill="url(#netfill)" />
      <polyline points={line} fill="none" stroke="var(--color-primary)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function HeadlineNet({ label, net }: { label: string; net: number }) {
  return (
    <div className="flex-1 rounded-card border border-border bg-[#0F172A] p-3.5 dark:bg-surface">
      <div className="text-[9px] font-bold tracking-[.05em] text-[#94a3b8]">{label}</div>
      <div className={`mt-1 font-mono text-[21px] font-bold tabular ${heroNet(net)}`}>{inr(net)}</div>
    </div>
  );
}
function HeadlineStat({ label, value }: { label: string; value: string }) {
  return (
    <div className={`flex-1 ${CARD}`}>
      <div className="text-[9px] font-bold tracking-[.05em] text-muted">{label}</div>
      <div className="mt-1 font-mono text-[21px] font-bold tabular">{value}</div>
    </div>
  );
}

// ── GLOBAL panel ─────────────────────────────────────────────────────────────────────────────
function GlobalPanel({ g }: { g: GlobalAnalytics }) {
  if (g.acc.graded === 0 && g.pot.entered === 0) {
    return (
      <div className="rounded-card border border-dashed border-border p-8 text-center text-[13px] text-muted">
        Your analytics appear here as matches settle.
      </div>
    );
  }
  const bias = g.acc.goalBias;
  const biasTxt = bias == null ? "—" : `${bias >= 0 ? "+" : "−"}${Math.abs(bias).toFixed(1)}`;
  const biasLabel = bias == null ? "" : bias > 0.15 ? "you predict high" : bias < -0.15 ? "you predict low" : "on the money";
  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-2.5">
        <HeadlineNet label="💰 NET" net={g.net} />
        <HeadlineStat label="🎯 CORRECT" value={pct(g.acc.correctPct)} />
      </div>

      <div className={CARD}>
        <div className="mb-2.5 flex items-center justify-between">
          <span className="text-[12px] font-bold">Net over the tournament</span>
          <span className="rounded-pill bg-mint px-2 py-0.5 text-[9px] font-bold text-primary-press">💰 MONEY</span>
        </div>
        <NetChart points={g.cumulative} />
      </div>

      <div className="flex gap-2.5">
        <Cell>
          <div className="text-center font-mono text-[18px] font-bold">{pct(g.acc.exactPct)}</div>
          <div className="mt-0.5 text-center text-[10px] text-muted">Exact score 🎯</div>
        </Cell>
        <Cell>
          <div className="text-center font-mono text-[18px] font-bold">{g.pot.won}/{g.pot.entered}</div>
          <div className="mt-0.5 text-center text-[10px] text-muted">Pot win 💰</div>
        </Cell>
        <Cell>
          <div className="text-center font-mono text-[18px] font-bold text-win">{g.streak}</div>
          <div className="mt-0.5 text-center text-[10px] text-muted">Streak 🎯</div>
        </Cell>
      </div>

      {(g.lucky || g.biggest) && (
        <div className="flex gap-2.5">
          <Cell>
            <div className="text-[10px] font-bold text-muted">Lucky team 💰</div>
            <div className="mt-1 text-[14px] font-extrabold">{g.lucky?.team ?? "—"}</div>
            {g.lucky && <div className={`font-mono text-[12px] font-bold ${netColor(g.lucky.net)}`}>{inr(g.lucky.net)}</div>}
          </Cell>
          <Cell>
            <div className="text-[10px] font-bold text-muted">Biggest night 💰</div>
            <div className="mt-1 text-[14px] font-extrabold">{g.biggest?.dayKey ?? "—"}</div>
            {g.biggest && <div className={`font-mono text-[12px] font-bold ${netColor(g.biggest.net)}`}>{inr(g.biggest.net)}</div>}
          </Cell>
        </div>
      )}

      <div className="flex gap-2.5">
        {g.best && g.best.slug ? (
          <Link href={`/leagues/${g.best.slug}/m/${g.best.contestId}`} className="flex-1">
            <Cell tint="bg-[#F0FDF4] dark:bg-[#16a34a1a] border-[#bbf7d0] dark:border-[#16a34a55]">
              <div className="text-[10px] font-bold text-primary-press">Best result 💰</div>
              <div className="mt-1 font-mono text-[16px] font-bold text-win">{inr(g.best.net)}</div>
              <div className="truncate text-[10px] text-muted">{g.best.label} ›</div>
            </Cell>
          </Link>
        ) : (
          <Cell><div className="text-[10px] font-bold text-muted">Best result 💰</div><div className="mt-1 text-[14px] text-muted">—</div></Cell>
        )}
        <Cell>
          <div className="text-[10px] font-bold text-muted">Goals bias 🎯</div>
          <div className="mt-1 font-mono text-[16px] font-bold text-away">{biasTxt}</div>
          <div className="text-[10px] text-muted">{biasLabel}</div>
        </Cell>
      </div>

      {(g.favouritesWonPct != null || g.calledUpsets > 0) && (
        <div className={CARD}>
          <div className="mb-2 text-[12px] font-bold">Match intelligence</div>
          {g.favouritesWonPct != null && (
            <div className="flex items-center justify-between text-[11px] text-label">
              <span>Favourites have won</span>
              <span className="font-mono font-bold text-fg">{pct(g.favouritesWonPct)}</span>
            </div>
          )}
          <div className="mt-1.5 flex items-center justify-between text-[11px] text-label">
            <span>Your called upsets 🎯</span>
            <span className="font-mono font-bold text-win">{g.calledUpsets}</span>
          </div>
        </div>
      )}
    </div>
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
    <div className="flex flex-col gap-3">
      <div className="flex gap-2.5">
        <div className="flex-1 rounded-card border border-border bg-[#0F172A] p-3.5 dark:bg-surface">
          <div className="text-[9px] font-bold tracking-[.05em] text-[#94a3b8]">💰 NET · RANK {lg.rank}/{lg.members}</div>
          <div className={`mt-1 font-mono text-[20px] font-bold tabular ${heroNet(lg.net)}`}>{inr(lg.net)}</div>
        </div>
        <HeadlineStat label="🎯 CORRECT" value={pct(lg.acc.correctPct)} />
      </div>

      <div className={CARD}>
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[12px] font-bold">Sharpest predictor</span>
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
          <div className="text-[12px] font-bold">Head-to-head</div>
          <div className="mb-2.5 text-[10px] text-muted">Tap a leaguemate to compare</div>
          <div className="mb-3 flex gap-2 overflow-x-auto pb-1">
            {lg.rivals.map((r) => (
              <button
                key={r.userId}
                type="button"
                onClick={() => setRivalId(r.userId)}
                className={`flex shrink-0 flex-col items-center gap-1.5 rounded-control border px-2.5 py-2 ${
                  r.userId === rivalId ? "border-fg bg-fg text-bg" : "border-border bg-surface text-label"
                }`}
              >
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
    </div>
  );
}

export function AnalyticsTab({ view }: { view: AnalyticsView }) {
  const [scope, setScope] = useState<string>("global"); // "global" | leagueId
  const league = view.leagues.find((l) => l.leagueId === scope) ?? null;

  const seg = (active: boolean) =>
    `shrink-0 whitespace-nowrap rounded-[9px] px-3 py-1.5 text-[12px] ${
      active ? "bg-surface font-bold text-fg shadow-[0_1px_3px_rgba(15,23,42,.08)]" : "font-semibold text-muted"
    }`;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-1 overflow-x-auto rounded-control bg-subtle p-1">
        <button type="button" className={seg(scope === "global")} onClick={() => setScope("global")}>Global</button>
        {view.leagues.map((l) => (
          <button key={l.leagueId} type="button" className={seg(scope === l.leagueId)} onClick={() => setScope(l.leagueId)}>
            {l.leagueName}
          </button>
        ))}
      </div>

      {league ? <LeaguePanel lg={league} myCorrect={league.acc.correctPct} /> : <GlobalPanel g={view.global} />}
    </div>
  );
}
