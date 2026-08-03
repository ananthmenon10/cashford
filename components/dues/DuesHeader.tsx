import { DUES_COPY } from "@/lib/payment-copy";

export function DuesHeader() {
  return (
    <div className="mt-5">
      <h1 className="text-xl font-extrabold">{DUES_COPY.netPosition}</h1>
      <p className="mt-1 text-[12px] text-cs2-ink-3">{DUES_COPY.netNote}</p>
    </div>
  );
}

