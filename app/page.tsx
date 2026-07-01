import Image from "next/image";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { loadMatchesView } from "@/lib/home-matches";
import { loadAnalyticsView } from "@/lib/home-analytics";
import { logout } from "./actions";
import { LinkPending } from "@/components/LinkPending";
import { LocalTime } from "@/components/LocalTime";
import { ThemeToggle } from "@/components/ThemeToggle";
import { HomeTabs } from "@/components/HomeTabs";
import { MatchesTab } from "@/components/MatchesTab";
import { AnalyticsTab } from "@/components/AnalyticsTab";
import { CountUp } from "@/components/motion";
import { APP_VERSION } from "@/lib/version";

function initials(name: string) {
  const clean = name.replace(/[^A-Za-z]/g, "");
  return (clean.slice(0, 2) || "??").toUpperCase();
}

export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const admin = createServiceRoleClient();

  const username =
    (user?.user_metadata?.username as string | undefined) ??
    user?.email?.split("@")[0] ??
    "you";

  const [{ data: leagues }, { data: members }, { data: myResults }, { data: openContests }, matchesView, analyticsView] = await Promise.all([
    supabase.from("leagues").select("id, name, slug, status").order("name"),
    supabase.from("league_members").select("league_id"),
    supabase.from("contest_results").select("net_inr, contests!inner(league_id)").eq("user_id", user!.id),
    supabase.from("contests")
      .select("id, league_id, lock_at, fixtures(home_label, away_label, kickoff_at)")
      .eq("status", "open").order("lock_at", { ascending: true }),
    loadMatchesView(supabase, admin, user!.id),
    loadAnalyticsView(supabase, user!.id),
  ]);

  // Next fixture still open for prediction in each league (earliest lock that hasn't passed),
  // even if already predicted. Excludes locked/live/done — those aren't status "open".
  const now = Date.now();
  const nextByLeague = new Map<string, { contestId: string; home: string; away: string; kickoffIso: string }>();
  for (const c of openContests ?? []) {
    if (new Date(c.lock_at).getTime() <= now) continue;        // lock passed (cron lag) → not open
    if (nextByLeague.has(c.league_id)) continue;               // keep earliest (ordered by lock asc)
    const f = (Array.isArray(c.fixtures) ? c.fixtures[0] : c.fixtures) as { home_label: string; away_label: string; kickoff_at: string } | null;
    if (!f) continue;
    nextByLeague.set(c.league_id, { contestId: c.id, home: f.home_label, away: f.away_label, kickoffIso: f.kickoff_at });
  }

  // Has the viewer already predicted that next fixture? If so, show the pick + "Edit" instead of "Predict".
  const nextIds = [...nextByLeague.values()].map((n) => n.contestId);
  const { data: nextPreds } = nextIds.length
    ? await supabase.from("predictions").select("contest_id, outcome, pred_home, pred_away").eq("user_id", user!.id).in("contest_id", nextIds)
    : { data: [] as { contest_id: string; outcome: "home" | "draw" | "away"; pred_home: number; pred_away: number }[] };
  const myPickByContest = new Map((nextPreds ?? []).map((p) => [p.contest_id, p]));

  const counts = new Map<string, number>();
  for (const m of members ?? []) {
    counts.set(m.league_id, (counts.get(m.league_id) ?? 0) + 1);
  }

  // Net per league (scoped via the contest→league join), so each card shows the
  // right standing — not a global total.
  const netByLeague = new Map<string, number>();
  for (const r of myResults ?? []) {
    const lid = (Array.isArray(r.contests) ? r.contests[0] : r.contests)?.league_id;
    if (lid) netByLeague.set(lid, (netByLeague.get(lid) ?? 0) + (r.net_inr ?? 0));
  }

  const matchesAlert = matchesView.live.length > 0 || matchesView.picksDue != null;

  // ── Tab 1: Leagues (unchanged from the previous home) ──────────────────────────────
  const leaguesPanel = (
    <div className="px-5 py-5">
      <h1 className="mb-3.5 text-xl font-extrabold tracking-[-.01em]">Your leagues</h1>

      {(leagues ?? []).length === 0 ? (
        <div className="rounded-card border border-dashed border-[#CBD5E1] dark:border-[#2f3a48] p-6 text-center">
          <div className="text-[15px] font-bold">No leagues yet</div>
          <div className="mt-1 text-[13px] text-muted">
            Start your own or wait for an invite from your captain.
          </div>
          <div className="mt-4 flex flex-col gap-2">
            <Link
              href="/leagues/new"
              className="inline-flex items-center justify-center gap-1 rounded-control bg-primary px-5 py-2.5 text-[13px] font-bold text-white shadow-[0_4px_12px_rgba(21,166,106,.3)]"
            >
              + Create a league
            </Link>
            <Link
              href="/leagues/join"
              className="inline-flex items-center justify-center gap-1 rounded-control border border-border bg-surface px-5 py-2.5 text-[13px] font-semibold text-primary-press"
            >
              Join with a code
            </Link>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {(leagues ?? []).map((lg) => {
            const next = nextByLeague.get(lg.id);
            const myPick = next ? myPickByContest.get(next.contestId) : undefined;
            const pickLabel = next && myPick
              ? `${myPick.outcome === "home" ? next.home : myPick.outcome === "away" ? next.away : "Draw"} ${myPick.pred_home}–${myPick.pred_away}`
              : null;
            return (
              <div
                key={lg.id}
                className="relative overflow-hidden rounded-card border border-border bg-surface shadow-[0_2px_8px_rgba(15,23,42,.04)] cf-press"
              >
                <Link href={`/leagues/${lg.slug}`} className="relative block p-4">
                  <LinkPending />
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex items-center gap-1.5 text-base font-bold">
                        {lg.name}
                        {lg.status === "archived" && (
                          <span className="rounded-pill bg-subtle px-2 py-0.5 text-[10px] font-semibold text-muted">
                            Archived
                          </span>
                        )}
                      </div>
                      <div className="mt-0.5 text-xs text-muted">
                        {counts.get(lg.id) ?? 0} members
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-[11px] text-muted">Your net</div>
                      <div className={`font-mono text-xl font-bold tabular ${(netByLeague.get(lg.id) ?? 0) > 0 ? "text-win" : (netByLeague.get(lg.id) ?? 0) < 0 ? "text-loss" : "text-muted"}`}>
                        <CountUp value={netByLeague.get(lg.id) ?? 0} kind="inr" />
                      </div>
                    </div>
                  </div>
                </Link>
                {next && (
                  <Link
                    href={`/leagues/${lg.slug}/m/${next.contestId}`}
                    className="flex items-center justify-between gap-2 border-t border-border px-4 py-2.5 text-[12px] active:bg-subtle"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate">
                        <span className="text-muted">Next · </span>
                        <span className="font-semibold">{next.home} v {next.away}</span>
                      </div>
                      <div className="mt-0.5 truncate text-muted">
                        {pickLabel
                          ? <>Your Pick <span className="font-semibold text-fg">{pickLabel}</span></>
                          : <LocalTime iso={next.kickoffIso} />}
                      </div>
                    </div>
                    <span className="shrink-0 font-semibold text-primary-press">{pickLabel ? "Edit →" : "Predict →"}</span>
                  </Link>
                )}
              </div>
            );
          })}
        </div>
      )}

      {(leagues ?? []).length > 0 && (
        <div className="mt-3 flex flex-col gap-2">
          <Link
            href="/leagues/new"
            className="flex items-center justify-center gap-1 rounded-control border border-border bg-surface py-2.5 text-[13px] font-semibold text-primary-press"
          >
            + New league
          </Link>
          <Link
            href="/leagues/join"
            className="flex items-center justify-center gap-1 rounded-control border border-border bg-surface py-2.5 text-[13px] font-semibold text-primary-press"
          >
            Join with a code
          </Link>
        </div>
      )}

      <Link
        href="/rules"
        className="mt-5 flex items-center justify-between rounded-card border border-border bg-surface px-4 py-3.5 text-[14px] font-semibold shadow-[0_2px_8px_rgba(15,23,42,.04)] cf-press"
      >
        <span>📖 How scoring &amp; tiebreakers work</span>
        <span className="text-muted">›</span>
      </Link>
    </div>
  );

  // ── Tab 3: Analytics ────────────────────────────────────────────────────────────────
  const analyticsPanel = (
    <div className="px-4 py-4">
      <AnalyticsTab view={analyticsView} />
    </div>
  );

  return (
    <main className="min-h-screen bg-bg">
      {/* TopBar */}
      <header className="flex items-center justify-between border-b border-border bg-surface px-5 py-3">
        <div className="flex items-center gap-2">
          <Image src="/icon-512.png" alt="" width={26} height={26} className="rounded-[7px]" />
          <span className="text-lg font-extrabold tracking-[-.02em]">Cashford</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="rounded-pill bg-subtle px-2 py-0.5 font-mono text-[10px] font-semibold text-muted" title="Build version">
            v{APP_VERSION}
          </span>
          <ThemeToggle />
          <span className="flex h-[30px] w-[30px] items-center justify-center rounded-full bg-mint text-[11px] font-bold text-primary-press">
            {initials(username)}
          </span>
          <form action={logout}>
            <button className="text-xs font-bold text-muted">Sign out</button>
          </form>
        </div>
      </header>

      <HomeTabs
        leagues={leaguesPanel}
        matches={<div className="px-4 py-4"><MatchesTab view={matchesView} /></div>}
        analytics={analyticsPanel}
        matchesAlert={matchesAlert}
        bracketHref="/bracket"
        bracketNew
      />
    </main>
  );
}
