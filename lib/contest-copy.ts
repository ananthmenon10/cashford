// Presentation copy for void contests — single source of truth so the badge, the league card,
// and the match screen never drift. The MONEY is identical for both void reasons (stakes
// returned, everyone net 0); only the STORY differs. Universal: no I/O, no server-only imports
// (imported by both server pages and the client-bundled cards).

export type VoidReason = "insufficient_entries" | "no_separation" | null | undefined;

export interface VoidPresentation {
  badge: string;       // StatusBadge pill label
  cardLine: string;    // one-liner on the league MatchCard
  title: string;       // match-screen headline
  blurb: string;       // match-screen sub-copy
  showReveal: boolean; // whether to show everyone's picks
  tone: "neutral" | "muted"; // styling discriminant (all-square reads positive; void reads muted)
}

export function voidPresentation(reason: VoidReason): VoidPresentation {
  if (reason === "no_separation") {
    return {
      badge: "ALL SQUARE",
      cardLine: "All square — too level to separate · stakes returned",
      title: "All square",
      blurb: "Too level to separate a winner — everyone gets their stake back.",
      showReveal: true,
      tone: "neutral",
    };
  }
  // insufficient_entries (and any unknown/null) — a genuine no-contest
  return {
    badge: "VOID",
    cardLine: "Voided — not enough players entered · stakes returned",
    title: "Contest void",
    blurb: "Not enough players entered — stakes are returned.",
    showReveal: false,
    tone: "muted",
  };
}
