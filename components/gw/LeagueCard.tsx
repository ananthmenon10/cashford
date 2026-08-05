import Link from "next/link";
import { StatusBadge } from "@/components/ui";
import {
  C5,
  C30Prefix,
  C31,
  C32,
  C33,
  C60,
  C69,
} from "@/lib/gw-copy";
import type { HomeLeagueCard } from "@/lib/gw-home";
import { DUES_COPY } from "@/lib/payment-copy";
import { LocalTime } from "@/components/LocalTime";

function netCopy(netInr: number | "suppressed") {
  if (netInr === "suppressed") return C60;
  if (netInr > 0) return C32(netInr);
  if (netInr < 0) return C31(netInr);
  return C33;
}

export function LeagueCard({ card }: { card: HomeLeagueCard }) {
  const badgeState = card.badge?.toLowerCase().replaceAll(" ", "_");
  return (
    <article className="overflow-hidden rounded-cs2-lg border border-cs2-line bg-cs2-paper shadow-[0_2px_10px_rgba(20,23,26,.04)]">
      <Link href={`/leagues/${card.slug}`} className="block p-4">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-[16px] font-extrabold">{card.leagueName}</h2>
            <p className="mt-0.5 truncate text-[11px] font-semibold text-cs2-ink-3">
              {card.competitionName}
            </p>
          </div>
          {badgeState ? (
            <StatusBadge kind="gameweek" state={badgeState as never} />
          ) : card.archived ? (
            <span className="rounded-cs2-sm bg-cs2-amber-soft px-2 py-1 text-[10px] font-bold text-cs2-amber">
              {C69}
            </span>
          ) : null}
          {card.pendingPaymentCount > 0 ? <span className="rounded-cs2-sm bg-cs2-red-soft px-2 py-1 text-[10px] font-bold text-cs2-red">{DUES_COPY.pendingAnswer(card.pendingPaymentCount)}</span> : null}
        </div>
        <p className="mt-3 text-[12px] font-semibold text-cs2-ink-2">
          {card.openDetails ? (
            <>
              {C30Prefix(card.openDetails.gameweekNumber)}{" "}
              <LocalTime iso={card.openDetails.deadlineAt} relative={false} />
              {" · "}
              {C5(
                card.openDetails.potInr,
                card.openDetails.enteredCount,
                card.openDetails.eligibleCount,
              )}
            </>
          ) : (
            card.subline
          )}
        </p>
        <p
          className={`mt-2 font-mono text-[14px] font-bold tabular ${
            card.netInr === "suppressed"
              ? "text-cs2-amber"
              : card.netInr > 0
                ? "text-cs2-green"
                : card.netInr < 0
                  ? "text-cs2-red"
                  : "text-cs2-ink-3"
          }`}
        >
          {netCopy(card.netInr)}
        </p>
      </Link>
      {card.action ? (
        <Link
          href={card.action.href}
          className="block border-t border-cs2-line-2 px-4 py-3 text-center text-[13px] font-bold text-cs2-green"
        >
          {card.action.label}
        </Link>
      ) : null}
      {card.pendingPaymentCount > 0 ? <Link href={`/leagues/${card.slug}/dues`} className="block border-t border-cs2-line-2 px-4 py-3 text-center text-[13px] font-bold text-cs2-green">{DUES_COPY.pendingAnswer(card.pendingPaymentCount)}</Link> : null}
    </article>
  );
}
