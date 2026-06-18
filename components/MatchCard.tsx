import Link from "next/link";
import { type CardState, ROUND_LABEL } from "@/lib/contest-state";
import { LocalTime, Countdown } from "./LocalTime";
import { StatusBadge, Avatar, inr } from "./ui";
import { LinkPending } from "./LinkPending";

export interface CardData {
  contestId: string;
  slug: string;
  state: CardState;
  round: string;
  isKnockout: boolean;
  homeLabel: string;
  awayLabel: string;
  homeShort?: string | null;
  awayShort?: string | null;
  kickoffIso: string;
  lockIso: string;
  stake: number;
  ftHome?: number | null;
  ftAway?: number | null;
  minute?: number | null;
  advancerSide?: "home" | "away" | null;
  my?: { outcome: "home" | "draw" | "away"; predHome: number; predAway: number } | null;
  myNet?: number | null;
}

const OUTCOME_WORD = { home: "Home", draw: "Draw", away: "Away" } as const;
const showScore = (s: CardState) =>
  ["live", "settling", "won", "lost", "push", "notentered"].includes(s);

function TeamRow({ label, short, score, won }: { label: string; short?: string | null; score?: number | null; won?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <Avatar label={short || label} size={26} />
      <span className={`text-[15px] ${won ? "font-bold" : "font-semibold"}`}>{label}</span>
      {score != null && (
        <span className="ml-auto font-mono text-lg font-bold tabular">{score}</span>
      )}
    </div>
  );
}

export function MatchCard({ d }: { d: CardData }) {
  const roundTxt = d.round === "group" ? "Group" : ROUND_LABEL[d.round] ?? d.round;
  const scored = showScore(d.state);
  const homeWon = d.advancerSide === "home" || (scored && (d.ftHome ?? 0) > (d.ftAway ?? 0));
  const awayWon = d.advancerSide === "away" || (scored && (d.ftAway ?? 0) > (d.ftHome ?? 0));

  return (
    <Link
      href={`/leagues/${d.slug}/m/${d.contestId}`}
      className="relative block rounded-card border border-border bg-surface p-4 shadow-[0_2px_8px_rgba(15,23,42,.04)] transition-transform active:scale-[.99]"
    >
      <LinkPending />
      <div className="mb-2.5 flex items-center justify-between">
        <span className="text-[11px] text-muted">
          {roundTxt} · <LocalTime iso={d.kickoffIso} />
        </span>
        <StatusBadge state={d.state} />
      </div>

      <div className="flex flex-col gap-2">
        <TeamRow label={d.homeLabel} short={d.homeShort} score={scored ? d.ftHome : null} won={homeWon} />
        <TeamRow label={d.awayLabel} short={d.awayShort} score={scored ? d.ftAway : null} won={awayWon} />
      </div>

      {/* state-specific footer */}
      <div className="mt-3 text-[12px]">{footer(d)}</div>
    </Link>
  );
}

function footer(d: CardData) {
  const pick = d.my ? `${OUTCOME_WORD[d.my.outcome]} · ${d.my.predHome}–${d.my.predAway}` : null;
  switch (d.state) {
    case "open_nopick":
      return (
        <div className="flex items-center justify-between">
          <span className="rounded-pill bg-amber-bg px-2.5 py-1 font-mono font-semibold text-amber-fg">
            <Countdown iso={d.lockIso} />
          </span>
          <span className="font-semibold text-primary-press">Make pick →</span>
        </div>
      );
    case "open_picked":
      return (
        <div className="flex items-center justify-between">
          <span className="font-semibold text-fg">Your pick: <span className="font-mono">{pick}</span></span>
          <span className="font-semibold text-primary-press">Edit →</span>
        </div>
      );
    case "tbd":
      return <span className="text-muted">Teams TBD — opens once the bracket is set</span>;
    case "locked":
      return (
        <div className="flex items-center justify-between text-muted">
          <span className="font-mono"><Countdown iso={d.kickoffIso} prefix="Kicks off in" /></span>
          <span>Locked · picks revealed</span>
        </div>
      );
    case "live":
      return <span className="font-semibold text-live">● Live{d.minute ? ` · ${d.minute}'` : ""}</span>;
    case "settling":
      return <span className="text-muted">Full time · settling…</span>;
    case "won":
      return <span className="font-mono font-bold text-win">{inr(d.myNet ?? 0)}</span>;
    case "lost":
      return <span className="font-mono font-bold text-loss">{inr(d.myNet ?? 0)}</span>;
    case "push":
      return <span className="font-semibold text-push">Push · no money</span>;
    case "notentered":
      return <span className="text-muted">You sat this one out</span>;
    case "void":
      return <span className="text-push">Void — not enough players entered</span>;
    case "cancelled":
      return <span className="text-[#B91C1C]">Match cancelled — no contest</span>;
  }
}
