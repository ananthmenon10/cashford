"use server";

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import type { AuthState } from "../login/actions";

export async function changePassword(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");

  if (password.length < 10) {
    return { error: "Use at least 10 characters." };
  }
  if (password !== confirm) {
    return { error: "Passwords don't match." };
  }

  const supabase = await createClient();
  // Set the new password AND clear the first-login flag in one call.
  const { error } = await supabase.auth.updateUser({
    password,
    data: { must_change_password: false },
  });

  if (error) return { error: error.message };

  redirect("/");
}
