import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { type CardState } from "@/lib/contest-state";
import { PredictionForm } from "@/components/PredictionForm";
import { RevealGrid, type RevealRow } from "@/components/RevealGrid";
import { StatusBadge } from "@/components/ui";
import { voidPresentation, type VoidReason } from "@/lib/contest-copy";
import type { ReactNode } from "react";
import { FixtureHeader } from "@/components/FixtureHeader";
import { WinProbBar } from "@/components/WinProbBar";
import { MatchInsights } from "@/components/MatchInsights";
import { MatchTabs } from "./MatchTabs";
import { WhatIf } from "@/components/WhatIf";
import { buildBoard } from "@/lib/match-board";
import { AutoRefresh } from "@/components/AutoRefresh";
import { BackLink } from "@/components/BackLink";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { pollScores } from "@/lib/espn";
import { refreshInsights, type InsightsView } from "@/lib/espn-insights";
import { loadLegacyMatchPage } from "@/lib/legacy-match-load";
import { after } from "next/server";

const EMPTY_INSIGHTS: InsightsView = {
  oddsAvailable: false, provider: null, ml: null, probs: null, totalLine: null, pOver: null,
  topScores: [], btts: null, cleanSheet: { home: null, away: null }, formHome: [], formAway: [],
  h2h: null, standings: null,
};

