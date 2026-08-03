import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { loadLeagueIdentity } from "@/lib/gw-view";
import { loadDuesView } from "@/lib/dues-view";
import { PaymentSheet } from "@/components/dues/PaymentSheet";

export default async function DuesLogPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ payer?: string; receiver?: string; amount?: string }> }) {
  const { slug } = await params;
  const query = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) notFound();
  const identity = await loadLeagueIdentity(supabase, slug);
  if (!identity) notFound();
  const view = await loadDuesView(supabase, createServiceRoleClient(), identity, user.id);
  const participantIds = new Set(view.people.map((person) => person.id));
  const amount = query.amount ? Number(query.amount) : undefined;
  const initial = query.payer && query.receiver && participantIds.has(query.payer) && participantIds.has(query.receiver) && typeof amount === "number" && Number.isInteger(amount) && amount > 0
    ? { payerUserId: query.payer, receiverUserId: query.receiver, amountInr: amount }
    : undefined;
  return <main className="min-h-screen bg-bg px-4 py-6"><div className="mx-auto max-w-[520px]"><PaymentSheet leagueId={identity.league.id} participantOptions={view.people.map((person) => ({ id: person.id, name: person.name }))} initial={initial} /></div></main>;
}
