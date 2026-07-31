import type { PollCounter } from "./phase4-poll-runtime";

type Admin = ReturnType<typeof import("./supabase/service").createServiceRoleClient>;

type SampleBody = object;

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function presentKeys(body: unknown): string[] {
  if (!body || typeof body !== "object" || Array.isArray(body)) return [];
  return Object.entries(body)
    .filter(([, value]) => value != null)
    .map(([key]) => key);
}

export async function writeProviderShapeIssue(
  admin: Admin,
  counter: PollCounter,
  input: {
    provider: "fotmob" | "understat";
    endpoint: string;
    ref: string | null;
    reason: "parse" | "bytes" | "missing_block";
    detail?: Record<string, unknown>;
  },
) {
  await counter.renew();
  const { error } = await admin.from("sync_issues").insert({
    source: input.provider,
    kind: "provider_shape",
    ref: input.ref,
    detail: {
      endpoint: input.endpoint,
      reason: input.reason,
      ...input.detail,
    },
  });
  if (error) {
    throw new Error(`${input.provider} shape issue: ${error.message}`);
  }
  counter.wrote();
}

export async function recordProviderSample(
  admin: Admin,
  counter: PollCounter,
  input: {
    provider: "fotmob" | "understat";
    endpoint: string;
    ref: string | null;
    status: number;
    body: SampleBody;
  },
) {
  const bytes = JSON.stringify(input.body).length;
  const { data: retained, error: readError } = await admin
    .from("provider_samples")
    .select("bytes, body")
    .eq("provider", input.provider)
    .eq("endpoint", input.endpoint)
    .order("fetched_at", { ascending: false })
    .limit(5);
  if (readError) {
    throw new Error(`${input.provider} sample history: ${readError.message}`);
  }

  const oldBytes = (retained ?? [])
    .map((row: any) => row.bytes)
    .filter((value: unknown): value is number =>
      typeof value === "number" && value >= 0
    );
  const oldMedian = median(oldBytes);
  const previousKeys = new Set(
    (retained ?? []).flatMap((row: any) => presentKeys(row.body)),
  );
  const currentKeys = new Set(presentKeys(input.body));
  const missingBlocks = [...previousKeys].filter((key) => !currentKeys.has(key));
  const byteSwing =
    oldMedian != null &&
    oldMedian > 0 &&
    Math.abs(bytes - oldMedian) / oldMedian > 0.4;

  await counter.renew();
  const { error: sampleError } = await admin.from("provider_samples").insert({
    provider: input.provider,
    endpoint: input.endpoint,
    ref: input.ref,
    status: input.status,
    bytes,
    body: input.body,
  });
  if (sampleError) {
    throw new Error(`${input.provider} sample: ${sampleError.message}`);
  }
  counter.wrote();

  if (byteSwing || missingBlocks.length) {
    await writeProviderShapeIssue(admin, counter, {
      provider: input.provider,
      endpoint: input.endpoint,
      ref: input.ref,
      reason: missingBlocks.length ? "missing_block" : "bytes",
      detail: {
        bytes,
        medianBytes: oldMedian,
        missingBlocks,
      },
    });
  }
}
