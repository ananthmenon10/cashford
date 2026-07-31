import fs from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import {
  isPhase4SyncKey,
  PHASE4_LAUNCH_KEYS,
  PHASE4_SYNC_KEYS,
} from "../lib/poll-keys.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CONTRACT = path.join(
  ROOT,
  "docs/plans/2026-07-31-001-phase4-ro-contract.md",
);
const args = process.argv.slice(2);
const keyIndex = args.indexOf("--key");
const keyCount = args.filter((arg) => arg === "--key").length;
const namedKey = keyIndex >= 0 ? args[keyIndex + 1] : null;
const confirm = args.includes("--confirm");
const revert = args.includes("--revert");
const explicitDryRun = args.includes("--dry-run");
const deployedShaIndex = args.indexOf("--deployed-sha");
const deployedSha = deployedShaIndex >= 0 ? args[deployedShaIndex + 1] : null;

function exactArgs(expected) {
  return args.length === expected.length && expected.every((arg, index) => args[index] === arg);
}

if (keyIndex >= 0 && (!namedKey || !isPhase4SyncKey(namedKey))) {
  throw new Error(`--key must be one of: ${PHASE4_SYNC_KEYS.join(", ")}`);
}
if (deployedShaIndex >= 0 && (!deployedSha || !/^[0-9a-f]{40}$/.test(deployedSha))) {
  throw new Error("--deployed-sha must be a 40-character lowercase commit SHA");
}
if (deployedShaIndex >= 0 && !confirm) {
  throw new Error("--deployed-sha is valid only for a confirmed arm");
}
if (confirm && !revert && !exactArgs(["--key", namedKey, "--confirm", "--deployed-sha", deployedSha])) {
  throw new Error("Arming requires exactly: --key <name> --confirm --deployed-sha <sha>");
}
if (revert && !exactArgs(["--key", namedKey, "--revert", "--confirm"])) {
  throw new Error("Revert requires exactly: --key <key> --revert --confirm");
}
if (confirm && explicitDryRun) {
  throw new Error("Choose either --confirm or --dry-run");
}
const dryRun = !revert && !confirm;
const keys = namedKey
  ? [namedKey]
  : revert
    ? [...PHASE4_SYNC_KEYS]
    : [...PHASE4_LAUNCH_KEYS];
const dueAt = revert ? "infinity" : new Date().toISOString();

if (dryRun) {
  for (const key of keys) console.log(`${key} -> ${dueAt} (dry run)`);
  console.log(
    "No rows changed. Arming needs --key <name> --confirm and an approved RO contract.",
  );
  process.exit(0);
}

if (confirm && !revert) {
  const contract = fs.readFileSync(CONTRACT, "utf8");
  const status = contract.match(/^Status:\s*(.+)$/m)?.[1] ?? "missing";
  if (status !== "APPROVED") {
    throw new Error(`RO contract is not approved: ${status}`);
  }
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  throw new Error(
    "NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required",
  );
}
const admin = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
  db: { schema: "cashford" },
});

if (confirm && !revert) {
  const contract = fs.readFileSync(CONTRACT, "utf8");
  const actualContract = createHash("sha256").update(contract).digest("hex");
  const deployed = await fetch("https://cashford.vercel.app", {
    redirect: "follow",
    cache: "no-store",
  });
  const deployedBody = await deployed.text();
  const appVersion = deployedBody.match(/\bv([0-9]+)\b/i)?.[1] ?? null;
  if (!deployed.ok) {
    throw new Error(`deployed app identity fetch failed with ${deployed.status}`);
  }
  const { data: approvals, error: approvalError } = await admin
    .from("sync_issues")
    .select("id, detail")
    .eq("source", "phase4")
    .eq("kind", "ro_approval")
    .eq("ref", "phase4-ro-contract")
    .is("resolved_at", null);
  if (approvalError) throw new Error(`read RO approval: ${approvalError.message}`);
  if (!approvals || approvals.length !== 1) {
    throw new Error(`expected exactly one phase4 RO approval row, found ${approvals?.length ?? 0}`);
  }
  const detail = approvals[0].detail;
  const approvedContract = detail?.contract_sha256;
  const approvedBuild = detail?.deployed_build_sha;
  if (!/^[0-9a-f]{64}$/.test(approvedContract ?? "") || !/^[0-9a-f]{40}$/.test(approvedBuild ?? "")) {
    throw new Error("RO approval detail must contain contract_sha256 and deployed_build_sha");
  }
  if (actualContract !== approvedContract) {
    throw new Error(`contract SHA-256 mismatch: approval has ${approvedContract}, current file has ${actualContract}`);
  }
  if (deployedSha !== approvedBuild) {
    throw new Error(`deployed build SHA mismatch: approval has ${approvedBuild}, supplied ${deployedSha}`);
  }
  if (detail.deployed_app_version != null && appVersion !== String(detail.deployed_app_version)) {
    throw new Error(`deployed APP_VERSION mismatch: approval has ${detail.deployed_app_version}, fetched ${appVersion ?? "missing"}`);
  }
  console.log(`verified external RO approval; deployed endpoint ${deployed.status}, APP_VERSION ${appVersion ?? "not exposed"}`);
}

for (const key of keys) {
  const { data: armed, error } = await admin.rpc("arm_sync_key", {
    p_key: key,
    p_due_at: dueAt,
  });
  if (error) throw new Error(`arm_sync_key(${key}): ${error.message}`);
  if (!armed) throw new Error(`${key}: row missing or currently leased`);
  console.log(`${key} -> ${dueAt}`);
}
