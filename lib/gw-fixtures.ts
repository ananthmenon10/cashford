export type GameweekFixtureState = "active" | "void" | "excluded";

export type GameweekFixtureMembership<T = unknown> = {
  fixtureId?: string;
  fixture_id?: string;
  state: GameweekFixtureState;
  membershipId?: string;
  id?: string;
  fixture?: T;
  voidReason?: string | null;
};

export type EffectiveGameweekFixture<T = unknown> = {
  fixtureId: string;
  fixture_id?: string;
  state: "active" | "void";
  effectiveState?: "active" | "void";
  membershipId?: string;
  fixture?: T;
  voidReason?: string | null;
};

/**
 * Mirrors cashford.gameweek_effective_fixtures: any active row wins, then void;
 * excluded-only history disappears.
 */
export function collapseGameweekFixtures<T>(
  rows: readonly GameweekFixtureMembership<T>[],
): EffectiveGameweekFixture<T>[] {
  const grouped = new Map<string, GameweekFixtureMembership<T>[]>();
  for (const row of rows) {
    const fixtureId = row.fixtureId ?? row.fixture_id;
    if (!fixtureId) continue;
    const current = grouped.get(fixtureId) ?? [];
    current.push(row);
    grouped.set(fixtureId, current);
  }

  const effective: EffectiveGameweekFixture<T>[] = [];
  for (const [fixtureId, history] of grouped) {
    const chosen =
      history.find((row) => row.state === "active") ??
      history.find((row) => row.state === "void");
    if (!chosen) continue;
    const state = chosen.state === "active" ? "active" : "void";
    effective.push({
      fixtureId,
      fixture_id: fixtureId,
      state,
      effectiveState: state,
      membershipId: chosen.membershipId ?? chosen.id,
      fixture: chosen.fixture,
      voidReason: chosen.voidReason,
    });
  }

  return effective.sort((a, b) => a.fixtureId.localeCompare(b.fixtureId));
}
