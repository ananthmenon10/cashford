"use client";

// Per-league bracket-accuracy board (Phase 4). Ranks leaguemates by correct picks
// over decided matches. Always shows X/Y with a visible denominator (sample size) so
// a late joiner's 3/3 doesn't read as "better" than 22/28 without context.

import { useState } from "react";
import type { LeagueLeaderboard } from "@/lib/knockout-data";

const MUT = "#7a8794";
const TXT = "#E7ECEF";

export function KnockoutLeaderboard({ leaderboards }: { leaderboards: LeagueLeaderboard[] }) {
  const [idx, setIdx] = useState(0);
  if (leaderboards.length === 0) return null;
  const lg = leaderboards[Math.min(idx, leaderboards.length - 1)];
  const anyDecided = lg.rows.some((r) => r.decided > 0);

  return (
    <div className="mx-3.5 mt-3 rounded-[14px] border p-4" style={{ background: "#11161D", borderColor: "rgba(255,255,255,.08)" }}>
      <div className="flex items-center justify-between">
        <div className="font-mono text-[11px] font-bold tracking-[.08em]" style={{ color: MUT }}>
          BRACKET LEADERBOARD
        </div>
        {leaderboards.length > 1 && (
          <select
            value={idx}
            onChange={(e) => setIdx(Number(e.target.value))}
            className="rounded-[7px] border bg-transparent px-2 py-1 text-[11px] font-semibold"
            style={{ borderColor: "rgba(255,255,255,.12)", color: TXT }}
            aria-label="League"
          >
            {leaderboards.map((l, i) => (
              <option key={l.leagueId} value={i} style={{ color: "#000" }}>
                {l.name}
              </option>
            ))}
          </select>
        )}
      </div>

      {!anyDecided ? (
        <div className="mt-2.5 text-[11px] leading-[1.45]" style={{ color: MUT }}>
          Scoring starts as matches finish — everyone's at 0 for now. Accuracy counts only the matches
          each player actually predicted, so a late start never inflates a score.
        </div>
      ) : (
        <ol className="mt-2.5 flex flex-col gap-1.5">
          {lg.rows.map((r, i) => (
            <li
              key={r.userId}
              className="flex items-center gap-2.5 rounded-[9px] px-2.5 py-2"
              style={{ background: r.isYou ? "rgba(21,166,106,.12)" : "transparent" }}
            >
              <span className="w-4 font-mono text-[12px] font-bold" style={{ color: MUT }}>
                {i + 1}
              </span>
              <span className="flex-1 truncate text-[13px] font-bold" style={{ color: TXT }}>
                {r.name}
                {r.isYou && <span className="ml-1 text-[10px] font-semibold" style={{ color: "#15A66A" }}>you</span>}
              </span>
              <span className="font-mono text-[13px] font-extrabold" style={{ color: r.decided > 0 ? "#16A34A" : MUT }}>
                {r.correct}
                <span style={{ color: MUT }}>/{r.decided}</span>
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
