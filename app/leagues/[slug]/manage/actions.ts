"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { generateToken, generateShortCode } from "@/lib/invite";

// ── Guard ───────────────────────────────────────────────────────────────────

type League = {
  id: string;
  name: string;
  slug: string;
  status: string;
  created_by: string;
  default_stake_inr: number;
};

export async function requireCaptain(
  slug: string,
): Promise<{ league: League; userId: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createServiceRoleClient();

  const { data: league } = await admin
    .from("leagues")
    .select("id, name, slug, status, created_by, default_stake_inr")
    .eq("slug", slug)
    .single();

  if (!league) redirect("/");

  // Allow captain or admin (profiles.is_admin)
  if (league.created_by !== user.id) {
    const { data: profile } = await admin
      .from("profiles")
      .select("is_admin")
      .eq("id", user.id)
      .maybeSingle();
    if (!profile?.is_admin) redirect("/leagues/" + slug);
  }

  return { league: league as League, userId: user.id };
}

// ── Actions ─────────────────────────────────────────────────────────────────

export async function revokeInvite(slug: string): Promise<void> {
  const { league } = await requireCaptain(slug);
  const admin = createServiceRoleClient();

  await admin
    .from("league_invites")
    .update({ revoked_at: new Date().toISOString() })
    .eq("league_id", league.id)
    .is("revoked_at", null);

  redirect("/leagues/" + slug + "/manage");
}

export async function regenerateInvite(slug: string): Promise<void> {
  const { league, userId } = await requireCaptain(slug);
  const admin = createServiceRoleClient();

  // Revoke current active invite (if any)
  await admin
    .from("league_invites")
    .update({ revoked_at: new Date().toISOString() })
    .eq("league_id", league.id)
    .is("revoked_at", null);

  // Insert new invite (retry up to 3× on unique violation)
  let inserted = false;
  for (let attempt = 0; attempt < 3 && !inserted; attempt++) {
    const token = generateToken();
    const short_code = generateShortCode();

    const { error } = await admin.from("league_invites").insert({
      league_id: league.id,
      token,
      short_code,
      created_by: userId,
    });

    if (!error) {
      inserted = true;
    } else if (error.code !== "23505") {
      throw error;
    }
  }

  if (!inserted) {
    throw new Error("Could not generate a unique invite after 3 attempts.");
  }

  redirect("/leagues/" + slug + "/manage");
}

export type RemoveMemberState = { error: string | null };

export async function removeMember(
  slug: string,
  targetUserId: string,
): Promise<RemoveMemberState> {
  const { league } = await requireCaptain(slug);

  if (targetUserId === league.created_by) {
    return { error: "Cannot remove the league captain." };
  }

  const admin = createServiceRoleClient();

  // Close the membership instead of deleting it: member_competitions references the row, and
  // the routine takes the same locks as gameweek entry so a removal cannot race an entry.
  const { error } = await admin.rpc("leave_league", {
    p_league_id: league.id,
    p_user_id: targetUserId,
  });

  if (error) return { error: error.message };

  redirect("/leagues/" + slug + "/manage");
}

export async function archiveLeague(slug: string): Promise<void> {
  const { league } = await requireCaptain(slug);
  const admin = createServiceRoleClient();

  // Archives the league AND its competition rows in one transaction: entry and mirror check the
  // competition row, so leaving it active would let members keep entering an archived league.
  const { error } = await admin.rpc("archive_league", { p_league_id: league.id });
  if (error) throw error;

  redirect("/leagues/" + slug + "/manage");
}
