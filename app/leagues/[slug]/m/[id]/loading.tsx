import { Sk } from "@/components/Skeleton";

export default function LoadingMatch() {
  return (
    <main className="min-h-screen bg-bg">
      <header className="flex items-center gap-2.5 border-b border-border bg-surface px-4 py-3">
        <span className="text-lg text-muted">‹</span>
        <Sk className="h-5 w-28" />
      </header>
      <div className="mx-auto max-w-[480px] px-4 py-4">
        <div className="mb-4 rounded-card border border-border bg-surface p-4">
          <Sk className="mb-3 h-3 w-48" />
          <div className="flex items-center gap-2.5 py-1"><Sk className="h-7 w-7 rounded-full" /><Sk className="h-4 w-36" /></div>
          <div className="flex items-center gap-2.5 py-1"><Sk className="h-7 w-7 rounded-full" /><Sk className="h-4 w-28" /></div>
        </div>
        <Sk className="h-56 w-full rounded-card" />
      </div>
    </main>
  );
}
