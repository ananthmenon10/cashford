import Image from "next/image";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { loadHomePage } from "@/lib/home-page-load";
import { GW_UI_COPY } from "@/lib/gw-copy";
import { logout } from "./actions";
import { ThemeToggle } from "@/components/ThemeToggle";
import { HomeTabs } from "@/components/HomeTabs";
import { AnalyticsFeed } from "@/components/AnalyticsFeed";
import { HomeHub } from "@/components/gw/HomeHub";
import { HomeMatchesTab } from "@/components/matches/HomeMatchesTab";
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

  const { homeLeagueCards, analyticsVisible, analyticsFeed } = await loadHomePage(
    supabase,
    admin,
    user!.id,
  );
  // ── Tab 1: Leagues ─────────────────────────────────────────────────────────────────
  const leaguesPanel = (
    <div className="px-5 py-5">
      <h1 className="mb-3.5 text-xl font-extrabold tracking-[-.01em]">
        {GW_UI_COPY.homeTitle}
      </h1>

      {homeLeagueCards.length === 0 ? (
        <div className="rounded-card border border-dashed border-[#CBD5E1] dark:border-[#2f3a48] p-6 text-center">
          <div className="text-[15px] font-bold">{GW_UI_COPY.noLeagues}</div>
          <div className="mt-1 text-[13px] text-muted">
            {GW_UI_COPY.noLeaguesBody}
          </div>
          <div className="mt-4 flex flex-col gap-2">
            <Link
              href="/leagues/new"
              className="inline-flex items-center justify-center gap-1 rounded-control bg-primary px-5 py-2.5 text-[13px] font-bold text-white shadow-[0_4px_12px_rgba(21,166,106,.3)]"
            >
              + {GW_UI_COPY.createLeague}
            </Link>
            <Link
              href="/leagues/join"
              className="inline-flex items-center justify-center gap-1 rounded-control border border-border bg-surface px-5 py-2.5 text-[13px] font-semibold text-primary-press"
            >
              {GW_UI_COPY.joinCode}
            </Link>
          </div>
        </div>
      ) : (
        <HomeHub cards={homeLeagueCards} />
      )}

      {homeLeagueCards.length > 0 && (
        <div className="mt-3 flex flex-col gap-2">
          <Link
            href="/leagues/new"
            className="flex items-center justify-center gap-1 rounded-control border border-border bg-surface py-2.5 text-[13px] font-semibold text-primary-press"
          >
            + {GW_UI_COPY.newLeague}
          </Link>
          <Link
            href="/leagues/join"
            className="flex items-center justify-center gap-1 rounded-control border border-border bg-surface py-2.5 text-[13px] font-semibold text-primary-press"
          >
            {GW_UI_COPY.joinCode}
          </Link>
        </div>
      )}

      <Link
        href="/rules"
        className="mt-5 flex items-center justify-between rounded-card border border-border bg-surface px-4 py-3.5 text-[14px] font-semibold shadow-[0_2px_8px_rgba(15,23,42,.04)] cf-press"
      >
        <span>📖 {GW_UI_COPY.rules}</span>
        <span className="text-muted">›</span>
      </Link>
    </div>
  );

  // ── Tab 3: Analytics ────────────────────────────────────────────────────────────────
  const analyticsProps = analyticsVisible
    ? {
        analytics: (
          <div className="px-4 py-4">
            <AnalyticsFeed feed={analyticsFeed} />
          </div>
        ),
      }
    : {};

  return (
    <main className="min-h-screen bg-bg">
      {/* TopBar */}
      <header className="flex items-center justify-between border-b border-border bg-surface px-5 py-3">
        <div className="flex items-center gap-2">
          <Image src="/icon-512.png" alt="" width={26} height={26} className="rounded-[7px]" />
          <span className="text-lg font-extrabold tracking-[-.02em]">
            {GW_UI_COPY.brandName}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span
            className="rounded-pill bg-subtle px-2 py-0.5 font-mono text-[10px] font-semibold text-muted"
            title={GW_UI_COPY.buildVersion}
          >
            v{APP_VERSION}
          </span>
          <ThemeToggle />
          <span className="flex h-[30px] w-[30px] items-center justify-center rounded-full bg-mint text-[11px] font-bold text-primary-press">
            {initials(username)}
          </span>
          <form action={logout}>
            <button className="text-xs font-bold text-muted">
              {GW_UI_COPY.signOut}
            </button>
          </form>
        </div>
      </header>

      <HomeTabs
        leagues={leaguesPanel}
        matches={
          <HomeMatchesTab />
        }
        matchesAlert={false}
        analyticsVisible={analyticsVisible}
        {...analyticsProps}
      />
    </main>
  );
}
