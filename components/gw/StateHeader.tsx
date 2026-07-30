import { StatusBadge, type GwBadgeState } from "@/components/ui";
import {
  C1,
  C2,
  C4,
  C6,
  C10,
  C11,
  C12,
  C13,
  C14,
  C15,
  C16,
  C26,
  C29,
  C45,
  C46,
  C48,
  C49,
  C58,
  C59,
  C60,
  C64,
  C65,
  C66,
  C72,
  correctionCopy,
  voidReasonCopy,
} from "@/lib/gw-copy";
import { formatIstDeadline } from "@/lib/ist";
import type { GameweekViewDTO } from "@/lib/gw-view";
import { RecalculatingNote } from "./RecalculatingNote";
import { SyncIssueNote } from "./SyncIssueNote";

function badgeFor(lifecycle: GameweekViewDTO["lifecycle"]): GwBadgeState {
  if (lifecycle === "CL1") return "open";
  if (lifecycle === "CL2") return "locked";
  if (lifecycle === "CL3" || lifecycle === "CL4") return "live";
  if (lifecycle === "CL5") return "settled";
  if (lifecycle === "CL7" || lifecycle === "CL10") return "void";
  if (lifecycle === "CL6" || lifecycle === "CL8") return "recalculating";
  return "locked";
}

export function StateHeader({ view }: { view: GameweekViewDTO }) {
  if (!view.gameweek || !view.contest) return <div>{C29}</div>;
  const number = view.gameweek.number;
  const viewerStanding = view.standings.find((row) => row.isViewer);
  if (view.lifecycle === "CL9") return <SyncIssueNote />;
  if (view.lifecycle === "CL6" || view.lifecycle === "CL8") {
    return (
      <div className="space-y-3">
        <div className="flex justify-end">
          <StatusBadge kind="gameweek" state="recalculating" />
        </div>
        <RecalculatingNote cause={view.result?.lastSettleCause ?? null} />
        {view.lifecycle === "CL8" && view.result?.voidReason ? (
          <p className="text-[12px] text-cs2-ink-2">
            {voidReasonCopy(view.result.voidReason)}
          </p>
        ) : null}
      </div>
    );
  }
  let title = C1(number);
  let body = C4;

  if (view.viewerParticipation === "VP0") {
    title = C65(view.viewerEligibleFromGameweekNumber ?? number + 1);
    body = "";
  } else if (
    view.viewerParticipation === "VP5" &&
    !(
      view.lifecycle === "CL7" &&
      view.result?.voidReason === "single_entrant"
    )
  ) {
    title = C48(number);
    body = C49;
  } else if (view.lifecycle === "CL1") {
    if (view.viewerParticipation === "VP2") {
      title = C6(number);
    } else if (view.viewerParticipation === "VP3") {
      title = C45(number);
      body = C46;
    }
  } else if (view.lifecycle === "CL2") {
    title = C10(number);
    body = C58(number);
  } else if (view.lifecycle === "CL3") {
    title = C12(number);
    body = C13;
  } else if (view.lifecycle === "CL4") {
    title = C59;
    body = C14(
      view.fixtures.filter(
        (fixture) => fixture.state === "active" && fixture.status === "finished",
      ).length,
      view.fixtures.filter((fixture) => fixture.state === "active").length,
    );
  } else if (view.lifecycle === "CL5") {
    title = viewerStanding?.netInr != null && viewerStanding.netInr > 0 ? C15(number) : C16(number);
    body = view.viewerParticipation === "VP1" ? C66 : C11;
  } else if (view.lifecycle === "CL7") {
    title = C26(number);
    body =
      view.viewerParticipation === "VP1"
        ? C66
        : voidReasonCopy(view.result?.voidReason ?? null);
  } else if (view.lifecycle === "CL10") {
    title = C72;
    body = "";
  }

  const correction = view.result
    ? correctionCopy(view.result.lastSettleCause)
    : null;
  return (
    <section className="rounded-cs2-lg border border-cs2-line bg-cs2-paper p-5">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-[20px] font-extrabold tracking-[-.02em]">{title}</h1>
          {body ? <p className="mt-1 text-[13px] leading-5 text-cs2-ink-2">{body}</p> : null}
        </div>
        <StatusBadge kind="gameweek" state={badgeFor(view.lifecycle)} />
      </div>
      {view.lifecycle === "CL1" ? (
        <>
          <div className="mt-4 rounded-cs2-md border border-cs2-line-2 bg-cs2-canvas px-3 py-2.5">
            <div className="text-[10px] font-extrabold uppercase tracking-[.1em] text-cs2-ink-3">
              {C2(formatIstDeadline(view.contest.deadlineAt))}
            </div>
          </div>
          {view.nudge ? (
            <a
              href={view.nudge.href}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 block rounded-cs2-md border border-cs2-green-line bg-cs2-green-soft px-3 py-2.5 text-[12px] font-semibold text-cs2-green"
            >
              {view.nudge.copy}
            </a>
          ) : null}
        </>
      ) : null}
      {correction ? (
        <p className="mt-3 text-[11px] text-cs2-ink-3">
          {correction}
        </p>
      ) : null}
    </section>
  );
}
