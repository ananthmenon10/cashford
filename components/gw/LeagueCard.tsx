import Link from "next/link";
import { Countdown, LocalTime } from "@/components/LocalTime";
import { LEAGUE_CARD_COPY } from "@/lib/gw-copy";
import type {
  HomeLeagueCard,
  HomeLeagueCardDetail,
  HomeLeagueCardTone,
} from "@/lib/gw-home";

const TONE_STYLES: Record<
  HomeLeagueCardTone,
  { status: string; kicker: string; marker: string }
> = {
  open: {
    status: "border-cs2-green-line bg-cs2-green-soft text-cs2-green",
    kicker: "text-cs2-green",
    marker: "bg-cs2-green",
  },
  live: {
    status: "border-cs2-red-line bg-cs2-red-soft text-cs2-red",
    kicker: "text-cs2-red",
    marker: "bg-cs2-red",
  },
  settled: {
    status: "border-cs2-green-line bg-cs2-green-soft text-cs2-green",
    kicker: "text-cs2-green",
    marker: "bg-cs2-green",
  },
  loss: {
    status: "border-cs2-line bg-cs2-line-2 text-cs2-ink-3",
    kicker: "text-cs2-red",
    marker: "bg-cs2-red",
  },
  archive: {
    status: "border-cs2-amber-line bg-cs2-amber-soft text-cs2-amber",
    kicker: "text-cs2-amber",
    marker: "bg-cs2-amber",
  },
  upcoming: {
    status: "border-cs2-amber-line bg-cs2-amber-soft text-cs2-amber",
    kicker: "text-cs2-amber",
    marker: "bg-cs2-amber",
  },
  neutral: {
    status: "border-cs2-line bg-cs2-line-2 text-cs2-ink-3",
    kicker: "text-cs2-ink-3",
    marker: "bg-cs2-ink-3",
  },
};

const NET_STYLES: Record<HomeLeagueCard["rail"]["netTone"], string> = {
  positive: "text-cs2-green",
  negative: "text-cs2-red",
  muted: "text-cs2-amber",
  neutral: "text-cs2-ink-3",
};

function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length > 1) return words.slice(0, 2).map((word) => word[0]).join("").toUpperCase();
  return (words[0]?.slice(0, 2) || "??").toUpperCase();
}

function Action({ action }: { action: NonNullable<HomeLeagueCard["primary"]["action"]> }) {
  const className = action.muted
    ? "mt-3 inline-flex items-center gap-1.5 rounded-cs2-sm border border-cs2-line bg-[#f7f8f6] px-2.5 dark:bg-white/[0.05] py-2 text-[10px] font-extrabold text-cs2-ink-3"
    : "mt-3 inline-flex items-center gap-1.5 rounded-cs2-sm bg-cs2-green px-2.5 py-2 text-[10px] font-extrabold text-white shadow-[0_2px_6px_rgba(18,128,92,.18)]";
  const content = (
    <>
      <span>{action.label}</span>
      <span aria-hidden="true" className="font-mono text-[12px] leading-none">{action.arrow}</span>
    </>
  );
  if (!action.href) return <div className={className}>{content}</div>;
  return <Link href={action.href} className={`${className} cf-press`}>{content}</Link>;
}

function BottomAction({ action }: { action: NonNullable<HomeLeagueCard["bottomActions"]>[number] }) {
  const className = action.tone === "amber"
    ? "border-cs2-amber-line bg-cs2-amber-soft text-cs2-amber"
    : "border-cs2-green-line bg-cs2-green-soft text-cs2-green";
  return (
    <Link
      href={action.href ?? "#"}
      className={`flex min-h-[35px] flex-1 items-center justify-center gap-1 rounded-cs2-sm border px-2 py-2 text-center text-[10px] font-extrabold ${className} cf-press`}
    >
      <span>{action.label}</span>
      {action.arrow ? <span aria-hidden="true" className="font-mono text-[11px]">{action.arrow}</span> : null}
    </Link>
  );
}

function Detail({ detail }: { detail: NonNullable<HomeLeagueCard["primary"]["detail"]> }) {
  if (typeof detail === "string") return <>{detail}</>;
  const structured = detail as HomeLeagueCardDetail;
  return (
    <>
      {structured.prefix}
      <strong className="font-bold text-cs2-ink">{structured.amount}</strong>
      {structured.suffix}
    </>
  );
}

