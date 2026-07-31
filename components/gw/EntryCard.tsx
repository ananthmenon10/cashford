import { C8, C9, GW_UI_COPY } from "@/lib/gw-copy";
import type { GameweekViewDTO } from "@/lib/gw-view";

export function EntryCard({
  fixtures,
  picks,
}: {
  fixtures: GameweekViewDTO["fixtures"];
  picks: GameweekViewDTO["viewerPicks"];
}) {
  const byFixture = new Map(picks.map((pick) => [pick.fixtureId, pick]));
  return (
    <div className="mt-4 rounded-cs2-md border border-cs2-green-line bg-cs2-green-soft p-4">
      <div className="text-[11px] font-extrabold uppercase tracking-[.1em] text-cs2-green">
        {GW_UI_COPY.picks}
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        {fixtures
          .filter((fixture) => fixture.state === "active")
          .map((fixture) => {
            const pick = byFixture.get(fixture.fixtureId);
            return pick ? (
              <span
                key={fixture.fixtureId}
                className="rounded-cs2-sm border border-cs2-green-line bg-cs2-paper px-2.5 py-1 font-mono text-[12px] font-bold tabular"
              >
                {fixture.homeShort} {pick.predHome}–{pick.predAway} {fixture.awayShort}
              </span>
            ) : null;
          })}
      </div>
      <p className="mt-3 text-[12px] text-cs2-ink-2">{C8}</p>
      <p className="mt-1 text-[11px] text-cs2-ink-3">{C9}</p>
    </div>
  );
}
