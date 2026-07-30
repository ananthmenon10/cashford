"use server";

import { createClient } from "@/lib/supabase/server";
import { consumePendingInvite } from "@/app/leagues/join/actions";
import { safeReturnPath } from "@/lib/safe-return-path";
import { redirect } from "next/navigation";

export type AuthState = { error: string | null };

export async function login(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const username = String(formData.get("username") ?? "")
    .trim()
    .toLowerCase();
  const password = String(formData.get("password") ?? "");
  const returnPath = safeReturnPath(String(formData.get("next") ?? ""));

  if (!username || !password) {
    return { error: "Enter your username and password." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email: `${username}@cashford.internal`,
    password,
  });

  if (error) return { error: "Incorrect username or password." };

  const slug = await consumePendingInvite(data.user.id);
  if (slug) {
    redirect("/leagues/" + slug);
  }

  // Middleware routes to /change-password if this is a first login.
  redirect(returnPath);
}
