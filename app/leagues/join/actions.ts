"use server";

import { createServiceRoleClient } from "@/lib/supabase/service";
import { createClient } from "@/lib/supabase/server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export type InviteDTO =
  | { status: "notfound" }
  | { status: "revoked" }
  | {
      status: "active";
      leagueId: string;
      slug: string;
      leagueName: string;
      captainName: string;
      memberCount: number;
      stakeInr: number;
      token: string;
    };

export async function resolveInvite(raw: string): Promise<InviteDTO> {
  const admin = createServiceRoleClient();
  const normalized = raw.trim().toUpperCase();

  const { data: invite } = await admin
    .from("league_invites")
    .select("id, token, revoked_at, league_id")
    .or(`token.eq.${raw},short_code.eq.${normalized}`)
    .maybeSingle();

  if (!invite) return { status: "notfound" };
  if (invite.revoked_at) return { status: "revoked" };

  const { data: league } = await admin
    .from("leagues")
    .select("id, name, slug, default_stake_inr, created_by")
    .eq("id", invite.league_id)
    .single();

  if (!league) return { status: "notfound" };

  const { data: captain } = await admin
    .from("profiles")
    .select("display_name")
    .eq("id", league.created_by)
    .maybeSingle();

  const { count } = await admin
    .from("league_members")
    .select("id", { count: "exact", head: true })
    .eq("league_id", league.id);

  return {
    status: "active",
    leagueId: league.id,
    slug: league.slug,
    leagueName: league.name,
    captainName: captain?.display_name ?? "Captain",
    memberCount: count ?? 0,
    stakeInr: league.default_stake_inr,
    token: invite.token,
  };
}

export async function joinLeagueForUser(
  raw: string,
  userId: string,
): Promise<{ ok: boolean; slug?: string; error?: string; already?: boolean }> {
  const dto = await resolveInvite(raw);
  if (dto.status !== "active") return { ok: false, error: "inactive" };

  const admin = createServiceRoleClient();

  // Idempotency: already a member?
  const { data: existing } = await admin
    .from("league_members")
    .select("id")
    .eq("league_id", dto.leagueId)
    .eq("user_id", userId)
    .maybeSingle();

  if (existing) return { ok: true, slug: dto.slug, already: true };

  const { error: insertError } = await admin
    .from("league_members")
    .insert({ league_id: dto.leagueId, user_id: userId });

  // 23505 = unique_violation — race where another request inserted first
  if (insertError && insertError.code !== "23505") {
    return { ok: false, error: insertError.message };
  }

  return { ok: true, slug: dto.slug };
}

export async function joinLeague(raw: string): Promise<{ error: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const result = await joinLeagueForUser(raw, user.id);
  if (result.ok && result.slug) {
    redirect("/leagues/" + result.slug);
  }

  return { error: "This invite link is no longer active." };
}

export async function stashInviteAndGo(
  token: string,
  dest: string,
): Promise<never> {
  const c = await cookies();
  c.set("cf_invite", token, {
    httpOnly: true,
    sameSite: "lax",
    secure: true,
    maxAge: 900,
    path: "/",
  });
  redirect(dest);
}

export async function consumePendingInvite(
  userId: string,
): Promise<string | null> {
  const c = await cookies();
  const token = c.get("cf_invite")?.value;
  if (!token) return null;

  const result = await joinLeagueForUser(token, userId);
  c.delete("cf_invite");
  return result.ok && result.slug ? result.slug : null;
}

export type CodeState = { error: string | null };

export async function submitCode(
  _prev: CodeState,
  formData: FormData,
): Promise<CodeState> {
  const code = String(formData.get("code") ?? "").trim();
  const dto = await resolveInvite(code);
  if (dto.status === "active") {
    redirect("/j/" + dto.token);
  }
  return { error: "No active league found for that code." };
}
