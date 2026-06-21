"use client";

// Home "Matches" tab (PRD docs/prds/2026-06-21-home-matches-tab-prd.md). A pinned hub (live cards
// + a "picks due" nudge) sits above two sub-tabs — Next 24h (upcoming) and Results (settled) —
// each a vertical timeline grouped by local day. All cross-league data is computed server-side
// (lib/home-matches) and passed in as plain props; this component owns only the view state.

import { useState } from "react";
import Link from "next/link";
import type { MatchGroup, MatchesView } from "@/lib/match-feed";
import { ROUND_LABEL, liveLabel } from "@/lib/contest-state";
import { inr } from "@/components/ui";
import { LocalTime, Countdown } from "@/components/LocalTime";
import { AutoRefresh } from "@/components/AutoRefresh";
import { MatchFeedCard, TeamCrest, matchHref, pickRollup } from "@/components/MatchFeedCard";

const roundText = (round: string) => ROUND_LABEL[round] ?? round;

// Local calendar-day difference (client tz — same basis as LocalTime), so "Today/Tomorrow" match
// what the user sees on each card's time.
function dayDiff(ts: number, now: number) {
  const d = new Date(ts);
  const n = new Date(now);
  const a = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const b = new Date(n.getFullYear(), n.getMonth(), n.getDate()).getTime();
  return Math.round((a - b) / 86_400_000);
}
function bucketLabel(ts: number, now: number, zone: "upcoming" | "results") {
  const diff = dayDiff(ts, now);
  if (diff === 0) return "TODAY";
  if (zone === "upcoming" && diff === 1) return "TOMORROW";
  if (zone === "results" && diff === -1) return "YESTERDAY";
  return new Date(ts).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" }).toUpperCase();
}
function bucketize(groups: MatchGroup[], now: number, zone: "upcoming" | "results") {
  const out: { label: string; groups: MatchGroup[] }[] = [];
  for (const g of groups) {
    const label = bucketLabel(g.fixture.kickoffMs, now, zone);
    const last = out[out.length - 1];
    if (!last || last.label !== label) out.push({ label, groups: [g] });
    else last.groups.push(g);
  }
  return out;
}

function dotClass(g: MatchGroup, zone: "upcoming" | "results") {
  if (zone === "upcoming") {
    return g.leagues.some((l) => l.state === "open_nopick")
      ? "bg-accent shadow-[0_0_0_3px_var(--color-amber-bg)]"
      : "bg-draw";
  }
  if (g.predictedLeagues === 0) return "bg-draw";
  const net = g.settledNet ?? 0;
  if (g.hasMixedResults) return "bg-push";
  if (net > 0) return "bg-win";
  if (net < 0) return "bg-loss";
  return "bg-push";
}

