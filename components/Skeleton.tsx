// Shimmer skeleton block. Tailwind's animate-pulse + token bg.
export function Sk({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-control bg-subtle ${className}`} />;
}

// A skeleton MatchCard (matches the real card's footprint to avoid layout shift).
export function MatchCardSkeleton() {
  return (
    <div className="rounded-card border border-border bg-surface p-4">
      <div className="mb-3 flex items-center justify-between">
        <Sk className="h-3 w-40" />
        <Sk className="h-5 w-14 rounded-pill" />
      </div>
      <div className="flex flex-col gap-2.5">
        <div className="flex items-center gap-2.5"><Sk className="h-7 w-7 rounded-full" /><Sk className="h-4 w-32" /></div>
        <div className="flex items-center gap-2.5"><Sk className="h-7 w-7 rounded-full" /><Sk className="h-4 w-28" /></div>
      </div>
      <Sk className="mt-3 h-4 w-24" />
    </div>
  );
}