export default async function MatchPage({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  // Freshen live scores from ESPN AFTER the response is sent (non-blocking).
  after(async () => { try { await pollScores(createServiceRoleClient()); } catch {} });
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) notFound();

  const loaded = await loadLegacyMatchPage(
    supabase,
    createServiceRoleClient(),
    user.id,
    id,
    { allowInsightWrites: true },
  );
  if (!loaded) notFound();
  const {
    c,
    f,
    homeShort,
    awayShort,
    highlightTeamIds,
    mine,
    myRes,
    revealed,
    state,
    isOpen,
    roundTxt,
    roundLabel,
    advancerLabel,
    otherLeagues,
    prefillFrom,
    insightsView,
    insightWarm,
    rows,
    players,
  } = loaded;
  if (insightWarm) {
    const { fixtureId, externalId, espnSlug } = insightWarm;
    after(async () => {
      try {
        await refreshInsights(createServiceRoleClient(), {
          id: fixtureId,
          external_id: externalId,
          espn_slug: espnSlug,
        });
      } catch {}
    });
  }

  const predictForm = (
    <PredictionForm
      contestId={c.id} slug={slug} isKnockout={c.is_knockout}
      homeLabel={f.home_label} awayLabel={f.away_label} homeShort={homeShort} awayShort={awayShort}
      lockIso={c.lock_at} stake={c.stake_inr}
      initial={mine ? { outcome: mine.outcome, predHome: mine.pred_home, predAway: mine.pred_away } : null}
      otherLeagues={otherLeagues} prefillFrom={prefillFrom}
      insights={insightsView?.oddsAvailable
        ? { oddsAvailable: true, topScores: insightsView.topScores, totalLine: insightsView.totalLine, pOver: insightsView.pOver }
        : null}
    />
  );

  // ── Live / locked / settled board + "What if" tabs (plan 2026-06-23-002) ───────────────────────
  // Only for revealed contests the viewer actually entered (`!!mine`). Non-entrants keep the plain
  // reveal grid below; open_*/tbd/void/cancelled are handled by their own branches.
  const entered = !!mine;
  const LIVE_TAB_STATES = new Set<CardState>(["locked", "live", "settling", "won", "lost", "push"]);
  const showLiveTabs = revealed && entered && LIVE_TAB_STATES.has(state);

  const hShort = homeShort || f.home_label;
  const aShort = awayShort || f.away_label;
  const isLivePhase = state === "live" || state === "settling";
  const liveScore = f.ft_home != null && f.ft_away != null ? { home: f.ft_home, away: f.ft_away } : null;
  // Provisional board: only with a usable score AND ≥2 entrants (the 10s RLS skew can briefly hide others).
  const liveVm =
    isLivePhase && liveScore && players.length >= 2
      ? buildBoard(players, liveScore, { isKnockout: c.is_knockout, stake: c.stake_inr, homeShort: hShort, awayShort: aShort })
      : null;

  const settledHeadline =
    state === "won" || state === "lost" || state === "push" ? (
      <div className="mb-3 text-center text-xl font-extrabold"
           style={{ color: state === "won" ? "var(--color-win)" : state === "lost" ? "var(--color-loss)" : "var(--color-push)" }}>
        {state === "won" ? <>You win <span className="font-mono">₹{Math.abs(myRes?.net_inr ?? 0).toLocaleString("en-IN")}</span></>
          : state === "lost" ? <>You lose <span className="font-mono">₹{Math.abs(myRes?.net_inr ?? 0).toLocaleString("en-IN")}</span></>
          : "No winner · nothing owed"}
      </div>
    ) : null;

  const boardRowsFromVm = (vm: NonNullable<typeof liveVm>): RevealRow[] =>
    vm.rows.map((p) => ({
      userId: p.id, name: p.name, isMe: p.isMe, pickLabel: p.pickLabel,
      predHome: p.predHome, predAway: p.predAway, result: p.result, net: p.net, winner: p.net > 0,
    }));

  let boardPanel: ReactNode = null;
  if (state === "won" || state === "lost" || state === "push") {
    boardPanel = (<>{settledHeadline}<RevealGrid rows={rows} settled /></>);
  } else if (isLivePhase && liveVm) {
    boardPanel = (
      <div className="flex flex-col gap-3">
        <div className="flex items-start gap-2.5 rounded-control border border-[#f1dd9e] bg-amber-bg p-3 dark:border-[#5b4d1f]">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-amber-fg animate-live-pulse" />
          <div className="text-[12px] leading-snug text-amber-fg">
            {state === "settling"
              ? <><strong>Full time — settling now.</strong> Final standings appear in a moment.</>
              : <><strong>Provisional — based on the live {liveScore!.home}–{liveScore!.away} (regulation).</strong> Winnings settle at full time and move with every goal.</>}
          </div>
        </div>
        <RevealGrid rows={boardRowsFromVm(liveVm)} settled />
        <div className="text-center text-[11.5px] text-muted">
          <span className="font-mono font-bold text-fg">₹{liveVm.pot.toLocaleString("en-IN")}</span> in the pot · <span className="font-bold text-win">{liveVm.ahead} ahead</span> · <span className="font-bold text-loss">{liveVm.behind} behind</span>
        </div>
      </div>
    );
  } else {
    // locked, or live/settling without a usable score yet → picks only, no nets
    boardPanel = (
      <div className="flex flex-col gap-3">
        <div className="text-[12px] text-muted">
          {state === "locked" ? "Picks are locked — standings appear once the match kicks off." : "Standings appear shortly."}
        </div>
        <RevealGrid rows={rows} settled={false} />
      </div>
    );
  }

  const baseline =
    isLivePhase && liveVm?.you
      ? { score: liveScore!, youNet: liveVm.you.net, label: "live" as const }
      : state === "won" || state === "lost" || state === "push"
        ? {
            score: { home: f.ft_home ?? 0, away: f.ft_away ?? 0 },
            youNet: myRes?.net_inr ?? 0,
            label: "final" as const,
            advancerOverride: c.is_knockout ? (f.advancer_team_id === f.home_team_id ? ("home" as const) : ("away" as const)) : undefined,
          }
        : null;

  const liveTabLabel = isLivePhase ? (state === "settling" ? "Result" : "Live winnings") : state === "locked" ? "Standings" : "Results";

  return (
    <main className="min-h-screen bg-bg">
      {(state === "live" || state === "settling") && <AutoRefresh seconds={20} />}
      <header className="flex items-center gap-2.5 border-b border-border bg-surface px-4 py-3">
        <BackLink href={`/leagues/${slug}`} />
        <span className="text-[15px] font-bold">{roundTxt}</span>
        <span className="ml-auto"><StatusBadge state={state} voidReason={c.void_reason as VoidReason} /></span>
      </header>

      <div className="mx-auto max-w-[480px] px-4 py-4">
        <FixtureHeader
          d={{
            state, homeLabel: f.home_label, awayLabel: f.away_label, homeShort, awayShort,
            kickoffIso: f.kickoff_at, venue: f.venue, roundLabel,
            ftHome: f.ft_home, ftAway: f.ft_away, minute: f.minute, statusDetail: f.status_detail,
            advancerLabel,
          }}
        />

        {isOpen ? (
          <MatchTabs
            labels={["Predict", "Full insight"]}
            firstTabCta={<>Form · H2H · group table <span className="text-primary">→</span></>}
            panels={[
              <div className="flex flex-col gap-3">
                {insightsView?.oddsAvailable && insightsView.probs && (
                  <WinProbBar
                    probs={insightsView.probs}
                    homeShort={homeShort || f.home_label}
                    awayShort={awayShort || f.away_label}
                  />
                )}
                {predictForm}
              </div>,
              <MatchInsights
                d={insightsView ?? EMPTY_INSIGHTS}
                home={{ label: f.home_label, short: homeShort || f.home_label }}
                away={{ label: f.away_label, short: awayShort || f.away_label }}
                groupLabel={f.round === "group" ? f.group_label : null}
                highlightTeamIds={highlightTeamIds}
              />,
            ]}
          />
        ) : state === "tbd" ? (
          <div className="rounded-card border border-dashed border-[#CBD5E1] p-8 text-center text-[13px] text-muted dark:border-[#2f3a48]">
            Teams to be decided — this contest opens once the bracket is set.
          </div>
        ) : state === "void" ? (() => {
          const vp = voidPresentation(c.void_reason as VoidReason);
          // Enrich only when every revealed pick is byte-identical (we already have all picks in `rows`);
          // a no_separation void can also be a mirror-tie (e.g. 2–0 vs 0–2 at 1–1), so don't over-claim.
          const picked = rows.filter((r) => r.pickLabel !== "—");
          const identical =
            vp.showReveal && picked.length > 1 &&
            new Set(picked.map((r) => `${r.pickLabel}-${r.predHome}-${r.predAway}`)).size === 1;
          const title = identical
            ? `All square — everyone called it ${picked[0].predHome}–${picked[0].predAway}`
            : vp.title;
          return (
            <div className="flex flex-col gap-3">
              <div className="rounded-card border border-border bg-surface p-5 text-center">
                <div className="text-base font-extrabold text-push">{title}</div>
                <div className="mt-1 text-[13px] text-muted">{vp.blurb}</div>
              </div>
              {vp.showReveal && <RevealGrid rows={rows} settled />}
            </div>
          );
        })() : state === "cancelled" ? (
          <div className="rounded-card border border-border bg-surface p-6 text-center text-[13px] text-[#B91C1C] dark:text-[#fca5a5]">Match cancelled — no contest.</div>
        ) : showLiveTabs ? (
          <>
            <div className="mb-3 text-center text-[11px] text-muted">
              {roundLabel} · <span className="font-mono">₹{c.stake_inr}</span> stake · {players.length} player{players.length === 1 ? "" : "s"}
            </div>
            <MatchTabs
              labels={[liveTabLabel, "What if"]}
              panels={[
                boardPanel,
                <WhatIf
                  players={players}
                  stake={c.stake_inr}
                  isKnockout={c.is_knockout}
                  homeShort={hShort}
                  awayShort={aShort}
                  baseline={baseline}
                />,
              ]}
            />
          </>
        ) : (
          <RevealGrid rows={rows} settled={["won", "lost", "push", "notentered"].includes(state)} />
        )}
      </div>
    </main>
  );
}
