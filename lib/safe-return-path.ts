const LOCAL_ORIGIN = "http://localhost.invalid";

export function safeReturnPath(raw: string): string {
  const value = raw.trim();
  if (!value.startsWith("/")) return "/";
  try {
    const url = new URL(value, LOCAL_ORIGIN);
    if (url.origin !== LOCAL_ORIGIN) return "/";
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return "/";
  }
}