export function LeagueCard({
  card,
  now,
}: {
  card: HomeLeagueCard;
  now?: string | number;
}) {
  const style = TONE_STYLES[card.tone];
  const primary = card.primary;
  const secondary = card.secondary;
  const netStyle = NET_STYLES[card.rail.netTone];
  return (
    <article
      data-state={card.state}
      className="overflow-hidden rounded-cs2-lg border border-cs2-line bg-cs2-paper shadow-[0_2px_10px_rgba(20,23,26,.04)]"
    >
      <Link
        href={`/leagues/${card.slug}`}
        className="flex items-center gap-2.5 border-b border-cs2-line-2 bg-cs2-paper px-3.5 py-3 cf-press"
      >
        <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-cs2-sm border border-cs2-green-line bg-cs2-green-soft font-mono text-[10px] font-bold text-cs2-green">
          {initials(card.leagueName)}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14px] font-extrabold tracking-[-.015em] text-cs2-ink">
            {card.leagueName}
          </span>
          {card.competitionName ? (
            <span className="mt-0.5 block truncate text-[10px] font-semibold text-cs2-ink-3">
              {card.competitionName}
            </span>
          ) : null}
        </span>
        <span className={`shrink-0 rounded-cs2-sm border px-1.5 py-1 font-mono text-[9px] font-bold tracking-[.06em] ${style.status}`}>
          {card.badge}
        </span>
      </Link>

      <div className="grid grid-cols-[minmax(0,1fr)_106px] gap-3 border-b border-cs2-line-2 bg-[#fbfcfb] p-3.5 dark:bg-white/[0.03]">
        <div className="min-w-0">
          <p className={`mb-2 flex items-center gap-1.5 text-[9px] font-extrabold ${style.kicker}`}>
            <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${style.marker}`} aria-hidden="true" />
            {primary.kicker}
          </p>
          <h3 className="text-[20px] font-extrabold leading-[1.04] tracking-[-.055em] text-cs2-ink">
            {primary.title}
          </h3>
          {primary.deadlineAt && primary.deadlineVariant === "time" ? (
            <p className="mt-1.5 font-mono text-[10px] font-semibold leading-[1.4] tracking-[-.025em] text-cs2-ink-2">
              {primary.deadlinePrefix}{primary.deadlinePrefix ? " " : null}
              <strong className="font-bold text-cs2-ink">
                <LocalTime
                  iso={primary.deadlineAt}
                  variant="time"
                  relative={false}
                  includeWeekday={primary.deadlineIncludeWeekday}
                />
              </strong>
            </p>
          ) : primary.deadlineAt && primary.deadlineVariant === "date" ? (
            <p className="mt-1.5 font-mono text-[10px] font-semibold leading-[1.4] tracking-[-.025em] text-cs2-ink-2">
              <LocalTime iso={primary.deadlineAt} variant="date" relative={false} includeYear={false} />{" "}
              <span aria-hidden="true">{LEAGUE_CARD_COPY.separator}</span>{" "}
              {primary.deadlineSuffix}
            </p>
          ) : primary.detail ? (
            <p className="mt-1.5 font-mono text-[10px] font-semibold leading-[1.4] tracking-[-.025em] text-cs2-ink-2">
              <Detail detail={primary.detail} />
            </p>
          ) : null}
          {primary.countdown && primary.deadlineAt ? (
            <p className="font-mono text-[10px] font-semibold leading-[1.4] text-cs2-amber">
              <Countdown iso={primary.deadlineAt} prefix={LEAGUE_CARD_COPY.countdownPrefix} now={now} />
            </p>
          ) : null}
          {primary.action ? <Action action={primary.action} /> : null}
        </div>

        <div className="flex min-w-0 flex-col gap-2.5 border-l border-cs2-line px-0 pl-3 pt-0.5">
          <div>
            <span className="mb-1 block font-mono text-[8px] font-bold text-cs2-ink-3">{LEAGUE_CARD_COPY.net}</span>
            <strong className={`block font-mono text-[15px] font-bold leading-none tracking-[-.06em] ${netStyle}`}>
              {card.rail.net}
            </strong>
          </div>
          <div>
            <span className="mb-1 block font-mono text-[8px] font-bold text-cs2-ink-3">{card.rail.positionLabel}</span>
            <strong className={`block font-mono text-[15px] font-bold leading-none tracking-[-.06em] ${card.rail.positionTone === "muted" ? "text-cs2-ink-3" : "text-cs2-ink"}`}>
              {card.rail.position}
            </strong>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 px-3.5 pt-2.5 font-mono text-[10px] font-semibold leading-[1.35] tracking-[-.035em] text-cs2-ink-2">
        {card.context.map((item, index) => (
          <span key={`${item}-${index}`} className="inline-flex items-center gap-1.5">
            {index > 0 ? <span aria-hidden="true" className="text-cs2-ink-3">{LEAGUE_CARD_COPY.separator}</span> : null}
            {item}
          </span>
        ))}
      </div>

      {secondary ? (
        <div className={`mx-3.5 mt-2.5 flex items-center justify-between gap-2 rounded-cs2-sm border px-2 py-1.5 text-[9px] font-bold ${secondary.live ? "border-cs2-red-line bg-cs2-red-soft text-cs2-red" : "border-cs2-green-line bg-cs2-green-soft text-cs2-ink-2"}`}>
          <span className="flex min-w-0 items-center gap-1.5">
            <span className={`shrink-0 font-mono text-[9px] font-bold ${secondary.live ? "text-cs2-red" : "text-cs2-green"}`}>{secondary.tag}</span>
            <span className="truncate">{secondary.copy}</span>
          </span>
          <span className="shrink-0 font-mono text-[9px] font-bold text-cs2-ink-3">{secondary.rank}</span>
        </div>
      ) : null}

      {card.duesLabel ? (
        <Link
          href={`/leagues/${card.slug}/dues`}
          className="mx-3.5 mt-2.5 inline-flex min-h-[22px] items-center rounded-[7px] border border-cs2-red-line bg-cs2-red-soft px-1.5 py-1 text-[9px] font-extrabold leading-[1.1] text-cs2-red cf-press"
        >
          {card.duesLabel}
        </Link>
      ) : null}

      {card.bottomActions?.length ? (
        <div className="mx-3.5 mt-3 flex items-center gap-2 pb-3">
          {card.bottomActions.map((action) => <BottomAction key={action.label} action={action} />)}
        </div>
      ) : <div className="h-3" />}
    </article>
  );
}
