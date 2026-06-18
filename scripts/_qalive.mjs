import { createClient } from "@supabase/supabase-js";
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth:{persistSession:false}, db:{schema:"cashford"} });
const uidOf = async (u) => { const { data } = await admin.auth.admin.listUsers({ perPage:200 }); return data.users.find(x=>x.email===`${u}@cashford.internal`)?.id; };
if (process.argv[2]==="cleanup") {
  const { data: lg } = await admin.from("leagues").select("id").eq("slug","qa-live").maybeSingle();
  if (lg) { const { data:cs } = await admin.from("contests").select("id").eq("league_id",lg.id); const ids=(cs??[]).map(c=>c.id);
    if (ids.length){ await admin.from("predictions").delete().in("contest_id",ids); await admin.from("contests").delete().in("id",ids);} 
    await admin.from("league_members").delete().eq("league_id",lg.id); await admin.from("leagues").delete().eq("id",lg.id); }
  const id = await uidOf("qaview"); if (id) await admin.auth.admin.deleteUser(id);
  console.log("qa-live cleaned"); process.exit(0);
}
// setup
let id = await uidOf("qaview");
if (!id) { const { data } = await admin.auth.admin.createUser({ email:"qaview@cashford.internal", password:"Qa-View-1234!", email_confirm:true, user_metadata:{ username:"qaview", display_name:"QA View", must_change_password:false } }); id = data.user.id; }
const { data: lg } = await admin.from("leagues").upsert({ name:"QA Live", slug:"qa-live", default_stake_inr:500 }, { onConflict:"slug" }).select("id").single();
await admin.from("league_members").upsert({ league_id:lg.id, user_id:id }, { onConflict:"league_id,user_id" });
const { data: fx } = await admin.from("fixtures").select("id, kickoff_at, status").eq("home_label","Czechia").ilike("away_label","South Africa%").single();
const { data: c } = await admin.from("contests").upsert({ league_id:lg.id, fixture_id:fx.id, stake_inr:500, status:"locked", lock_at:fx.kickoff_at, is_knockout:false }, { onConflict:"league_id,fixture_id" }).select("id").single();
await admin.from("predictions").upsert({ contest_id:c.id, user_id:id, outcome:"home", pred_home:2, pred_away:1, updated_at:new Date().toISOString() }, { onConflict:"contest_id,user_id" });
console.log(`qa-live ready (fixture status=${fx.status}); login qaview / Qa-View-1234!`);
