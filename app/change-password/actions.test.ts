import { describe, it, expect, vi, beforeEach } from "vitest";

const updateUser = vi.fn();
const redirect = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { updateUser: (a: any) => updateUser(a) } }),
}));
vi.mock("next/navigation", () => ({ redirect: (p: string) => redirect(p) }));

import { changePassword } from "./actions";

const form = (password: string, confirm: string) => {
  const f = new FormData();
  f.set("password", password);
  f.set("confirm", confirm);
  return f;
};

beforeEach(() => {
  updateUser.mockReset();
  redirect.mockReset();
});

describe("changePassword", () => {
  it("enforces a 10-char minimum", async () => {
    expect(await changePassword({ error: null }, form("short", "short"))).toEqual({ error: "Use at least 10 characters." });
    expect(updateUser).not.toHaveBeenCalled();
  });

  it("requires the confirmation to match", async () => {
    expect(await changePassword({ error: null }, form("longenough1", "different12"))).toEqual({ error: "Passwords don't match." });
    expect(updateUser).not.toHaveBeenCalled();
  });

  it("sets the password and clears the must-change flag in one call, then redirects", async () => {
    updateUser.mockResolvedValue({ error: null });
    await changePassword({ error: null }, form("longenough1", "longenough1"));
    expect(updateUser).toHaveBeenCalledWith({ password: "longenough1", data: { must_change_password: false } });
    expect(redirect).toHaveBeenCalledWith("/");
  });

  it("surfaces a Supabase error", async () => {
    updateUser.mockResolvedValue({ error: { message: "weak password" } });
    expect(await changePassword({ error: null }, form("longenough1", "longenough1"))).toEqual({ error: "weak password" });
    expect(redirect).not.toHaveBeenCalled();
  });
});
