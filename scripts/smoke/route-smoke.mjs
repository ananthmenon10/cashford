// Cashford route smoke pass (#12). Run with:
//   node --env-file=.env.local scripts/smoke/route-smoke.mjs
//   node --env-file=.env.local scripts/smoke/route-smoke.mjs --self-test
//
// This script is read-only by construction: every page loader receives a client wrapper that
// records and rejects writes, rpc calls, schema/storage/functions access, and auth.admin calls
// other than the one read used by the feedback page. It discovers the four target leagues by
// name at runtime, then uses each league's own active member as the viewer id.
//
// RLS scope: the three real leagues use the service-role client for both halves because no member
// credentials are available for them. ZZ-P1 uses an anon client signed in as
// ananth@cashford.internal (CASHFORD_ANANTH_PASSWORD) for the session half, with service role
// still used for admin reads. This exercises the same league-generic RLS policies. The residual
// blind spot is a policy that behaves differently because of data unique to another real league.
// Password values are read only and never included in output.
//
// The self-test proves the two production failure classes are visible to this harness:
//   v101: on the actual loadDuesView path, inject a missing column inside its contests embed.
//         This is the same PostgREST schema-cache failure as the old contests.competition_id
//         select. The loader/harness must report ✗ rather than accepting partial data.
//   v102: on the same loadDuesView path, remove the loader's explicit gameweek_entries
//         relationship marker. With the two foreign keys in the live schema, PostgREST returns
//         PGRST201 (ambiguous relationship); again the harness must report the loader failure.
//         The self-test mutates the live loader argument and does not copy a production select.
//
// Route coverage is the data-loading path behind: / (home + analytics), /matches, /bracket,
// /leagues/[slug] (gameweek branch), season, table, enter, dues, dues/log, both payment detail
// routes, manage, /leagues/new's competition picker and slug check, the three WC archive pages,
// /leagues/[slug]/m/[id], /m/[fixtureId], and both /dev read-only pages. Auth forms, /rules,
// and public invite/join/share pages have no authenticated page data loader and are out of scope.

import { register } from "node:module";

// Node can strip the repository's TypeScript, but its ESM resolver needs the same extension
// hook used by the existing .mts/.mjs operational scripts for the repo's extensionless imports.
register("./ts-resolve-loader.mjs", import.meta.url);
await new Promise((resolve) => setImmediate(resolve));

const { createClient } = await import("@supabase/supabase-js");
const [
  { loadHomePage },
  { loadAnalyticsView },
  { loadCreatableCompetitions, isLeagueSlugAvailable },
  { loadMatchesPage },
  { loadBracketPage },
  { loadLeagueIdentity, loadGameweekView, loadMirrorTargets },
  { loadSeasonView },
  { loadSeasonPickCorpus },
  { loadDuesView },
  { loadMatchDetail },
  { loadLegacyMatchPage },
  { loadLeagueTablePage },
  { loadWcArchivePage, loadWcArchiveMatchesPage, loadWcArchiveBracketPage },
  { loadPaymentDetailPage },
  { loadManagePage },
  { loadCaptainAccess },
  { loadDevFeedbackPage },
  { loadDevGameweeksPage },
] = await Promise.all([
  import("../../lib/home-page-load.ts"),
  import("../../lib/home-analytics.ts"),
  import("../../lib/creatable-competitions-load.ts"),
  import("../../lib/matches-page-load.ts"),
  import("../../lib/bracket-page-load.ts"),
  import("../../lib/gw-view.ts"),
  import("../../lib/gw-season.ts"),
  import("../../lib/analytics-corpus-load.ts"),
  import("../../lib/dues-view.ts"),
  import("../../lib/match-detail-load.ts"),
  import("../../lib/legacy-match-load.ts"),
  import("../../lib/league-table-load.ts"),
  import("../../lib/wc-archive-load.ts"),
  import("../../lib/payment-detail-load.ts"),
  import("../../lib/manage-page-load.ts"),
  import("../../lib/manage-access-load.ts"),
  import("../../lib/dev-feedback-load.ts"),
  import("../../lib/dev-gameweeks-load.ts"),
]);

