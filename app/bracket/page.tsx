import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { loadKnockoutView, loadKnockoutLeaderboards } from "@/lib/knockout-data";
import { KnockoutCircle } from "@/components/KnockoutCircle";
import { KnockoutLeaderboard } from "@/components/KnockoutLeaderboard";
import { ThemeToggle } from "@/components/ThemeToggle";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { BRACKET_COPY } from "@/lib/bracket-copy";

// The Knockout Circle is an immersive "arena" screen (its own route, not an in-home tab
// panel). It follows the app's light/dark theme — colours come from the shared tokens and
// the --kc-* SVG palette, so both modes read correctly.
export const dynamic = "force-dynamic"; // live results + the viewer's own picks

export default async function BracketPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const view = await loadKnockoutView(supabase, user.id);
  const leaderboards = await loadKnockoutLeaderboards(supabase, user.id, view.results);
  const competition = await createServiceRoleClient().from("competitions").select("status").eq("slug", "wc2026").maybeSingle();
  const readOnly = competition.data?.status === "archived";

  return (
    <div className="min-h-screen bg-bg text-fg">
      <div className="mx-auto max-w-[480px] px-0 pb-16 pt-2">
        {/* header */}
        <div className="flex items-center gap-2.5 px-3.5 pb-1.5 pt-2">
          <Link href="/" aria-label={BRACKET_COPY.back} className="w-6 text-[20px] leading-none text-muted">
            ‹
          </Link>
          <div className="flex-1">
            <div className="text-[15.5px] font-extrabold tracking-[-.01em]">{BRACKET_COPY.title}</div>
            <div className="mt-px font-mono text-[10.5px] text-muted">{BRACKET_COPY.competition}</div>
          </div>
          <span className="font-mono text-[10px] font-bold tracking-[.08em] text-muted">
            {view.locked ? BRACKET_COPY.locked : BRACKET_COPY.official}
          </span>
          <ThemeToggle />
        </div>

        <KnockoutCircle view={view} readOnly={readOnly} />
        <KnockoutLeaderboard leaderboards={leaderboards} />
      </div>
    </div>
  );
}
