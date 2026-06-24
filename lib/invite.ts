import { randomBytes } from "node:crypto";

/** Opaque, URL-safe invite token (~32 chars). */
export function generateToken(): string {
  return randomBytes(24).toString("base64url");
}

const CROCKFORD_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** 8-char short code from the Crockford base32 alphabet (no I/L/O/U). */
export function generateShortCode(): string {
  const bytes = randomBytes(8);
  let code = "";
  for (let i = 0; i < 8; i++) {
    code += CROCKFORD_ALPHABET[bytes[i] % 32];
  }
  return code;
}
