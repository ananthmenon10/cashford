import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { deriveCardState, ROUND_LABEL, type CardState, type ContestStatus, type FixtureStatus, type ResultKind } from "@/lib/contest-state";
import { PredictionForm } from "@/components/PredictionForm";
import { isEligible, RENDER_MARGIN_MS, type OtherLeague, type PickShape } from "@/lib/cross-league";
import { RevealGrid, type RevealRow } from "@/components/RevealGrid";
import { StatusBadge } from "@/components/ui";
import { voidPresentation, type VoidReason } from "@/lib/contest-copy";
import type { ReactNode } from "react";
import { FixtureHeader } from "@/components/FixtureHeader";
import { WinProbBar } from "@/components/WinProbBar";
import { MatchInsights } from "@/components/MatchInsights";
import { MatchTabs } from "./MatchTabs";
import { WhatIf } from "@/components/WhatIf";
import { buildBoard, type PlayerPick } from "@/lib/match-board";
import type { Outcome } from "@/lib/settlement";
import { AutoRefresh } from "@/components/AutoRefresh";
import { BackLink } from "@/components/BackLink";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { pollScores } from "@/lib/espn";
import { refreshInsights, mapInsightsView, INSIGHTS_WINDOW_MS, type InsightsView } from "@/lib/espn-insights";
import { after } from "next/server";

const EMPTY_INSIGHTS: InsightsView = {
  oddsAvailable: false, provider: null, ml: null, probs: null, totalLine: null, pOver: null,
  topScores: [], btts: null, cleanSheet: { home: null, away: null }, formHome: [], formAway: [],
  h2h: null, standings: null,
};

// Typed view of the joined fixture row (replaces a loose `as any`). The select string below
// determines these fields; keep them in sync.
interface FixtureRow {
  external_id: number | null; round: string; group_label: string | null;
  home_label: string; away_label: string; home_team_id: string | null; away_team_id: string | null;
  kickoff_at: string; status: string; status_detail: string | null;
  ft_home: number | null; ft_away: number | null; minute: number | null;
  venue: string | null; advancer_team_id: string | null;
}