const TARGET_NAMES = [
  "Solid Yenne Boys",
  "KK Bois",
  "PES Bois",
  "ZZ-P1 Test League",
];
const ZERO_UUID = "00000000-0000-0000-0000-000000000000";
const WRITE_METHODS = new Set(["insert", "update", "upsert", "delete"]);
const RLS_EMAIL = "ananth@cashford.internal";
const TEST_LEAGUE_NAME = "ZZ-P1 Test League";

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`missing ${name}`);
  return value;
}

const url = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
const serviceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
const anonKey = requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");

function newBaseClient() {
  return createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    db: { schema: "cashford" },
  });
}

async function newRlsSessionClient() {
  const client = createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    db: { schema: "cashford" },
  });
  const password = requireEnv("CASHFORD_ANANTH_PASSWORD");
  const result = await client.auth.signInWithPassword({ email: RLS_EMAIL, password });
  if (result.error) throw new Error(`RLS session sign-in failed: ${errorText(result.error)}`);
  if (!result.data.user) throw new Error("RLS session sign-in returned no user");
  return client;
}

function errorText(error) {
  if (!error) return "unknown query error";
  const code = error.code ? `${error.code}: ` : "";
  return `${code}${error.message ?? String(error)}`;
}

function trackedReadOnlyClient(base, label, mutateSelect, state) {
  const recordQueryError = (resource, error) => {
    if (error) {
      state.queryErrors.push({ client: label, table: resource, error });
    }
  };
  const blocked = (operation) => {
    state.blockedWrites.push({ client: label, operation });
    throw new Error(`${label}: blocked read-only call ${operation}`);
  };

  const wrapAuth = (auth) =>
    new Proxy(auth, {
      get(target, property) {
        if (property !== "admin") return Reflect.get(target, property, target);
        const admin = Reflect.get(target, property, target);
        return new Proxy(admin, {
          get(adminTarget, adminProperty) {
            if (adminProperty === "listUsers") {
              const method = Reflect.get(adminTarget, adminProperty, adminTarget);
              return (...args) => {
                const result = Reflect.apply(method, adminTarget, args);
                if (result && typeof result.then === "function") {
                  return result.then((value) => {
                    if (value?.error) recordQueryError("auth.admin.listUsers", value.error);
                    return value;
                  });
                }
                if (result?.error) recordQueryError("auth.admin.listUsers", result.error);
                return result;
              };
            }
            return blocked(`auth.admin.${String(adminProperty)}`);
          },
        });
      },
    });

  const wrapBuilder = (builder, table) =>
    new Proxy(builder, {
      get(target, property) {
        if (property === "then") {
          const then = target.then.bind(target);
          return (resolve, reject) =>
            then(
              (result) => {
                if (result?.error) {
                  recordQueryError(table, result.error);
                }
                return resolve ? resolve(result) : result;
              },
              reject,
            );
        }
        if (typeof property === "string" && WRITE_METHODS.has(property)) {
          return () => blocked(`${property} on ${table}`);
        }
        const method = Reflect.get(target, property, target);
        if (typeof method !== "function") return method;
        return (...args) => {
          const nextArgs =
            property === "select" && mutateSelect
              ? mutateSelect(table, args)
              : args;
          const result = Reflect.apply(method, target, nextArgs);
          return result && typeof result === "object"
            ? wrapBuilder(result, table)
            : result;
        };
      },
    });

  const client = new Proxy(base, {
      get(target, property) {
        if (property === "from") {
          return (table) => wrapBuilder(target.from(table), table);
        }
        if (property === "rpc") {
          return () => blocked("rpc");
        }
        if (property === "schema") {
          return () => blocked("schema()");
        }
        if (property === "storage" || property === "functions") {
          return blocked(String(property));
        }
        if (property === "auth") {
          return wrapAuth(Reflect.get(target, property, target));
        }
        return Reflect.get(target, property, target);
      },
    });
  return { client };
}

