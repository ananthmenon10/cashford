import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { PAYMENT_COPY } from "@/lib/payment-copy";
const schema = z.object({ clientRequestId: z.string().uuid() });
export async function POST(request: Request, context: { params: Promise<{ paymentId: string }> }) {
  const { paymentId } = await context.params; const supabase = await createClient(); const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not authenticated" }, { status: 401 }); const parsed = schema.safeParse(await request.json().catch(() => null)); if (!parsed.success) return NextResponse.json({ error: "invalid request" }, { status: 400 });
  const { data, error } = await supabase.rpc("cancel_payment", { p_payment_id: paymentId, p_client_request_id: parsed.data.clientRequestId }); if (error) return NextResponse.json({ error: PAYMENT_COPY.cancelFailure }, { status: 400 }); return NextResponse.json({ payment: data });
}
