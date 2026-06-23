"use client";

// One card in the home Matches timeline (PRD §6/§7). Renders a fixture deduped across the viewer's
// leagues. Single-league → the whole card links into that league's match page. Multi-league → the
// card is an expander; the collapsed face shows the cross-league roll-up, the expanded face lists
// each league with its own pick/result and a link into that league's existing match page.

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { ROUND_LABEL, type CardState } from "@/lib/contest-state";
import type { FeedEntry, MatchGroup, PickShape } from "@/lib/match-feed";
import { chipColor, inr, StatusBadge } from "@/components/ui";
import { LocalTime, Countdown } from "@/components/LocalTime";
import { CountUp } from "@/components/motion";

export const matchHref = (e: FeedEntry) => `/leagues/${e.leagueSlug}/m/${e.contestId}`;

export function TeamCrest({ code, size = 22 }: { code: string; size?: number }) {
  const c = (code || "?").slice(0, 3).toUpperCase();
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full font-mono font-bold text-white"
      style={{ width: size, height: size, background: chipColor(c), fontSize: Math.round(size * 0.32) }}
    >
      {c}
    </span>
  );
}

const OUTCOME_SHORT = (p: PickShape, homeShort: string | null, awayShort: string | null) =>
  p.outcome === "home" ? homeShort || "Home" : p.outcome === "away" ? awayShort || "Away" : "Draw";

function pickShort(p: PickShape, g: MatchGroup) {
  return `${OUTCOME_SHORT(p, g.fixture.homeShort, g.fixture.awayShort)} ${p.predHome}–${p.predAway}`;
}

// The collapsed footer's pick summary across leagues.
export function pickRollup(g: MatchGroup): string | null {
  if (g.pickConsistency === "none") return null;
  if (g.pickConsistency === "uniform" && g.representativePick) return pickShort(g.representativePick, g);
  if (g.pickConsistency === "sameOutcome") {
    const p = g.leagues.find((l) => l.pick)!.pick!;
    return `${OUTCOME_SHORT(p, g.fixture.homeShort, g.fixture.awayShort)} · mixed scores`;
  }
  return "Mixed picks";
}

// Which upcoming state best represents the group (open-unpicked is the most actionable).
function upcomingState(g: MatchGroup): CardState {
  const order: CardState[] = ["open_nopick", "open_picked", "locked", "tbd"];
  for (const s of order) if (g.leagues.some((l) => l.state === s)) return s;
  return g.leagues[0].state;
}

const roundText = (round: string) => ROUND_LABEL[round] ?? round;

// Per-league breakdown rows, shown when a multi-league card is expanded.
function PerLeagueRows({ g, zone }: { g: MatchGroup; zone: "upcoming" | "results" }) {
  return (
    <div className="mt-1 border-t border-border pt-2">
      {g.leagues.map((l) => {
        const right =
          zone === "results" && l.net != null ? (
            <span className={`font-mono text-[12px] font-bold tabular ${l.net > 0 ? "text-win" : l.net < 0 ? "text-loss" : "text-push"}`}>
              {inr(l.net)}
            </span>
          ) : l.pick ? (
            <span className="font-mono text-[11px] font-semibold text-fg">{pickShort(l.pick, g)}</span>
          ) : l.state === "open_nopick" ? (
            <span className="text-[11px] font-bold text-primary-press">Pick →</span>
          ) : (
            <span className="text-[11px] text-muted">—</span>
          );
        return (
          <Link key={l.contestId} href={matchHref(l)} className="flex items-center gap-2 py-2 active:bg-subtle">
            <span className="flex-1 truncate text-[12px] font-semibold">{l.leagueName}</span>
            {zone === "upcoming" && l.members > 0 && (
              <span className="text-[10px] text-muted">{l.joined}/{l.members}</span>
            )}
            {right}
            <span className="text-muted">›</span>
          </Link>
        );
      })}
    </div>
  );
}

