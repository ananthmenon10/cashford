import { LeagueCard } from "@/components/gw/LeagueCard";
import {
  buildHomeLeagueCard,
  type HomeLeagueCardInput,
} from "@/lib/gw-home";
import { LEAGUE_CARD_HARNESS_COPY } from "@/lib/gw-copy";

const REFERENCE_NOW = "2026-08-17T10:00:00.000Z";

const OPEN_DEADLINE = "2026-08-17T13:42:00.000Z";

const BASE_CARD: HomeLeagueCardInput = {
  leagueId: "harness-league",
  leagueName: LEAGUE_CARD_HARNESS_COPY.leagues.kkBois,
  slug: "harness-league",
  competitionName: LEAGUE_CARD_HARNESS_COPY.competitions.premierLeague,
  competitionSlug: "premier-league-2026-27",
  format: "gameweek",
  archived: false,
  lifecycle: "CL1",
  viewerParticipation: "VP1",
  gameweekNumber: 4,
  deadlineAt: OPEN_DEADLINE,
  upcomingAt: null,
  potInr: 900,
  enteredCount: 7,
  eligibleCount: 9,
  viewerRank: null,
  viewerNetInr: null,
  secondary: [],
  pendingPaymentCount: 0,
  netInr: 340,
  hasSettledHistory: false,
  memberCount: 9,
  archiveRank: null,
  liveMatchCount: 0,
};

function pinnedCard(overrides: Partial<HomeLeagueCardInput>) {
  return buildHomeLeagueCard({
    ...BASE_CARD,
    ...overrides,
    leagueId: overrides.leagueId ?? `harness-${overrides.leagueName ?? "league"}`,
  });
}

function stateCard(
  state: keyof typeof LEAGUE_CARD_HARNESS_COPY.states,
  overrides: Partial<HomeLeagueCardInput>,
) {
  return {
    label: LEAGUE_CARD_HARNESS_COPY.states[state],
    card: pinnedCard(overrides),
  };
}

function variantCard(
  variant: keyof typeof LEAGUE_CARD_HARNESS_COPY.variants,
  overrides: Partial<HomeLeagueCardInput>,
) {
  return {
    label: LEAGUE_CARD_HARNESS_COPY.variants[variant],
    card: pinnedCard(overrides),
  };
}

