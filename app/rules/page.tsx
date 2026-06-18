import { BackLink } from "@/components/BackLink";

function Step({ n, title, formula, children }: { n: number; title: string; formula?: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-[12px] font-bold text-white">{n}</span>
      <div className="flex-1">
        <div className="text-[14px] font-bold">{title}</div>
        {formula && (
          <div className="my-1 inline-block rounded-[8px] bg-bg px-2 py-1 font-mono text-[12px] text-fg">{formula}</div>
        )}
        <div className="text-[13px] leading-relaxed text-label">{children}</div>
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
        <span className="text-[17px] font-extrabold">How it works</span>
      </header>

      <div className="mx-auto flex max-w-[480px] flex-col gap-3.5 px-4 py-4">
        <Card title="The basics">
          <p>For every match you predict two things: the <strong>result</strong> (Home win / Draw / Away win) and the <strong>scoreline</strong>.</p>
          <p>Predictions <strong>lock at kickoff</strong>. Before kickoff you only see your own pick; after kickoff everyone&apos;s picks are revealed.</p>
          <p>Default stake is <strong className="font-mono">₹500</strong> per match, per league. A contest needs at least <strong>2</strong> players&apos; picks to count.</p>
        </Card>

        <Card title="Who wins — the result decides first">
          <p>The <strong>result</strong> (not the scoreline) decides winners, as long as players disagree on it:</p>
          <ul className="ml-4 list-disc space-y-1">
            <li>Everyone who got the result right is a <strong className="text-win">winner</strong>; everyone else is a <strong className="text-loss">loser</strong>.</li>
            <li>Each loser pays the stake. The total pot is split <strong>equally</strong> among the winners.</li>
          </ul>
          <div className="rounded-[10px] bg-bg p-3 text-[12px] leading-relaxed">
            <div className="mb-1.5 text-muted">The pot = the <em>losers&apos;</em> stakes, split equally among winners:</div>
            <div>1 winner, 3 losers → winner <span className="font-mono text-win">+₹1,500</span> (₹500 × 3).</div>
            <div className="mt-1">2 winners, 1 loser → each <span className="font-mono text-win">+₹250</span> (₹500 ÷ 2); loser <span className="font-mono text-loss">−₹500</span>.</div>
            <div className="mt-1">3 winners, 1 loser → each <span className="font-mono text-win">≈ +₹167</span> (₹500 ÷ 3); loser <span className="font-mono text-loss">−₹500</span>.</div>
          </div>
          <p className="text-[12px] text-muted">When the result splits players like this, the scoreline is <em>ignored</em> — it&apos;s only a tiebreaker (below).</p>
        </Card>

        <Card title="The tiebreaker — when everyone predicts the same result">
          <p>If <strong>everyone picks the same result</strong> (say all &quot;Home win&quot;), there&apos;s no winner/loser split — so the <strong>closest predicted scoreline</strong> decides the single winner. It&apos;s checked in this exact order, stopping at the first step that separates people:</p>
          <div className="flex flex-col gap-3.5 rounded-[12px] bg-bg/40 py-1">
            <Step n={1} title="Exact score" formula="your score == actual score">
              Nailed the exact scoreline → you win outright.
            </Step>
            <Step n={2} title="Fewest total goals off" formula="| yourHome − actHome | + | yourAway − actAway |">
              Add up how far off you were on <em>each</em> team&apos;s goals. Lowest total wins.
            </Step>
            <Step n={3} title="Closest winning margin" formula="| (yourHome − yourAway) − (actHome − actAway) |">
              Who got the <em>margin</em> of victory closest (e.g. &quot;won by 1&quot;).
            </Step>
            <Step n={4} title="Closest total goals" formula="| (yourHome + yourAway) − (actHome + actAway) |">
              Who was closest on the <em>total number of goals</em> in the match.
            </Step>
            <Step n={5} title="Still tied?">
              The tied players <strong>split</strong> the pot equally. If every pick is identical, it&apos;s a <strong>push</strong> — no money changes hands.
            </Step>
          </div>
          <div className="rounded-[10px] border border-border bg-surface p-3 text-[12px]">
            <div className="font-bold">Example — actual result <span className="font-mono">2–1</span>, everyone picked Home win:</div>
            <div className="mt-1.5 font-mono">
              <div>you 2–1 → <span className="text-win">exact ✓ you win</span></div>
              <div className="mt-1 text-muted">no exact? then by total goals off:</div>
              <div>3–1 → off by 1 &nbsp;·&nbsp; 1–0 → off by 2 &nbsp;·&nbsp; 3–2 → off by 2</div>
              <div className="text-win">→ 3–1 wins (closest)</div>
            </div>
          </div>
          <p className="text-[12px] text-muted">This still applies if <em>everyone got the result wrong</em> — the &quot;least wrong&quot; scoreline wins.</p>
        </Card>

        <Card title="A couple of edge cases">
          <p><strong>Players split the result but nobody&apos;s right</strong> (e.g. some Home, some Away, but it&apos;s a Draw): falls back to the same closest-scoreline check above. If even that can&apos;t separate anyone → the match is <strong>void</strong> (no money).</p>
          <p><strong>Fewer than 2 picks</strong>, or a match cancelled/abandoned → <strong>void</strong>, no money.</p>
        </Card>

        <Card title="Knockouts">
          <p>From the Round of 32 onwards there&apos;s no Draw — you pick <strong>who advances</strong>. The scoreline you enter is the <strong>90-minute</strong> score, and that 90-minute score is what the tiebreaker uses, even if the match goes to extra time or penalties.</p>
        </Card>

        <Card title="Money &amp; dues">
          <p>Losers pay, winners collect — it always nets to zero across the league. The <strong>Dues</strong> tab shows everyone&apos;s running total and a simple &quot;who owes whom&quot; so you can settle up.</p>
        </Card>

        <p className="pb-2 pt-1 text-center text-[11px] text-muted">Stakes and rules are managed by your captain.</p>
      </div>
    </main>
  );
}