// Shell: single-league → Link; multi-league → expandable div. `head` is the always-visible face.
function CardShell({
  g,
  zone,
  className,
  head,
}: {
  g: MatchGroup;
  zone: "upcoming" | "results";
  className: string;
  head: (multi: boolean, open: boolean) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const multi = g.leagueCount > 1;
  if (!multi) {
    return (
      <Link href={matchHref(g.leagues[0])} className={`block ${className} cf-press`}>
        {head(false, false)}
      </Link>
    );
  }
  return (
    <div className={className}>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="block w-full text-left cf-press">
        {head(true, open)}
      </button>
      {open && <PerLeagueRows g={g} zone={zone} />}
    </div>
  );
}

const CARD = "rounded-card border border-border bg-surface p-3.5 shadow-[0_2px_8px_rgba(15,23,42,.04)]";

function Header({ g, state }: { g: MatchGroup; state?: CardState }) {
  return (
    <div className="mb-2.5 flex items-center justify-between">
      <span className="text-[11px] text-muted">
        {roundText(g.fixture.round)} · <LocalTime iso={g.fixture.kickoffIso} />
      </span>
      {state && <StatusBadge state={state} />}
    </div>
  );
}

function Teams({ g, score }: { g: MatchGroup; score?: boolean }) {
  const fx = g.fixture;
  const hw = fx.advancerSide === "home" || (score && (fx.ftHome ?? 0) > (fx.ftAway ?? 0));
  const aw = fx.advancerSide === "away" || (score && (fx.ftAway ?? 0) > (fx.ftHome ?? 0));
  return (
    <div className="flex items-center gap-2 text-[14px] font-bold">
      <TeamCrest code={fx.homeShort || fx.homeLabel} />
      <span className={hw ? "" : "font-semibold"}>{fx.homeLabel}</span>
      {score ? (
        <span className="ml-auto flex items-center gap-1.5 font-mono">
          <span className={`text-[18px] font-bold ${hw ? "" : "text-muted"}`}>{fx.ftHome ?? 0}</span>
          <span className="text-draw">–</span>
          <span className={`text-[18px] font-bold ${aw ? "" : "text-muted"}`}>{fx.ftAway ?? 0}</span>
        </span>
      ) : (
        <span className="text-draw">v</span>
      )}
      <TeamCrest code={fx.awayShort || fx.awayLabel} />
      <span className={`${score ? "" : ""} ${aw ? "" : "font-semibold"}`}>{fx.awayLabel}</span>
    </div>
  );
}

// Expand affordance for a multi-league card: "in N leagues ▾" (grey) or "N leagues ▾" (green, when
// already picked). The chevron rotates when the card is open. Null for single-league cards.
const expandChip = (n: number, open: boolean, tone: "grey" | "green") =>
  n > 1 ? (
    <span
      className={`inline-flex items-center gap-1.5 rounded-pill px-2.5 py-1 text-[11px] ${
        tone === "green" ? "font-bold text-primary-press" : "bg-subtle text-label"
      }`}
    >
      {tone === "green" ? `${n} leagues` : `in ${n} leagues`}
      <span className={`font-mono text-[10px] transition-transform duration-200 ${open ? "rotate-180" : ""}`}>▾</span>
    </span>
  ) : null;

// ---- UPCOMING (full) ----
function UpcomingFull({ g }: { g: MatchGroup }) {
  const state = upcomingState(g);
  const roll = pickRollup(g);
  return (
    <CardShell
      g={g}
      zone="upcoming"
      className={CARD}
      head={(multi, open) => (
        <>
          <Header g={g} state={state} />
          <div className="mb-3"><Teams g={g} /></div>
          {state === "tbd" ? (
            <div className="text-[12px] text-muted">Teams TBD — opens once the bracket is set</div>
          ) : state === "open_nopick" ? (
            <div>
              <div className="mb-2.5 flex items-center justify-between">
                <span className="rounded-pill bg-amber-bg px-2.5 py-1 font-mono text-[12px] font-semibold text-amber-fg">
                  <Countdown iso={g.fixture.kickoffIso} prefix="Locks in" />
                </span>
                {expandChip(g.leagueCount, open, "grey")}
              </div>
              {/* Collapsed: the CTA expands the card. Expanded (multi): the per-league "Pick →" rows
                  below replace it, so we hide the button to match the handoff. */}
              {!(multi && open) && (
                <div className="rounded-control bg-primary py-2.5 text-center text-[14px] font-bold text-white shadow-[0_2px_8px_rgba(21,166,106,.3)]">
                  {multi ? "Make pick ▾" : "Make pick"}
                </div>
              )}
            </div>
          ) : state === "open_picked" ? (
            <div className="flex items-center justify-between text-[12px]">
              <span className="text-muted">
                {roll ? <>Your pick <span className="font-mono font-bold text-fg">{roll}</span></> : "Predicted"}
              </span>
              {multi ? expandChip(g.leagueCount, open, "green") : <span className="font-bold text-primary-press">Edit →</span>}
            </div>
          ) : (
            <div className="flex items-center justify-between text-[12px] text-muted">
              <span className="font-mono"><Countdown iso={g.fixture.kickoffIso} prefix="Kicks off in" /></span>
              <span>Locked{g.leagueCount > 1 ? ` · ${g.leagueCount} leagues` : ""}</span>
            </div>
          )}
        </>
      )}
    />
  );
}

// ---- COMPACT (later-day upcoming, or sat-out/void results) ----
function CompactRow({ g, zone, dim }: { g: MatchGroup; zone: "upcoming" | "results"; dim?: boolean }) {
  const fx = g.fixture;
  const state = zone === "upcoming" ? upcomingState(g) : undefined;
  return (
    <CardShell
      g={g}
      zone={zone}
      className={`${CARD} ${dim ? "opacity-75" : ""}`}
      head={() => (
        <div className="flex items-center gap-2.5">
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-bold">
              {fx.homeLabel} {zone === "results" && <span className="font-mono text-muted">{fx.ftHome ?? 0}–{fx.ftAway ?? 0}</span>} {zone === "upcoming" ? "v" : ""} {fx.awayLabel}
            </div>
            <div className="mt-0.5 truncate text-[11px] text-muted">
              <LocalTime iso={fx.kickoffIso} />
              {g.leagueCount > 1 && <> · in {g.leagueCount} leagues</>}
              {zone === "results" && g.predictedLeagues === 0 && <> · You sat this out</>}
            </div>
          </div>
          {zone === "upcoming" && state === "open_nopick" ? (
            <span className="shrink-0 rounded-pill bg-primary px-3 py-1.5 text-[11px] font-bold text-white">Pick</span>
          ) : zone === "upcoming" && state === "open_picked" ? (
            <span className="shrink-0 text-[12px] font-bold text-primary-press">Edit</span>
          ) : (
            <span className="shrink-0 font-mono text-[13px] text-muted">—</span>
          )}
        </div>
      )}
    />
  );
}

// ---- RESULTS (full, entered) ----
function resultMeta(g: MatchGroup) {
  const net = g.settledNet ?? 0;
  if (g.hasMixedResults) {
    const wins = g.leagues.filter((l) => (l.net ?? 0) > 0).length;
    const losses = g.leagues.filter((l) => (l.net ?? 0) < 0).length;
    return { kind: "mixed" as const, label: `Won ${wins} · lost ${losses} · net`, net };
  }
  if (net > 0) return { kind: "won" as const, label: null, net };
  if (net < 0) return { kind: "lost" as const, label: null, net };
  return { kind: "push" as const, label: "Push · no winner", net };
}

const WON_VERBS = ["Called it", "Nailed it", "Spot on", "Bang on", "Clinical", "Textbook"];
function wonVerb(seed: string) {
  let h = 0;
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return WON_VERBS[h % WON_VERBS.length];
}

function ResultFull({ g }: { g: MatchGroup }) {
  const m = resultMeta(g);
  const roll = pickRollup(g);
  const leaguesSuffix = g.leagueCount > 1 ? ` · ${g.leagueCount} leagues` : "";
  const won = m.kind === "won";
  const container = won
    ? "relative overflow-hidden cf-win rounded-card border-[1.5px] border-[#16A34A] bg-[#F0FDF4] p-3.5 dark:bg-[#16a34a1a] shadow-[0_4px_16px_-4px_rgba(22,163,74,.25)]"
    : CARD;

  const banner =
    won ? (
      <div className="flex items-center justify-between rounded-control bg-[#16A34A] px-3.5 py-2.5 text-white">
        <span className="text-[12px] font-bold">{wonVerb(g.fixtureId)}{roll ? ` · ${roll}` : ""}{leaguesSuffix}</span>
        <span className="font-mono text-[16px] font-bold"><CountUp value={m.net} kind="inr" /></span>
      </div>
    ) : m.kind === "push" ? (
      <div className="flex items-center justify-between rounded-control bg-subtle px-3.5 py-2.5">
        <span className="text-[12px] font-semibold text-label">{m.label}{leaguesSuffix}</span>
        <span className="font-mono text-[13px] font-bold text-push">nothing owed</span>
      </div>
    ) : (
      <div className="flex items-center justify-between rounded-control bg-[#FEF2F2] px-3.5 py-2.5 dark:bg-[#ef44441f]">
        <span className="text-[12px] font-semibold text-[#991B1B] dark:text-[#fca5a5]">
          {m.kind === "mixed" ? m.label : roll ? `Your pick ${roll}` : "You lose"}{leaguesSuffix}
        </span>
        <span className={`font-mono text-[15px] font-bold ${m.net >= 0 ? "text-win" : "text-loss"}`}>{inr(m.net)}</span>
      </div>
    );

  return (
    <CardShell
      g={g}
      zone="results"
      className={container}
      head={() => (
        <>
          {won && <span aria-hidden className="cf-sheen" />}
          <div className="mb-2.5"><Teams g={g} score /></div>
          {banner}
        </>
      )}
    />
  );
}

// Dispatch: pick the right card for the group + zone + compact hint.
export function MatchFeedCard({ g, zone, compact }: { g: MatchGroup; zone: "upcoming" | "results"; compact: boolean }) {
  if (zone === "upcoming") return compact ? <CompactRow g={g} zone="upcoming" /> : <UpcomingFull g={g} />;
  // results
  const everyVoid = g.leagues.every((l) => l.state === "void");
  const everyCancelled = g.leagues.every((l) => l.state === "cancelled");
  if (g.predictedLeagues === 0 || everyVoid || everyCancelled) return <CompactRow g={g} zone="results" dim />;
  return <ResultFull g={g} />;
}