const CARDS = [
  stateCard("S1", {}),
  stateCard("S2", {
    leagueId: "harness-s2",
    viewerParticipation: "VP2",
    enteredCount: 8,
    viewerRank: 4,
  }),
  stateCard("S3", {
    leagueId: "harness-s3",
    lifecycle: "CL3",
    viewerParticipation: "VP4",
    gameweekNumber: 3,
    enteredCount: 8,
    viewerRank: 4,
    liveMatchCount: 3,
  }),
  stateCard("S4", {
    leagueId: "harness-s4",
    leagueName: LEAGUE_CARD_HARNESS_COPY.leagues.solidYenneBoys,
    lifecycle: "CL5",
    viewerParticipation: "VP4",
    gameweekNumber: 3,
    enteredCount: 9,
    viewerRank: 2,
    viewerNetInr: 450,
    netInr: 790,
    hasSettledHistory: true,
  }),
  stateCard("S5", {
    leagueId: "harness-s5",
    leagueName: LEAGUE_CARD_HARNESS_COPY.leagues.solidYenneBoys,
    lifecycle: "CL5",
    viewerParticipation: "VP4",
    gameweekNumber: 3,
    enteredCount: 9,
    viewerRank: 7,
    viewerNetInr: -100,
    netInr: 240,
    hasSettledHistory: true,
  }),
  stateCard("S6", {
    leagueId: "harness-s6",
    leagueName: LEAGUE_CARD_HARNESS_COPY.leagues.solidYenneBoys,
    secondary: [{ gameweekNumber: 3, kind: "settled", viewerRank: 2, viewerNetInr: 450, liveMatchCount: 0 }],
    netInr: 790,
    hasSettledHistory: true,
  }),
  stateCard("S7", {
    leagueId: "harness-s7",
    secondary: [{ gameweekNumber: 3, kind: "live", viewerRank: 4, viewerNetInr: null, liveMatchCount: 3 }],
  }),
  stateCard("S8", {
    leagueId: "harness-s8",
    pendingPaymentCount: 1,
  }),
  stateCard("S9", {
    leagueId: "harness-s9",
    competitionName: LEAGUE_CARD_HARNESS_COPY.competitions.worldCup,
    competitionSlug: "wc2026",
    format: "cup",
    archived: true,
    lifecycle: "CL0",
    viewerParticipation: "VP0",
    gameweekNumber: null,
    deadlineAt: null,
    potInr: 0,
    enteredCount: 0,
    eligibleCount: 9,
    viewerRank: null,
    viewerNetInr: null,
    netInr: 340,
    hasSettledHistory: true,
    memberCount: 9,
    archiveRank: 3,
  }),
  stateCard("S10", {
    leagueId: "harness-s10",
    leagueName: LEAGUE_CARD_HARNESS_COPY.leagues.solidYenneBoys,
    lifecycle: "CL0",
    viewerParticipation: "VP1",
    gameweekNumber: null,
    deadlineAt: null,
    upcomingAt: "2025-06-15T09:00:00.000Z",
    potInr: 0,
    enteredCount: 0,
    eligibleCount: 9,
    viewerRank: null,
    viewerNetInr: null,
    netInr: 0,
  }),
  variantCard("cl2Locked", {
    leagueId: "harness-cl2",
    lifecycle: "CL2",
    viewerParticipation: "VP4",
    liveMatchCount: 0,
  }),
  variantCard("cl3NoLive", {
    leagueId: "harness-cl3-gap",
    lifecycle: "CL3",
    viewerParticipation: "VP4",
    liveMatchCount: 0,
    viewerRank: 4,
  }),
  variantCard("cl4AwaitingSettlement", {
    leagueId: "harness-cl4",
    lifecycle: "CL4",
    viewerParticipation: "VP4",
    gameweekNumber: 3,
    viewerRank: 4,
    finalMatchCount: 10,
    totalMatchCount: 10,
  }),
  variantCard("cl7Void", {
    leagueId: "harness-cl7",
    lifecycle: "CL7",
    viewerParticipation: "VP4",
  }),
  variantCard("cl10AllVoid", {
    leagueId: "harness-cl10",
    lifecycle: "CL10",
    viewerParticipation: "VP4",
  }),
  variantCard("vp3ActionNeeded", {
    leagueId: "harness-vp3",
    lifecycle: "CL1",
    viewerParticipation: "VP3",
  }),
  variantCard("vp0Ineligible", {
    leagueId: "harness-vp0",
    lifecycle: "CL1",
    viewerParticipation: "VP0",
  }),
  variantCard("vp5Invalid", {
    leagueId: "harness-vp5",
    lifecycle: "CL1",
    viewerParticipation: "VP5",
  }),
  variantCard("duesOnLive", {
    leagueId: "harness-dues-live",
    lifecycle: "CL3",
    viewerParticipation: "VP4",
    viewerRank: 4,
    pendingPaymentCount: 1,
    liveMatchCount: 3,
  }),
  variantCard("breakEven", {
    leagueId: "harness-break-even",
    lifecycle: "CL5",
    viewerParticipation: "VP4",
    viewerRank: 4,
    viewerNetInr: 0,
    netInr: 340,
    hasSettledHistory: true,
  }),
  variantCard("satOut", {
    leagueId: "harness-sat-out",
    lifecycle: "CL5",
    viewerParticipation: "VP1",
    viewerRank: null,
    viewerNetInr: null,
    hasSettledHistory: true,
  }),
] as const;

export default function LeagueCardHarnessPage() {
  return (
    <main className="min-h-screen bg-cs2-canvas px-4 py-6 text-cs2-ink">
      <div className="mx-auto max-w-[560px] space-y-5">
        <header>
          <p className="text-[10px] font-extrabold uppercase tracking-[.12em] text-cs2-green">
            {LEAGUE_CARD_HARNESS_COPY.eyebrow}
          </p>
          <h1 className="mt-1 text-2xl font-extrabold tracking-[-.02em]">
            {LEAGUE_CARD_HARNESS_COPY.title}
          </h1>
          <p className="mt-1 text-[12px] text-cs2-ink-3">
            {LEAGUE_CARD_HARNESS_COPY.note}
          </p>
          <p className="mt-2 font-mono text-[10px] font-semibold text-cs2-ink-3">
            {LEAGUE_CARD_HARNESS_COPY.referenceNow}: {REFERENCE_NOW}
          </p>
        </header>

        <div className="space-y-3">
          {CARDS.map(({ label, card }) => (
            <section key={card.leagueId}>
              <h2 className="mb-1.5 font-mono text-[10px] font-bold text-cs2-ink-3">
                {label}
              </h2>
              <LeagueCard card={card} now={REFERENCE_NOW} />
            </section>
          ))}
        </div>
      </div>
    </main>
  );
}
