"use server";

import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { validateUsername, validatePassword } from "@/lib/validation";
import { consumePendingInvite } from "@/app/leagues/join/actions";
import { redirect } from "next/navigation";

export type AuthState = { error: string | null };

export async function signUp(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const usernameRaw = String(formData.get("username") ?? "");
  const displayNameRaw = String(formData.get("displayName") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");

  // Validate username
  const usernameResult = validateUsername(usernameRaw);
  if (!usernameResult.ok) return { error: usernameResult.error };
  const username = usernameResult.value;

  // Validate password
  const passwordResult = validatePassword(password);
  if (!passwordResult.ok) return { error: passwordResult.error };

  // Confirm match
  if (password !== confirm) return { error: "Passwords don't match." };

  // Normalize display name
  const displayName = displayNameRaw.slice(0, 40) || username;

  const email = `${username}@cashford.internal`;
  const admin = createServiceRoleClient();

  // Availability pre-check
  const { data: existing } = await admin
    .from("profiles")
    .select("id")
    .eq("username", username)
    .maybeSingle();

  if (existing) return { error: "Username taken." };

  // Create the user
  const { data: created, error: createError } =
    await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        username,
        display_name: displayName,
        is_admin: false,
        must_change_password: false,
      },
    });

  if (createError) {
    const msg = createError.message.toLowerCase();
    if (
      msg.includes("already") ||
      msg.includes("exists") ||
      msg.includes("unique")
    ) {
      return { error: "Username taken." };
    }
    return { error: "Couldn't create your account. Try again." };
  }

  const newUserId = created.user.id;

  // Sign in to set the session cookie
  const supabase = await createClient();
  const { error: signInError } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (signInError) {
    // Roll back the created user
    await admin.auth.admin.deleteUser(newUserId);
    return { error: "Couldn't create your account. Try again." };
  }

  const slug = await consumePendingInvite(newUserId);
  if (slug) {
    redirect("/leagues/" + slug);
  }
  redirect("/");
}
