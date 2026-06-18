import { Sk } from "@/components/Skeleton";

export default function LoadingHome() {
  return (
    <main className="min-h-screen bg-bg">
      <header className="flex items-center justify-between border-b border-border bg-surface px-5 py-3">
        <Sk className="h-6 w-28" />
        <Sk className="h-[30px] w-[30px] rounded-full" />
      </header>
      <div className="mx-auto max-w-[480px] px-5 py-5">
        <Sk className="mb-3.5 h-6 w-36" />
        <div className="flex flex-col gap-3">
          <Sk className="h-[88px] w-full rounded-card" />
          <Sk className="h-[88px] w-full rounded-card" />
        </div>
      </div>
    </main>
  );
}
