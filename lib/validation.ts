export const USERNAME_RE = /^[a-z0-9_-]{3,20}$/;

export function normalizeUsername(raw: string): string {
  return raw.trim().toLowerCase();
}

export function validateUsername(
  raw: string,
): { ok: true; value: string } | { ok: false; error: string } {
  const value = normalizeUsername(raw);
  if (!USERNAME_RE.test(value)) {
    return {
      ok: false,
      error: "Username must be 3–20 chars: letters, numbers, _ or -",
    };
  }
  return { ok: true, value };
}

export function validatePassword(
  pw: string,
): { ok: true } | { ok: false; error: string } {
  if (pw.length < 8) {
    return { ok: false, error: "Password must be at least 8 characters." };
  }
  return { ok: true };
}