function trackedPair(clients, context, mutator) {
  const state = { queryErrors: [], blockedWrites: [] };
  const sessionBase = context.league?.name === TEST_LEAGUE_NAME ? clients.rls : clients.service;
  if (!sessionBase) throw new Error("RLS session client was not initialized");
  const session = trackedReadOnlyClient(sessionBase, "session", null, state);
  const admin = trackedReadOnlyClient(clients.service, "admin", mutator ?? null, state);
  return {
    session: session.client,
    admin: admin.client,
    state,
  };
}

function allQueryErrors(pair) {
  return pair.state.queryErrors;
}

async function readOrThrow(query, context) {
  if (query.error) throw new Error(`${context}: ${errorText(query.error)}`);
  return query.data;
}

async function discoverLeagues(db) {
  const query = await db
    .from("leagues")
    .select("id, name, slug, status, created_by")
    .in("name", TARGET_NAMES);
  const rows = await readOrThrow(query, "discover leagues");
  const byName = new Map((rows ?? []).map((row) => [row.name, row]));
  const missing = TARGET_NAMES.filter((name) => !byName.has(name));
  if (missing.length) throw new Error(`missing target league(s): ${missing.join(", ")}`);

  const leagues = TARGET_NAMES.map((name) => byName.get(name));
  const memberQuery = await db
    .from("league_members")
    .select("league_id, user_id, left_at")
    .in("league_id", leagues.map((league) => league.id));
  const members = await readOrThrow(memberQuery, "discover league members");
  const membersByLeague = new Map();
  for (const member of members ?? []) {
    const list = membersByLeague.get(member.league_id) ?? [];
    list.push(member);
    membersByLeague.set(member.league_id, list);
  }

  const discovered = await Promise.all(
    leagues.map(async (league) => {
      const [contests, gameweeks, payments] = await Promise.all([
        db
          .from("contests")
          .select("id, fixture_id, status")
          .eq("league_id", league.id)
          .order("id", { ascending: true })
          .limit(50),
        db.from("gameweek_contests").select("id, gameweek_id").eq("league_id", league.id).limit(1),
        db.from("payments").select("id").eq("league_id", league.id).limit(1),
      ]);
      const contestRows = await readOrThrow(contests, `discover contests ${league.slug}`);
      return {
        leagueId: league.id,
        contest: (contestRows ?? []).find((row) => row.status === "open") ?? contestRows?.[0] ?? null,
        gameweek: await readOrThrow(gameweeks, `discover gameweek ${league.slug}`),
        payment: await readOrThrow(payments, `discover payments ${league.slug}`),
      };
    }),
  );
  const routeInputs = new Map(discovered.map((row) => [row.leagueId, row]));
  for (const league of leagues) {
    const input = routeInputs.get(league.id);
    const gameweekId = input?.gameweek?.[0]?.gameweek_id;
    if (gameweekId) {
      const fixtures = await db
        .from("gameweek_fixtures")
        .select("fixture_id")
        .eq("gameweek_id", gameweekId)
        .order("fixture_id", { ascending: true })
        .limit(1);
      input.fixtureId = (await readOrThrow(fixtures, `discover fixture ${league.slug}`))?.[0]?.fixture_id ?? null;
    } else {
      input.fixtureId = null;
    }
  }

  return leagues.map((league) => {
    const activeMember = (membersByLeague.get(league.id) ?? []).find((member) => member.left_at == null);
    return {
      league,
      slug: league.slug,
      viewerId: activeMember?.user_id ?? league.created_by,
      contestId: routeInputs.get(league.id)?.contest?.id ?? null,
      fixtureId: routeInputs.get(league.id)?.fixtureId ?? null,
      paymentId: routeInputs.get(league.id)?.payment?.[0]?.id ?? ZERO_UUID,
    };
  });
}

