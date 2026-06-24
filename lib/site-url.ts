import "server-only";
import { headers } from "next/headers";

// The site's origin for the CURRENT request — correct on prod, staging, and Vercel
// previews without hardcoding a domain. Use in Server Components to build absolute
// URLs (e.g. invite links). Client components should use window.location.origin.
export async function originFromHeaders(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "cashford.vercel.app";
  const proto = h.get("x-forwarded-proto") ?? "https";
  return `${proto}://${host}`;
}
