import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PaymentDetail } from "@/components/dues/PaymentDetail";

export default async function LeaguePaymentPage({ params }: { params: Promise<{ slug: string; paymentId: string }> }) {
  const { paymentId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) notFound();
  const query = await supabase.from("payments").select("id, league_id, payer_user_id, receiver_user_id, amount_inr, status, logged_by").eq("id", paymentId).maybeSingle();
  if (query.error || !query.data) notFound();
  const member = await supabase.from("league_members").select("user_id").eq("league_id", query.data.league_id).eq("user_id", user.id).is("left_at", null).maybeSingle();
  return <main className="min-h-screen bg-bg px-4 py-6"><div className="mx-auto max-w-[520px]"><PaymentDetail payment={{ id: query.data.id, payerUserId: query.data.payer_user_id, receiverUserId: query.data.receiver_user_id, amountInr: query.data.amount_inr, status: query.data.status, loggedBy: query.data.logged_by }} viewerId={user.id} canReverse={!!member.data} /></div></main>;
}
