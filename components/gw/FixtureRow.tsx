import { GW_UI_COPY } from "@/lib/gw-copy";
import type { GameweekViewDTO } from "@/lib/gw-view";
import { LocalTime } from "@/components/LocalTime";

export function FixtureRow({
  fixture,
  picks,
}: {
  fixture: GameweekViewDTO["fixtures"][number];
  picks: GameweekViewDTO["revealedPicks"];
}) {
  const fixturePicks = picks.filter((pick) => pick.fixtureId === fixture.fixtureId);
  return (
    <div className="border-b border-cs2-line-2 py-3 last:border-b-0">
      {fixture.kickoffAt ? (
        <div className="mb-2 flex items-center justify-between gap-3 text-[10px] font-semibold text-cs2-ink-3">
          <span>
            <LocalTime iso={fixture.kickoffAt} variant="date" relative={false} includeYear={false} />
            {" · "}
            <LocalTime iso={fixture.kickoffAt} variant="time" relative={false} />
          </span>
        </div>
      ) : null}
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
        <span className="text-right text-[13px] font-bold">{fixture.homeName}</span>
        <span className="min-w-16 text-center font-mono text-[15px] font-extrabold tabular">
          {fixture.homeScore != null && fixture.awayScore != null
            ? `${fixture.homeScore}–${fixture.awayScore}`
            : "–"}
        </span>
        <span className="text-[13px] font-bold">{fixture.awayName}</span>
      </div>
      {fixture.state === "void" ? (
        <p className="mt-1 text-center text-[11px] font-semibold text-cs2-ink-3">
          {GW_UI_COPY.voidFixture}
        </p>
      ) : null}
      {fixturePicks.length ? (
        <div className="mt-2 flex flex-wrap justify-center gap-1.5">
          {fixturePicks.map((pick) => (
            <span
              key={pick.userId}
              className="rounded-cs2-sm bg-cs2-line-2 px-2 py-1 font-mono text-[10px] font-bold tabular text-cs2-ink-2"
            >
              {pick.predHome}–{pick.predAway}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
