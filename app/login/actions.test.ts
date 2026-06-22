import { describe, it, expect, vi, beforeEach } from "vitest";

const signInWithPassword = vi.fn();
const redirect = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { signInWithPassword: (a: any) => signInWithPassword(a) } }),
}));
vi.mock("next/navigation", () => ({ redirect: (p: string) => redirect(p) }));

import { login } from "./actions";

const form = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};

beforeEach(() => {
  signInWithPassword.mockReset();
  redirect.mockReset();
});

describe("login", () => {
  it("requires both fields", async () => {
    expect(await login({ error: null }, form({ username: "", password: "" }))).toEqual({ error: "Enter your username and password." });
    expect(signInWithPassword).not.toHaveBeenCalled();
  });

  it("normalizes the username into the internal email and signs in", async () => {
    signInWithPassword.mockResolvedValue({ error: null });
    await login({ error: null }, form({ username: "  Ananth  ", password: "pw" }));
    expect(signInWithPassword).toHaveBeenCalledWith({ email: "ananth@cashford.internal", password: "pw" });
    expect(redirect).toHaveBeenCalledWith("/");
  });

  it("maps an auth failure to a generic message (no user enumeration)", async () => {
    signInWithPassword.mockResolvedValue({ error: { message: "Invalid login credentials" } });
    expect(await login({ error: null }, form({ username: "ananth", password: "wrong" }))).toEqual({ error: "Incorrect username or password." });
    expect(redirect).not.toHaveBeenCalled();
  });
});
