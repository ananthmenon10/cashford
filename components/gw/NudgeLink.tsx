"use client";

import { useEffect, useState } from "react";
import {
  formatFriendlyDateTime,
  getLocalTimeZone,
} from "@/lib/datetime";
import { nudgeMessage } from "@/lib/gw-copy";

export function NudgeLink({
  league,
  gameweek,
  deadlineAt,
}: {
  league: string;
  gameweek: number;
  deadlineAt: string;
}) {
  const [message, setMessage] = useState<string | null>(null);
  const [href, setHref] = useState<string | null>(null);

  useEffect(() => {
    const deadline = formatFriendlyDateTime(deadlineAt, {
      timeZone: getLocalTimeZone(),
      relative: false,
      includeTimeZone: true,
    });
    const nextMessage = nudgeMessage({ league, gw: gameweek, deadline });
    setMessage(nextMessage);
    setHref(`https://wa.me/?text=${encodeURIComponent(nextMessage)}`);
  }, [deadlineAt, gameweek, league]);

  if (!message || !href) return null;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="mt-3 block rounded-cs2-md border border-cs2-green-line bg-cs2-green-soft px-3 py-2.5 text-[12px] font-semibold text-cs2-green"
    >
      {message}
    </a>
  );
}
