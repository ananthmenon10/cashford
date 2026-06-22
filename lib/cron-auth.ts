// Authorization for the cron tick endpoint (app/api/cron/tick/route.ts).
// Accepts the Vercel Cron / pg_cron `Authorization: Bearer <secret>` header or a
// manual `?secret=` query param. If CRON_SECRET is unset, every caller is denied
// (fail closed) so the settle/lock job can never run unauthenticated.

export interface CronRequest {
  header: string | null;
  queryParam: string | null;
}

export function isAuthorized(req: CronRequest, secret = process.env.CRON_SECRET): boolean {
  if (!secret) return false;
  if (req.header === `Bearer ${secret}`) return true;
  return req.queryParam === secret;
}
