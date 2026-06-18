import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { logout } from "./actions";

function initials(name: string) {
  const clean = name.replace(/[^A-Za-z]/g, "");
  return (clean.slice(0, 2) || "??").toUpperCase();
}

const inr = (n: number) =>
  `${n < 0 ? "−" : "+"}₹${Math.abs(n).toLocaleString("en-IN")}`;

export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const username =
    (user?.user_metadata?.username as string | undefined) ??
    user?.email?.split("@")[0] ??
    "you";

  const [{ data: leagues }, { data: members }] = await Promise.all([
    supabase.from("leagues").select("id, name, slug").order("name"),
    supabase.from("league_members").select("league_id"),
  ]);

  const counts = new Map<string, number>();
  for (const m of members ?? []) {
    counts.set(m.league_id, (counts.get(m.league_id) ?? 0) + 1);
  }

  return (
    <main className="min-h-screen bg-bg">
      {/* TopBar */}
      <header className="flex items-center justify-between border-b border-border bg-surface px-5 py-3">
        <div className="flex items-center gap-2">
          <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-primary">
            <div className="h-[9px] w-[9px] rounded-full bg-accent" />
          </div>
          <span className="text-lg font-extrabold tracking-[-.02em]">Cashford</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="flex h-[30px] w-[30px] items-center justify-center rounded-full bg-mint text-[11px] font-bold text-primary-press">
            {initials(username)}
          </span>
          <form action={logout}>
            <button className="text-xs font-bold text-muted">Sign out</button>
          </form>
        </div>
      </header>

      <div className="mx-auto max-w-[480px] px-5 py-5">
        <h1 className="mb-3.5 text-xl font-extrabold tracking-[-.01em]">Your leagues</h1>

        {(leagues ?? []).length === 0 ? (
          <div className="rounded-card border border-dashed border-[#CBD5E1] p-6 text-center">
            <div className="text-[15px] font-bold">No leagues yet</div>
            <div className="mt-1 text-[13px] text-muted">
              Your captain will add you to a league. Check back soon.
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {(leagues ?? []).map((lg) => (
              <Link
                key={lg.id}
                href={`/leagues/${lg.slug}`}
                className="block rounded-card border border-border bg-surface p-4 shadow-[0_2px_8px_rgba(15,23,42,.04)] active:scale-[.99] transition-transform"
              >
                <div className="flex items-start justify-between">
                  <div>
                    <div className="text-base font-bold">{lg.name}</div>
                    <div className="mt-0.5 text-xs text-muted">
                      {counts.get(lg.id) ?? 0} members
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-[11px] text-muted">Your net</div>
                    <div className="font-mono text-xl font-bold text-muted tabular">
                      {inr(0)}
                    </div>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
