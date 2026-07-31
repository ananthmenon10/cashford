import {
  fetchFotMobCandidates,
  fetchFotMobMatch,
  type FotMobFields,
} from "./fotmob";
import { matchFixture } from "./provider-match";
import {
  recordProviderSample,
  writeProviderShapeIssue,
} from "./provider-samples";
import { runPhase4Poller } from "./phase4-poll-runtime";
import { replaceProviderFixtureId } from "./provider-ids";

type Admin = ReturnType<typeof import("./supabase/service").createServiceRoleClient>;

export const MAX_FOTMOB_CALLS_PER_RUN = 12;

function one<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

function dateKey(value: string): string {
  return value.slice(0, 10).replaceAll("-", "");
}

function isOpenDue(fixture: any, old: any, now: Date): boolean {
  if (fixture.status !== "scheduled") return false;
  const kickoff = new Date(fixture.kickoff_at);
  const remaining = kickoff.getTime() - now.getTime();
  if (remaining <= 0 || remaining > 24 * 3_600_000) return false;
  return !old?.tried_at;
}

function isPostDue(fixture: any, old: any, now: Date): boolean {
  if (
    fixture.status !== "finished" ||
    !fixture.finished_at ||
    new Date(fixture.finished_at) > now
  ) {
    return false;
  }
  if (
    old?.last_error == null &&
    old?.fetched_at &&
    new Date(old.fetched_at) >= new Date(fixture.kickoff_at)
  ) {
    return false;
  }
  return !old?.tried_at || new Date(old.tried_at) <= now;
}

function openFields(fields: FotMobFields): FotMobFields {
  return {
    ...(fields.facts ? { facts: fields.facts } : {}),
    ...(fields.predictedXi ? { predictedXi: fields.predictedXi } : {}),
  };
}

