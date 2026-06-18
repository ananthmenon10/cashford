"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Periodically re-fetches the server component data (live scores, status/tab
// transitions) without a full reload or losing client state.
export function AutoRefresh({ seconds = 30 }: { seconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => router.refresh(), seconds * 1000);
    return () => clearInterval(t);
  }, [router, seconds]);
  return null;
}
