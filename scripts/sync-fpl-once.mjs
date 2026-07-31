// Phase 1 step 5: run exactly one FPL sync. Arms the lease (next_due_at = now()) and then
// ticks the cron endpoint, which is the only place syncFpl runs — so this exercises the real
// code path rather than a script-only copy of it.
//
//   node --env-file=.env.local scripts/sync-fpl-once.mjs [base-url]
//
// Defaults to production. After it returns, run scripts/verify-phase1.mjs.

import { createClient } from "@supabase/supabase-js";

const base = process.argv[2] ?? "https://cashford.vercel.app";
const secret = process.env.CRON_SECRET;
if (!secret) {
  console.error("CRON_SECRET missing");
  process.exit(1);
}

const svc = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false }, db: { schema: "cashford" } },
);

const { data: before, error: readErr } = await svc
  .from("sync_state").select("*").eq("key", "fpl-sync").maybeSingle();
if (readErr || !before) {
  console.error(`✗ sync_state 'fpl-sync' not found: ${readErr?.message ?? "missing row"}`);
  process.exit(1);
}
console.log(`before: next_due_at=${before.next_due_at} lease_token=${before.lease_token ?? "—"}`);

// A held lease means a sync is already running (or crashed mid-run); do not stomp on it.
if (before.lease_token && before.lease_until && new Date(before.lease_until) > new Date()) {
  console.error("✗ lease is currently held — wait for it to expire before forcing a run");
  process.exit(1);
}

const { error: armErr } = await svc
  .from("sync_state")
  .update({ next_due_at: new Date().toISOString() })
  .eq("key", "fpl-sync");
if (armErr) {
  console.error(`✗ could not arm the lease: ${armErr.message}`);
  process.exit(1);
}
console.log("✓ armed next_due_at = now()");

const res = await fetch(`${base}/api/cron/tick`, {
  method: "POST",
  headers: { Authorization: `Bearer ${secret}` },
});
const body = await res.json();
console.log(`tick ${res.status}`);
console.log(JSON.stringify(body.fpl ?? body, null, 2));
console.log(`gameweeks: ${JSON.stringify(body.gameweeks ?? null)}`);

const { data: after } = await svc
  .from("sync_state").select("next_due_at, last_run_at, lease_token")
  .eq("key", "fpl-sync").maybeSingle();
console.log(
  `after: next_due_at=${after?.next_due_at} last_run_at=${after?.last_run_at} lease_token=${after?.lease_token ?? "—"}`,
);

if (!body?.fpl?.ran) {
  console.error("\n✗ the sync did not run — see the reason above");
  process.exit(1);
}
console.log("\n✓ one sync completed");
