"use server";

import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { GW_ACTION_COPY } from "@/lib/gw-copy";
import { activeCompetitions } from "@/lib/gw-invites";
import { validateSlug, validateStake } from "@/lib/validation";

export async function checkSlug(
  slug: string,
): Promise<{ available: boolean; error?: string }> {
  const result = validateSlug(slug);
  if (!result.ok) return { available: false, error: result.error };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { available: false, error: GW_ACTION_COPY.signInToCreate };
  }

  const admin = createServiceRoleClient();
  const { data, error } = await admin
    .from("leagues")
    .select("id")
    .eq("slug", result.value)
    .maybeSingle();
  if (error) throw new Error(`check-slug: ${error.message}`);

  return { available: data === null };
}

export type CreatableCompetition = { slug: string; name: string; format: string };

// Only an ACTIVE competition can be created against — a competition still 'preparing' has no
// open gameweek and no verified fixture data, so it must not appear in the picker.
export async function listCreatableCompetitions(): Promise<CreatableCompetition[]> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("not authenticated");

  const admin = createServiceRoleClient();
  const { data, error } = await admin
    .from("competitions")
    .select("slug, name, format, status")
    .order("created_at", { ascending: false });
  if (error) throw new Error(`list-creatable-competitions: ${error.message}`);
  return activeCompetitions(data ?? []).map(({ slug, name, format }) => ({
    slug,
    name,
    format,
  }));
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

// Thin wrapper over cashford.create_league: league + captain membership + invite +
// competition wiring + the opening pot all commit together, or none of them do.
export async function createLeague(
  _prev: CreateState,
  formData: FormData,
): Promise<CreateState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: GW_ACTION_COPY.signInToCreate };

  const nameRaw = String(formData.get("name") ?? "").trim();
  if (!nameRaw) return { error: GW_ACTION_COPY.nameRequired };
  if (nameRaw.length > 60) return { error: GW_ACTION_COPY.nameTooLong };

  const stakeResult = validateStake(String(formData.get("stake") ?? ""));
  if (!stakeResult.ok) return { error: stakeResult.error };

  const slugResult = validateSlug(String(formData.get("slug") ?? ""));
  if (!slugResult.ok) return { error: slugResult.error };

  const competitionSlug = String(formData.get("competition") ?? "").trim();
  if (!competitionSlug) return { error: GW_ACTION_COPY.competitionRequired };

  const { data, error } = await supabase.rpc("create_league", {
    p_name: nameRaw,
    p_slug: slugResult.value,
    p_stake: stakeResult.value,
    p_competition_slug: competitionSlug,
  });

  if (error) {
    if (error.code === "23505") return { error: GW_ACTION_COPY.urlTaken };
    console.error("[createLeague]", error);
    return { error: GW_ACTION_COPY.createFailed };
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.invite_token) return { error: GW_ACTION_COPY.createFailed };

  return {
    error: null,
    created: {
      slug: slugResult.value,
      token: row.invite_token,
      shortCode: row.short_code,
      name: nameRaw,
    },
  };
}
