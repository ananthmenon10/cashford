"use client";

import { useRef, useState } from "react";
import { TRANSITION_COPY } from "@/lib/payment-copy";
import { LocalTime } from "@/components/LocalTime";

export function CaptainAdoptionSheet({ slug, leagueId, anteInr, gameweekNumber, deadlineAt }: { slug: string; leagueId: string; anteInr: number; gameweekNumber: number | null; deadlineAt: string | null }) {
  const [ante, setAnte] = useState(String(anteInr)); const [message, setMessage] = useState<string | null>(null); const requestId = useRef<string | null>(null);
  async function adopt() { requestId.current ??= crypto.randomUUID(); const response = await fetch(`/api/leagues/${slug}/adopt`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ leagueId, anteInr: Number(ante), clientRequestId: requestId.current }) }); const body = await response.json().catch(() => ({})); if (!response.ok) setMessage(body.error ?? TRANSITION_COPY.preparing); else window.location.href = `/leagues/${slug}`; }
  return <section className="mt-5 rounded-card border border-cs2-green/30 bg-cs2-paper p-4"><h2 className="text-lg font-extrabold">{TRANSITION_COPY.captainHeading}</h2><p className="mt-1 text-[12px] text-cs2-ink-3">{TRANSITION_COPY.captainBody}</p><label className="mt-4 block text-[12px] font-semibold">{TRANSITION_COPY.anteLabel}<input type="number" min="50" max="1000000" value={ante} onChange={(event) => setAnte(event.target.value)} className="mt-1 w-full rounded-control border border-border bg-surface p-2.5" /></label><p className="mt-2 text-[12px]">{TRANSITION_COPY.consequence(Number(ante))}</p>{gameweekNumber && deadlineAt ? <p className="mt-1 text-[12px]">{TRANSITION_COPY.firstGameweekPrefix(gameweekNumber)}{" "}<LocalTime iso={deadlineAt} relative={false} /></p> : null}<button type="button" onClick={adopt} className="mt-4 w-full rounded-control bg-primary py-3 text-[13px] font-bold text-white">{TRANSITION_COPY.cta}</button>{message ? <p className="mt-2 text-[12px] text-loss">{message}</p> : null}</section>;
}
