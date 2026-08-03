import { ARCHIVE_COPY } from "@/lib/payment-copy";
export function WcRules() { return <section className="mt-4 rounded-card border border-border bg-surface p-4"><h2 className="font-extrabold">{ARCHIVE_COPY.rules}</h2><ol className="mt-2 list-decimal pl-5 text-[12px] text-muted">{ARCHIVE_COPY.rulesList.map((rule) => <li key={rule}>{rule}</li>)}</ol></section>; }
