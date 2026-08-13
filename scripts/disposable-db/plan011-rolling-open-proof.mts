// Plan 011 §1.2 disposable-DB proof.
//
// Run only against the local disposable harness:
//   scripts/disposable-db/up.sh
//   node scripts/disposable-db/plan011-rolling-open-proof.mts
//
// This script deliberately seeds and mutates only localhost:55432. It refuses to continue when
// its named competition already exists, so a stale harness cannot silently change the evidence.
import pg from "pg";

const CONN = {
  host: "localhost",
  port: 55432,
  user: "postgres",
  password: "postgres",
  database: "postgres",
};
const COMP_SLUG = "plan011-rolling-open";
const LEAGUE_SLUG = "plan011-proof-league";
const USER_A = "00000000-0000-0000-0000-0000000011a1";
const USER_B = "00000000-0000-0000-0000-0000000011b1";
const COMP = "00000000-0000-0000-0000-000000011001";
const LEAGUE = "00000000-0000-0000-0000-000000011002";
const GW_N = "00000000-0000-0000-0000-000000011003";
const GW_N1 = "00000000-0000-0000-0000-000000011004";
const TEAM_HOME = "00000000-0000-0000-0000-000000011005";
const TEAM_AWAY = "00000000-0000-0000-0000-000000011006";
const FIXTURE = "00000000-0000-0000-0000-000000011007";
const MEMBERSHIP = "00000000-0000-0000-0000-000000011008";
const POT_N = "00000000-0000-0000-0000-000000011009";
const ENTRY_A = "00000000-0000-0000-0000-00000001100a";
const ENTRY_B = "00000000-0000-0000-0000-00000001100b";
const PICK_A = "00000000-0000-0000-0000-00000001100c";
const PICK_B = "00000000-0000-0000-0000-00000001100d";

let failures = 0;
const check = (label: string, condition: boolean, detail = "") => {
  if (!condition) failures++;
  console.log(`${condition ? "PASS" : "FAIL"} ${label}${detail ? ` — ${detail}` : ""}`);
};
const count = (value: unknown) => Number(value);

const db = new pg.Client(CONN);
await db.connect();
const rows = async (sql: string, values: unknown[] = []) => (await db.query(sql, values)).rows;
const row = async (sql: string, values: unknown[] = []) => (await rows(sql, values))[0];

