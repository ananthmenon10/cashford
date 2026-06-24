"use client";

import { useState, useTransition } from "react";
import { removeMember } from "./actions";

export function RemoveMemberButton({
  slug,
  targetUserId,
  targetName,
}: {
  slug: string;
  targetUserId: string;
  targetName: string;
}) {
  const [confirming, setConfirming] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleRemove() {
    startTransition(async () => {
      const result = await removeMember(slug, targetUserId);
      if (result?.error) {
        setError(result.error);
        setConfirming(false);
      }
      // On success, removeMember redirects — no further handling needed
    });
  }

  if (confirming) {
    return (
      <div className="flex flex-col items-end gap-1">
        {error && <span className="text-[11px] text-loss">{error}</span>}
        <div className="flex gap-1.5">
          <button
            type="button"
            onClick={() => { setConfirming(false); setError(null); }}
            className="rounded-control border border-border px-2.5 py-1 text-[12px] font-semibold text-fg"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={isPending}
            onClick={handleRemove}
            className="rounded-control bg-loss px-2.5 py-1 text-[12px] font-bold text-white disabled:opacity-50"
          >
            {isPending ? "Removing…" : "Confirm"}
          </button>
        </div>
        <span className="text-[10px] text-muted">
          History &amp; dues are preserved.
        </span>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setConfirming(true)}
      className="rounded-control border border-border px-2.5 py-1 text-[12px] font-semibold text-muted hover:text-loss"
    >
      Remove
    </button>
  );
}
