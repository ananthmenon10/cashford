import { Avatar, inr } from "@/components/ui";
import type { DuesPerson } from "@/lib/dues-view";
import { PHASE5_UI_COPY } from "@/lib/payment-copy";

export function NetPositionTable({ people }: { people: readonly DuesPerson[] }) {
  return <div className="mt-4 flex flex-col gap-1.5">{people.map((person, index) => (
    <div key={person.id} className="flex items-center gap-3 rounded-card border border-border bg-surface px-4 py-2.5">
      <span className="w-4 font-mono text-[13px] text-muted">{index + 1}</span>
      <Avatar label={person.name} size={26} />
      <span className="text-[14px] font-semibold">{person.name}{person.departed ? <span className="ml-1 text-[10px] font-medium text-muted">{PHASE5_UI_COPY.pastMember}</span> : null}{person.isViewer ? <span className="ml-1 text-[10px] font-medium text-muted">{PHASE5_UI_COPY.you}</span> : null}</span>
      <span className={`ml-auto font-mono text-[14px] font-bold tabular ${person.netInr > 0 ? "text-win" : person.netInr < 0 ? "text-loss" : "text-muted"}`}>{inr(person.netInr)}</span>
    </div>
  ))}</div>;
}
