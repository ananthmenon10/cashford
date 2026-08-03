"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { PAYMENT_COPY } from "@/lib/payment-copy";

const inputSchema = z.object({
  leagueId: z.string().uuid(),
  payerUserId: z.string().uuid(),
  receiverUserId: z.string().uuid(),
  amountInr: z.number().int().min(1),
  paidOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  note: z.string().max(240).optional().nullable(),
  clientRequestId: z.string().uuid(),
  acknowledgedIds: z.array(z.string().uuid()).optional().nullable(),
});

export type LogPaymentInput = z.infer<typeof inputSchema>;
export type LogPaymentResult = {
  outcome?: string;
  payment?: unknown;
  paymentId?: string | null;
  matchedIds?: string[];
  error?: string;
};

export async function logPayment(input: LogPaymentInput): Promise<LogPaymentResult> {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { error: PAYMENT_COPY.logFailure };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "not authenticated" };

  const value = parsed.data;
  const { data, error } = await supabase.rpc("log_payment", {
    p_league_id: value.leagueId,
    p_payer_user_id: value.payerUserId,
    p_receiver_user_id: value.receiverUserId,
    p_amount_inr: value.amountInr,
    p_paid_on: value.paidOn,
    p_note: value.note?.trim() || null,
    p_client_request_id: value.clientRequestId,
    p_acknowledged_ids: value.acknowledgedIds ?? null,
  });
  if (error) return { error: PAYMENT_COPY.logFailure };

  const row: any = Array.isArray(data) ? data[0] : data;
  const matchedIds = Array.isArray(row?.matched_ids) ? row.matched_ids : [];
  if (row?.outcome === "matching_existing") {
    return {
      outcome: "matching_existing",
      paymentId: row.payment?.id ?? row.payment_id ?? matchedIds[0] ?? null,
      matchedIds,
    };
  }
  return { payment: row?.payment ?? row, outcome: row?.outcome ?? "created", matchedIds };
}
