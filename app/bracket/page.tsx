import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { loadKnockoutView, loadKnockoutLeaderboards } from "@/lib/knockout-data";
import { KnockoutCircle } from "@/components/KnockoutCircle";
import { KnockoutLeaderboard } from "@/components/KnockoutLeaderboard";

// The Knockout Circle is an always-dark, immersive "arena" screen (its own route, not
// an in-home tab panel). Explicit dark palette (matches the prototype + html.dark
// tokens) so it reads the same regardless of the app's light/dark setting.
export const dynamic = "force-dynamic"; // live results + the viewer's own picks

export default async function BracketPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const view = await loadKnockoutView(supabase, user.id);
  const leaderboards = await loadKnockoutLeaderboards(supabase, user.id, view.results);

  return (
    <div style={{ background: "#0B0F14", minHeight: "100vh", color: "#E7ECEF" }}>
      <div className="mx-auto max-w-[480px] px-0 pb-16 pt-2">
        {/* header */}
        <div className="flex items-center gap-2.5 px-3.5 pb-1.5 pt-2">
          <Link href="/" aria-label="Back" className="w-6 text-[20px] leading-none" style={{ color: "#7a8794" }}>
            ‹
          </Link>
          <div className="flex-1">
            <div className="text-[15.5px] font-extrabold tracking-[-.01em]">Knockout Circle</div>
            <div className="mt-px font-mono text-[10.5px]" style={{ color: "#7a8794" }}>
              World Cup 2026
            </div>
          </div>
          <span className="font-mono text-[10px] font-bold tracking-[.08em]" style={{ color: "#7a8794" }}>
            {view.locked ? "LOCKED" : "OFFICIAL"}
          </span>
        </div>

        <KnockoutCircle view={view} />
        <KnockoutLeaderboard leaderboards={leaderboards} />
      </div>
    </div>
  );
}
