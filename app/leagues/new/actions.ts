"use server";

import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { validateSlug, validateStake } from "@/lib/validation";
import { generateToken, generateShortCode } from "@/lib/invite";

export async function checkSlug(
  slug: string,
): Promise<{ available: boolean; error?: string }> {
  const result = validateSlug(slug);
  if (!result.ok) return { available: false, error: result.error };

  const admin = createServiceRoleClient();
  const { data } = await admin
    .from("leagues")
    .select("id")
    .eq("slug", result.value)
    .maybeSingle();

  return { available: data === null };
}

export type CreateState = {
  error: string | null;
  created?: {
    slug: string;
    token: string;
    shortCode: string;
    name: string;
  };
};

export async function createLeague(
  _prev: CreateState,
  formData: FormData,
): Promise<CreateState> {
  // ── 1. Auth ──────────────────────────────────────────────────────────────
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "You must be logged in to create a league." };

  // ── 2. Validate inputs ───────────────────────────────────────────────────
  const nameRaw = String(formData.get("name") ?? "").trim();
  if (!nameRaw) return { error: "League name is required." };
  if (nameRaw.length > 60) return { error: "League name must be 60 chars or fewer." };

  const stakeResult = validateStake(String(formData.get("stake") ?? ""));
  if (!stakeResult.ok) return { error: stakeResult.error };
  const stake = stakeResult.value;

  const slugResult = validateSlug(String(formData.get("slug") ?? ""));
  if (!slugResult.ok) return { error: slugResult.error };
  const slug = slugResult.value;

  const admin = createServiceRoleClient();
  let leagueId: string | null = null;

  try {
    // ── 3. Insert league ───────────────────────────────────────────────────
    const { data: lg, error: lgErr } = await admin
      .from("leagues")
      .insert({
        name: nameRaw,
        slug,
        default_stake_inr: stake,
        created_by: user.id,
      })
      .select("id")
      .single();

    if (lgErr) {
      if (lgErr.code === "23505") {
        return { error: "That league URL is taken — pick another." };
      }
      throw lgErr;
    }

    leagueId = lg.id;

    // ── 4. Insert creator as first member ──────────────────────────────────
    const { error: memberErr } = await admin.from("league_members").insert({
      league_id: leagueId,
      user_id: user.id,
    });
    if (memberErr) throw memberErr;

    // ── 5. Generate + insert invite (retry up to 3×) ───────────────────────
    let token = "";
    let short_code = "";
    let inviteInserted = false;

    for (let attempt = 0; attempt < 3 && !inviteInserted; attempt++) {
      token = generateToken();
      short_code = generateShortCode();

      const { error: inviteErr } = await admin.from("league_invites").insert({
        league_id: leagueId,
        token,
        short_code,
        created_by: user.id,
      });

      if (!inviteErr) {
        inviteInserted = true;
      } else if (inviteErr.code !== "23505") {
        throw inviteErr;
      }
      // 23505 = unique violation on token/short_code → regenerate and retry
    }

    if (!inviteInserted) {
      throw new Error("Could not generate a unique invite after 3 attempts.");
    }

    // ── 6. Bulk-insert contests for future fixtures ────────────────────────
    const { data: fixtures, error: fixErr } = await admin
      .from("fixtures")
      .select("id, kickoff_at, is_knockout");
    if (fixErr) throw fixErr;

    const now = Date.now();
    const contests = (fixtures ?? [])
      .filter((f) => new Date(f.kickoff_at).getTime() > now)
      .map((f) => ({
        league_id: leagueId!,
        fixture_id: f.id,
        stake_inr: stake,
        status: "open" as const,
        lock_at: f.kickoff_at,
        is_knockout: f.is_knockout,
      }));

    if (contests.length > 0) {
      const { error: contestErr } = await admin.from("contests").upsert(contests, {
        onConflict: "league_id,fixture_id",
        ignoreDuplicates: true,
      });
      if (contestErr) throw contestErr;
    }

    // ── 7. Success ─────────────────────────────────────────────────────────
    return {
      error: null,
      created: { slug, token, shortCode: short_code, name: nameRaw },
    };
  } catch (err) {
    // ── Rollback: delete the league row (cascades invites/contests) ────────
    if (leagueId) {
      // Delete members first in case FK blocks cascade
      try {
        await admin.from("league_members").delete().eq("league_id", leagueId);
      } catch {
        // Ignore — cascade will clean up or the league row will be left orphaned
      }
      try {
        await admin.from("leagues").delete().eq("id", leagueId);
      } catch {
        // Ignore
      }
    }
    console.error("[createLeague] rollback triggered:", err);
    return { error: "Something went wrong. Please try again." };
  }
}
