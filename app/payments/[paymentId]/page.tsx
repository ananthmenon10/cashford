import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PaymentDetail } from "@/components/dues/PaymentDetail";
import { loadPaymentDetailPage } from "@/lib/payment-detail-load";

export default async function PaymentPage({ params }: { params: Promise<{ paymentId: string }> }) {
  const { paymentId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) notFound();
  const loaded = await loadPaymentDetailPage(supabase, paymentId, user.id);
  if (!loaded) notFound();
  return <main className="min-h-screen bg-bg px-4 py-6"><div className="mx-auto max-w-[520px]"><PaymentDetail payment={{ id: loaded.payment.id, payerUserId: loaded.payment.payer_user_id, receiverUserId: loaded.payment.receiver_user_id, amountInr: loaded.payment.amount_inr, status: loaded.payment.status, loggedBy: loaded.payment.logged_by }} viewerId={loaded.viewerId} canReverse={loaded.canReverse} /></div></main>;
}
