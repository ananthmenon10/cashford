import { type CardState, liveLabel } from "@/lib/contest-state";
import { LocalTime } from "./LocalTime";
import { Avatar } from "./ui";

// Centred team header for the match screen — replaces the old vertical fixture card across ALL
// states (plan 2026-06-20-003, caveat 3). Pre-match shows "vs"; scored states show the centred
// regulation score. Reuses Avatar (chipColor/flag) + LocalTime; dark-aware via semantic tokens.
const SCORED: CardState[] = ["live", "settling", "won", "lost", "push", "notentered"];

export interface FixtureHeaderData {
  state: CardState;
  homeLabel: string;
  awayLabel: string;
  homeShort?: string | null;
  awayShort?: string | null;
  kickoffIso: string;
  venue?: string | null;
  roundLabel: string; // "Group E" / "Round of 16" / …
  ftHome?: number | null;
  ftAway?: number | null;
  minute?: number | null;
  statusDetail?: string | null;
  advancerLabel?: string | null; // resolved team label that advanced (knockout)
}

export function FixtureHeader({ d }: { d: FixtureHeaderData }) {
  const scored = SCORED.includes(d.state);
  const live = d.state === "live";
  const advSuffix =
    d.statusDetail === "PEN" ? " on penalties" : d.statusDetail === "AET" ? " after extra time" : "";

  return (
    <div className="mb-4 rounded-card border border-border bg-surface p-4 shadow-[0_2px_8px_rgba(15,23,42,.04)]">
      <div className="flex items-start justify-between gap-3">
        <TeamCol label={d.homeLabel} short={d.homeShort} />
        <div className="flex shrink-0 items-center pt-3.5">
          {scored ? (
            <span className="font-mono text-[26px] font-bold leading-none tabular">
              {d.ftHome ?? 0}
              <span className="px-1.5 text-muted">–</span>
              {d.ftAway ?? 0}
            </span>
          ) : (
            <span className="text-[13px] font-semibold text-muted">vs</span>
          )}
        </div>
        <TeamCol label={d.awayLabel} short={d.awayShort} />
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-center gap-x-1.5 gap-y-1 text-center text-[12px] text-muted">
        {live && (
          <span className="inline-flex items-center gap-1.5 rounded-pill bg-[#FFECEC] px-2 py-0.5 font-semibold text-live dark:bg-[#ff3b301f]">
            <span className="h-1.5 w-1.5 rounded-full bg-live cf-live-dot" />
            {liveLabel(d.statusDetail ?? null, d.minute ?? null)}
          </span>
        )}
        <span>{d.roundLabel}</span>
        <span aria-hidden>·</span>
        <LocalTime iso={d.kickoffIso} />
        {d.venue ? (
          <>
            <span aria-hidden>·</span>
            <span>{d.venue}</span>
          </>
        ) : null}
      </div>

      {d.advancerLabel && (
        <div className="mt-2 text-center text-[12px] font-semibold text-primary-press">
          {d.advancerLabel} advance{advSuffix}
        </div>
      )}
    </div>
  );
}

function TeamCol({ label, short }: { label: string; short?: string | null }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col items-center gap-2">
      <Avatar label={short || label} size={46} />
      <span className="line-clamp-2 text-center text-[13px] font-bold leading-tight">{label}</span>
    </div>
  );
}
