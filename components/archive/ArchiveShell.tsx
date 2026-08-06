import Link from "next/link";
import { BackLink } from "@/components/BackLink";
import { Avatar } from "@/components/ui";
import { ARCHIVE_COPY } from "@/lib/payment-copy";
import { PHASE5_UI_COPY } from "@/lib/payment-copy";
import { moneyCopy, ordinalCopy } from "@/lib/gw-copy";
import type { WcArchiveBalance, WcLiveCompetition } from "@/lib/wc-archive-load";

function signClass(sign: "positive" | "negative" | "zero"): string {
  if (sign === "positive") return "text-cs2-green";
  if (sign === "negative") return "text-cs2-red";
  return "text-cs2-ink";
}

const tabs = [
  [PHASE5_UI_COPY.analytics, ""],
  [PHASE5_UI_COPY.matches, "/matches"],
  [PHASE5_UI_COPY.bracket, "/bracket"],
] as const;

function LockGlyph() {
  return (
    <svg width="10" height="14" viewBox="0 0 10 14" aria-hidden="true" className="mt-px shrink-0">
      <path
        d="M1.7 5.3V3.1a3.3 3.3 0 0 1 6.6 0v2.2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
      />
      <rect x="0.7" y="5.3" width="8.6" height="7.4" rx="1.4" fill="none" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

export async function ArchiveShell({
  slug,
  leagueName,
  viewerName,
  balance,
  active,
  snapshot,
  liveCompetition,
  children,
}: {
  slug: string;
  leagueName: string;
  viewerName: string;
  balance?: WcArchiveBalance;
  active: "analytics" | "matches" | "bracket";
  snapshot?: { matchesSettled: number; finish: number | null; netInr: number | null };
  liveCompetition?: WcLiveCompetition | null;
  children: React.ReactNode;
}) {
  const openLive = liveCompetition ? ARCHIVE_COPY.openLive(liveCompetition.name) : null;
  return (
    <main className="min-h-screen bg-cs2-canvas text-cs2-ink">
      <header className="border-b border-cs2-line-2 bg-cs2-paper">
        <div className="mx-auto flex max-w-[520px] items-center gap-3 px-4 py-3">
          <BackLink href="/" />
          <h1 className="min-w-0 flex-1 truncate text-[17px] font-extrabold leading-[1.1] tracking-[-0.02em]">
            {leagueName}
          </h1>
          <Avatar label={viewerName} size={30} />
        </div>
        <nav
          className="mx-auto grid max-w-[520px] grid-cols-3 px-4"
          aria-label={PHASE5_UI_COPY.worldCup}
        >
          {tabs.map(([label, suffix], index) => {
            const key = ["analytics", "matches", "bracket"][index] as typeof active;
            const href = `/leagues/${slug}/archive/wc2026${suffix}`;
            return (
              <Link
                key={label}
                href={href}
                aria-current={active === key ? "page" : undefined}
                className={`border-b-2 px-1 pb-2.5 pt-1 text-center text-[13px] font-bold ${active === key ? "border-cs2-green text-cs2-ink" : "border-transparent text-cs2-ink-3"}`}
              >
                {label}
              </Link>
            );
          })}
        </nav>
      </header>
      <div className="mx-auto max-w-[520px] px-4 pb-10">
        <section
          className="mt-4 rounded-cs2-md border border-cs2-amber-line bg-cs2-amber-soft p-3.5"
          aria-label={ARCHIVE_COPY.archiveBannerLabel(PHASE5_UI_COPY.worldCup)}
        >
          <div className="flex items-center justify-between gap-2.5">
            <div className="flex items-center gap-[7px] text-[10px] font-extrabold tracking-[0.1em] text-cs2-amber">
              <LockGlyph />
              <span>{ARCHIVE_COPY.archiveMark}</span>
            </div>
            <span className="rounded-pill border border-cs2-amber-line px-[7px] pt-[5px] pb-[4px] text-[9px] font-extrabold leading-none tracking-[0.08em] text-cs2-amber">
              {ARCHIVE_COPY.badge}
            </span>
          </div>
          <div className="mt-[13px] text-[20px] font-extrabold leading-[1.02] tracking-[-0.035em]">
            {PHASE5_UI_COPY.worldCup}
          </div>
          <p className="mb-3.5 mt-[7px] text-[12px] font-semibold leading-[1.42] text-cs2-ink-2">
            {ARCHIVE_COPY.notice}
          </p>
          {openLive ? (
            <Link
              href={liveCompetition!.href}
              className="flex w-full items-center justify-between rounded-cs2-sm border border-cs2-green-line bg-cs2-paper px-[11px] py-[10px] text-left text-[12px] font-extrabold leading-[1.1] text-cs2-green"
            >
              <span>{openLive.label}</span>
              <span aria-hidden="true" className="pl-2 font-mono text-[14px] font-medium">
                {openLive.arrow}
              </span>
            </Link>
          ) : null}
        </section>

        {balance ? (
          <div className="mt-3 flex items-center justify-between gap-2.5 border-b border-cs2-line pb-[13px] text-[12px] font-semibold text-cs2-ink-2">
            <span>
              {balance.prefix}
              {balance.amount ? (
                <strong className={`font-mono text-[14px] font-bold tracking-[-0.04em] ${signClass(balance.sign)}`}>
                  {balance.amount}
                </strong>
              ) : null}
            </span>
            <span className="whitespace-nowrap text-[10px] font-semibold text-cs2-ink-3">
              {ARCHIVE_COPY.leagueBalance}
            </span>
          </div>
        ) : null}

        {snapshot ? (
          <section
            className="mt-4 rounded-cs2-md border border-cs2-line bg-cs2-paper p-3.5"
            aria-label={ARCHIVE_COPY.snapshotTitle}
          >
            <div className="flex items-baseline justify-between gap-2.5">
              <h2 className="text-[14px] font-extrabold tracking-[-0.01em]">
                {ARCHIVE_COPY.snapshotTitle}
              </h2>
              <span className="whitespace-nowrap text-[10px] font-semibold text-cs2-ink-3">
                {PHASE5_UI_COPY.worldCup}
              </span>
            </div>
            <div className="mt-3.5 grid grid-cols-3 gap-3 border-t border-cs2-line-2 pt-3">
              <div className="min-w-0">
                <div className="text-[10px] font-semibold leading-[1.2] text-cs2-ink-3">
                  {ARCHIVE_COPY.matchesSettled}
                </div>
                <div className="mt-1 font-mono text-[15px] font-bold leading-none tracking-[-0.04em]">
                  {snapshot.matchesSettled}
                </div>
              </div>
              <div className="min-w-0">
                <div className="text-[10px] font-semibold leading-[1.2] text-cs2-ink-3">
                  {ARCHIVE_COPY.yourFinish}
                </div>
                <div className="mt-1 font-mono text-[15px] font-bold leading-none tracking-[-0.04em]">
                  {snapshot.finish == null ? "—" : ordinalCopy(snapshot.finish)}
                </div>
              </div>
              <div className="min-w-0">
                <div className="text-[10px] font-semibold leading-[1.2] text-cs2-ink-3">
                  {ARCHIVE_COPY.yourNet}
                </div>
                <div
                  className={`mt-1 font-mono text-[15px] font-bold leading-none tracking-[-0.04em] ${
                    snapshot.netInr == null
                      ? ""
                      : signClass(snapshot.netInr > 0 ? "positive" : snapshot.netInr < 0 ? "negative" : "zero")
                  }`}
                >
                  {snapshot.netInr == null ? "—" : moneyCopy(snapshot.netInr)}
                </div>
              </div>
            </div>
          </section>
        ) : null}

        {children}
      </div>
    </main>
  );
}
