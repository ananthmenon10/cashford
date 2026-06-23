import Link from "next/link";
import { type CardState, ROUND_LABEL, liveLabel } from "@/lib/contest-state";
import { LocalTime, Countdown } from "./LocalTime";
import { StatusBadge, Avatar } from "./ui";
import { LinkPending } from "./LinkPending";

export interface RevealMini {
  userId: string;
  name: string;
  isMe: boolean;
  pickLabel: string; // "BRA" / "Draw" / "ARG"
  predHome: number;
  predAway: number;
}

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
  statusDetail?: string | null;
  advancerSide?: "home" | "away" | null;
  my?: { outcome: "home" | "draw" | "away"; predHome: number; predAway: number } | null;
  myNet?: number | null;
  joined?: number;
  members?: number;
  provisionalNet?: number | null;
  reveal?: RevealMini[]; // members' picks shown inside a locked card
}

const OUTCOME_WORD = { home: "Home", draw: "Draw", away: "Away" } as const;
const showScore = (s: CardState) =>
  ["live", "settling", "won", "lost", "push", "notentered"].includes(s);

// Win brag — one phrase per game, picked by hashing the contest id so it's varied across
// matches but stable across the league page's 30s auto-refresh (no flicker on a settled card).
const WON_PHRASES = [
  "You nailed it", "Called it", "Easy money", "Spot on", "Too easy", "Bang on", "Cash collected",
  "Textbook", "Clinical", "Crystal ball", "In the bag", "Pure class", "Knew it", "Cha-ching",
];
function wonPhrase(seed: string) {
  let h = 0;
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return WON_PHRASES[h % WON_PHRASES.length];
}

// Card container varies for the celebratory / dimmed states (per design S6/S10/S11).
const CONTAINER: Partial<Record<CardState, string>> = {
  won: "border-[1.5px] border-[#16A34A] bg-[#F0FDF4] dark:bg-[#16a34a1a] shadow-[0_4px_16px_-4px_rgba(22,163,74,.25)]",
  void: "border border-border bg-[#FBFCFD] dark:bg-surface opacity-[.85] shadow-[0_2px_8px_rgba(15,23,42,.04)]",
  cancelled: "border border-border bg-[#FBFCFD] dark:bg-surface opacity-[.85] shadow-[0_2px_8px_rgba(15,23,42,.04)]",
};
const DEFAULT_BOX = "border border-border bg-surface shadow-[0_2px_8px_rgba(15,23,42,.04)]";