function isGameweek(identity) {
  return identity?.participation?.status === "active" && identity.participation.format === "gameweek";
}

async function withIdentity(loaders, pair, context, work) {
  const identity = await loaders.loadLeagueIdentity(pair.session, context.slug);
  if (!identity) throw new Error("league identity not found");
  return work(identity);
}

function makeCases(loaders, context) {
  const leagueCases = [
    {
      name: "league-identity",
      run: (pair) => loaders.loadLeagueIdentity(pair.session, context.slug),
    },
    {
      name: "league-home",
      run: (pair) =>
        withIdentity(loaders, pair, context, async (identity) => {
          if (identity.participation.status === "none") return { skipped: "no competition; page renders empty state" };
          if (!isGameweek(identity)) return { skipped: "page renders archive/non-gameweek branch" };
          await loaders.loadGameweekView(pair.session, pair.admin, identity, context.viewerId, undefined, new Date(), true);
          return identity;
        }),
    },
    {
      name: "season",
      run: (pair) =>
        withIdentity(loaders, pair, context, async (identity) => {
          if (!isGameweek(identity)) return { skipped: "page redirects to archive/non-gameweek branch" };
          await loaders.loadSeasonView(pair.session, pair.admin, identity, context.viewerId);
        }),
    },
    {
      name: "analytics-corpus",
      run: (pair) =>
        withIdentity(loaders, pair, context, async (identity) => {
          const competitionId = identity.participation.competitionId;
          if (!competitionId) return { skipped: "no competition" };
          return loaders.loadSeasonPickCorpus(
            pair.session,
            pair.admin,
            context.league.id,
            competitionId,
            context.viewerId,
          );
        }),
    },
    {
      name: "table",
      run: (pair) =>
        withIdentity(loaders, pair, context, async (identity) => {
          if (!isGameweek(identity)) return { skipped: "page redirects to archive/non-gameweek branch" };
          await Promise.all([
            loaders.loadLeagueTablePage(pair.session, pair.admin, identity, context.viewerId),
            loaders.loadSeasonView(pair.session, pair.admin, identity, context.viewerId),
          ]);
        }),
    },
    {
      name: "enter",
      run: (pair) =>
        withIdentity(loaders, pair, context, async (identity) => {
          if (!isGameweek(identity)) return { skipped: "page redirects/not-found for non-gameweek branch" };
          const view = await loaders.loadGameweekView(pair.session, pair.admin, identity, context.viewerId, undefined, new Date(), false);
          if (view.gameweek && view.contest) {
            await loaders.loadMirrorTargets(pair.session, view, context.viewerId);
          }
          return view;
        }),
    },
    {
      name: "dues",
      run: (pair) =>
        withIdentity(loaders, pair, context, async (identity) => {
          if (!isGameweek(identity)) return { skipped: "page redirects to archive/non-gameweek branch" };
          await loaders.loadDuesView(pair.session, pair.admin, identity, context.viewerId);
        }),
    },
    {
      name: "dues-log",
      run: (pair) =>
        withIdentity(loaders, pair, context, (identity) =>
          loaders.loadDuesView(pair.session, pair.admin, identity, context.viewerId),
        ),
    },
    {
      name: "archive-wc2026",
      run: (pair) =>
        withIdentity(loaders, pair, context, (identity) =>
          loaders.loadWcArchivePage(pair.session, pair.admin, identity, context.viewerId),
        ),
    },
    {
      name: "archive-wc2026-matches",
      run: (pair) =>
        withIdentity(loaders, pair, context, (identity) =>
          loaders.loadWcArchiveMatchesPage(pair.session, pair.admin, identity, context.viewerId),
        ),
    },
    {
      name: "archive-wc2026-bracket",
      run: (pair) =>
        withIdentity(loaders, pair, context, (identity) =>
          loaders.loadWcArchiveBracketPage(pair.session, pair.admin, identity, context.viewerId),
        ),
    },
    {
      name: "legacy-match-m-id",
      run: (pair) =>
        context.contestId
          ? loaders.loadLegacyMatchPage(pair.session, pair.admin, context.viewerId, context.contestId, { allowInsightWrites: false })
          : { skipped: "no legacy contest in this league" },
    },
    {
      name: "match-detail-m-fixtureId",
      run: (pair) =>
        context.fixtureId
          ? loaders.loadMatchDetail(pair.session, pair.admin, context.viewerId, context.fixtureId, context.slug)
          : { skipped: "no gameweek fixture in this league" },
    },
    {
      name: "payment-detail (both routes)",
      run: async (pair) => {
        if (context.paymentId === ZERO_UUID) return { skipped: "no discovered payment" };
        const result = await loaders.loadPaymentDetailPage(pair.session, context.paymentId, context.viewerId);
        if (!result) throw new Error("discovered payment was not visible to the route viewer");
        return result;
      },
    },
    {
      name: "manage",
      run: (pair) => loaders.loadManagePage(pair.admin, context.league.id),
    },
    {
      name: "manage-access-guard",
      run: async (pair) => {
        const owner = await loaders.loadCaptainAccess(
          pair.admin,
          context.slug,
          context.league.created_by,
        );
        if (context.viewerId !== context.league.created_by) {
          await loaders.loadCaptainAccess(pair.admin, context.slug, context.viewerId);
        }
        return owner;
      },
    },
    {
      name: "home",
      run: (pair) => loaders.loadHomePage(pair.session, pair.admin, context.viewerId),
    },
    {
      name: "new-league-slug-check",
      run: (pair) => loaders.isLeagueSlugAvailable(pair.admin, context.slug),
    },
    {
      name: "analytics",
      run: (pair) => loaders.loadAnalyticsView(pair.session, context.viewerId),
    },
    {
      name: "matches",
      run: (pair) => loaders.loadMatchesPage(pair.session, pair.admin, context.viewerId),
    },
    {
      name: "bracket",
      run: (pair) => loaders.loadBracketPage(pair.session, pair.admin, context.viewerId),
    },
  ];
  return leagueCases;
}

