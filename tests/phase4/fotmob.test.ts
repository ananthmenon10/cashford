import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchFotMobCandidates,
  fetchFotMobMatch,
  parseFotMob,
  parseFotMobCandidates,
} from "../../lib/fotmob";
import ft from "../fixtures/fotmob/matchdetails-ft.json";

describe("FotMob adapter", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("extracts facts, ratings, PotM, shots, momentum, and XI from the real matchDetails paths", () => {
    const parsed = parseFotMob(ft, { terminal: true });
    expect(parsed?.xg).toMatchObject({ home: 0.49, away: 1, model: "fotmob-2026" });
    expect(parsed?.facts).toEqual(
      expect.arrayContaining([
        { key: "big_chances", args: [0, 2] },
        { key: "corners", args: [7, 2] },
      ]),
    );
    expect(parsed?.ratings).toEqual(
      expect.arrayContaining([
        { team: "home", player: "David Raya", rating: 8 },
        { team: "home", player: "Ben White", rating: 7.1 },
        { team: "away", player: "Nick Pope", rating: 6.7 },
        { team: "away", player: "Lewis Miley", rating: 7 },
      ]),
    );
    expect(parsed?.potm).toEqual({ team: "home", player: "Piero Hincapié", rating: 8 });
    expect(parsed?.shots).toEqual([
      { team: "away", player: "Bruno Guimarães", minute: 4, x: 85.279411764, y: 36.745000000000005, xg: 0.059495292603969574, result: "off_target" },
      { team: "home", player: "Eberechi Eze", minute: 8, x: 83.2733009712, y: 21.8272611502, xg: 0.029577648267149925, result: "off_target" },
      { team: "home", player: "Eberechi Eze", minute: 9, x: 85.70882352880001, y: 23.2985987305, xg: 0.029637373983860016, result: "goal" },
      { team: "away", player: "Daniel Burn", minute: 16, x: 95.0614035074, y: 30.244, xg: 0.04416581615805626, result: "saved" },
      { team: "away", player: "Joseph Willock", minute: 18, x: 91.7, y: 51.847898088099996, xg: 0.023056700825691223, result: "saved" },
    ]);
    expect(parsed?.momentum).toEqual([
      { minute: 0, value: 0 },
      { minute: 1, value: -5 },
      { minute: 2, value: 0 },
      { minute: 3, value: 0 },
      { minute: 4, value: -5 },
    ]);
    expect(parsed?.predictedXi).toEqual({
      home: {
        formation: "4-2-3-1",
        rows: [
          { label: "Goalkeeper", players: ["David Raya"] },
          { label: "Defenders", players: ["Ben White", "William Saliba", "Gabriel"] },
        ],
      },
      away: {
        formation: "4-3-3",
        rows: [
          { label: "Goalkeeper", players: ["Nick Pope"] },
          { label: "Midfielders", players: ["Lewis Miley"] },
          { label: "Defenders", players: ["Malick Thiaw", "Sven Botman"] },
        ],
      },
    });
  });

  it("F-1a/F-1b: no forbidden sentinel survives at any depth of the whitelist", () => {
    const SENTINEL = "SENTINEL-DO-NOT-LEAK";
    const raw = {
      general: { matchId: "9", started: true, finished: true, notes: SENTINEL },
      header: {
        teams: [
          { name: `Arsenal ${SENTINEL}`, score: 2 },
          { name: "Chelsea", score: 1 },
        ],
        status: { reason: SENTINEL },
      },
      content: {
        matchFacts: {
          highlights: { expandedHighlights: [{ text: SENTINEL }] },
          events: [{ type: "goal", text: SENTINEL }],
        },
        commentary: { commentary: [{ text: SENTINEL }] },
        stats: {
          Periods: {
            All: {
              stats: [
                {
                  title: SENTINEL,
                  stats: [
                    { key: "expected_goals", title: SENTINEL, stats: [1.8, 0.9] },
                    { key: "big_chance", title: SENTINEL, stats: [4, 2] },
                  ],
                },
              ],
            },
          },
        },
      },
      cashford: {
        xg: { home: 1.8, away: 0.9 },
        facts: [{ key: "big_chances", args: [4, 2] }],
        prose: SENTINEL,
      },
    };
    const parsed = parseFotMob(raw, { terminal: true });
    expect(JSON.stringify(parsed)).not.toContain(SENTINEL);

    const candidates = parseFotMobCandidates({
      leagues: [
        {
          matches: [
            {
              id: "9",
              date: "2026-02-03T15:00:00.000Z",
              homeName: "Arsenal",
              awayName: "Chelsea",
              prose: SENTINEL,
              score: SENTINEL,
              events: [SENTINEL],
              commentary: SENTINEL,
            },
          ],
        },
      ],
    });
    expect(candidates).toEqual([
      { id: "9", date: "2026-02-03T15:00:00.000Z", homeName: "Arsenal", awayName: "Chelsea" },
    ]);
    expect(Object.keys(candidates![0]).sort()).toEqual(
      ["awayName", "date", "homeName", "id"].sort(),
    );
    expect(JSON.stringify(candidates)).not.toContain(SENTINEL);
  });

  it("drops prose and unknown fact keys without dropping siblings", () => {
    const parsed = parseFotMob(
      {
        cashford: {
          facts: [
            { key: "shots_on_target", args: [5, 2] },
            {
              key: "Haaland has scored in five straight home games",
              args: [5],
            },
            { key: "aerials_won", args: [8, 4] },
          ],
        },
      },
      { terminal: true },
    );
    expect(parsed?.facts).toEqual([
      { key: "shots_on_target", args: [5, 2] },
    ]);
  });

  it("hides momentum before terminal and degrades on shape change", () => {
    const raw = { cashford: { momentum: [{ minute: 5, value: 12 }] } };
    expect(parseFotMob(raw, { terminal: false })).toBeNull();
    expect(parseFotMob(raw, { terminal: true })?.momentum).toHaveLength(1);
    expect(parseFotMob({ content: { stats: { Periods: { All: { stats: [] } } }, lineup: {}, matchFacts: {} } }, { terminal: true })).toBeNull();
  });

  it("parses discovery candidates and treats an empty list as absent", () => {
    const matchesDate = {
      leagues: [{ matches: [{
        id: "4813706",
        date: "2026-04-25T16:30:00.000Z",
        homeName: "Arsenal",
        awayName: "Newcastle United",
      }] }],
    };
    expect(parseFotMobCandidates(matchesDate)?.[0]).toMatchObject({
      id: "4813706",
      homeName: "Arsenal",
      awayName: "Newcastle United",
    });
    expect(parseFotMobCandidates({ leagues: [] })).toBeNull();
  });

  it("F-3: the kill switch makes zero network calls and constructs no URL when FOTMOB_ENABLED is unset", async () => {
    vi.stubEnv("FOTMOB_ENABLED", "");
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    expect(await fetchFotMobMatch("4193495")).toEqual({ kind: "disabled" });
    expect(await fetchFotMobCandidates("2026-02-03")).toEqual({ kind: "disabled" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("F-5: each transport failure maps to its own tag", async () => {
    vi.stubEnv("FOTMOB_ENABLED", "true");

    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response("forbidden", { status: 403 }))));
    expect(await fetchFotMobMatch("1")).toEqual({ kind: "http", status: 403 });

    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new DOMException("aborted", "AbortError"))),
    );
    expect(await fetchFotMobMatch("1")).toEqual({ kind: "timeout" });

    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response("not json{", { status: 200 }))),
    );
    expect(await fetchFotMobMatch("1")).toEqual({ kind: "invalid_json" });

    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response(JSON.stringify({}), { status: 200 }))),
    );
    expect(await fetchFotMobMatch("1")).toEqual({ kind: "shape" });

    vi.stubEnv("FOTMOB_ENABLED", "");
    expect(await fetchFotMobMatch("1")).toEqual({ kind: "disabled" });
  });
});
