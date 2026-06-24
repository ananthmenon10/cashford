export const USERNAME_RE = /^[a-z0-9_-]{3,20}$/;

// ── Slug validation ─────────────────────────────────────────────────────────

export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const RESERVED_SLUGS = [
  "new",
  "create",
  "settings",
  "login",
  "rules",
  "api",
  "j",
  "change-password",
  "leagues",
  "signup",
];

/** Convert a league name into a URL-safe slug (up to 40 chars). */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")  // non-alphanumeric runs → hyphen
    .replace(/-+/g, "-")           // collapse consecutive hyphens
    .replace(/^-+|-+$/g, "")       // trim leading/trailing hyphens
    .slice(0, 40);
}

export function validateSlug(
  raw: string,
): { ok: true; value: string } | { ok: false; error: string } {
  const value = slugify(raw);
  // Check reserved before format/length so the error is specific
  if (RESERVED_SLUGS.includes(value)) {
    return { ok: false, error: "That URL is reserved — pick another." };
  }
  if (!SLUG_RE.test(value) || value.length < 3 || value.length > 40) {
    return {
      ok: false,
      error: "League URL must be 3–40 chars: letters, numbers, and hyphens only.",
    };
  }
  return { ok: true, value };
}

// ── Stake validation ─────────────────────────────────────────────────────────

export function validateStake(
  raw: string | number,
): { ok: true; value: number } | { ok: false; error: string } {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isInteger(n)) {
    return { ok: false, error: "Stake must be a whole number." };
  }
  if (n < 50) {
    return { ok: false, error: "Minimum stake is ₹50 per match." };
  }
  if (n > 1_000_000) {
    return { ok: false, error: "Stake is too high." };
  }
  return { ok: true, value: n };
}

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