try {
  const existing = await row("select id from cashford.competitions where slug = $1", [COMP_SLUG]);
  if (existing) {
    throw new Error(`${COMP_SLUG} already exists; recreate the disposable harness first`);
  }

  // Two eligible members, one active league-format competition, and two gameweeks. The second
  // gameweek intentionally has no pot before maintenance; that is asserted again below.
  await db.query(
    `insert into auth.users
       (instance_id, id, aud, role, email, encrypted_password, confirmed_at,
        raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
     values
       ('00000000-0000-0000-0000-000000000000', $1, 'authenticated', 'authenticated',
        'plan011-a@p11.internal', '', now(),
        '{"provider":"email","providers":["email"]}',
        '{"username":"plan011-a","display_name":"Plan 011 A"}', now(), now()),
       ('00000000-0000-0000-0000-000000000000', $2, 'authenticated', 'authenticated',
        'plan011-b@p11.internal', '', now(),
        '{"provider":"email","providers":["email"]}',
        '{"username":"plan011-b","display_name":"Plan 011 B"}', now(), now())`,
    [USER_A, USER_B],
  );
  await db.query(
    `insert into cashford.competitions (id, slug, name, format, season, fpl_source, status)
     values ($1, $2, 'Plan 011 Rolling Open', 'league', '2026/27', true, 'active')`,
    [COMP, COMP_SLUG],
  );
  await db.query(
    `insert into cashford.leagues (id, name, slug, default_stake_inr, status, created_by)
     values ($1, 'Plan 011 Proof League', $2, 100, 'active', $3)`,
    [LEAGUE, LEAGUE_SLUG, USER_A],
  );
  await db.query(
    `insert into cashford.league_members (league_id, user_id)
     values ($1, $2), ($1, $3)`,
    [LEAGUE, USER_A, USER_B],
  );
  await db.query(
    `insert into cashford.gameweeks
       (id, competition_id, number, name, deadline_at, status, fpl_event_id)
     values
       ($1, $3, 1, 'Plan 011 GW1', clock_timestamp() - interval '1 second', 'open', 11001),
       ($2, $3, 2, 'Plan 011 GW2', clock_timestamp() + interval '1 day', 'upcoming', 11002)`,
    [GW_N, GW_N1, COMP],
  );
  await db.query(
    `insert into cashford.league_competitions
       (league_id, competition_id, status, eligible_from_gameweek_id)
     values ($1, $2, 'active', $3)`,
    [LEAGUE, COMP, GW_N],
  );
  await db.query(
    `insert into cashford.member_competitions
       (league_id, user_id, competition_id, eligible_from_gameweek_id)
     values ($1, $2, $3, $4), ($1, $5, $3, $4)`,
    [LEAGUE, USER_A, COMP, GW_N, USER_B],
  );
  await db.query(
    `insert into cashford.teams (id, external_id, name, short_name)
     values ($1, 11001, 'Plan 011 Home', 'P11H'), ($2, 11002, 'Plan 011 Away', 'P11A')`,
    [TEAM_HOME, TEAM_AWAY],
  );
  await db.query(
    `insert into cashford.fixtures
       (id, external_id, round, competition_id, fpl_fixture_id, kickoff_at,
        home_team_id, away_team_id, status)
     values ($1, 11001, 'group', $2, 11001, clock_timestamp() + interval '1 hour', $3, $4, 'scheduled')`,
    [FIXTURE, COMP, TEAM_HOME, TEAM_AWAY],
  );
  await db.query(
    `insert into cashford.gameweek_fixtures
       (id, gameweek_id, fixture_id, competition_id, state, is_current)
     values ($1, $2, $3, $4, 'active', true)`,
    [MEMBERSHIP, GW_N, FIXTURE, COMP],
  );
  await db.query(
    `insert into cashford.gameweek_contests
       (id, league_id, gameweek_id, competition_id, stake_inr, deadline_at, status)
     values ($1, $2, $3, $4, 100,
             (select deadline_at from cashford.gameweeks where id = $3), 'open')`,
    [POT_N, LEAGUE, GW_N, COMP],
  );
  await db.query(
    `insert into cashford.gameweek_entries
       (id, gameweek_contest_id, league_id, gameweek_id, competition_id, user_id, status)
     values
       ($1, $3, $4, $5, $6, $7, 'entered'),
       ($2, $3, $4, $5, $6, $8, 'entered')`,
    [ENTRY_A, ENTRY_B, POT_N, LEAGUE, GW_N, COMP, USER_A, USER_B],
  );
  await db.query(
    `insert into cashford.gameweek_picks
       (id, entry_id, membership_id, gameweek_id, fixture_id, competition_id, pred_home, pred_away)
     values
       ($1, $3, $5, $6, $7, $8, 1, 0),
       ($2, $4, $5, $6, $7, $8, 0, 1)`,
    [PICK_A, PICK_B, ENTRY_A, ENTRY_B, MEMBERSHIP, GW_N, FIXTURE, COMP],
  );

  const before = await row(
    `select
       (select count(*) from cashford.gameweek_contests where competition_id = $1 and gameweek_id = $2) as n_pots,
       (select count(*) from cashford.gameweek_entries where gameweek_contest_id = $3 and status = 'entered') as entered,
       (select count(*) from cashford.gameweek_fixtures where gameweek_id = $6 and state = 'active') as active_fixtures,
       (select count(*) from cashford.fixtures f join cashford.gameweek_fixtures gf on gf.fixture_id = f.id
         where gf.gameweek_id = $6 and gf.state = 'active'
           and (f.status <> 'finished' or f.ft_home is null or f.ft_away is null)) as unfinished,
       (select count(*) from cashford.gameweek_entries e
         where e.gameweek_contest_id = $3 and e.status = 'entered'
           and (select count(*) from cashford.gameweek_picks p where p.entry_id = e.id) =
               (select count(*) from cashford.gameweek_fixtures gf where gf.gameweek_id = $6 and gf.state = 'active')) as complete_entries,
       (select count(*) from cashford.gameweek_picks p where p.entry_id in ($4, $5)) as picks,
       (select gc.deadline_at = g.deadline_at
          from cashford.gameweek_contests gc join cashford.gameweeks g on g.id = gc.gameweek_id
         where gc.id = $3) as snapshot_matches_gw`,
    [COMP, GW_N1, POT_N, ENTRY_A, ENTRY_B, GW_N],
  );
  check("before: GW n+1 has zero pots", count(before.n_pots) === 0, String(before.n_pots));
  check("before: two complete entered entries exist", count(before.entered) === 2, String(before.entered));
  check("before: at least one active fixture exists", count(before.active_fixtures) >= 1, String(before.active_fixtures));
  check("before: at least one active fixture is unfinished", count(before.unfinished) >= 1, String(before.unfinished));
  check("before: both entered entries have a complete pick set", count(before.complete_entries) === 2, String(before.complete_entries));
  check("before: every active fixture has a pick in both entries", count(before.picks) === 2 * count(before.active_fixtures), String(before.picks));
  check("before: pot deadline snapshot equals GW n deadline", before.snapshot_matches_gw === true);

  // This is the one maintenance call. Do not retry: the assertions below are meant to prove the
  // atomic rolling-open transition, including the original pot identity.
  const maintenance = await row("select cashford.run_gameweek_maintenance($1) as result", [COMP]);
  const result = maintenance.result as {
    locked?: number;
    pots_locked?: number;
    entries_locked_in?: number;
    pots_provisioned?: number;
  };
  check("after: maintenance locked the expired GW", count(result.locked) === 1, JSON.stringify(result));
  check("after: maintenance locked the original pot", count(result.pots_locked) === 1, JSON.stringify(result));
  check("after: maintenance resolved both entries into the pot", count(result.entries_locked_in) === 2, JSON.stringify(result));
  check("after: maintenance provisioned one next-GW pot", count(result.pots_provisioned) === 1, JSON.stringify(result));

  const after = await row(
    `select
       (select status from cashford.gameweeks where id = $1) as gw_n_status,
       (select status from cashford.gameweeks where id = $2) as gw_n1_status,
       (select count(*) from cashford.gameweeks where competition_id = $3 and status = 'open') as open_gws,
       (select count(*) from cashford.gameweek_entries where gameweek_contest_id = $4 and status = 'locked_in') as locked_entries,
       (select id from cashford.gameweek_contests where id = $5) as original_pot_id,
       (select status from cashford.gameweek_contests where id = $5) as original_pot_status,
       (select count(*) from cashford.gameweek_contests where competition_id = $3 and gameweek_id = $2) as next_pots,
       (select count(*) from cashford.gameweek_contests where competition_id = $3 and gameweek_id = $2 and league_id = $6 and status = 'open') as next_open_pots`,
    [GW_N, GW_N1, COMP, POT_N, POT_N, LEAGUE],
  );
  check("after: GW n is locked", after.gw_n_status === "locked", String(after.gw_n_status));
  check("after: both entries are locked_in", count(after.locked_entries) === 2, String(after.locked_entries));
  check("after: original pot id is unchanged", after.original_pot_id === POT_N, String(after.original_pot_id));
  check("after: original pot is locked", after.original_pot_status === "locked", String(after.original_pot_status));
  check("after: GW n+1 is open", after.gw_n1_status === "open", String(after.gw_n1_status));
  check("after: exactly one GW is open", count(after.open_gws) === 1, String(after.open_gws));
  check("after: exactly one pot exists for the active league in GW n+1", count(after.next_pots) === 1, String(after.next_pots));
  check("after: the next-GW pot is open", count(after.next_open_pots) === 1, String(after.next_open_pots));
} finally {
  await db.end();
}

console.log(failures ? `${failures} PLAN 011 PROOF FAILURE(S)` : "ALL PLAN 011 ROLLING-OPEN PROOFS PASSED");
process.exitCode = failures ? 1 : 0;
