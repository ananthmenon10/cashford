"use client";

import { useEffect, useState } from "react";

// Renders a UTC ISO timestamp in the viewer's local timezone (with tz hint).
// Server renders nothing visible; client fills in after mount → no hydration mismatch.
export function LocalTime({ iso, className }: { iso: string; className?: string }) {
  const [txt, setTxt] = useState<string | null>(null);
  useEffect(() => {
    const d = new Date(iso);
    setTxt(
      new Intl.DateTimeFormat("en-GB", {
        weekday: "short", day: "numeric", month: "short",
        hour: "numeric", minute: "2-digit", timeZoneName: "short",
      }).format(d),
    );
  }, [iso]);
  return (
    <time dateTime={iso} className={className} suppressHydrationWarning>
      {txt ?? "…"}
    </time>
  );
}

// Live MM:SS countdown to a target ISO; calls nothing once elapsed.
export function Countdown({ iso, prefix = "Locks in" }: { iso: string; prefix?: string }) {
  const [left, setLeft] = useState<number | null>(null);
  useEffect(() => {
    const target = new Date(iso).getTime();
    const tick = () => setLeft(Math.max(0, target - Date.now()));
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [iso]);
  if (left === null) return <span suppressHydrationWarning>…</span>;
  if (left === 0) return <span>Locked</span>;
  const m = Math.floor(left / 60000);
  const s = Math.floor((left % 60000) / 1000);
  const h = Math.floor(m / 60);
  const disp = h > 0 ? `${h}h ${m % 60}m` : `${m}:${String(s).padStart(2, "0")}`;
  return (
    <span suppressHydrationWarning>
      {prefix} {disp}
    </span>
  );
}
