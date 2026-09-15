import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { MATCH_DATA_CACHE_COLUMNS } from "@/lib/poll-match-data";

describe("pollMatchData column discipline", () => {
  const selected = () => new Set(MATCH_DATA_CACHE_COLUMNS.split(",").map((c) => c.trim()));

  it("does not select * or the heavy JSON blobs it never reads", () => {
    expect(MATCH_DATA_CACHE_COLUMNS).not.toContain("*");
    for (const heavy of ["player_stats", "commentary", "key_events", "scorers", "team_stats"]) {
      expect(selected()).not.toContain(heavy);
    }
    // lineups IS read (the `lineups_ok && lineups` guard), so it must stay.
    expect(selected()).toContain("lineups");
  });

  it("covers every `old.<field>` the module reads", () => {
    const source = readFileSync("lib/poll-match-data.ts", "utf8");
    const referenced = [...source.matchAll(/\bold\??\.([a-z_]+)/g)].map((m) => m[1]);
    expect(referenced.length).toBeGreaterThan(0);
    for (const field of new Set(referenced)) {
      expect(selected(), `missing ${field}`).toContain(field);
    }
  });

  it("the source uses the constant in the fixture_match_data read", () => {
    const source = readFileSync("lib/poll-match-data.ts", "utf8");
    expect(source).toContain('.from("fixture_match_data").select(MATCH_DATA_CACHE_COLUMNS)');
    expect(source).not.toMatch(/from\("fixture_match_data"\)\s*\.select\("\*"\)/);
  });
});
