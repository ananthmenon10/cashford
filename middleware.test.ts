import { describe, it, expect, vi } from "vitest";

// Mock the Supabase SSR client; middleware only uses auth.getUser().
let currentUser: any = null;
vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({ auth: { getUser: async () => ({ data: { user: currentUser } }) } }),
}));

import { NextRequest } from "next/server";
import { middleware } from "./middleware";

const run = (path: string, user: any) => {
  currentUser = user;
  return middleware(new NextRequest(`http://localhost${path}`));
};
const redirectedTo = (res: Awaited<ReturnType<typeof middleware>>) => {
  const loc = res.headers.get("location");
  return loc ? new URL(loc).pathname : null;
};

describe("middleware — auth gate", () => {
  it("redirects an anonymous user away from a protected page", async () => {
    expect(redirectedTo(await run("/leagues/kk", null))).toBe("/login");
  });

  it("lets an anonymous user reach /login", async () => {
    expect(redirectedTo(await run("/login", null))).toBeNull();
  });

  it("lets a signed-in user through", async () => {
    expect(redirectedTo(await run("/leagues/kk", { id: "u1", user_metadata: {} }))).toBeNull();
  });
});

describe("middleware — force first-login password change", () => {
  const flagged = { id: "u1", user_metadata: { must_change_password: true } };

  it("redirects a flagged user to /change-password", async () => {
    expect(redirectedTo(await run("/leagues/kk", flagged))).toBe("/change-password");
  });

  it("does not loop once they are on /change-password", async () => {
    expect(redirectedTo(await run("/change-password", flagged))).toBeNull();
  });

  it("leaves an unflagged user alone", async () => {
    expect(redirectedTo(await run("/", { id: "u1", user_metadata: { must_change_password: false } }))).toBeNull();
  });
});
