"use client";

// Attention banner atop the Leagues panel — the first-login pull into the Knockout
// Circle. Green brand gradient, a shimmer sweep + rise-in, tap → /bracket. Collapses
// after the user opens it once (localStorage flag; a profile column is a later nicety).

import { useEffect, useState } from "react";
import Link from "next/link";

export function KnockoutBanner() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    try {
      setShow(localStorage.getItem("cf-seen-knockout") !== "1");
    } catch {
      setShow(true);
    }
  }, []);
  if (!show) return null;

  return (
    <Link
      href="/bracket"
      onClick={() => {
        try {
          localStorage.setItem("cf-seen-knockout", "1");
        } catch {
          /* ignore */
        }
      }}
      className="kc-banner relative mb-4 block overflow-hidden rounded-[18px] p-4 text-white"
      style={{ background: "linear-gradient(115deg,#0E8455,#15A66A 55%,#19c07d)", boxShadow: "0 10px 26px -8px rgba(21,166,106,.5)" }}
    >
      <span className="kc-shimmer pointer-events-none absolute inset-y-0 left-0 w-[45%]" style={{ background: "linear-gradient(100deg,transparent,rgba(255,255,255,.4),transparent)" }} />
      <div className="relative flex items-center gap-2">
        <span className="rounded-full bg-white/20 px-2 py-0.5 text-[9px] font-extrabold tracking-[.1em]">NEW · LIVE</span>
        <span className="font-mono text-[10.5px] font-semibold text-white/85">Round of 16</span>
      </div>
      <div className="relative mt-2 flex items-center gap-3">
        <div className="flex-1">
          <div className="text-[18px] font-extrabold leading-tight tracking-[-.01em]">The Knockout Circle</div>
          <div className="mt-1 text-[12px] leading-snug text-white/90">See the full draw spin to life — and lock your picks.</div>
        </div>
        <span className="text-[30px]" aria-hidden>◎</span>
      </div>
      <div className="relative mt-3 flex items-center justify-between">
        <span className="text-[12.5px] font-extrabold">Tap to enter →</span>
        <span className="flex gap-1">
          {[0, 1, 2].map((i) => (
            <span key={i} className="h-1.5 w-1.5 rounded-full" style={{ background: `rgba(255,255,255,${i === 0 ? 0.9 : 0.4})` }} />
          ))}
        </span>
      </div>
    </Link>
  );
}
