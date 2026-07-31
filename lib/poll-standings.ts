import {
  fetchEspnStandings,
  type CompetitionStanding,
} from "./espn-standings";
import { runPhase4Poller } from "./phase4-poll-runtime";

type Admin = ReturnType<typeof import("./supabase/service").createServiceRoleClient>;

export async function pollStandings(admin: Admin, now = new Date()) {
  return runPhase4Poller(
    admin,
    "espn_standings",
    { nextDueMs: 10 * 60_000 },
    async (counter) => {
      const { data: competitions, error } = await admin
        .from("competitions")
        .select("id, slug, status")
        .eq("slug", "pl-2026-27")
        .neq("status", "archived");
      if (error) throw new Error(`pollStandings competition: ${error.message}`);
      const competition = competitions?.[0];
      if (!competition) return;
      const { data: liveFixtures, error: liveError } = await admin
        .from("fixtures")
        .select("id")
        .eq("competition_id", competition.id)
        .eq("status", "live")
        .limit(1);
      if (liveError) {
        throw new Error(`pollStandings live check: ${liveError.message}`);
      }
      counter.nextDueIn(liveFixtures?.length ? 10 * 60_000 : 60 * 60_000);
      counter.fetched();
      const rows = await fetchEspnStandings();
      if (!rows) return;
      await counter.renew();
      const { error: writeError } = await admin
        .from("competition_standings")
        .upsert(
          {
            competition_id: competition.id,
            source: "espn",
            rows,
            note: null,
            fetched_at: now.toISOString(),
          },
          { onConflict: "competition_id,source" },
        );
      if (writeError) {
        throw new Error(`pollStandings write: ${writeError.message}`);
      }
      counter.wrote();
    },
  );
}

type DerivedFixture = {
  kickoff_at: string | null;
  home_team_id: string | null;
  away_team_id: string | null;
  ft_home: number | null;
  ft_away: number | null;
  home: { id: string; name: string } | null;
  away: { id: string; name: string } | null;
};

export function deriveStandingRows(
  fixtures: readonly DerivedFixture[],
): CompetitionStanding[] {
  type Mutable = Omit<CompetitionStanding, "rank"> & { recent: string[] };
  const table = new Map<string, Mutable>();
  const club = (team: { id: string; name: string }) => {
    const existing = table.get(team.id);
    if (existing) return existing;
    const row: Mutable = {
      club: team.name,
      club_id: team.id,
      played: 0,
      won: 0,
      drawn: 0,
      lost: 0,
      gd: 0,
      points: 0,
      form: [],
      recent: [],
    };
    table.set(team.id, row);
    return row;
  };
  const ordered = [...fixtures]
    .filter(
      (fixture) =>
        fixture.home &&
        fixture.away &&
        fixture.ft_home != null &&
        fixture.ft_away != null,
    )
    .sort(
      (a, b) =>
        new Date(a.kickoff_at ?? 0).getTime() -
        new Date(b.kickoff_at ?? 0).getTime(),
    );
  for (const fixture of ordered) {
    const home = club(fixture.home!);
    const away = club(fixture.away!);
    const homeScore = fixture.ft_home!;
    const awayScore = fixture.ft_away!;
    home.played++;
    away.played++;
    home.gd += homeScore - awayScore;
    away.gd += awayScore - homeScore;
    if (homeScore > awayScore) {
      home.won++;
      away.lost++;
      home.points += 3;
      home.recent.push("W");
      away.recent.push("L");
    } else if (homeScore < awayScore) {
      away.won++;
      home.lost++;
      away.points += 3;
      home.recent.push("L");
      away.recent.push("W");
    } else {
      home.drawn++;
      away.drawn++;
      home.points++;
      away.points++;
      home.recent.push("D");
      away.recent.push("D");
    }
  }
  return [...table.values()]
    .sort(
      (a, b) =>
        b.points - a.points ||
        b.gd - a.gd ||
        a.club.localeCompare(b.club),
    )
    .map((row, index) => ({
      ...row,
      rank: index + 1,
      form: row.recent.slice(-5) as Array<"W" | "D" | "L">,
      recent: undefined,
    }))
    .map(({ recent: _recent, ...row }) => row);
}

export async function deriveStandings(admin: Admin, now = new Date()) {
  return runPhase4Poller(
    admin,
    "derived_standings",
    { nextDueMs: 60 * 60_000 },
    async (counter) => {
      const { data: competitions, error } = await admin
        .from("competitions")
        .select("id")
        .eq("slug", "pl-2026-27");
      if (error) throw new Error(`deriveStandings competition: ${error.message}`);
      const competition = competitions?.[0];
      if (!competition) return;
      const { data: fixtures, error: fixtureError } = await admin
        .from("fixtures")
        .select(
          "kickoff_at, home_team_id, away_team_id, ft_home, ft_away, home:teams!fixtures_home_team_id_fkey(id,name), away:teams!fixtures_away_team_id_fkey(id,name)",
        )
        .eq("competition_id", competition.id)
        .eq("status", "finished");
      if (fixtureError) {
        throw new Error(`deriveStandings fixtures: ${fixtureError.message}`);
      }
      const rows = deriveStandingRows((fixtures ?? []) as unknown as DerivedFixture[]);
      if (!rows.length) return;
      const played = rows.map((row) => row.played);
      const spread = Math.max(...played) - Math.min(...played);
      const note =
        spread > 0
          ? "Some clubs have a game in hand — postponed fixtures stay in their original gameweek."
          : null;
      await counter.renew();
      const { error: writeError } = await admin
        .from("competition_standings")
        .upsert(
          {
            competition_id: competition.id,
            source: "derived",
            rows,
            note,
            fetched_at: now.toISOString(),
          },
          { onConflict: "competition_id,source" },
        );
      if (writeError) {
        throw new Error(`deriveStandings write: ${writeError.message}`);
      }
      counter.wrote();
    },
  );
}