function makeGlobalCases(loaders) {
  return [
    {
      name: "new-league-competition-picker",
      run: (pair) => loaders.loadCreatableCompetitions(pair.admin),
    },
    {
      name: "dev-gameweeks",
      run: (pair) => loaders.loadDevGameweeksPage(pair.session, pair.admin),
    },
    {
      name: "dev-feedback",
      run: (pair) => loaders.loadDevFeedbackPage(pair.admin),
    },
  ];
}

function failureDetails(pair, thrown) {
  const details = [];
  if (pair.state.blockedWrites.length) {
    details.push(
      `blocked read-only call(s): ${pair.state.blockedWrites
        .map(({ client, operation }) => `${client}/${operation}`)
        .join(", ")}`,
    );
  }
  if (allQueryErrors(pair).length) {
    details.push(
      allQueryErrors(pair)
        .map(({ client, table, error }) => `${client}/${table}: ${errorText(error)}`)
        .join("; "),
    );
  }
  if (thrown) details.push(`loader: ${errorText(thrown)}`);
  return details.join("; ") || "unknown route smoke failure";
}

async function runOne(clients, context, definition, mutator = null) {
  const pair = trackedPair(clients, context, mutator);
  const started = Date.now();
  try {
    const result = await definition.run(pair);
    if (pair.state.blockedWrites.length) throw new Error("blocked read-only call");
    if (allQueryErrors(pair).length) throw new Error("query error returned by Supabase");
    return {
      ok: true,
      skipped: result?.skipped ?? null,
      elapsed: Date.now() - started,
      queryErrors: [],
    };
  } catch (error) {
    return {
      ok: false,
      skipped: null,
      elapsed: Date.now() - started,
      queryErrors: allQueryErrors(pair),
      error: failureDetails(pair, error),
    };
  }
}

async function mapLimit(items, limit, worker) {
  let next = 0;
  async function take() {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, take));
}

