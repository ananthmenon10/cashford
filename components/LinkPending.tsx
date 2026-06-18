"use client";

import { useLinkStatus } from "next/link";

// Renders a small spinner while the parent <Link>'s navigation is pending,
// so a tap gives instant feedback even before the destination skeleton shows.
export function LinkPending() {
  const { pending } = useLinkStatus();
  if (!pending) return null;
  return (
    <span
      aria-label="Loading"
      className="absolute right-3 top-3 h-4 w-4 animate-spin rounded-full border-2 border-subtle border-t-primary"
    />
  );
}
