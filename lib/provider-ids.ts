import type { PollCounter } from "./phase4-poll-runtime";

type Admin = ReturnType<typeof import("./supabase/service").createServiceRoleClient>;

export async function replaceProviderFixtureId(
  admin: Admin,
  counter: PollCounter,
  row: {
    fixture_id: string;
    provider: "fotmob" | "understat";
    external_id: string;
    confidence: "exact" | "matched" | "manual";
    matched_on: unknown;
  },
): Promise<void> {
  const { data: removed, error } = await admin.rpc("replace_provider_fixture_id", {
    p_fixture_id: row.fixture_id,
    p_provider: row.provider,
    p_external_id: row.external_id,
    p_confidence: row.confidence,
    p_matched_on: row.matched_on,
  });
  if (error) throw new Error(`provider id remap(${row.provider}): ${error.message}`);
  counter.wrote((Number(removed) || 0) + 1);
}
