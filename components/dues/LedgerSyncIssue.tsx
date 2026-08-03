"use client";

import { useEffect } from "react";
import { DUES_COPY } from "@/lib/payment-copy";

export function LedgerSyncIssue({ leagueId, fingerprint }: { leagueId: string; fingerprint: string }) {
  useEffect(() => {
    void fetch("/api/dues/issues", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ leagueId, fingerprint }) });
  }, [leagueId, fingerprint]);
  return <div className="mt-4 rounded-cs2-md border border-cs2-red-line bg-cs2-red-soft p-4 text-[13px] font-semibold text-cs2-red">{DUES_COPY.syncError}</div>;
}

