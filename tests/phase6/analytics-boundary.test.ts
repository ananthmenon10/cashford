import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const files = ["analytics-room.ts", "analytics-rivalry.ts", "analytics-habits.ts"];

describe("analytics grading boundary", () => {
  it("keeps settlement grading in stored corpus reads", () => {
    for (const file of files) {
      const source = readFileSync(new URL(`../../lib/${file}`, import.meta.url), "utf8");
      expect(source).not.toMatch(/gradeFinal|scoreGameweek|assignPoints/);
    }
  });
});
