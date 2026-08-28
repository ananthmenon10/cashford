"use client";

import { useMemo, useState } from "react";
import { HOME_HUB_COPY } from "@/lib/gw-copy";
import {
  homeCardsForScope,
  homeCompetitionScopes,
  homeScopeChipsVisible,
  type HomeLeagueCard,
} from "@/lib/gw-home";
import { LeagueCard } from "@/components/gw/LeagueCard";

export function HomeHub({ cards }: { cards: readonly HomeLeagueCard[] }) {
  const scopes = useMemo(() => homeCompetitionScopes(cards), [cards]);
  const showChips = homeScopeChipsVisible(cards);
  const [selectedScope, setSelectedScope] = useState<string | null>(scopes[0]?.competitionSlug ?? null);
  const scoped = useMemo(
    () => homeCardsForScope(cards, showChips ? selectedScope : null),
    [cards, selectedScope, showChips],
  );

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

      <div className="flex flex-col gap-3">
        {scoped.map((card) => (
          <LeagueCard key={card.leagueId} card={card} />
        ))}
      </div>
    </div>
  );
}