function Timeline({ groups, zone, now }: { groups: MatchGroup[]; zone: "upcoming" | "results"; now: number }) {
  if (!groups.length) {
    return (
      <div className="rounded-card border border-dashed border-border p-8 text-center text-[13px] text-muted">
        {zone === "upcoming" ? "No upcoming matches." : "No results yet."}
      </div>
    );
  }
  const buckets = bucketize(groups, now, zone);
  return (
    <div className="relative pl-[22px]">
      <div className="absolute bottom-0 left-[5px] top-1 w-0.5 bg-border" />
      {buckets.map((b) => (
        <div key={b.label}>
          <div className="mb-3 text-[11px] font-extrabold tracking-[.06em] text-muted">{b.label}</div>
          {b.groups.map((g) => (
            <div key={g.fixtureId} className="relative mb-3.5">
              <span className={`absolute -left-[20px] top-1.5 h-2.5 w-2.5 rounded-full ${dotClass(g, zone)}`} />
              <MatchFeedCard g={g} zone={zone} compact={zone === "upcoming" && dayDiff(g.fixture.kickoffMs, now) > 0} />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function HubLiveCard({ g, provisional }: { g: MatchGroup; provisional: number | null }) {
  const fx = g.fixture;
  const roll = pickRollup(g);
  const suffix = g.leagueCount > 1 ? ` · ${g.leagueCount} leagues` : "";
  const track =
    provisional == null ? null : (
      <span className={`font-bold ${provisional > 0 ? "text-win" : provisional < 0 ? "text-loss" : "text-push"}`}>
        {provisional === 0 ? `level${suffix}` : `on track ${inr(provisional)}${suffix}`}
      </span>
    );
  return (
    <Link
      href={matchHref(g.leagues[0])}
      className="block rounded-card border border-border border-l-[3px] border-l-live bg-surface p-3.5 shadow-[0_2px_8px_rgba(15,23,42,.04)] transition-transform active:scale-[.99]"
    >
      <div className="mb-2.5 flex items-center justify-between">
        <span className="text-[11px] text-muted">
          {roundText(fx.round)} · <span className="font-bold text-live">● {liveLabel(fx.statusDetail, fx.minute)}</span>
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-pill bg-live px-2 py-0.5 text-[9px] font-extrabold tracking-[.06em] text-white">
          <span className="h-1 w-1 animate-live-pulse rounded-full bg-white" />LIVE
        </span>
      </div>
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-2.5">
          <TeamCrest code={fx.homeShort || fx.homeLabel} size={24} />
          <span className="text-[14px] font-bold">{fx.homeLabel}</span>
          <span className="ml-auto font-mono text-[18px] font-bold">{fx.ftHome ?? 0}</span>
        </div>
        <div className="flex items-center gap-2.5">
          <TeamCrest code={fx.awayShort || fx.awayLabel} size={24} />
          <span className="text-[14px] font-semibold text-muted">{fx.awayLabel}</span>
          <span className="ml-auto font-mono text-[18px] font-bold text-muted">{fx.ftAway ?? 0}</span>
        </div>
      </div>
      {roll && (
        <div className="mt-2.5 flex items-center justify-between border-t border-border pt-2.5 text-[12px]">
          <span className="text-muted">Your pick <span className="font-bold text-fg">{roll}</span></span>
          {track}
        </div>
      )}
    </Link>
  );
}

export function MatchesTab({ view }: { view: MatchesView }) {
  const [tab, setTab] = useState<"next" | "results">("next");
  const now = Date.now();
  const { live, upcoming, past, picksDue, provisionalByFixture } = view;

  // "Predict →" target: the first upcoming fixture the viewer can still pick, in its first open league.
  const firstDue = upcoming.find((g) => g.needsPick);
  const dueTarget = firstDue
    ? matchHref(firstDue.leagues.find((l) => l.state === "open_nopick") ?? firstDue.leagues[0])
    : null;

  const tabBtn = (key: "next" | "results", label: string) => (
    <button
      type="button"
      role="tab"
      aria-selected={tab === key}
      onClick={() => setTab(key)}
      className={`-mb-px border-b-[2.5px] pb-2.5 pt-1 text-[13px] ${
        tab === key ? "border-primary font-extrabold text-fg" : "border-transparent font-semibold text-muted"
      }`}
    >
      {label}
    </button>
  );

  const nothing = !live.length && !upcoming.length && !past.length;
  if (nothing) {
    return (
      <div className="rounded-card border border-dashed border-border p-8 text-center text-[13px] text-muted">
        No matches scheduled yet.
      </div>
    );
  }

  return (
    <div>
      {live.length > 0 && <AutoRefresh seconds={30} />}

      {(live.length > 0 || picksDue) && (
        <div className="mb-2 flex flex-col gap-2.5">
          {live.map((g) => (
            <HubLiveCard key={g.fixtureId} g={g} provisional={provisionalByFixture[g.fixtureId] ?? null} />
          ))}
          {picksDue && (
            <Link
              href={dueTarget ?? "#"}
              className="flex items-center justify-between gap-3 rounded-card border border-amber-fg/30 bg-amber-bg px-4 py-3 active:scale-[.99]"
            >
              <div className="min-w-0">
                <div className="text-[14px] font-extrabold text-amber-fg">
                  {picksDue.count} {picksDue.count === 1 ? "pick" : "picks"} due
                </div>
                {picksDue.earliestLockIso && (
                  <div className="text-[11px] font-semibold text-amber-fg opacity-80">
                    Earliest <Countdown iso={picksDue.earliestLockIso} prefix="locks in" />
                  </div>
                )}
              </div>
              <span className="shrink-0 rounded-pill bg-amber-fg px-4 py-2 text-[12px] font-bold text-white">Predict →</span>
            </Link>
          )}
        </div>
      )}

      <div role="tablist" aria-label="Matches view" className="mb-1 flex gap-6 border-b border-border px-1">
        {tabBtn("next", "Next 24h")}
        {tabBtn("results", "Results")}
      </div>

      <div className="pt-4">
        {tab === "next" ? (
          <Timeline groups={upcoming} zone="upcoming" now={now} />
        ) : (
          <Timeline groups={past} zone="results" now={now} />
        )}
      </div>
    </div>
  );
}
