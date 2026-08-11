"use client";

// Step 8 — Analytics tab: structure A (sticky filter row + one aggregate feed, no sub-tabs),
// cross-comp B (per-season sections, live before archive), my-form A (scoped to one league at a
// time via the filter row, never a global blend). Supersedes components/AnalyticsTab.tsx, which
// stays in place unused (excluded from copy-scan governance already — see
// tests/phase3/copy-scan-manifest.json's _excludedNote).
import { useMemo, useState } from "react";
import { NetValue } from "@/components/analytics/NetValue";
import { MyFormTrend } from "@/components/analytics/MyFormTrend";
import { ANALYTICS_COPY } from "@/lib/analytics-copy";
import { useHomeTabsContext } from "@/components/HomeTabsContext";
import { AnalyticsModules } from "@/components/analytics/AnalyticsModules";
import type { AnalyticsFeedView } from "@/lib/analytics-feed-load";
import type { AnalyticsSection, AnalyticsMyForm, AnalyticsAllTimeStrip } from "@/lib/analytics-feed";

function SectionCard({ section }: { section: AnalyticsSection }) {
  const isArchive = section.kind === "archive";
  const throughLine =
    !isArchive && section.throughGameweek != null
      ? ANALYTICS_COPY.liveThrough(section.leagueLines.length, section.throughGameweek)
      : null;
  return (
    <section
      className={
        isArchive
          ? "rounded-cs2-lg border border-cs2-amber-line bg-cs2-amber-soft p-4"
          : "rounded-cs2-lg border border-cs2-line bg-cs2-paper p-4 dark:bg-white/[0.03]"
      }
    >
      <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide">
        <span className={isArchive ? "h-1.5 w-1.5 rounded-full bg-cs2-amber" : "h-1.5 w-1.5 rounded-full bg-cs2-green"} />
        <span className={isArchive ? "text-cs2-amber" : "text-cs2-green"}>
          {isArchive ? ANALYTICS_COPY.archiveKicker : ANALYTICS_COPY.liveKicker}
        </span>
      </div>
      <h3 className="mt-1 text-[15px] font-extrabold">{section.competitionName}</h3>
      {isArchive ? <p className="mt-0.5 text-[11px] text-cs2-ink-3">{ANALYTICS_COPY.archiveNote}</p> : null}
      {throughLine ? <p className="mt-0.5 text-[11px] text-cs2-ink-3">{throughLine}</p> : null}
      <div className="mt-3 flex flex-col gap-2">
        {section.leagueLines.map((line) => (
          <div key={line.leagueId} className="flex items-center justify-between text-[13px]">
            <span className="font-semibold">{line.leagueName}</span>
            <span className="font-mono font-bold">
              <NetValue net={line.net} />
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

function MyFormCard({ myForm }: { myForm: AnalyticsMyForm | null }) {
  if (!myForm) {
    return (
      <section className="rounded-cs2-lg border border-cs2-line bg-cs2-paper p-4 dark:bg-white/[0.03]">
        <h3 className="text-[15px] font-extrabold">{ANALYTICS_COPY.myFormTitle}</h3>
        <p className="mt-2 text-[13px] text-cs2-ink-3">{ANALYTICS_COPY.noFormHistory}</p>
      </section>
    );
  }
  const isArchive = myForm.kind === "archive";
  return (
    <section
      className={
        isArchive
          ? "rounded-cs2-lg border border-cs2-amber-line bg-cs2-amber-soft p-4"
          : "rounded-cs2-lg border border-cs2-green-line bg-cs2-green-soft p-4"
      }
    >
      <div className="flex items-center justify-between">
        <h3 className="text-[15px] font-extrabold">{ANALYTICS_COPY.myFormTitle}</h3>
        <span
          className={
            isArchive
              ? "rounded-cs2-sm bg-cs2-amber px-2 py-0.5 text-[10px] font-bold text-white"
              : "rounded-cs2-sm bg-cs2-green px-2 py-0.5 text-[10px] font-bold text-white"
          }
        >
          {isArchive ? ANALYTICS_COPY.archiveKicker : ANALYTICS_COPY.liveKicker}
        </span>
      </div>
      <p className="mt-0.5 text-[11px] text-cs2-ink-3">
        {ANALYTICS_COPY.myFormSub(myForm.leagueName, myForm.competitionName)}
      </p>
      <div className="mt-3 flex items-baseline gap-4">
        <div>
          <div className="font-mono text-[22px] font-extrabold">
            <NetValue net={myForm.net} />
          </div>
          <div className="text-[10px] font-semibold text-cs2-ink-3">{ANALYTICS_COPY.seasonNet}</div>
        </div>
        {myForm.record ? (
          <div>
            <div className="font-mono text-[15px] font-bold">{myForm.record}</div>
            <div className="text-[10px] font-semibold text-cs2-ink-3">{ANALYTICS_COPY.record}</div>
          </div>
        ) : null}
      </div>
      <MyFormTrend trend={myForm.trend} />
      <p className="mt-3 text-[11px] text-cs2-ink-3">{myForm.sampleNote}</p>
    </section>
  );
}

function AllTimeStripCard({ strip }: { strip: AnalyticsAllTimeStrip | null }) {
  if (!strip) {
    return (
      <div className="rounded-cs2-lg border border-cs2-line bg-cs2-paper p-4 dark:bg-white/[0.03]">
        <div className="text-[10px] font-bold uppercase tracking-wide text-cs2-ink-3">
          {ANALYTICS_COPY.allTimeNet}
        </div>
        <p className="mt-1 text-[13px] text-cs2-ink-3">{ANALYTICS_COPY.allTimeNoHistory}</p>
      </div>
    );
  }
  return (
    <div className="rounded-cs2-lg border border-cs2-line bg-cs2-paper p-4 dark:bg-white/[0.03]">
      <div className="flex items-baseline justify-between gap-3">
        <div className="text-[10px] font-bold uppercase tracking-wide text-cs2-ink-3">
          {ANALYTICS_COPY.allTimeNet}
        </div>
        <div className="font-mono text-[20px] font-extrabold">
          <NetValue net={strip.net} />
        </div>
      </div>
      <p className="mt-1 text-[11px] text-cs2-ink-3">
        {ANALYTICS_COPY.allTimeStrip(strip.leagueCount, strip.competitionCount, strip.settledRounds)}
      </p>
    </div>
  );
}

export function AnalyticsFeed({ feed }: { feed: AnalyticsFeedView }) {
  const { analyticsActivated } = useHomeTabsContext();
  const [selectedLeagueId, setSelectedLeagueId] = useState<string | null>(
    feed.leagueOptions[0]?.id ?? null,
  );
  const myForm = useMemo(
    () => (selectedLeagueId ? feed.myFormByLeague[selectedLeagueId] ?? null : null),
    [feed.myFormByLeague, selectedLeagueId],
  );

  if (feed.leagueOptions.length === 0) {
    return (
      <div className="rounded-cs2-lg border border-cs2-line bg-cs2-paper p-5 text-center text-[13px] text-cs2-ink-3 dark:bg-white/[0.03]">
        {ANALYTICS_COPY.noLeagues}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <AllTimeStripCard strip={feed.allTimeStrip} />

      <div className="sticky top-0 z-10 -mx-4 flex items-center gap-2 bg-cs2-canvas px-4 py-2">
        <label className="text-[11px] font-bold text-cs2-ink-3" htmlFor="analytics-league-filter">
          {ANALYTICS_COPY.filterLabel}
        </label>
        <select
          id="analytics-league-filter"
          className="rounded-cs2-sm border border-cs2-line bg-cs2-paper px-2.5 py-1.5 text-[12px] font-semibold dark:bg-white/[0.05]"
          value={selectedLeagueId ?? ""}
          onChange={(event) => setSelectedLeagueId(event.target.value)}
        >
          {feed.leagueOptions.map((option) => (
            <option key={option.id} value={option.id}>
              {option.name}
            </option>
          ))}
        </select>
      </div>

      <MyFormCard myForm={myForm} />

      <AnalyticsModules
        leagueId={myForm?.leagueId ?? null}
        competitionId={myForm?.competitionId ?? null}
        activated={analyticsActivated}
      />

      {feed.sections.length === 0 ? (
        <div className="rounded-cs2-lg border border-cs2-line bg-cs2-paper p-5 text-center text-[13px] text-cs2-ink-3 dark:bg-white/[0.03]">
          {ANALYTICS_COPY.noSections}
        </div>
      ) : (
        feed.sections.map((section) => <SectionCard key={section.competitionId} section={section} />)
      )}
    </div>
  );
}
