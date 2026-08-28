import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/gw-api";
import { loadMatchesHomeTab } from "@/lib/matches-home-tab-load";
import { MATCH_COPY } from "@/lib/match-copy";

export const dynamic = "force-dynamic";

const paramsSchema = z.object({
  comp: z.string().min(1).max(64).optional(),
  gw: z.string().regex(/^[1-9]\d*$/).transform(Number).optional(),
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
  const requestedGw = new URL(request.url).searchParams.get("gw");
  const parsed = paramsSchema.safeParse({
    comp: requestedComp ?? undefined,
    gw: requestedGw ?? undefined,
  });
  if (!parsed.success) return json({ error: MATCH_COPY.apiInvalidCompetition }, 400);

  try {
    const options = {
      requestedScopeSlug: parsed.data.comp,
      ...(parsed.data.gw == null ? {} : { requestedGameweek: parsed.data.gw }),
    };
    const payload = await loadMatchesHomeTab(auth.db, auth.userId, options);
    return json(payload);
  } catch {
    return json({ error: MATCH_COPY.apiUnavailable }, 500);
  }
}
