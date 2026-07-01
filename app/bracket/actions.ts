"use server";

// Server actions for the Knockout Circle builder.
// Pick writes go through the RLS (user) client so every gate applies — future
// kickoff, league membership, bracket-unlocked, participant, no-peek. Lock/unlock
// touch the service-role-only header table, and re-derive completeness + score
// server-side (never trust the client) before committing.

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { loadKnockoutView } from "@/lib/knockout-data";
import { autoPicks, completeBracket, score } from "@/lib/knockout";

const TID = "wc2026";
const SLOT_RE = /^[1-5]:\d{1,2}$/;

export type ActionResult = { ok: true } | { ok: false; error: string };

/** Persist a promotion: upsert the pick at slotKey, clear the downstream slots. */
export async function applyKnockoutPromote(input: {
  slotKey: string;
  teamId: string;
  clearSlots: string[];
}): Promise<ActionResult> {
  if (!SLOT_RE.test(input.slotKey)) return { ok: false, error: "bad slot" };
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "not signed in" };

  // Authoritative slot→fixture binding (never trust the client's fixture id).
  const view = await loadKnockoutView(supabase, user.id);
  const fixtureId = view.slotFixtureId[input.slotKey];
  if (!fixtureId) return { ok: false, error: "slot not yet playable" };

  const { error } = await supabase.from("knockout_predictions").upsert(
    {
      user_id: user.id,
      tournament_id: TID,
      slot_key: input.slotKey,
      fixture_id: fixtureId,
      predicted_team_id: input.teamId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,tournament_id,slot_key" },
  );
  if (error) return { ok: false, error: error.message };

  const clear = (input.clearSlots ?? []).filter((s) => SLOT_RE.test(s));
  if (clear.length) {
    await supabase.from("knockout_predictions").delete().eq("user_id", user.id).eq("tournament_id", TID).in("slot_key", clear);
  }
  revalidatePath("/bracket");
  return { ok: true };
}

/** Clear picks (Reset): delete all the user's picks; the ring re-seeds from results. */
export async function resetKnockoutBracket(): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "not signed in" };
  const { error } = await supabase.from("knockout_predictions").delete().eq("user_id", user.id).eq("tournament_id", TID);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/bracket");
  return { ok: true };
}

/** Lock the bracket (full freeze) once complete; mint the share token + score snapshot. */
export async function lockKnockoutBracket(): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "not signed in" };

  const view = await loadKnockoutView(supabase, user.id);
  // A bracket is complete when every circle slot has a team — either the viewer's pick
  // or a real (auto-locked) result. Merge, then require all 31.
  const merged = { ...autoPicks(view.results), ...view.myPicks };
  if (!completeBracket(merged)) return { ok: false, error: "Complete your bracket first — pick a winner for every match." };

  const sc = score(view.myPicks, view.results);
  const admin = createServiceRoleClient();
  const { data: existing } = await admin
    .from("knockout_brackets")
    .select("share_token")
    .eq("user_id", user.id)
    .eq("tournament_id", TID)
    .maybeSingle();
  const token = (existing?.share_token as string) ?? randomBytes(24).toString("base64url");

  const { error } = await admin.from("knockout_brackets").upsert(
    {
      user_id: user.id,
      tournament_id: TID,
      locked_at: new Date().toISOString(),
      share_token: token,
      champion_team_id: merged["5:0"] ?? null,
      correct_picks: sc.correct,
      total_decided: sc.decided,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,tournament_id" },
  );
  if (error) return { ok: false, error: error.message };
  revalidatePath("/bracket");
  return { ok: true };
}

/** Unlock (Edit) — clears the freeze so future slots become editable again. */
export async function unlockKnockoutBracket(): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "not signed in" };
  const admin = createServiceRoleClient();
  const { error } = await admin.from("knockout_brackets").update({ locked_at: null, updated_at: new Date().toISOString() }).eq("user_id", user.id).eq("tournament_id", TID);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/bracket");
  return { ok: true };
}
