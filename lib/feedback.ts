import { FEEDBACK_COPY } from "@/lib/gw-copy";

export function validateFeedbackMessage(value: unknown):
  | { ok: true; message: string }
  | { ok: false; error: string } {
  if (typeof value !== "string") {
    return { ok: false, error: FEEDBACK_COPY.required };
  }

  const message = value.trim();
  const length = Array.from(message).length;
  if (length < 1) return { ok: false, error: FEEDBACK_COPY.required };
  if (length > 2000) {
    return { ok: false, error: FEEDBACK_COPY.tooLong };
  }
  return { ok: true, message };
}

export function isFeedbackRateLimited(count: number | null): boolean {
  return (count ?? 0) > 10;
}

export function leagueSlugFromPath(pathname: string): string | null {
  const match = /^\/leagues\/([^/]+)(?:\/|$)/.exec(pathname);
  return match?.[1] ?? null;
}
