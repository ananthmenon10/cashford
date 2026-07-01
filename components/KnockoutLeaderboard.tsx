"use client";

// Per-league bracket-accuracy board (Phase 4). Ranks leaguemates by correct picks
// over decided matches. Always shows X/Y with a visible denominator (sample size) so
// a late joiner's 3/3 doesn't read as "better" than 22/28 without context.
// Collapsible (minimised by default) so the bracket itself owns the screen.

import { useState } from "react";
import type { LeagueLeaderboard } from "@/lib/knockout-data";

export function KnockoutLeaderboard({ leaderboards }: { leaderboards: LeagueLeaderboard[] }) {
  const [idx, setIdx] = useState(0);
  const [open, setOpen] = useState(false);
  if (leaderboards.length === 0) return null;
  const lg = leaderboards[Math.min(idx, leaderboards.length - 1)];
  const anyDecided = lg.rows.some((r) => r.decided > 0);
  const you = lg.rows.find((r) => r.isYou);
  const yourRank = you ? lg.rows.indexOf(you) + 1 : null;

  return (
    <div className="mx-3 mt-3 overflow-hidden rounded-[14px] border bg-surface" style={{ borderColor: "var(--color-border)" }}>
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-2 px-4 py-2.5 text-left" aria-expanded={open}>
        <span className="shrink-0 font-mono text-[10px] font-bold uppercase tracking-[.08em] text-muted">Bracket leaderboard</span>
        <span className="min-w-0 flex-1 truncate text-[12.5px] font-bold text-fg">
          {yourRank ? `You’re #${yourRank} of ${lg.rows.length}` : `${lg.rows.length} players`}
        </span>
        <Chevron open={open} />
      </button>

      {open && (
        <div className="border-t px-4 pb-4 pt-3.5" style={{ borderColor: "var(--color-border)" }}>
          {leaderboards.length > 1 && (
            <select
              value={idx}
              onChange={(e) => setIdx(Number(e.target.value))}
              className="mb-2.5 w-full rounded-[7px] border bg-transparent px-2 py-1.5 text-[12px] font-semibold text-fg"
              style={{ borderColor: "var(--color-border)" }}
              aria-label="League"
            >
              {leaderboards.map((l, i) => (
                <option key={l.leagueId} value={i} style={{ color: "#000" }}>
                  {l.name}
                </option>
              ))}
            </select>
          )}

          {!anyDecided ? (
            <div className="text-[11px] leading-[1.45] text-muted">
              Scoring starts as matches finish — everyone’s at 0 for now. Accuracy counts only the matches
              each player actually predicted, so a late start never inflates a score.
            </div>
          ) : (
            <ol className="flex flex-col gap-1.5">
              {lg.rows.map((r, i) => (
                <li
                  key={r.userId}
                  className="flex items-center gap-2.5 rounded-[9px] px-2.5 py-2"
                  style={{ background: r.isYou ? "rgba(21,166,106,.12)" : "transparent" }}
                >
                  <span className="w-4 font-mono text-[12px] font-bold text-muted">{i + 1}</span>
                  <span className="flex-1 truncate text-[13px] font-bold text-fg">
                    {r.name}
                    {r.isYou && <span className="ml-1 text-[10px] font-semibold" style={{ color: "#15A66A" }}>you</span>}
                  </span>
                  <span className="font-mono text-[13px] font-extrabold" style={{ color: r.decided > 0 ? "#16A34A" : "var(--color-muted)" }}>
                    {r.correct}
                    <span className="text-muted">/{r.decided}</span>
                  </span>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </div>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-muted" style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform .2s var(--cf-ease)" }} aria-hidden="true">
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}
