"use client";

import { useEffect, useRef, useState } from "react";
import { TRANSITION_COPY } from "@/lib/payment-copy";
import { LocalTime } from "@/components/LocalTime";

export function CaptainAdoptionSheet({ slug, leagueId, competitionSlug, anteInr, gameweekNumber, deadlineAt }: { slug: string; leagueId: string; competitionSlug: string; anteInr: number; gameweekNumber: number | null; deadlineAt: string | null }) {
  const [ante, setAnte] = useState(String(anteInr));
  const [message, setMessage] = useState<string | null>(null);
  const [inFlight, setInFlight] = useState(false);
  const requestId = useRef<string | null>(null);
  const lastAnte = useRef(ante);

  // Must-fix #3 (R2 F5): regenerate the idempotency key whenever the ante changes — otherwise
  // an edited resubmit reuses the first attempt's key, and the RPC reads it as the ante having
  // silently changed under an unchanged request ("adoption idempotency facts changed") instead
  // of as a fresh request.
  useEffect(() => {
    if (lastAnte.current !== ante) {
      requestId.current = null;
      lastAnte.current = ante;
    }
  }, [ante]);

  async function adopt() {
    if (inFlight) return;
    requestId.current ??= crypto.randomUUID();
    setInFlight(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/leagues/${slug}/adopt`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ leagueId, competitionSlug, anteInr: Number(ante), clientRequestId: requestId.current }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setMessage(body.error ?? TRANSITION_COPY.adoptionFailed);
        setInFlight(false);
        return;
      }
      window.location.href = `/leagues/${slug}`;
    } catch {
      setMessage(TRANSITION_COPY.adoptionFailed);
      setInFlight(false);
    }
  }

  return <section id="adopt-premier-league" className="mt-5 rounded-card border border-cs2-green/30 bg-cs2-paper p-4"><h2 className="text-lg font-extrabold">{TRANSITION_COPY.captainHeading}</h2><p className="mt-1 text-[12px] text-cs2-ink-3">{TRANSITION_COPY.captainBody}</p><label className="mt-4 block text-[12px] font-semibold">{TRANSITION_COPY.anteLabel}<input type="number" min="50" max="1000000" value={ante} onChange={(event) => setAnte(event.target.value)} className="mt-1 w-full rounded-control border border-border bg-surface p-2.5" /></label><p className="mt-2 text-[12px]">{TRANSITION_COPY.consequence(Number(ante))}</p>{gameweekNumber && deadlineAt ? <p className="mt-1 text-[12px]">{TRANSITION_COPY.firstGameweekPrefix(gameweekNumber)}{" "}<LocalTime iso={deadlineAt} /></p> : null}<button type="button" onClick={adopt} disabled={inFlight} className="mt-4 w-full rounded-control bg-primary py-3 text-[13px] font-bold text-white disabled:opacity-60">{inFlight ? TRANSITION_COPY.startingLabel : TRANSITION_COPY.cta}</button>{message ? <p className="mt-2 text-[12px] text-loss">{message}</p> : null}</section>;
}