export async function pollSlowProviders(admin: Admin, now = new Date()) {
  return runPhase4Poller(
    admin,
    "fotmob_slow",
    { jitterSeconds: [10_800, 18_000] as const },
    async (counter) => {
      const { data: fixtures, error } = await admin
        .from("fixtures")
        .select(
          "id, kickoff_at, status, finished_at, home:teams!fixtures_home_team_id_fkey(name), away:teams!fixtures_away_team_id_fkey(name)",
        )
        .in("status", ["scheduled", "finished"])
        .not("kickoff_at", "is", null)
        .order("kickoff_at", { ascending: true });
      if (error) throw new Error(`pollSlowProviders fixtures: ${error.message}`);
      if (!fixtures?.length) return;

      const fixtureIds = fixtures.map((fixture: any) => fixture.id);
      const [{ data: mappings }, { data: oldRows }] = await Promise.all([
        admin
          .from("fixture_provider_ids")
          .select("fixture_id, external_id, matched_on")
          .eq("provider", "fotmob")
          .in("fixture_id", fixtureIds),
        admin
          .from("fixture_provider_data")
          .select(
            "fixture_id, attempts, tried_at, fetched_at, last_error, xg_ok, xg_fetched_at, facts_ok, predicted_xi_ok",
          )
          .eq("provider", "fotmob")
          .in("fixture_id", fixtureIds),
      ]);
      const mappingByFixture = new Map(
        (mappings ?? []).map((row: any) => [row.fixture_id, row]),
      );
      const oldByFixture = new Map(
        (oldRows ?? []).map((row: any) => [row.fixture_id, row]),
      );
      let calls = 0;

      const needsMapping = fixtures.filter((fixture: any) => {
        const old: any = oldByFixture.get(fixture.id);
        if (!isOpenDue(fixture, old, now) && !isPostDue(fixture, old, now)) {
          return false;
        }
        const mapping: any = mappingByFixture.get(fixture.id);
        return (
          !mapping ||
          mapping.matched_on?.date !== fixture.kickoff_at.slice(0, 10)
        );
      });
      const dates = [...new Set(
        needsMapping.map((fixture: any) => dateKey(fixture.kickoff_at)),
      )].sort();
      for (const date of dates) {
        if (calls >= MAX_FOTMOB_CALLS_PER_RUN) break;
        const result = await fetchFotMobCandidates(date);
        if (result.kind !== "disabled") {
          counter.fetched();
          calls++;
        }
        if (result.kind === "shape") {
          await writeProviderShapeIssue(admin, counter, {
            provider: "fotmob",
            endpoint: "matches",
            ref: date,
            reason: "parse",
          });
        }
        if (result.kind !== "ok") continue;
        await recordProviderSample(admin, counter, {
          provider: "fotmob",
          endpoint: "matches",
          ref: date,
          status: 200,
          body: { candidates: result.value },
        });
        for (const fixture of needsMapping) {
          if (dateKey(fixture.kickoff_at) !== date) continue;
          const home: any = one(fixture.home);
          const away: any = one(fixture.away);
          if (!home?.name || !away?.name) continue;
          const matched = matchFixture(
            {
              kickoffAt: fixture.kickoff_at,
              homeName: home.name,
              awayName: away.name,
            },
            result.value,
          );
          if (!matched) continue;
          await counter.renew();
          await replaceProviderFixtureId(admin, counter, {
            fixture_id: fixture.id,
            provider: "fotmob",
            external_id: matched.externalId,
            confidence: matched.confidence,
            matched_on: matched.matchedOn,
          });
          mappingByFixture.set(fixture.id, {
            fixture_id: fixture.id,
            external_id: matched.externalId,
            matched_on: matched.matchedOn,
          });
        }
      }

      let failures = 0;
      for (const fixture of fixtures) {
        if (calls >= MAX_FOTMOB_CALLS_PER_RUN) break;
        const mapping: any = mappingByFixture.get(fixture.id);
        if (!mapping) continue;
        const old: any = oldByFixture.get(fixture.id);
        const terminal = isPostDue(fixture, old, now);
        const open = isOpenDue(fixture, old, now);
        if (!terminal && !open) continue;

        const result = await fetchFotMobMatch(mapping.external_id, { terminal });
        if (result.kind !== "disabled") {
          counter.fetched();
          calls++;
        }
        const stamp = now.toISOString();
        await counter.renew();
        if (result.kind === "ok") {
          const fields = terminal ? result.value : openFields(result.value);
          if (!Object.keys(fields).length) {
            await writeProviderShapeIssue(admin, counter, {
              provider: "fotmob",
              endpoint: "matchDetails",
              ref: mapping.external_id,
              reason: "missing_block",
            });
          } else {
            await recordProviderSample(admin, counter, {
              provider: "fotmob",
              endpoint: "matchDetails",
              ref: mapping.external_id,
              status: 200,
              body: fields,
            });
          }
          const patch = terminal
            ? {
                xg_home: fields.xg?.home ?? null,
                xg_away: fields.xg?.away ?? null,
                xg_model: fields.xg?.model ?? null,
                xg_detail: fields.xg ?? null,
                shots: fields.shots ?? null,
                ratings: fields.ratings ?? null,
                ratings_provider: fields.ratings ? "FotMob" : null,
                potm: fields.potm ?? null,
                momentum: fields.momentum ?? null,
                momentum_provider: fields.momentum ? "FotMob" : null,
                xg_fetched_at: fields.xg ? stamp : null,
                xg_ok: !!fields.xg,
                shots_fetched_at: fields.shots ? stamp : null,
                shots_ok: !!fields.shots,
                ratings_fetched_at: fields.ratings ? stamp : null,
                ratings_ok: !!fields.ratings,
                momentum_fetched_at: fields.momentum ? stamp : null,
                momentum_ok: !!fields.momentum,
              }
            : {};
          const { error: writeError } = await admin
            .from("fixture_provider_data")
            .upsert(
              {
                fixture_id: fixture.id,
                provider: "fotmob",
                ...patch,
                insight_facts: fields.facts ?? null,
                predicted_xi: fields.predictedXi ?? null,
                facts_fetched_at: fields.facts ? stamp : null,
                facts_ok: !!fields.facts,
                predicted_xi_fetched_at: fields.predictedXi ? stamp : null,
                predicted_xi_ok: !!fields.predictedXi,
                fetched_at: stamp,
                attempts: (old?.attempts ?? 0) + 1,
                last_error: null,
                last_status: null,
                tried_at: stamp,
              },
              { onConflict: "fixture_id,provider" },
            );
          if (writeError) {
            throw new Error(`pollSlowProviders write: ${writeError.message}`);
          }
          counter.wrote();
          failures = 0;
        } else {
          failures++;
          if (result.kind === "shape") {
            await writeProviderShapeIssue(admin, counter, {
              provider: "fotmob",
              endpoint: "matchDetails",
              ref: mapping.external_id,
              reason: "parse",
            });
          }
          const attempts = (old?.attempts ?? 0) + 1;
          const { error: failureError } = await admin
            .from("fixture_provider_data")
            .upsert(
              {
                fixture_id: fixture.id,
                provider: "fotmob",
                fetched_at: stamp,
                attempts,
                last_error: result.kind,
                last_status: result.kind === "http" ? result.status : null,
                tried_at: new Date(
                  now.getTime() + (attempts >= 3 ? 24 : 4) * 3_600_000,
                ).toISOString(),
                xg_ok: false,
                shots_ok: false,
                ratings_ok: false,
                momentum_ok: false,
                facts_ok: false,
                predicted_xi_ok: false,
              },
              { onConflict: "fixture_id,provider" },
            );
          if (failureError) {
            throw new Error(
              `pollSlowProviders failure write: ${failureError.message}`,
            );
          }
          counter.wrote();
          if (failures >= 5) {
            const { error: issueError } = await admin.from("sync_issues").insert({
              source: "fotmob",
              kind: "provider-breaker",
              ref: null,
              detail: { failures },
            });
            if (issueError) {
              throw new Error(`pollSlowProviders issue: ${issueError.message}`);
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
