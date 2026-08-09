import { BackLink } from "@/components/BackLink";
import { RULES_COPY as R } from "@/lib/rules-copy";

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span>{label}</span>
      <span className="font-mono font-bold text-fg">{value}</span>
    </div>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-[12px] font-bold text-white">{n}</span>
      <div className="flex-1 text-[13px] leading-relaxed text-label">
        <span className="font-bold text-fg">{title}</span> {children}
      </div>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-card border border-border bg-surface p-4 shadow-[0_2px_8px_rgba(15,23,42,.04)]">
      <h2 className="mb-3 text-[16px] font-extrabold tracking-[-.01em]">{title}</h2>
      <div className="flex flex-col gap-3 text-[13px] leading-relaxed text-label">{children}</div>
    </section>
  );
}

export default function RulesPage() {
  return (
    <main className="min-h-screen bg-bg">
      <header className="flex items-center gap-2.5 border-b border-border bg-surface px-4 py-3">
        <BackLink href="/" />
        <span className="text-[17px] font-extrabold">{R.title}</span>
      </header>

      <div className="mx-auto flex max-w-[480px] flex-col gap-3.5 px-4 py-4">
        <Card title={R.basicsTitle}>
          <p>{R.basicsEntry}</p>
          <p>{R.basicsLock}</p>
          <p>{R.basicsWhole}</p>
          <p>{R.basicsAnte}</p>
          <p className="text-[12px] text-muted">{R.basicsInvalid}</p>
        </Card>

        <Card title={R.scoringTitle}>
          <p>{R.scoringIntro}</p>
          <div className="flex flex-col gap-1.5 rounded-[10px] bg-bg p-3 text-[13px]">
            <Row label={R.scoreExactLabel} value={R.scoreExactPts} />
            <Row label={R.scoreResultLabel} value={R.scoreResultPts} />
            <Row label={R.scoreMissLabel} value={R.scoreMissPts} />
          </div>
          <p className="text-[12px] text-muted">{R.scoringVoid}</p>
          <p>{R.scoringSum}</p>
        </Card>

        <Card title={R.winnersTitle}>
          <p>{R.winnersLead}</p>
          <div className="flex flex-col gap-3.5 rounded-[12px] bg-bg/40 py-1">
            <Step n={1} title={R.tiebreak1Title}>{R.tiebreak1Body}</Step>
            <Step n={2} title={R.tiebreak2Title}>{R.tiebreak2Body}</Step>
            <Step n={3} title={R.tiebreak3Title}>{R.tiebreak3Body}</Step>
          </div>
        </Card>

        <Card title={R.moneyTitle}>
          <p>{R.moneyLead}</p>
          <div className="rounded-[10px] bg-bg p-3 text-[12px] leading-relaxed">
            <div>{R.moneyOneWinner}</div>
            <div className="mt-1">{R.moneyThreeWinners}</div>
          </div>
          <p className="text-[12px] text-muted">{R.moneyRounding}</p>
        </Card>

        <Card title={R.voidTitle}>
          <p>{R.voidLead}</p>
          <ul className="ml-4 list-disc space-y-1">
            <li>{R.voidNoEntrants}</li>
            <li>{R.voidSingleEntrant}</li>
            <li>{R.voidAllFixtures}</li>
          </ul>
        </Card>

        <Card title={R.duesTitle}>
          <p>{R.duesBody}</p>
        </Card>

        <Card title={R.archiveTitle}>
          <p>{R.archiveRules}</p>
          <p>{R.archiveWhere}</p>
          <p>{R.archiveDues}</p>
        </Card>

        <p className="pb-2 pt-1 text-center text-[11px] text-muted">{R.footer}</p>
      </div>
    </main>
  );
}
