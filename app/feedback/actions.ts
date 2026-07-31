"use server";

import { APP_VERSION } from "@/lib/version";
import { FEEDBACK_COPY } from "@/lib/gw-copy";
import {
  isFeedbackRateLimited,
  leagueSlugFromPath,
  validateFeedbackMessage,
} from "@/lib/feedback";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";

const FEEDBACK_WINDOW_MS = 60 * 60 * 1000;

export type FeedbackActionResult =
  | { ok: true }
  | { ok: false; error: string };

export async function submitFeedback(input: {
  message: string;
  pathname: string;
}): Promise<FeedbackActionResult> {
  const validation = validateFeedbackMessage(input?.message);
  if (!validation.ok) return validation;

  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { ok: false, error: FEEDBACK_COPY.signInAgain };

    const pathname =
      typeof input.pathname === "string" && input.pathname.startsWith("/")
        ? input.pathname
        : "/";
    const admin = createServiceRoleClient();
    const since = new Date(Date.now() - FEEDBACK_WINDOW_MS).toISOString();
    const rateQuery = await admin
      .from("feedback")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .gte("created_at", since);
    if (rateQuery.error) {
      throw new Error(`feedback-rate-limit: ${rateQuery.error.message}`);
    }
    if (isFeedbackRateLimited(rateQuery.count)) {
      return { ok: false, error: FEEDBACK_COPY.tooMany };
    }

    const { error } = await admin.from("feedback").insert({
      user_id: user.id,
      path: pathname,
      league_slug: leagueSlugFromPath(pathname),
      message: validation.message,
      app_version: Number(APP_VERSION),
    });
    if (error) throw new Error(`feedback-insert: ${error.message}`);

    return { ok: true };
  } catch (error) {
    console.error("[feedback] submit failed", error);
    return { ok: false, error: FEEDBACK_COPY.sendError };
  }
}
