import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { PAYMENT_COPY } from "@/lib/payment-copy";

const bodySchema = z.object({
  leagueId: z.string().uuid(), payerUserId: z.string().uuid(), receiverUserId: z.string().uuid(), amountInr: z.number().int().min(1), paidOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), note: z.string().max(240).optional().nullable(), clientRequestId: z.string().uuid(), acknowledgedIds: z.array(z.string().uuid()).optional().nullable(),
});

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid payment" }, { status: 400 });
  const value = parsed.data;
  const { data, error } = await supabase.rpc("log_payment", { p_league_id: value.leagueId, p_payer_user_id: value.payerUserId, p_receiver_user_id: value.receiverUserId, p_amount_inr: value.amountInr, p_paid_on: value.paidOn, p_note: value.note?.trim() || null, p_client_request_id: value.clientRequestId, p_acknowledged_ids: value.acknowledgedIds ?? null });
  if (error) return NextResponse.json({ error: PAYMENT_COPY.logFailure }, { status: error.code === "23505" ? 409 : 400 });
  const row: any = Array.isArray(data) ? data[0] : data;
  const matchedIds = Array.isArray(row?.matched_ids) ? row.matched_ids : [];
  if (row?.outcome === "matching_existing") return NextResponse.json({ outcome: "matching_existing", paymentId: row.payment?.id ?? row.payment_id ?? matchedIds[0] ?? null, matchedIds }, { status: 409 });
  return NextResponse.json({ payment: row?.payment ?? row, outcome: row?.outcome ?? "created", matchedIds });
}
