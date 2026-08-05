import type { SupabaseClient } from "@supabase/supabase-js";

type CashfordClient = SupabaseClient<any, "cashford", any>;

function fail(error: { message?: string } | null, context: string) {
  if (error) throw new Error(`${context}: ${error.message ?? "query-failed"}`);
}

export type PaymentDetailPageLoad = {
  payment: {
    id: string;
    league_id: string;
    payer_user_id: string;
    receiver_user_id: string;
    amount_inr: number;
    status: string;
    logged_by: string;
  };
  viewerId: string;
  canReverse: boolean;
};

/** The server-side read path shared by both payment detail routes. */
export async function loadPaymentDetailPage(
  session: CashfordClient,
  paymentId: string,
  viewerId: string,
): Promise<PaymentDetailPageLoad | null> {
  const query = await session
    .from("payments")
    .select(
      "id, league_id, payer_user_id, receiver_user_id, amount_inr, status, logged_by",
    )
    .eq("id", paymentId)
    .maybeSingle();
  fail(query.error, "payment-detail");
  if (!query.data) return null;
  const member = await session
    .from("league_members")
    .select("user_id")
    .eq("league_id", query.data.league_id)
    .eq("user_id", viewerId)
    .is("left_at", null)
    .maybeSingle();
  fail(member.error, "payment-detail-membership");
  return {
    payment: query.data,
    viewerId,
    canReverse: !!member.data,
  };
}
