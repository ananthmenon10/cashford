import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { loadPublicBracket } from "@/lib/knockout-data";
import { autoPicks, score } from "@/lib/knockout";
import { PublicBracket } from "@/components/PublicBracket";

// Public, shareable bracket page. The og:image is auto-wired by the collocated
// opengraph-image.tsx (file convention). revalidate 300 — picks are frozen post-lock;
// the score overlay evolves slowly.
export const revalidate = 300;

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const data = await loadPublicBracket(id);
  if (!data) return { title: "Bracket not found · Cashford" };
  const eff = { ...autoPicks(data.view.results), ...data.view.myPicks };
  const champ = data.view.teams[eff["5:0"] ?? ""];
  const sc = score(data.view.myPicks, data.view.results);
  const who = data.ownerName || "My";
  const title = champ ? `${who} bracket: ${champ.name} to win 🏆` : `${who} World Cup 2026 bracket`;
  const description = `${sc.decided > 0 ? `${sc.correct}/${sc.decided} correct · ` : ""}Think you can beat it? Build yours on Cashford.`;
  return {
    title,
    description,
    openGraph: { title, description, type: "website" },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default async function PublicBracketPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await loadPublicBracket(id);
  if (!data) notFound();
  return <PublicBracket view={data.view} ownerName={data.ownerName} joinHref="/signup" />;
}