function TeamRow({ label, short, score, won, strike }: { label: string; short?: string | null; score?: number | null; won?: boolean; strike?: boolean }) {
  return (
    <div className={`flex items-center gap-2.5 ${strike ? "opacity-70" : ""}`}>
      <Avatar label={short || label} size={26} />
      <span className={`text-[15px] ${won ? "font-bold" : "font-semibold"} ${strike ? "text-muted line-through" : ""}`}>{label}</span>
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
  const strike = d.state === "cancelled";
  const showJoined =
    d.members != null && d.members > 0 && d.joined != null && !["tbd", "cancelled", "void"].includes(d.state);

  return (
    <Link
      href={`/leagues/${d.slug}/m/${d.contestId}`}
      className={`relative block rounded-card p-4 cf-press ${CONTAINER[d.state] ?? DEFAULT_BOX}`}
    >
      <LinkPending />
      <div className="mb-2.5 flex items-center justify-between">
        <span className="text-[11px] text-muted">
          {roundTxt} · <LocalTime iso={d.kickoffIso} />
          {showJoined && <> · <span className="font-semibold text-label">{d.joined}/{d.members} joined</span></>}
        </span>
        <StatusBadge state={d.state} />
      </div>

      <div className="flex flex-col gap-2">
        <TeamRow label={d.homeLabel} short={d.homeShort} score={scored ? d.ftHome : null} won={homeWon} strike={strike} />
        <TeamRow label={d.awayLabel} short={d.awayShort} score={scored ? d.ftAway : null} won={awayWon} strike={strike} />
      </div>

      {/* state-specific footer */}
      <div className="mt-3 text-[12px]">{footer(d)}</div>
    </Link>
  );
}

function footer(d: CardData) {
  const pick = d.my ? `${OUTCOME_WORD[d.my.outcome]} · ${d.my.predHome}–${d.my.predAway}` : null;
  // Short pick echo: "BRA 2–0" / "Draw 1–1".
  const pickShort = d.my
    ? `${d.my.outcome === "home" ? d.homeShort || "Home" : d.my.outcome === "away" ? d.awayShort || "Away" : "Draw"} ${d.my.predHome}–${d.my.predAway}`
    : null;
  const money = (n: number) => `₹${Math.abs(n).toLocaleString("en-IN")}`;

  switch (d.state) {
    case "open_nopick":
      return (
        <div>
          <div className="flex items-center justify-between">
            <span className="rounded-pill bg-amber-bg px-2.5 py-1 font-mono font-semibold text-amber-fg">
              <Countdown iso={d.lockIso} />
            </span>
            <span className="text-muted">Stake ₹{d.stake.toLocaleString("en-IN")}</span>
          </div>
          <span className="mt-3 block w-full rounded-control bg-primary py-3 text-center text-[15px] font-bold text-white shadow-[0_2px_8px_rgba(21,166,106,.3)]">
            Make pick
          </span>
        </div>
      );
    case "open_picked":
      return (
        <div>
          <div className="font-semibold text-fg">Your pick: <span className="font-mono">{pick}</span></div>
          <div className="mt-2.5 flex items-center justify-between">
            <span className="rounded-pill bg-amber-bg px-2.5 py-1 font-mono font-semibold text-amber-fg">
              <Countdown iso={d.lockIso} />
            </span>
            <span className="rounded-control border border-border bg-surface px-4 py-2 font-bold text-fg">Edit pick</span>
          </div>
        </div>
      );
    case "tbd":
      return <span className="text-muted">Teams TBD — opens once the bracket is set</span>;
    case "locked": {
      const reveal = d.reveal ?? [];
      return (
        <div>
          <div className="flex items-center justify-between text-muted">
            <span className="font-mono"><Countdown iso={d.kickoffIso} prefix="Kicks off in" /></span>
            <span>Locked</span>
          </div>
          {reveal.length > 0 && (
            <div className="mt-2.5 border-t border-border pt-2.5">
              <div className="mb-1.5 text-[10px] font-bold tracking-[.05em] text-muted">
                PICKS REVEALED · {reveal.length} IN
              </div>
              <div className="flex flex-col">
                {reveal.map((r) => (
                  <div key={r.userId} className="flex items-center gap-2 py-1">
                    <Avatar label={r.name} size={22} />
                    <span className={`flex-1 truncate text-[13px] ${r.isMe ? "font-bold" : "font-semibold"}`}>{r.name}</span>
                    <span className={`rounded-pill px-2 py-0.5 text-[10px] font-bold ${r.isMe ? "bg-mint text-primary-press" : "bg-subtle text-label"}`}>{r.pickLabel}</span>
                    <span className="w-9 text-center font-mono text-[12px] font-bold tabular">{r.predHome}–{r.predAway}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      );
    }
    case "live": {
      const pn = d.provisionalNet;
      const track =
        pn == null ? null
        : pn > 0 ? <span className="font-semibold text-win">on track to win +{money(pn)}</span>
        : pn < 0 ? <span className="font-semibold text-loss">on track to lose {money(pn)}</span>
        : <span className="text-push">level right now</span>;
      return (
        <div className="flex items-center justify-between gap-2">
          <span className="shrink-0 font-semibold text-live">● {liveLabel(d.statusDetail, d.minute)}</span>
          {pickShort && (
            <span className="truncate text-right text-muted">
              Your pick <span className="font-semibold text-fg">{pickShort}</span>
              {track && <> · {track}</>}
            </span>
          )}
        </div>
      );
    }
    case "settling":
      return <span className="text-muted">Full time · settling…</span>;
    case "won":
      return (
        <div className="flex items-center justify-between rounded-control bg-[#16A34A] px-3.5 py-3 text-white">
          <span className="text-[13px] font-bold">{wonPhrase(d.contestId)}{pickShort ? ` · ${pickShort}` : ""}</span>
          <span className="font-mono text-[18px] font-bold">+{money(d.myNet ?? 0)}</span>
        </div>
      );
    case "lost":
      return (
        <div className="flex items-center justify-between rounded-control bg-[#FEF2F2] px-3.5 py-3 dark:bg-[#ef44441f]">
          <span className="text-[13px] font-semibold text-[#991B1B] dark:text-[#fca5a5]">{pickShort ? `Your pick ${pickShort}` : "You lose"}</span>
          <span className="font-mono text-[18px] font-bold text-loss">−{money(d.myNet ?? 0)}</span>
        </div>
      );
    case "push":
      return (
        <div className="flex items-center justify-between rounded-control bg-subtle px-3.5 py-3">
          <span className="text-[13px] font-semibold text-label">Push · no winner</span>
          <span className="font-mono text-[14px] font-bold text-push">nothing owed</span>
        </div>
      );
    case "notentered":
      return (
        <div className="flex items-center gap-2 rounded-control bg-subtle px-3.5 py-3">
          <span className="text-[13px] font-semibold text-label">You sat this out</span>
          {d.joined != null && d.joined > 0 && (
            <span className="ml-auto text-[12px] text-muted">{d.joined} {d.joined === 1 ? "other played" : "others played"}</span>
          )}
        </div>
      );
    case "void":
      return (
        <div className="rounded-control bg-subtle px-3.5 py-3 text-center text-[13px] font-semibold text-muted">
          Voided — not enough players entered · stakes returned
        </div>
      );
    case "cancelled":
      return (
        <div className="rounded-control bg-[#FEE2E2] px-3.5 py-3 text-center text-[13px] font-semibold text-[#B91C1C] dark:bg-[#ef44441f] dark:text-[#fca5a5]">
          Match cancelled · all picks voided
        </div>
      );
  }
}
