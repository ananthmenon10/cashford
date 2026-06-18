import { Sk, MatchCardSkeleton } from "@/components/Skeleton";

export default function LoadingLeague() {
  return (
    <main className="min-h-screen bg-bg">
      <header className="flex items-center gap-2.5 border-b border-border bg-surface px-4 py-3">
        <span className="text-lg text-muted">‹</span>
        <Sk className="h-5 w-32" />
      </header>
      <div className="mx-auto max-w-[480px] px-4 py-4">
        <Sk className="mb-4 h-[76px] w-full rounded-card" />
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