export default async function MatchPage({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  // Freshen live scores from ESPN AFTER the response is sent (non-blocking).
  after(async () => { try { await pollScores(createServiceRoleClient()); } catch {} });
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const { data: c } = await supabase.from("contests")
    .select("id, league_id, fixture_id, status, void_reason, lock_at, stake_inr, is_knockout, fixtures(external_id, round, group_label, home_label, away_label, home_team_id, away_team_id, kickoff_at, status, status_detail, ft_home, ft_away, minute, venue, advancer_team_id, competitions(espn_slug))")
    .eq("id", id).single();
  if (!c) notFound();
  const f = (Array.isArray(c.fixtures) ? c.fixtures[0] : c.fixtures) as FixtureRow;

  const { data: teams } = await supabase.from("teams").select("id, short_name, external_id");
  const short = new Map((teams ?? []).map((t) => [t.id, t.short_name as string | null]));
  const extId = new Map((teams ?? []).map((t) => [t.id, t.external_id as number | null]));
  const homeShort = short.get(f.home_team_id ?? "") ?? null;
  const awayShort = short.get(f.away_team_id ?? "") ?? null;
  // ESPN team ids of the two sides — used to bold them in the group standings table.
  const highlightTeamIds = [f.home_team_id, f.away_team_id]
    .map((tid) => (tid ? extId.get(tid) : null))
    .filter((v): v is number => v != null)
    .map(String);

  const { data: mine } = await supabase.from("predictions")
    .select("outcome, pred_home, pred_away").eq("contest_id", id).eq("user_id", user!.id).maybeSingle();
  const { data: myRes } = await supabase.from("contest_results")
    .select("result, net_inr").eq("contest_id", id).eq("user_id", user!.id).maybeSingle();

  const now = Date.now();
  const revealed = c.status !== "open" || new Date(c.lock_at).getTime() <= now;
  const state = deriveCardState({
    contestStatus: c.status as ContestStatus, fixtureStatus: f.status as FixtureStatus,
    lockAtMs: new Date(c.lock_at).getTime(), nowMs: now, isKnockout: c.is_knockout,
    homeKnown: !!f.home_team_id, awayKnown: !!f.away_team_id, hasMyPrediction: !!mine,
    myResult: (myRes?.result ?? (mine ? null : "not_entered")) as ResultKind | null,
  });
  const isOpen = state === "open_nopick" || state === "open_picked";
  const roundTxt = f.round === "group" ? "Group stage" : ROUND_LABEL[f.round] ?? f.round;
  const roundLabel = f.round === "group" ? (f.group_label ? `Group ${f.group_label}` : "Group stage") : ROUND_LABEL[f.round] ?? f.round;
  const advancerLabel = f.advancer_team_id ? (f.advancer_team_id === f.home_team_id ? f.home_label : f.away_label) : null;

  // Cross-league duplication (plan 2026-06-19-001): only when the form renders.
  let otherLeagues: OtherLeague[] = [];
  let prefillFrom: (PickShape & { leagueName: string }) | null = null;
  // Match insights (plan 2026-06-20-003): only for open/pre-kickoff contests.
  let insightsView: InsightsView | null = null;
  if (isOpen) {
    const { data: siblings } = await supabase.from("contests")
      .select("id, status, lock_at, leagues(name)")
      .eq("fixture_id", c.fixture_id).neq("id", c.id);
    const sibIds = (siblings ?? []).map((s) => s.id);
    const { data: sibPreds } = sibIds.length
      ? await supabase.from("predictions")
          .select("contest_id, outcome, pred_home, pred_away, updated_at")
          .in("contest_id", sibIds).eq("user_id", user!.id)
      : { data: [] as { contest_id: string; outcome: string; pred_home: number; pred_away: number; updated_at: string }[] };
    const pickBy = new Map((sibPreds ?? []).map((p) => [p.contest_id, p]));
    const leagueName = (s: { leagues: unknown }) =>
      ((Array.isArray(s.leagues) ? s.leagues[0] : s.leagues) as { name?: string } | null)?.name ?? "League";
    otherLeagues = (siblings ?? []).map((s) => {
      const p = pickBy.get(s.id);
      return {
        contestId: s.id,
        leagueName: leagueName(s),
        eligible: isEligible(s.status, new Date(s.lock_at).getTime(), now, RENDER_MARGIN_MS),
        existingPick: p ? { outcome: p.outcome as PickShape["outcome"], predHome: p.pred_home, predAway: p.pred_away } : null,
      };
    });
    const latest = (sibPreds ?? []).slice().sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())[0];
    if (latest) {
      const src = (siblings ?? []).find((s) => s.id === latest.contest_id);
      prefillFrom = {
        leagueName: src ? leagueName(src) : "other league",
        outcome: latest.outcome as PickShape["outcome"], predHome: latest.pred_home, predAway: latest.pred_away,
      };
    }

    // Read cached insights; on a cold miss within the odds window, do a tight bounded fill so the
    // Predict tab's hero/chips aren't empty on first view. Cron + after() keep misses rare.
    const kickoffMs = new Date(f.kickoff_at).getTime();
    const inWindow = kickoffMs > now && kickoffMs - now <= INSIGHTS_WINDOW_MS;
    const { data: cachedRow } = await supabase.from("fixture_insights").select("*").eq("fixture_id", c.fixture_id).maybeSingle();
    let row: any = cachedRow;
    // No espn_slug means ESPN cannot see this competition at all — never guess one.
    const espnSlug: string | null = (f as any).competitions?.espn_slug ?? null;
    if (!row && inWindow && f.external_id && espnSlug) {
      try {
        const r = await refreshInsights(
          createServiceRoleClient(),
          { id: c.fixture_id, external_id: f.external_id, espn_slug: espnSlug },
          { ttlMs: 0, signal: AbortSignal.timeout(2000) },
        );
        row = r.row ?? null;
      } catch {}
    }
    insightsView = mapInsightsView(row);
    // Warm for the next view (TTL-guarded no-op when fresh).
    if (inWindow && f.external_id && espnSlug) {
      const fxId = c.fixture_id;
      const ext = f.external_id as number;
      const slug = espnSlug;
      after(async () => { try { await refreshInsights(createServiceRoleClient(), { id: fxId, external_id: ext, espn_slug: slug }); } catch {} });
    }
  }

  // Build reveal rows (only meaningful once revealed; RLS returns others' picks then)
  let rows: RevealRow[] = [];
  let players: PlayerPick[] = []; // entrants' picks for the live/what-if board (revealed only)
  if (revealed) {
    const { data: memberRows } = await supabase.from("league_members").select("user_id").eq("league_id", c.league_id);
    const memberIds = (memberRows ?? []).map((m) => m.user_id);
    const [{ data: preds }, { data: results }, { data: profiles }] = await Promise.all([
      supabase.from("predictions").select("user_id, outcome, pred_home, pred_away").eq("contest_id", id),
      supabase.from("contest_results").select("user_id, result, net_inr").eq("contest_id", id),
      supabase.from("profiles").select("id, display_name, username").in("id", memberIds),
    ]);
    const predBy = new Map((preds ?? []).map((p) => [p.user_id, p]));
    const resBy = new Map((results ?? []).map((r) => [r.user_id, r]));
    // Entrants' picks for the live/what-if board. Opaque ids only (never ship the auth UUID for
    // other players); sourced from the RLS-scoped client, so this is non-empty only post-lock.
    const nameById = new Map((profiles ?? []).map((pr) => [pr.id, pr.display_name || pr.username]));
    // Opaque ids (never ship auth UUIDs) — but assigned in REAL user_id sort order so settle()'s
    // ₹1-remainder distribution (keyed on the id string sort) reproduces the stored settlement
    // exactly. The viewer is flagged via isMe, not the id. (Padded so "p10" sorts after "p02".)
    players = (preds ?? [])
      .slice()
      .sort((x, y) => (x.user_id < y.user_id ? -1 : 1))
      .map((p, i) => ({
        id: `p${String(i).padStart(2, "0")}`,
        name: nameById.get(p.user_id) ?? "Player",
        isMe: p.user_id === user!.id,
        outcome: p.outcome as Outcome,
        predHome: p.pred_home,
        predAway: p.pred_away,
      }));
    const pickLabel = (o: string) => (o === "home" ? homeShort || "Home" : o === "away" ? awayShort || "Away" : "Draw");
    rows = (profiles ?? [])
      .map((pr) => {
        const p = predBy.get(pr.id);
        const r = resBy.get(pr.id);
        if (!p) return { userId: pr.id, name: pr.display_name || pr.username, isMe: pr.id === user!.id, pickLabel: "—", predHome: 0, predAway: 0, result: "not_entered" as const };
        return {
          userId: pr.id, name: pr.display_name || pr.username, isMe: pr.id === user!.id,
          pickLabel: pickLabel(p.outcome), predHome: p.pred_home, predAway: p.pred_away,
          result: (r?.result ?? null) as RevealRow["result"], net: r?.net_inr ?? null,
          winner: r?.result === "win",
        };
      })
      .sort((a, b) => (a.pickLabel === "—" ? 1 : 0) - (b.pickLabel === "—" ? 1 : 0));
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
