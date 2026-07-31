import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ESPN_STANDINGS_URL,
  parseEspnStandings,
} from "../../lib/espn-standings";
import table from "../fixtures/espn-standings/table.json";

describe("ESPN standings adapter", () => {
  it("A-8: uses the verified v2 endpoint", () => {
    expect(ESPN_STANDINGS_URL).toContain("/apis/v2/");
  });

  it("A-9: the /apis/site/v2/.../standings string does not appear anywhere in the module", () => {
    const source = readFileSync(
      join(__dirname, "../../lib/espn-standings.ts"),
      "utf8",
    );
    expect(source).not.toContain("/apis/site/v2/sports/soccer/eng.1/standings");
  });

  it("parses ranked rows and rejects empty or malformed payloads", () => {
    expect(parseEspnStandings(table)).toEqual([
      expect.objectContaining({ rank: 1, club: "Arsenal", points: 55 }),
      expect.objectContaining({ rank: 2, club: "Chelsea", points: 50 }),
    ]);
    expect(parseEspnStandings({ children: [] })).toBeNull();
    expect(parseEspnStandings(null)).toBeNull();
  });
});
