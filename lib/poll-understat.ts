import {
  fetchUnderstatCandidates,
  fetchUnderstatMatch,
} from "./understat";
import { matchFixture } from "./provider-match";
import {
  recordProviderSample,
  writeProviderShapeIssue,
} from "./provider-samples";
import { runPhase4Poller } from "./phase4-poll-runtime";
import { replaceProviderFixtureId } from "./provider-ids";

type Admin = ReturnType<typeof import("./supabase/service").createServiceRoleClient>;

export const MAX_UNDERSTAT_CALLS_PER_RUN = 12;

type UnderstatFixture = {
  id: string;
  kickoff_at: string;
  finished_at: string;
  home_team_id: string;
  away_team_id: string;
  home: { name: string } | null;
  away: { name: string } | null;
  competitions: { season: string } | null;
};

function one<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

export async function pollUnderstat(admin: Admin, now = new Date()) {
  return runPhase4Poller(
    admin,
    "understat_xg",
    { nextDueMs: 6 * 3_600_000 },
    async (counter) => {
      const cutoff = new Date(now.getTime() - 2 * 3_600_000).toISOString();
      const { data: fixtures, error } = await admin
        .from("fixtures")
        .select(
          "id, kickoff_at, finished_at, home_team_id, away_team_id, home:teams!fixtures_home_team_id_fkey(name), away:teams!fixtures_away_team_id_fkey(name), competitions!inner(season,slug)",
        )
        .eq("competitions.slug", "pl-2026-27")
        .eq("status", "finished")
        .not("finished_at", "is", null)
        .lte("finished_at", cutoff)
        .order("finished_at", { ascending: true });
      if (error) throw new Error(`pollUnderstat fixtures: ${error.message}`);
      const due = (fixtures ?? []) as unknown as UnderstatFixture[];
      if (!due.length) return;
      const ids = due.map((fixture) => fixture.id);
      const [{ data: providerIds }, { data: oldRows }] = await Promise.all([
        admin
          .from("fixture_provider_ids")
          .select("fixture_id, external_id, matched_on")
          .eq("provider", "understat")
          .in("fixture_id", ids),
        admin
          .from("fixture_provider_data")
          .select("fixture_id, attempts, tried_at, xg_ok, xg_fetched_at")
          .eq("provider", "understat")
          .in("fixture_id", ids),
      ]);
      const externalByFixture = new Map(
        (providerIds ?? []).map((row: any) => [
          row.fixture_id,
          row.external_id,
        ]),
      );
      const mappingByFixture = new Map(
        (providerIds ?? []).map((row: any) => [row.fixture_id, row]),
      );
      const oldByFixture = new Map(
        (oldRows ?? []).map((row: any) => [row.fixture_id, row]),
      );

      const unmatched = due.filter(
        (fixture) => {
          const mapping: any = mappingByFixture.get(fixture.id);
          const mappedDate = mapping?.matched_on?.date;
          return (
            (!mapping || mappedDate !== fixture.kickoff_at.slice(0, 10)) &&
            fixture.home &&
            fixture.away
          );
        },
      );
      let calls = 0;
      if (unmatched.length) {
        const { data: latestDiscovery } = await admin
          .from("provider_samples")
          .select("body, fetched_at")
          .eq("provider", "understat")
          .eq("endpoint", "leagueData")
          .order("fetched_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        const rescheduled = unmatched.some((fixture) =>
          mappingByFixture.has(fixture.id)
        );
        const cachedCandidates =
          !rescheduled &&
          latestDiscovery?.fetched_at &&
          now.getTime() - new Date(latestDiscovery.fetched_at).getTime() <
            7 * 24 * 3_600_000 &&
          Array.isArray((latestDiscovery.body as any)?.candidates)
            ? (latestDiscovery.body as any).candidates
            : null;
        let candidates = cachedCandidates;
        if (!candidates && calls < MAX_UNDERSTAT_CALLS_PER_RUN) {
          const season = one(unmatched[0].competitions)?.season;
          if (!season) throw new Error("pollUnderstat: competition season missing");
          const discovery = await fetchUnderstatCandidates(season);
          counter.fetched();
          calls++;
          if (discovery.kind === "ok") {
            candidates = discovery.value;
            await recordProviderSample(admin, counter, {
              provider: "understat",
              endpoint: "leagueData",
              ref: season,
              status: 200,
              body: { candidates },
            });
          } else if (discovery.kind === "shape") {
            await writeProviderShapeIssue(admin, counter, {
              provider: "understat",
              endpoint: "leagueData",
              ref: season,
              reason: "parse",
            });
          }
        }
        if (candidates) {
          for (const fixture of unmatched) {
            const matched = matchFixture(
              {
                kickoffAt: fixture.kickoff_at,
                homeName: fixture.home!.name,
                awayName: fixture.away!.name,
              },
              candidates,
            );
            if (!matched) continue;
            await counter.renew();
            await replaceProviderFixtureId(admin, counter, {
              fixture_id: fixture.id,
              provider: "understat",
              external_id: matched.externalId,
              confidence: matched.confidence,
              matched_on: matched.matchedOn,
            });
            externalByFixture.set(fixture.id, matched.externalId);
          }
        }
      }

      let consecutiveFailures = 0;
      for (const fixture of due) {
        if (calls >= MAX_UNDERSTAT_CALLS_PER_RUN) break;
        const externalId = externalByFixture.get(fixture.id);
        if (!externalId) continue;
        const old: any = oldByFixture.get(fixture.id);
        if (
          old?.xg_ok &&
          old?.attempts > 0 &&
          old?.xg_fetched_at &&
          new Date(old.xg_fetched_at) >= new Date(fixture.kickoff_at)
        ) {
          continue;
        }
        if (old?.tried_at && new Date(old.tried_at) > now) continue;
        const result = await fetchUnderstatMatch(externalId);
        counter.fetched();
        calls++;
        const stamp = now.toISOString();
        await counter.renew();
        if (result.kind === "ok") {
          const body = {
            xg: result.value.xg,
            shots: result.value.shots,
          };
          await recordProviderSample(admin, counter, {
            provider: "understat",
            endpoint: "match",
            ref: externalId,
            status: 200,
            body,
          });
          const { error: writeError } = await admin
            .from("fixture_provider_data")
            .upsert(
              {
                fixture_id: fixture.id,
                provider: "understat",
                xg_home: result.value.xg.home,
                xg_away: result.value.xg.away,
                xg_model: result.value.xg.model,
                xg_detail: result.value.xg,
                xg_fetched_at: stamp,
                xg_ok: true,
                shots: result.value.shots.length
                  ? result.value.shots
                  : null,
                shots_fetched_at: stamp,
                shots_ok: true,
                fetched_at: stamp,
                attempts: (old?.attempts ?? 0) + 1,
                last_error: null,
                last_status: null,
                tried_at: stamp,
              },
              { onConflict: "fixture_id,provider" },
            );
          if (writeError) {
            throw new Error(`pollUnderstat write: ${writeError.message}`);
          }
          counter.wrote();
          consecutiveFailures = 0;
        } else {
          consecutiveFailures++;
          if (result.kind === "shape") {
            await writeProviderShapeIssue(admin, counter, {
              provider: "understat",
              endpoint: "match",
              ref: externalId,
              reason: "parse",
            });
          }
          const attempts = (old?.attempts ?? 0) + 1;
          const retryAt = new Date(
            now.getTime() + (attempts >= 3 ? 24 : 6) * 3_600_000,
          ).toISOString();
          const { error: failureError } = await admin
            .from("fixture_provider_data")
            .upsert(
              {
                fixture_id: fixture.id,
                provider: "understat",
                fetched_at: stamp,
                attempts,
                last_error: result.kind,
                last_status: result.kind === "http" ? result.status : null,
                tried_at: retryAt,
                xg_ok: false,
                shots_ok: false,
              },
              { onConflict: "fixture_id,provider" },
            );
          if (failureError) {
            throw new Error(`pollUnderstat failure write: ${failureError.message}`);
          }
          counter.wrote();
          if (consecutiveFailures >= 5) {
            const { error: issueError } = await admin.from("sync_issues").insert({
              source: "understat",
              kind: "provider-breaker",
              ref: null,
              detail: { failures: consecutiveFailures },
            });
            if (issueError) {
              throw new Error(`pollUnderstat issue: ${issueError.message}`);
            }
            counter.wrote();
            counter.disarm();
            break;
          }
        }
      }
    },
  );
}
