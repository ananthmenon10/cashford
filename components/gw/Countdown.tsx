"use client";

import { useEffect, useState } from "react";
import { relativeDeadline } from "@/lib/gw-copy";

export function Countdown({ deadlineAt }: { deadlineAt: string }) {
  const [remaining, setRemaining] = useState<number | null>(null);
  useEffect(() => {
    const update = () => setRemaining(new Date(deadlineAt).getTime() - Date.now());
    update();
    const timer = window.setInterval(update, 30_000);
    return () => window.clearInterval(timer);
  }, [deadlineAt]);
  if (remaining == null) return null;
  return (
    <span className="rounded-md bg-cs2-amber-soft px-2 py-0.5 text-[11px] font-bold text-cs2-amber">
      {relativeDeadline(remaining)}
    </span>
  );
}
