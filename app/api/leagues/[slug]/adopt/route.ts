import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { TRANSITION_COPY } from "@/lib/payment-copy";
import { resolveCurrentSeasonCompetition } from "@/lib/wc-live-competition";

const schema = z.object({
  leagueId: z.string().uuid(),
  competitionSlug: z.string().min(1),
  anteInr: z.number().int().min(50).max(1000000),
  clientRequestId: z.string().uuid(),
});

// Item 2 / dual-review fix (R2 F3, R1 nit 4): the RPC raises plain Postgres exception text
// ("competition is not active", "% is already active for this league", …) — never surface
// that verbatim. Map every case the UI can actually reach to its own distinct TRANSITION_COPY
// string. "already active for this league" and "already archived" name a competition IN the
// message itself (extracted below) — that name can differ from the adopt target's name (e.g.
// a captain adopted a QA mock; the target is the real Premier League), so it must come from
// the message, never from the target's own name.
function mapAdoptError(message: string, targetCompetitionName: string): string {
  const otherActiveMatch = message.match(/^(.+) is already active for this league$/);
  if (otherActiveMatch) return TRANSITION_COPY.otherActive(otherActiveMatch[1]);
  const archivedMatch = message.match(/^This league already archived (.+)$/);
  if (archivedMatch) return TRANSITION_COPY.archivedTarget(archivedMatch[1]);
  if (message === "adoption idempotency facts changed") return TRANSITION_COPY.idempotencyMismatch;
  if (message === "invalid ante") return TRANSITION_COPY.invalidAnte;
  if (message === "competition is not active" || message === "unknown competition") {
    return TRANSITION_COPY.preparing;
  }
  // D1 backstop: the RPC's own guard against adopting into an archived league. The route/page
  // should already prevent reaching this (resolveWcTransition now maps an archived league to
  // "archived" before the CTA renders), but if a stale page still posts, surface a real
  // "archived" message instead of the generic fallback.
  if (message === "league is archived") return TRANSITION_COPY.leagueArchived;
  return TRANSITION_COPY.adoptionFailed;
}

export async function POST(request: Request, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not authenticated" }, { status: 401 });

  // Micro-round fix (item 4): the zod reject path (e.g. an empty ante field, where
  // Number("") === 0 fails the schema's min(50) before the request even reaches the RPC) used
  // to surface the raw internal string "invalid adoption" to the sheet. Render the same
  // ante-specific copy the RPC's own "invalid ante" case uses instead.
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: TRANSITION_COPY.invalidAnte }, { status: 400 });

  const league = await supabase
    .from("leagues")
    .select("id")
    .eq("id", parsed.data.leagueId)
    .eq("slug", slug)
    .maybeSingle();
  if (league.error || !league.data) return NextResponse.json({ error: "league not found" }, { status: 404 });

  // Blocker 1: resolve the adopt target the SAME safe way the page did — the one active
  // league-format competition flagged is_current_season, never "globally newest". Degrades to
  // null (400, no adoption attempted) rather than trusting whatever slug the client sent.
  const admin = createServiceRoleClient();
  const competition = await resolveCurrentSeasonCompetition(admin);
  if (!competition) {
    return NextResponse.json({ error: TRANSITION_COPY.preparing }, { status: 400 });
  }

  // Must-fix #4: the sheet sends the competition slug it rendered against — validate it
  // against this route's own resolution instead of trusting the client. A mismatch means the
  // page is stale (the current-season competition changed underneath it); reject rather than
  // silently adopting whatever the route resolved instead of what the user saw.
  if (parsed.data.competitionSlug !== competition.slug) {
    return NextResponse.json({ error: TRANSITION_COPY.competitionMismatch }, { status: 409 });
  }

  const { data, error } = await supabase.rpc("adopt_league_competition", {
    p_league_id: parsed.data.leagueId,
    p_competition_slug: competition.slug,
    p_ante_inr: parsed.data.anteInr,
    p_client_request_id: parsed.data.clientRequestId,
  });
  if (error) {
    return NextResponse.json({ error: mapAdoptError(error.message, competition.name) }, { status: 400 });
  }

  // Blocker 2 (R2 F1): the RPC can succeed (no thrown exception) while reporting
  // adopted:false — a no-op replay of an identical idempotent request, or a race where someone
  // else's adoption landed first. Passing that through as a 200 would let a stale page read
  // "your ante took effect" when nothing changed. Surface it as a distinct non-success instead.
  //
  // Micro-round fix (item 3): but an identical idempotent REPLAY of a request that already
  // succeeded also reports adopted:false on the second call (nothing changed because it already
  // happened) — that is not a failure, it is the same success arriving twice. Before 409ing,
  // check whether this league now holds an active participation for exactly the resolved
  // competition; if so, this is that replay and the original flow's redirect is the correct
  // response, not an error.
  const adoption = Array.isArray(data) ? data[0] : data;
  if (!adoption?.adopted) {
    const activeParticipation = await supabase
      .from("league_competitions")
      .select("competition_id")
      .eq("league_id", parsed.data.leagueId)
      .eq("competition_id", competition.id)
      .eq("status", "active")
      .maybeSingle();
    if (activeParticipation.data) {
      return NextResponse.json({ adoption: data });
    }
    return NextResponse.json({ error: TRANSITION_COPY.alreadyAdopted }, { status: 409 });
  }
  return NextResponse.json({ adoption: data });
}
