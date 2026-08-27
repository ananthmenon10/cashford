"use client";

// Home hub controls: competition scope chips + GW navigator (Option A · segmented strip) + the
// league-card detail stack for the selected scope. Scope switching is local state — it never
// reloads the page, and the same scope drives the whole hub.
//
// The navigator's chevrons are real links to the league screen for that gameweek;
// jumping to ANY gameweek opens a sheet (round-2 fix: replaces a sr-only <select>
// that full-page-reloaded via window.location.href). The matches hub itself is
// step 6B's rebuild, not this pass's job.

import { useMemo, useState } from "react";
import Link from "next/link";
import { Countdown } from "@/components/LocalTime";
import { GW_BADGE_COPY, HOME_HUB_COPY } from "@/lib/gw-copy";
import { useBottomSheet } from "@/lib/use-bottom-sheet";
import {
  homeCardsForScope,
  homeCompetitionScopes,
  homeScopeChipsVisible,
  gwNavigatorTargets,
  type GwNavigatorTarget,
  type HomeLeagueCard,
} from "@/lib/gw-home";
import { LeagueCard } from "@/components/gw/LeagueCard";

/**
 * Builds the navigator pill's state segment ("GW4 · OPEN") from the entry-status key mapping.
 */
function entryStatusBadgeLabel(status: NonNullable<HomeLeagueCard["entryStatus"]>): string {
  switch (status.key) {
    case "notEnteredOpen":
      return GW_BADGE_COPY.open;
    case "enteredOpen":
      return GW_BADGE_COPY.entered;
    case "submittedLocked":
      // Frame's multi-competition variant (reference ~:7291) labels a submitted, locked-not-live
      // row "Submitted" rather than "Locked" — see implementation-notes.md Step 6A Deviations for
      // the judgment call on the cited example actually depicting an open (not locked) row.
      return GW_BADGE_COPY.submitted;
    case "live":
      return GW_BADGE_COPY.live;
    case "won":
    case "lost":
    case "brokeEven":
      return GW_BADGE_COPY.settled;
    case "void":
      return GW_BADGE_COPY.void;
    default:
      return GW_BADGE_COPY.recalculating;
  }
}

/** The "jump to any gameweek" sheet — reuses the focus-trap/scroll-lock behavior extracted from
 * GameweekStrip's all-gameweeks sheet (lib/use-bottom-sheet.ts) rather than a second hand-rolled
 * copy. Content here is intentionally narrower than GameweekStrip's (just number + isCurrent) —
 * the home hub only has gwNavigatorTargets' shape available, not the richer per-gameweek facts
 * (outcome, winner, deadline) that the league screen's sheet shows. */
