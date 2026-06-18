import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { deriveCardState, ROUND_LABEL, liveLabel, type ContestStatus, type FixtureStatus, type ResultKind } from "@/lib/contest-state";
import { PredictionForm } from "@/components/PredictionForm";
import { RevealGrid, type RevealRow } from "@/components/RevealGrid";
import { StatusBadge, Avatar } from "@/components/ui";
import { LocalTime } from "@/components/LocalTime";
import { AutoRefresh } from "@/components/AutoRefresh";
import { BackLink } from "@/components/BackLink";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { pollScores } from "@/lib/espn";

export default async function MatchPage({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  // Freshen live scores from ESPN on load (guard inside skips if nothing live).
  try { await pollScores(createServiceRoleClient()); } catch {}
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const { data: c } = await supabase.from("contests")
    .select("id, league_id, status, lock_at, stake_inr, is_knockout, fixtures(round, home_label, away_label, home_team_id, away_team_id, kickoff_at, status, status_detail, ft_home, ft_away, minute, venue, advancer_team_id)")
    .eq("id", id).single();
  if (!c) notFound();
  const f = (Array.isArray(c.fixtures) ? c.fixtures[0] : c.fixtures) as any;

  const { data: teams } = await supabase.from("teams").select("id, short_name");
  const short = new Map((teams ?? []).map((t) => [t.id, t.short_name as string | null]));
  const homeShort = short.get(f.home_team_id) ?? null;
  const awayShort = short.get(f.away_team_id) ?? null;

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
  const scored = ["live", "settling", "won", "lost", "push", "notentered"].includes(state);
  const roundTxt = f.round === "group" ? "Group stage" : ROUND_LABEL[f.round] ?? f.round;

  // Build reveal rows (only meaningful once revealed; RLS returns others' picks then)
  let rows: RevealRow[] = [];
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
      // entered first, then sat-out
      .sort((a, b) => (a.pickLabel === "—" ? 1 : 0) - (b.pickLabel === "—" ? 1 : 0));
  }

  return (
    <main className="min-h-screen bg-bg">
      {(state === "live" || state === "settling") && <AutoRefresh seconds={20} />}
      <header className="flex items-center gap-2.5 border-b border-border bg-surface px-4 py-3">
        <BackLink href={`/leagues/${slug}`} />
        <span className="text-[15px] font-bold">{roundTxt}</span>
        <span className="ml-auto"><StatusBadge state={state} /></span>
      </header>

      <div className="mx-auto max-w-[480px] px-4 py-4">
        {/* Fixture header */}
        <div className="mb-4 rounded-card border border-border bg-surface p-4 shadow-[0_2px_8px_rgba(15,23,42,.04)]">
          <div className="mb-3 flex flex-wrap items-center gap-2 text-[12px] text-muted">
            {state === "live" && (
              <span className="inline-flex items-center gap-1.5 rounded-pill bg-[#FFECEC] px-2 py-0.5 font-semibold text-live">
                <span className="h-1.5 w-1.5 rounded-full bg-live animate-live-pulse" />
                {liveLabel(f.status_detail, f.minute)}
              </span>
            )}
            <LocalTime iso={f.kickoff_at} />
            {f.venue ? <span>· {f.venue}</span> : null}
          </div>
          {[{ label: f.home_label, sc: f.ft_home }, { label: f.away_label, sc: f.ft_away }].map((t, i) => (
            <div key={i} className="flex items-center gap-2.5 py-1">
              <Avatar label={(i === 0 ? homeShort : awayShort) || t.label} size={28} />
              <span className="text-[16px] font-semibold">{t.label}</span>
              {scored && <span className="ml-auto font-mono text-xl font-bold tabular">{t.sc ?? 0}</span>}
            </div>
          ))}
          {f.advancer_team_id && (
            <div className="mt-2 text-[12px] font-semibold text-primary-press">
              {f.advancer_team_id === f.home_team_id ? f.home_label : f.away_label} advance
              {f.status_detail === "PEN" ? " on penalties" : f.status_detail === "AET" ? " after extra time" : ""}
            </div>
          )}
        </div>

        {state === "open_nopick" || state === "open_picked" ? (
          <PredictionForm
            contestId={c.id} slug={slug} isKnockout={c.is_knockout}
            homeLabel={f.home_label} awayLabel={f.away_label} homeShort={homeShort} awayShort={awayShort}
            lockIso={c.lock_at} stake={c.stake_inr}
            initial={mine ? { outcome: mine.outcome, predHome: mine.pred_home, predAway: mine.pred_away } : null}
          />
        ) : state === "tbd" ? (
          <div className="rounded-card border border-dashed border-[#CBD5E1] p-8 text-center text-[13px] text-muted">
            Teams to be decided — this contest opens once the bracket is set.
          </div>
        ) : state === "void" ? (
          <div className="rounded-card border border-border bg-surface p-6 text-center text-[13px] text-push">Contest void — not enough players entered.</div>
        ) : state === "cancelled" ? (
          <div className="rounded-card border border-border bg-surface p-6 text-center text-[13px] text-[#B91C1C]">Match cancelled — no contest.</div>
        ) : (
          <>
            {(state === "won" || state === "lost" || state === "push") && (
              <div className="mb-3 text-center text-xl font-extrabold"
                   style={{ color: state === "won" ? "var(--color-win)" : state === "lost" ? "var(--color-loss)" : "var(--color-push)" }}>
                {state === "won" ? <>You win <span className="font-mono">₹{Math.abs(myRes?.net_inr ?? 0).toLocaleString("en-IN")}</span></>
                  : state === "lost" ? <>You lose <span className="font-mono">₹{Math.abs(myRes?.net_inr ?? 0).toLocaleString("en-IN")}</span></>
                  : "No winner · nothing owed"}
              </div>
            )}
            <RevealGrid rows={rows} settled={["won", "lost", "push", "notentered"].includes(state)} />
          </>
        )}
      </div>
    </main>
  );
}
