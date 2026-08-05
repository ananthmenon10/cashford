"use client";

import { useEffect, useState } from "react";
import {
  formatFriendlyDate,
  formatFriendlyDateTime,
  formatFriendlyTime,
  getLocalTimeZone,
} from "@/lib/datetime";
import { GW_UI_COPY } from "@/lib/gw-copy";

export type LocalTimeVariant = "datetime" | "date" | "time";

// The server cannot know the browser timezone. This boundary waits for the
// browser's resolved timezone, then uses the shared formatter for the display.
export function LocalTime({
  iso,
  className,
  now,
  relative = true,
  includeTimeZone = false,
  includeYear = true,
  includeWeekday = false,
  variant = "datetime",
}: {
  iso: string;
  className?: string;
  now?: string | number;
  relative?: boolean;
  includeTimeZone?: boolean;
  includeYear?: boolean;
  includeWeekday?: boolean;
  variant?: LocalTimeVariant;
}) {
  const [txt, setTxt] = useState<string | null>(null);
  useEffect(() => {
    const timeZone = getLocalTimeZone();
    if (variant === "date") {
      setTxt(formatFriendlyDate(iso, { timeZone, includeTimeZone, includeYear }));
    } else if (variant === "time") {
      setTxt(formatFriendlyTime(iso, { timeZone, includeTimeZone, includeWeekday }));
    } else {
      setTxt(
        formatFriendlyDateTime(iso, {
          timeZone,
          now,
          relative,
          includeTimeZone,
        }),
      );
    }
  }, [includeTimeZone, includeWeekday, includeYear, iso, now, relative, variant]);
  return (
    <time dateTime={iso} className={className} suppressHydrationWarning>
      {txt ?? "…"}
    </time>
  );
}

// Live MM:SS countdown to a target ISO; calls nothing once elapsed.
export function Countdown({
  iso,
  prefix = "Locks in",
  now,
}: {
  iso: string;
  prefix?: string;
  now?: string | number;
}) {
  const [left, setLeft] = useState<number | null>(null);
  useEffect(() => {
    const target = new Date(iso).getTime();
    const clock = now == null ? () => Date.now() : () => new Date(now).getTime();
    const tick = () => setLeft(Math.max(0, target - clock()));
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [iso, now]);
  if (left === null) return <span suppressHydrationWarning>…</span>;
  if (left === 0) return <span>{GW_UI_COPY.locked}</span>;
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
