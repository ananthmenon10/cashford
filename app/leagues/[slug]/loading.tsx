import { GW_TABS, GW_UI_COPY } from "@/lib/gw-copy";
import { BackLink } from "@/components/BackLink";
import { Sk, MatchCardSkeleton } from "@/components/Skeleton";

export default function LoadingLeague() {
  return (
    <main className="min-h-screen bg-cs2-canvas text-cs2-ink">
      <header className="border-b border-cs2-line-2 bg-cs2-paper">
        <div className="mx-auto flex max-w-[520px] items-center gap-3 px-4 py-3">
          <BackLink href="/" />
          <div className="min-w-0">
            <Sk className="h-5 w-32" />
            <Sk className="mt-1 h-3 w-24" />
          </div>
          <Sk className="ml-auto h-[30px] w-[30px] rounded-full" />
        </div>
        <nav className="mx-auto grid max-w-[520px] grid-cols-4 px-4" aria-label={GW_UI_COPY.leagueTabsAria}>
          {[GW_TABS.gameweek, GW_TABS.season, GW_TABS.dues, GW_TABS.table].map((label) => (
            <span key={label} className="border-b-2 border-transparent px-1 pb-2.5 pt-1 text-center text-[13px] font-bold text-cs2-ink-3">{label}</span>
          ))}
        </nav>
      </header>
      <div className="mx-auto max-w-[520px] px-4 py-4">
        <Sk className="mb-4 h-[76px] w-full rounded-cs2-lg" />
        <div className="mb-4 flex gap-5">
          <Sk className="h-5 w-20" /><Sk className="h-5 w-10" /><Sk className="h-5 w-12" /><Sk className="h-5 w-12" />
        </div>
        <div className="flex flex-col gap-3">
          <MatchCardSkeleton /><MatchCardSkeleton /><MatchCardSkeleton />
        </div>
      </div>
    </main>
  );
}
