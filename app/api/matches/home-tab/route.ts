import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/gw-api";
import { loadMatchesHomeTab } from "@/lib/matches-home-tab-load";
import { MATCH_COPY } from "@/lib/match-copy";

export const dynamic = "force-dynamic";

const paramsSchema = z.object({
  comp: z.string().min(1).max(64).optional(),
});

const CACHE_HEADERS = { "Cache-Control": "private, no-store" };

function json<T>(body: T, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: CACHE_HEADERS });
}

export async function GET(request: Request) {
  const auth = await requireUser();
  if (!auth.ok) {
    auth.res.headers.set("Cache-Control", "private, no-store");
    return auth.res;
  }

  const requestedComp = new URL(request.url).searchParams.get("comp");
  const parsed = paramsSchema.safeParse({
    comp: requestedComp ?? undefined,
  });
  if (!parsed.success) return json({ error: MATCH_COPY.apiInvalidCompetition }, 400);

  try {
    const payload = await loadMatchesHomeTab(auth.db, auth.userId, {
      requestedScopeSlug: parsed.data.comp,
    });
    return json(payload);
  } catch {
    return json({ error: MATCH_COPY.apiUnavailable }, 500);
  }
}
