import { createClient } from '@supabase/supabase-js';
import { matchEspnFixtures } from '../lib/espn-match';
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { db: { schema: 'cashford' } });
const r: any = await matchEspnFixtures(admin as any, 'pl-2026-27');
console.log(JSON.stringify(r, null, 1).slice(0, 1500));
