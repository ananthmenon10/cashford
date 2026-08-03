import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
const schema = z.object({ leagueId: z.string().uuid(), fingerprint: z.string().min(1).max(10000) });
export async function POST(request: Request) {
  const supabase = await createClient(); const { data: { user } } = await supabase.auth.getUser(); if (!user) return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  const parsed = schema.safeParse(await request.json().catch(() => null)); if (!parsed.success) return NextResponse.json({ error: "invalid issue" }, { status: 400 });
  const membership = await supabase.from("league_members").select("user_id").eq("league_id", parsed.data.leagueId).eq("user_id", user.id).is("left_at", null).maybeSingle(); if (membership.error || !membership.data) return NextResponse.json({ error: "not found" }, { status: 404 });
  const admin = createServiceRoleClient(); const { data, error } = await admin.rpc("record_dues_ledger_parity", { p_league_id: parsed.data.leagueId, p_detail: { fingerprint: parsed.data.fingerprint } }); if (error) return NextResponse.json({ error: "issue not recorded" }, { status: 400 }); return NextResponse.json({ issueId: data });
}