function printResult(context, definition, result) {
  const prefix = result.ok ? "✓" : "✗";
  const suffix = result.ok
    ? result.skipped
      ? ` — not applicable (${result.skipped})`
      : ` — ${result.elapsed}ms`
    : ` — ${result.error}`;
  console.log(`${prefix} ${context.slug} × ${definition.name}${suffix}`);
}

function v101BrokenSelect(table, args) {
  if (table !== "contest_results" || typeof args[0] !== "string") return args;
  const broken = args[0].replace(
    /contests!inner\(/,
    "contests!inner(__route_smoke_missing_v101,",
  );
  return broken === args[0] ? args : [broken, ...args.slice(1)];
}

function v102BrokenSelect(table, args) {
  if (table !== "gameweek_entry_results" || typeof args[0] !== "string") return args;
  const broken = args[0].replace(
    /gameweek_entries![^!(),]+!inner\(/,
    "gameweek_entries!inner(",
  );
  return broken === args[0] ? args : [broken, ...args.slice(1)];
}

async function runSelfTests(clients, loaders, context) {
  for (const [name, mutator, expected] of [
    ["v101-bad-column", v101BrokenSelect, "__route_smoke_missing_v101"],
    ["v102-unpinned-embed", v102BrokenSelect, "PGRST201"],
  ]) {
    const result = await runOne(
      clients,
      context,
      {
        name,
        run: (pair) => loaders.loadDuesView(pair.session, pair.admin, context.leagueIdentity, context.viewerId),
      },
      mutator,
    );
    const failureText = result.error ?? "";
    if (result.ok || !failureText.includes(expected)) {
      throw new Error(`${name}: harness did not reject the deliberately broken select (${failureText || "no failure"})`);
    }
    console.log(`✓ self-test × ${name} — harness reported ${failureText}`);
  }
}

async function main() {
  const loaders = {
    loadHomePage,
    loadAnalyticsView,
    loadCreatableCompetitions,
    isLeagueSlugAvailable,
    loadMatchesPage,
    loadBracketPage,
    loadLeagueIdentity,
    loadGameweekView,
    loadMirrorTargets,
    loadSeasonView,
    loadSeasonPickCorpus,
    loadDuesView,
    loadMatchDetail,
    loadLegacyMatchPage,
    loadLeagueTablePage,
    loadWcArchivePage,
    loadWcArchiveMatchesPage,
    loadWcArchiveBracketPage,
    loadPaymentDetailPage,
    loadManagePage,
    loadCaptainAccess,
    loadDevFeedbackPage,
    loadDevGameweeksPage,
  };
  const selfTest = process.argv.includes("--self-test");
  const clients = { service: newBaseClient(), rls: null };
  const contexts = await discoverLeagues(clients.service);
  if (!selfTest) clients.rls = await newRlsSessionClient();
  if (selfTest) {
    const context = contexts[0];
    const pair = trackedPair(clients, context, null);
    context.leagueIdentity = await loadLeagueIdentity(pair.session, context.slug);
    if (!context.leagueIdentity) throw new Error("self-test: target league identity not found");
    await runSelfTests(clients, loaders, context);
    return;
  }

  const jobs = contexts.flatMap((context) =>
    makeCases(loaders, context).map((definition) => ({ context, definition })),
  );
  const globalContext = { slug: "global", league: null, viewerId: null };
  jobs.push(
    ...makeGlobalCases(loaders).map((definition) => ({
      context: globalContext,
      definition,
    })),
  );
  let failures = 0;
  await mapLimit(jobs, 4, async ({ context, definition }) => {
    const result = await runOne(clients, context, definition);
    printResult(context, definition, result);
    if (!result.ok) failures++;
  });
  if (failures) throw new Error(`${failures} route smoke case(s) failed`);
}

try {
  await main();
} catch (error) {
  console.error(`✗ route-smoke setup — ${errorText(error)}`);
  process.exitCode = 1;
}
