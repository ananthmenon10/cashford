"use client";

// Public, read-only bracket at /b/[token] — what a recipient of a shared link sees.
// Renders the owner's locked bracket (no editing) + champion callout + a join CTA.
// Theme-aware: colours follow the app tokens + --kc-* SVG palette (light and dark).

import { useMemo, useState } from "react";
import Link from "next/link";
import { KnockoutRing } from "./KnockoutRing";
import { autoPicks, score, type SlotKey, type Picks } from "@/lib/knockout";
import type { KnockoutView } from "@/lib/knockout-data";

export function PublicBracket({ view, ownerName, joinHref }: { view: KnockoutView; ownerName: string; joinHref: string }) {
  const [selected, setSelected] = useState<SlotKey | null>(null);
  const effective: Picks = useMemo(() => ({ ...autoPicks(view.results), ...view.myPicks }), [view]);
  const champId = effective["5:0"];
  const champ = champId ? view.teams[champId] : null;
  const sc = score(view.myPicks, view.results);
  const pickState = { effective, userPicks: view.myPicks, field: view.field, results: view.results, hint: null, locked: true };

  return (
    <div className="min-h-screen bg-bg text-fg">
      <div className="mx-auto max-w-[480px] px-0 pb-16 pt-4">
        <div className="flex items-center gap-2 px-4 pb-1">
          <span className="grid h-6 w-6 place-items-center rounded-[7px]" style={{ background: "#15A66A" }}>
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: "#F2C94C" }} />
          </span>
          <span className="text-[16px] font-extrabold tracking-[-.02em]">Cashford</span>
          <span className="ml-auto font-mono text-[10px] font-bold tracking-[.16em]" style={{ color: "#F2C94C" }}>WC 2026</span>
        </div>
        <div className="px-4 pt-1">
          <div className="text-[18px] font-extrabold">{ownerName ? `${ownerName}'s Knockout Bracket` : "Knockout Bracket"}</div>
          <div className="font-mono text-[11px] text-muted">32 teams, one call</div>
        </div>

        <div className="mx-auto mt-2 w-full px-3" style={{ maxWidth: 460 }}>
          <KnockoutRing view={view} mode="picks" selected={selected} onSelect={setSelected} pick={pickState} />
        </div>

        {champ && (
          <div className="mx-3 mt-1 flex items-center gap-3 rounded-[14px] border p-3.5" style={{ background: "rgba(242,201,76,.10)", borderColor: "rgba(242,201,76,.4)" }}>
            <span className="grid h-9 w-9 place-items-center rounded-full font-mono text-[12px] font-extrabold text-white" style={{ background: "#15A66A" }}>{champ.code}</span>
            <div>
              <div className="font-mono text-[9px] font-bold tracking-[.14em]" style={{ color: "#F2C94C" }}>THEIR CHAMPION</div>
              <div className="text-[16px] font-extrabold">{champ.name}</div>
            </div>
            <span className="ml-auto text-[20px]">🏆</span>
          </div>
        )}

        {sc.decided > 0 && (
          <div className="mx-3 mt-2 text-center text-[12px] font-bold" style={{ color: "#22C55E" }}>{sc.correct}/{sc.decided} correct so far</div>
        )}

        <div className="mx-3 mt-4 rounded-[14px] border bg-surface p-4 text-center" style={{ borderColor: "var(--color-border)" }}>
          <div className="text-[14px] font-extrabold">Think you can beat {ownerName || "this"}?</div>
          <div className="mt-1 text-[12px] text-muted">Build your own World Cup 2026 bracket on Cashford.</div>
          <Link href={joinHref} className="mt-3 inline-block rounded-[9px] px-5 py-2.5 text-[13px] font-extrabold text-white" style={{ background: "#15A66A" }}>
            Build your bracket →
          </Link>
        </div>
      </div>
    </div>
  );
}
