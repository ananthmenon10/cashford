import { NextResponse } from "next/server";
import { z } from "zod";
import { loadSeasonPickCorpus } from "@/lib/analytics-corpus-load";
import { buildPredictionHabits } from "@/lib/analytics-habits";
import { buildWeeklyLabels } from "@/lib/analytics-labels";
import { loadSeasonView } from "@/lib/gw-season";
import { buildRivalryModule } from "@/lib/analytics-rivalry";
import { buildYouVsRoom } from "@/lib/analytics-room";
import type { LeagueIdentity } from "@/lib/gw-view";
import type { AnalyticsModulesView } from "@/lib/analytics-modules";
import { requireUser } from "@/lib/gw-api";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { ANALYTICS_COPY } from "@/lib/analytics-copy";

export const dynamic = "force-dynamic";

const paramsSchema = z.object({
  leagueId: z.string().uuid(),
  competitionId: z.string().uuid(),
});

const CACHE_HEADERS = { "Cache-Control": "private, no-store" };

function json<T>(body: T, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: CACHE_HEADERS });
}

function emptyModules(leagueId: string, competitionId: string): AnalyticsModulesView {
  return {
    leagueId,
    competitionId,
    modules: {
      youVsRoom: null,
      rivalry: null,
      habits: null,
      weeklyLabels: null,
      clubReads: null,
      receipts: null,
    },
  };
}

function identityFor(leagueId: string, competitionId: string): LeagueIdentity {
  return {
    league: {
      id: leagueId,
      name: "",
      slug: "",
      createdBy: "",
      status: "active",
    },
    participation: {
      status: "active",
      format: "gameweek",
      competitionId,
      competitionName: "",
      competitionSlug: "",
    },
  };
}

export async function GET(request: Request) {
  const auth = await requireUser();
  if (!auth.ok) {
    auth.res.headers.set("Cache-Control", "private, no-store");
    return auth.res;
  }

  const parsed = paramsSchema.safeParse({
    leagueId: new URL(request.url).searchParams.get("leagueId"),
    competitionId: new URL(request.url).searchParams.get("competitionId"),
  });
  if (!parsed.success) return json({ error: ANALYTICS_COPY.apiInvalidScope }, 400);

  const { leagueId, competitionId } = parsed.data;
  const membership = await auth.db
    .from("league_members")
    .select("user_id")
    .eq("league_id", leagueId)
    .eq("user_id", auth.userId)
    .is("left_at", null)
    .maybeSingle();
  if (membership.error || !membership.data) return json({ error: ANALYTICS_COPY.apiNotFound }, 404);

  const pair = await auth.db
    .from("league_competitions")
    .select("league_id, status, competitions(format)")
    .eq("league_id", leagueId)
    .eq("competition_id", competitionId)
    .maybeSingle();
  if (pair.error || !pair.data) return json({ error: ANALYTICS_COPY.apiNotFound }, 404);

  const competition = Array.isArray((pair.data as any).competitions)
    ? (pair.data as any).competitions[0]
    : (pair.data as any).competitions;
  if (competition?.format === "cup") {
    return json(emptyModules(leagueId, competitionId));
  }

  try {
    const admin = createServiceRoleClient();
    const [season, corpus] = await Promise.all([
      loadSeasonView(
        auth.db,
        admin,
        identityFor(leagueId, competitionId),
        auth.userId,
      ),
      loadSeasonPickCorpus(
        auth.db,
        admin,
        leagueId,
        competitionId,
        auth.userId,
      ),
    ]);
    const memberGameweeks = season.memberGameweeks ?? [];
    const names = new Map((corpus.members ?? []).map((member) => [member.userId, member.name]));
    const room = buildYouVsRoom(memberGameweeks, auth.userId);
    return json({
      leagueId,
      competitionId,
      modules: {
        youVsRoom: room
          ? {
              ...room,
              exactRateBars: room.exactRateBars.map((bar) => ({
                ...bar,
                isViewer: bar.userId === auth.userId,
                name: names.get(bar.userId),
              })),
            }
          : null,
        rivalry: buildRivalryModule(memberGameweeks, auth.userId, names, corpus),
        habits: buildPredictionHabits(corpus, auth.userId),
        weeklyLabels: buildWeeklyLabels(corpus, auth.userId),
        clubReads: null,
        receipts: null,
      },
    } satisfies AnalyticsModulesView);
  } catch {
    return json({ error: ANALYTICS_COPY.apiUnavailable }, 500);
  }
}
