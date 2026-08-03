"use server";

import { createServiceRoleClient } from "@/lib/supabase/service";
import { createClient } from "@/lib/supabase/server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { GW_ACTION_COPY } from "@/lib/gw-copy";
import {
  resolveInvite as resolveInviteSource,
  type InviteDTO,
} from "@/lib/gw-invites";

export type { InviteDTO, InviteParticipation } from "@/lib/gw-invites";

async function loadInvite(raw: string): Promise<InviteDTO> {
  const admin = createServiceRoleClient();
  const normalized = raw.trim().toUpperCase();

  // Look up by opaque token, then by short code — two precise eq lookups rather
  // than an .or() built from the raw URL value (interpolating it into the filter
  // string is a PostgREST injection vector: a crafted token like
  // "x,revoked_at.is.null" could match an arbitrary active invite).
  let inviteQuery = await admin
    .from("league_invites")
    .select("token, revoked_at, league_id")
    .eq("token", raw)
    .maybeSingle();
  if (inviteQuery.error) {
    throw new Error(`resolve-invite-token: ${inviteQuery.error.message}`);
  }
  let invite = inviteQuery.data;
  if (!invite) {
    inviteQuery = await admin
      .from("league_invites")
      .select("token, revoked_at, league_id")
      .eq("short_code", normalized)
      .maybeSingle();
    if (inviteQuery.error) {
      throw new Error(`resolve-invite-code: ${inviteQuery.error.message}`);
    }
    invite = inviteQuery.data;
  }

  if (!invite) return { status: "notfound" };
  if (invite.revoked_at) return { status: "revoked" };

  const leagueQuery = await admin
    .from("leagues")
    .select("id, name, slug, default_stake_inr, created_by, status")
    .eq("id", invite.league_id)
    .single();
  if (leagueQuery.error) {
    throw new Error(`resolve-invite-league: ${leagueQuery.error.message}`);
  }
  const league = leagueQuery.data;

  if (!league) return { status: "notfound" };

  const captainQuery = await admin
    .from("profiles")
    .select("display_name")
    .eq("id", league.created_by)
    .maybeSingle();
  if (captainQuery.error) {
    throw new Error(`resolve-invite-captain: ${captainQuery.error.message}`);
  }
  const captain = captainQuery.data;

  // league_members has a composite PK (league_id, user_id) and NO "id" column —
  // count over a real column.
  const countQuery = await admin
    .from("league_members")
    .select("user_id", { count: "exact", head: true })
    .eq("league_id", league.id)
    .is("left_at", null);
  if (countQuery.error) {
    throw new Error(`resolve-invite-members: ${countQuery.error.message}`);
  }

  const participationQuery = await admin
    .from("league_competitions")
    .select(
      "status, joined_at, eligible_from_gameweek_id, competitions!inner(id, name, slug, format)",
    )
    .eq("league_id", league.id)
    .order("joined_at", { ascending: false });
  if (participationQuery.error) {
    throw new Error(`resolve-invite-participation: ${participationQuery.error.message}`);
  }

  const active = (participationQuery.data ?? []).find((row: any) => row.status === "active") as any;
  const activeCompetition = active ? (Array.isArray(active.competitions) ? active.competitions[0] : active.competitions) : null;
  let nextGameweekNumber: number | null = null;
  let nextDeadlineAt: string | null = null;
  let eligibleFromGameweekNumber: number | null = null;
  if (activeCompetition) {
    const next = await admin.from("gameweeks").select("number, deadline_at").eq("competition_id", activeCompetition.id).eq("status", "open").gt("deadline_at", new Date().toISOString()).order("number", { ascending: true }).limit(1).maybeSingle();
    if (next.error) throw new Error(`resolve-invite-gameweek: ${next.error.message}`);
    nextGameweekNumber = next.data?.number ?? null;
    nextDeadlineAt = next.data?.deadline_at ?? null;
    if (active.eligible_from_gameweek_id) {
      const eligible = await admin.from("gameweeks").select("number").eq("id", active.eligible_from_gameweek_id).maybeSingle();
      if (eligible.error) throw new Error(`resolve-invite-eligibility: ${eligible.error.message}`);
      eligibleFromGameweekNumber = eligible.data?.number ?? null;
    }
  }
  return resolveInviteSource({
    status: "active",
    leagueId: league.id,
    slug: league.slug,
    leagueName: league.name,
    captainName: captain?.display_name ?? "Captain",
    memberCount: countQuery.count ?? 0,
    stakeInr: league.default_stake_inr,
    token: invite.token,
    leagueStatus: league.status,
    anteInr: active?.adopted_stake_inr ?? league.default_stake_inr,
    nextGameweekNumber,
    nextDeadlineAt,
    eligibleFromGameweekNumber,
    competitions: (participationQuery.data ?? []).map((row: any) => {
      const competition = Array.isArray(row.competitions)
        ? row.competitions[0]
        : row.competitions;
      return {
        status: row.status,
        id: competition.id,
        name: competition.name,
        format: competition.format,
        slug: competition.slug,
        joinedAt: row.joined_at,
      };
    }),
  });
}

