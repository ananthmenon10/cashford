// Phase 1 debug view (§6). Read-only: shows what the FPL sync and gameweek maintenance
// actually produced, so a bad sync is visible without opening the database.
// Auth-gated — RLS on gameweek_contests still limits the pot rows to the viewer's leagues.

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";

const IST = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata",
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});
const ist = (iso: string | null) => (iso ? IST.format(new Date(iso)) : "—");

export default async function DevGameweeksPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: competitions } = await supabase
    .from("competitions")
    .select("id, slug, name, format, season, status, fpl_source")
    .order("slug");

  const { data: gameweeks } = await supabase
    .from("gameweeks")
    .select("id, competition_id, number, name, status, deadline_at, locked_at")
    .order("number");

  // One read of every membership row; the per-gameweek counts are derived here rather than
  // with 38 count queries.
  const { data: memberships } = await supabase
    .from("gameweek_fixtures")
    .select("gameweek_id, state, is_current");

  const counts = new Map<string, { active: number; excluded: number; void: number }>();
  for (const m of memberships ?? []) {
    if (!m.is_current) continue;
    const c = counts.get(m.gameweek_id) ?? { active: 0, excluded: 0, void: 0 };
    if (m.state === "active") c.active++;
    else if (m.state === "excluded") c.excluded++;
    else c.void++;
    counts.set(m.gameweek_id, c);
  }

  // Fixtures ESPN can never poll (FPL is their only score source).
  const { count: noEspnId } = await supabase
    .from("fixtures")
    .select("id", { count: "exact", head: true })
    .is("external_id", null);

  // fixture_moves and sync_issues are service-role-only diagnostics (no RLS policy at all),
  // so they are read with the admin client. Neither holds user data.
  const admin = createServiceRoleClient();
  const { data: moves } = await admin
    .from("fixture_moves")
    .select("new_membership_id");
  const unassignedMoves = (moves ?? []).filter((m: any) => m.new_membership_id === null).length;

  const { data: pots } = await supabase
    .from("gameweek_contests")
    .select("id, gameweek_id, status, stake_inr, deadline_at, leagues(name)");

  const potsByGameweek = new Map<string, number>();
  for (const p of pots ?? []) {
    potsByGameweek.set(p.gameweek_id, (potsByGameweek.get(p.gameweek_id) ?? 0) + 1);
  }

  const { data: issues } = await admin
    .from("sync_issues")
    .select("source, kind, ref, created_at")
    .order("created_at", { ascending: false })
    .limit(25);

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
              <th className="py-1 pr-3">Deadline (IST)</th>
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
                  <td className="py-1 pr-3">{ist(g.deadline_at)}</td>
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
            · {ist(p.deadline_at)}
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
            {ist(i.created_at)} · {i.source} · {i.kind} · {i.ref ?? "—"}
          </li>
        ))}
      </ul>
    </main>
  );
}
