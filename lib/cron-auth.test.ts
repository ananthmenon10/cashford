import { describe, it, expect } from "vitest";
import { isAuthorized } from "./cron-auth";

const SECRET = "s3cr3t";

describe("isAuthorized", () => {
  it("accepts the matching Bearer header (Vercel Cron / pg_cron)", () => {
    expect(isAuthorized({ header: `Bearer ${SECRET}`, queryParam: null }, SECRET)).toBe(true);
  });

  it("accepts the matching ?secret= query param (manual trigger)", () => {
    expect(isAuthorized({ header: null, queryParam: SECRET }, SECRET)).toBe(true);
  });

  it("rejects a wrong or missing credential", () => {
    expect(isAuthorized({ header: "Bearer nope", queryParam: "nope" }, SECRET)).toBe(false);
    expect(isAuthorized({ header: null, queryParam: null }, SECRET)).toBe(false);
    expect(isAuthorized({ header: SECRET, queryParam: null }, SECRET)).toBe(false); // missing "Bearer " prefix
  });

  it("fails closed when CRON_SECRET is unset — even an empty Bearer is denied", () => {
    expect(isAuthorized({ header: "Bearer ", queryParam: null }, undefined)).toBe(false);
    expect(isAuthorized({ header: "Bearer ", queryParam: "" }, "")).toBe(false);
  });
});
