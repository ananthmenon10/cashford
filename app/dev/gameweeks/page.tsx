// Phase 1 debug view (§6). Read-only: shows what the FPL sync and gameweek maintenance
// actually produced, so a bad sync is visible without opening the database.
// Auth-gated — RLS on gameweek_contests still limits the pot rows to the viewer's leagues.

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { loadDevGameweeksPage } from "@/lib/dev-gameweeks-load";
import { LocalTime } from "@/components/LocalTime";

export const dynamic = "force-dynamic";

export default async function DevGameweeksPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createServiceRoleClient();
  const { competitions, gameweeks, counts, noEspnId, moves, unassignedMoves, pots, potsByGameweek, issues } = await loadDevGameweeksPage(supabase, admin);

  return (
    <main className="mx-auto max-w-[900px] px-5 py-8 text-sm">
      <h1 className="text-xl font-extrabold tracking-tight">Gameweeks (debug)</h1>

      <h2 className="mt-6 mb-2 text-xs font-bold uppercase tracking-wide text-label">
        Competitions
      </h2>
      <ul className="flex flex-col gap-1">
        {(competitions ?? []).map((c) => (
          <li key={c.id} className="font-mono text-[12px]">
            {c.slug} · {c.format} · {c.season} · <b>{c.status}</b>
            {c.fpl_source ? " · fpl" : ""}
          </li>
        ))}
      </ul>

      <h2 className="mt-6 mb-2 text-xs font-bold uppercase tracking-wide text-label">
        Gameweeks
      </h2>
      <div className="overflow-x-auto">
        <table className="w-full text-left font-mono text-[12px]">
          <thead className="text-label">
            <tr>
              <th className="py-1 pr-3">GW</th>
              <th className="py-1 pr-3">Status</th>
              <th className="py-1 pr-3">Deadline</th>
              <th className="py-1 pr-3">Active</th>
              <th className="py-1 pr-3">Excluded</th>
              <th className="py-1 pr-3">Void</th>
              <th className="py-1 pr-3">Pots</th>
            </tr>
          </thead>
          <tbody>
            {(gameweeks ?? []).map((g) => {
              const c = counts.get(g.id) ?? { active: 0, excluded: 0, void: 0 };
              return (
                <tr key={g.id} className="border-t border-border">
                  <td className="py-1 pr-3">{g.number}</td>
                  <td className="py-1 pr-3">{g.status}</td>
                  <td className="py-1 pr-3">
                    {g.deadline_at ? <LocalTime iso={g.deadline_at} relative={false} /> : "—"}
                  </td>
                  <td className="py-1 pr-3">{c.active}</td>
                  <td className="py-1 pr-3">{c.excluded}</td>
                  <td className="py-1 pr-3">{c.void}</td>
                  <td className="py-1 pr-3">{potsByGameweek.get(g.id) ?? 0}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[12px] text-muted">
        Fixtures with no ESPN id: {noEspnId ?? 0} · unassigned-by-FPL moves: {unassignedMoves} ·
        total moves: {(moves ?? []).length}
      </p>

      <h2 className="mt-6 mb-2 text-xs font-bold uppercase tracking-wide text-label">
        My pots
      </h2>
      <ul className="flex flex-col gap-1 font-mono text-[12px]">
        {(pots ?? []).length === 0 && <li className="text-muted">none</li>}
        {(pots ?? []).map((p: any) => (
          <li key={p.id}>
            {p.leagues?.name ?? "?"} · gw {p.gameweek_id.slice(0, 8)} · {p.status} · ₹{p.stake_inr}{" "}
            · {p.deadline_at ? <LocalTime iso={p.deadline_at} relative={false} /> : "—"}
          </li>
        ))}
      </ul>

      <h2 className="mt-6 mb-2 text-xs font-bold uppercase tracking-wide text-label">
        Recent sync issues
      </h2>
      <ul className="flex flex-col gap-1 font-mono text-[12px]">
        {(issues ?? []).length === 0 && <li className="text-muted">none</li>}
        {(issues ?? []).map((i: any, n: number) => (
          <li key={n}>
            <LocalTime iso={i.created_at} relative={false} /> · {i.source} · {i.kind} · {i.ref ?? "—"}
          </li>
        ))}
      </ul>
    </main>
  );
}