function JumpToGameweekSheet({
  targets,
  gwHref,
}: {
  targets: readonly GwNavigatorTarget[];
  gwHref: (n: number) => string;
}) {
  const { open, setOpen, close, dialogRef, triggerRef } = useBottomSheet();
  if (targets.length <= 1) return null;

  return (
    <>
      <button
        type="button"
        ref={triggerRef}
        onClick={() => setOpen(true)}
        aria-expanded={open}
        aria-controls="home-hub-gameweeks-dialog"
        aria-label={HOME_HUB_COPY.jumpToGameweek}
        className="flex h-8 shrink-0 items-center gap-1 rounded-cs2-sm border border-cs2-line px-1.5 text-[10px] font-bold text-cs2-ink-2 cf-press"
      >
        <span aria-hidden>⌄</span>
      </button>

      {open ? (
        <div className="fixed inset-0 z-30 flex items-end bg-black/30" role="presentation" onClick={close}>
          <section
            id="home-hub-gameweeks-dialog"
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="home-hub-gameweeks-title"
            tabIndex={-1}
            className="mx-auto max-h-[82vh] w-full max-w-[520px] overflow-y-auto rounded-t-cs2-lg bg-cs2-paper px-4 pb-6 pt-3 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mx-auto h-1 w-10 rounded-full bg-cs2-line" />
            <div className="mt-1 flex items-end justify-between gap-3">
              <h2 id="home-hub-gameweeks-title" className="text-[21px] font-extrabold">
                {HOME_HUB_COPY.jumpToGameweek}
              </h2>
              <button type="button" onClick={close} className="rounded-pill px-2 py-1 text-[12px] font-bold text-cs2-ink-3">
                ×
              </button>
            </div>
            <div className="mt-4 divide-y divide-cs2-line-2 rounded-cs2-md border border-cs2-line">
              {targets.map((target) => (
                <Link
                  key={target.gameweekNumber}
                  href={gwHref(target.gameweekNumber)}
                  onClick={close}
                  className={`flex items-center justify-between gap-3 px-3 py-3 ${target.isCurrent ? "bg-cs2-green-soft" : "hover:bg-cs2-canvas"}`}
                >
                  <span className="text-[13px] font-bold">
                    {HOME_HUB_COPY.gameweekOption(target.gameweekNumber, target.isCurrent)}
                  </span>
                </Link>
              ))}
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}

function GwNavigator({ card, now }: { card: HomeLeagueCard; now?: string | number }) {
  const targets = useMemo(
    () => gwNavigatorTargets(card.allGameweekNumbers, card.gameweekNumber),
    [card.allGameweekNumbers, card.gameweekNumber],
  );
  if (card.gameweekNumber == null || targets.length === 0) return null;
  const currentIndex = targets.findIndex((t) => t.isCurrent);
  const prev = currentIndex > 0 ? targets[currentIndex - 1] : null;
  const next = currentIndex >= 0 && currentIndex < targets.length - 1 ? targets[currentIndex + 1] : null;
  const gwHref = (n: number) => `/leagues/${card.slug}?gw=${n}#league-gw-${n}-matches`;
  const stateWord = card.entryStatus ? entryStatusBadgeLabel(card.entryStatus) : null;

  return (
    <nav
      aria-label={HOME_HUB_COPY.gwNavigatorAria}
      className="flex flex-col gap-1.5 rounded-cs2-lg border border-cs2-line bg-cs2-paper px-2 py-2"
    >
      <div className="flex items-center gap-2">
        {prev ? (
          <Link
            href={gwHref(prev.gameweekNumber)}
            aria-label={HOME_HUB_COPY.previousGameweek}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-cs2-sm border border-cs2-line text-[13px] font-bold text-cs2-ink-2 cf-press"
          >
            ‹
          </Link>
        ) : (
          <button
            type="button"
            disabled
            aria-label={HOME_HUB_COPY.previousGameweek}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-cs2-sm border border-cs2-line-2 text-[13px] font-bold text-cs2-ink-3 opacity-40"
          >
            ‹
          </button>
        )}

        <div className="flex min-w-0 flex-1 flex-col items-center gap-0.5">
          <span className="text-[13px] font-extrabold leading-none text-cs2-ink">
            {stateWord ? HOME_HUB_COPY.gameweekStateLabel(card.gameweekNumber, stateWord) : HOME_HUB_COPY.gameweekLabel(card.gameweekNumber)}
          </span>
          {card.primary.deadlineAt && card.primary.countdown ? (
            <span className="font-mono text-[9px] font-semibold text-cs2-amber">
              <Countdown iso={card.primary.deadlineAt} prefix={HOME_HUB_COPY.closesInPrefix} now={now} />
            </span>
          ) : null}
        </div>

        {next ? (
          <Link
            href={gwHref(next.gameweekNumber)}
            aria-label={HOME_HUB_COPY.nextGameweek}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-cs2-sm border border-cs2-line text-[13px] font-bold text-cs2-ink-2 cf-press"
          >
            ›
          </Link>
        ) : (
          <button
            type="button"
            disabled
            aria-label={HOME_HUB_COPY.nextGameweek}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-cs2-sm border border-cs2-line-2 text-[13px] font-bold text-cs2-ink-3 opacity-40"
          >
            ›
          </button>
        )}

        <JumpToGameweekSheet targets={targets} gwHref={gwHref} />
      </div>

      {prev || next ? (
        <div className="flex items-center justify-between px-1 text-[10px] font-semibold text-cs2-ink-3">
          {prev ? (
            <Link href={gwHref(prev.gameweekNumber)} className="cf-press">
              {HOME_HUB_COPY.navAnywherePrevious(prev.gameweekNumber)}
            </Link>
          ) : (
            <span />
          )}
          {next ? (
            <Link href={gwHref(next.gameweekNumber)} className="cf-press">
              {HOME_HUB_COPY.navAnywhereNext(next.gameweekNumber)}
            </Link>
          ) : (
            <span />
          )}
        </div>
      ) : null}
    </nav>
  );
}

export function HomeHub({ cards, now }: { cards: readonly HomeLeagueCard[]; now?: string | number }) {
  const scopes = useMemo(() => homeCompetitionScopes(cards), [cards]);
  const showChips = homeScopeChipsVisible(cards);
  const [selectedScope, setSelectedScope] = useState<string | null>(scopes[0]?.competitionSlug ?? null);

  const scoped = useMemo(
    () => homeCardsForScope(cards, showChips ? selectedScope : null),
    [cards, selectedScope, showChips],
  );
  // navigatorCard is the first scoped card with a gameweek — the frame assumes exactly one GW
  // per competition, so "first" is a deviation, not a guaranteed-correct pick when a league's
  // gameweek position genuinely diverges from its competition-mates (logged under Step 6A
  // Deviations).
  const navigatorCard = scoped.find((c) => c.format === "gameweek" && c.gameweekNumber != null) ?? null;

  if (cards.length === 0) return null;

  return (
    <div className="mb-3 flex flex-col gap-2.5">
      {showChips ? (
        <>
          <div role="tablist" aria-label={HOME_HUB_COPY.competitionScopeAria} className="flex flex-wrap gap-1.5">
            {scopes.map((scope) => (
              <button
                key={scope.competitionSlug}
                type="button"
                role="tab"
                aria-selected={selectedScope === scope.competitionSlug}
                onClick={() => setSelectedScope(scope.competitionSlug)}
                className={`rounded-pill border px-3 py-1.5 text-[11px] font-bold cf-press ${
                  selectedScope === scope.competitionSlug
                    ? "border-cs2-green-line bg-cs2-green-soft text-cs2-green"
                    : "border-cs2-line bg-cs2-paper text-cs2-ink-2"
                }`}
              >
                {HOME_HUB_COPY.scopeChip(scope.competitionName, scope.gameweekNumber)}
              </button>
            ))}
          </div>
          <p className="text-[11px] text-cs2-ink-3">{HOME_HUB_COPY.scopeHelper}</p>
        </>
      ) : null}

      {navigatorCard ? <GwNavigator card={navigatorCard} now={now} /> : null}

      <div className="flex flex-col gap-3">
        {scoped.map((card) => (
          <LeagueCard key={card.leagueId} card={card} />
        ))}
      </div>
    </div>
  );
}
