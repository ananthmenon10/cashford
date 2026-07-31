import { notFound } from "next/navigation";
import { Phase4MatchDetailPage } from "@/components/Phase4MatchDetailPage";
import { loadMatchDetail } from "@/lib/match-detail-load";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";

export default async function MatchDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ fixtureId: string }>;
  searchParams: Promise<{ league?: string }>;
}) {
  const [{ fixtureId }, query] = await Promise.all([params, searchParams]);
  const session = await createClient();
  const {
    data: { user },
  } = await session.auth.getUser();
  if (!user) notFound();
  const view = await loadMatchDetail(
    session,
    createServiceRoleClient(),
    user.id,
    fixtureId,
    query.league,
  );
  if (!view) notFound();
  return <Phase4MatchDetailPage fixtureId={fixtureId} view={view} />;
}