export async function resolveInvite(raw: string): Promise<InviteDTO> {
  return loadInvite(raw);
}

/**
 * Does this member still lack a member_competitions row for one of the league's active
 * league-format competitions? Only then does a repeated join have work to do.
 *
 * Both reads fail loudly. Treating an unavailable boundary as an empty result would hide a
 * provisioning fault.
 */
async function hasUnprovisionedCompetition(leagueId: string, userId: string): Promise<boolean> {
  const admin = createServiceRoleClient();
  const [active, mine] = await Promise.all([
    admin
      .from("league_competitions")
      .select("competition_id, competitions!inner(format)")
      .eq("league_id", leagueId)
      .eq("status", "active")
      .eq("competitions.format", "league"),
    admin
      .from("member_competitions")
      .select("competition_id")
      .eq("league_id", leagueId)
      .eq("user_id", userId),
  ]);

  if (active.error) {
    throw new Error(`join-active-participation: ${active.error.message}`);
  }
  if (mine.error) {
    throw new Error(`join-member-participation: ${mine.error.message}`);
  }

  const have = new Set((mine.data ?? []).map((r) => r.competition_id as string));
  return (active.data ?? []).some((r) => !have.has(r.competition_id as string));
}

// Membership and the member's per-competition eligibility must land together, so the write is
// one call to cashford.join_league. It reads auth.uid() itself, hence the authenticated client;
// callers pass the id they believe is signed in and we refuse to act on a mismatch.
export async function joinLeagueForUser(
  raw: string,
  userId: string,
): Promise<{ ok: boolean; slug?: string; error?: string; already?: boolean }> {
  const dto = await resolveInvite(raw);
  if (dto.status !== "active") return { ok: false, error: "inactive" };
  if (dto.leagueStatus === "archived") return { ok: false, error: "inactive" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || user.id !== userId) return { ok: false, error: "not signed in" };

  const admin = createServiceRoleClient();
  const existingQuery = await admin
    .from("league_members")
    .select("user_id, left_at")
    .eq("league_id", dto.leagueId)
    .eq("user_id", userId)
    .maybeSingle();
  if (existingQuery.error) {
    throw new Error(`join-existing-member: ${existingQuery.error.message}`);
  }
  const existing = existingQuery.data;

  // A member re-opening their own invite has nothing to write, and the write is not free: the
  // repeated member_competitions insert parks behind any transaction that has just touched that
  // row (maintenance resolving a null eligibility boundary), holding the league row while it
  // waits. So only call the routine when there is a row missing — which happens when a
  // competition was added to the league after this member joined, since join_league is the only
  // place that backfills member_competitions.
  if (existing && existing.left_at == null && !(await hasUnprovisionedCompetition(dto.leagueId, userId))) {
    return { ok: true, slug: dto.slug, already: true };
  }

  const { error } = await supabase.rpc("join_league", { p_invite: dto.token });
  if (error) {
    console.error("[joinLeague]", error);
    return { ok: false, error: "inactive" };
  }

  return { ok: true, slug: dto.slug, already: !!existing };
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

  return { error: GW_ACTION_COPY.inactiveInvite };
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

export async function submitCode(formData: FormData): Promise<never> {
  const code = String(formData.get("code") ?? "").trim();
  const dto = await resolveInvite(code);
  if (dto.status === "active") {
    redirect("/leagues/join?token=" + encodeURIComponent(dto.token));
  }
  redirect("/leagues/join?invalid=1");
}
