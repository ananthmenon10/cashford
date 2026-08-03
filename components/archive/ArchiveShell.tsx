import Link from "next/link";
import { BackLink } from "@/components/BackLink";
import { Avatar } from "@/components/ui";
import { ARCHIVE_COPY } from "@/lib/payment-copy";
import { PHASE5_UI_COPY } from "@/lib/payment-copy";
import { createClient } from "@/lib/supabase/server";
import { loadCompetitionSheet } from "@/lib/competition-sheet";
import { CompetitionSheet } from "@/components/gw/CompetitionSheet";

const tabs = [
  [PHASE5_UI_COPY.analytics, ""],
  [PHASE5_UI_COPY.matches, "/matches"],
  [PHASE5_UI_COPY.bracket, "/bracket"],
] as const;

export async function ArchiveShell({ slug, leagueName, viewerName, balance, active, children }: { slug: string; leagueName: string; viewerName: string; balance?: string; active: "analytics" | "matches" | "bracket"; children: React.ReactNode }) {
  const client = await createClient();
  const league = await client.from("leagues").select("id").eq("slug", slug).maybeSingle();
  const sheet = league.data ? await loadCompetitionSheet(client, league.data.id, slug) : { leagueSlug: slug, items: [] };
  return <main className="min-h-screen bg-cs2-canvas text-cs2-ink"><header className="border-b border-cs2-line-2 bg-cs2-paper"><div className="mx-auto flex max-w-[520px] items-center gap-3 px-4 py-3"><BackLink href="/" /><div className="min-w-0"><div className="truncate text-[17px] font-extrabold">{leagueName}</div><div className="mt-0.5 flex items-center gap-2 text-[10px] font-bold text-cs2-ink-3">{PHASE5_UI_COPY.worldCup} <span className="rounded-cs2-sm bg-cs2-amber-soft px-1.5 py-0.5 text-cs2-amber">{ARCHIVE_COPY.badge}</span></div></div><CompetitionSheet dto={sheet} /><span><Avatar label={viewerName} size={30} /></span></div><nav className="mx-auto grid max-w-[520px] grid-cols-3 px-4" aria-label={PHASE5_UI_COPY.worldCup}>{tabs.map(([label, suffix], index) => { const key = ["analytics", "matches", "bracket"][index] as typeof active; const href = `/leagues/${slug}/archive/wc2026${suffix}`; return <Link key={label} href={href} aria-current={active === key ? "page" : undefined} className={`border-b-2 px-1 pb-2.5 pt-1 text-center text-[13px] font-bold ${active === key ? "border-cs2-green text-cs2-ink" : "border-transparent text-cs2-ink-3"}`}>{label}</Link>; })}</nav></header><div className="mx-auto max-w-[520px] px-4 pb-10"><div className="mt-4 rounded-cs2-md border border-cs2-amber-line bg-cs2-amber-soft p-3 text-[12px] font-semibold text-cs2-amber">{ARCHIVE_COPY.notice}</div>{balance ? <div className="mt-3 text-[12px] font-semibold text-cs2-ink-3">{balance}</div> : null}{children}</div></main>;
}
