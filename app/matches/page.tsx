import { notFound } from "next/navigation";
import { Phase4MatchesPage } from "@/components/Phase4MatchesPage";
import { loadMatchesPage } from "@/lib/matches-page-load";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";

export default async function MatchesPage({
  searchParams,
}: {
  searchParams: Promise<{ gw?: string; view?: string }>;
}) {
  const query = await searchParams;
  const session = await createClient();
  const {
    data: { user },
  } = await session.auth.getUser();
  if (!user) notFound();
  const admin = createServiceRoleClient();
  const requestedGw = query.gw ? Number(query.gw) : undefined;
  const loaded = await loadMatchesPage(
    session,
    admin,
    user.id,
    Number.isInteger(requestedGw) ? requestedGw : undefined,
    query.view,
  );
  if (!loaded) notFound();

  return (
    <Phase4MatchesPage
      view={loaded.view}
      standings={loaded.standings}
      segment={loaded.segment}
    />
  );
}
