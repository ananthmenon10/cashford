import { describe, expect, it } from "vitest";
import ft from "../fixtures/espn-summary/ft.json";
import live from "../fixtures/espn-summary/live.json";
import pre from "../fixtures/espn-summary/pre.json";

function isSubsequence(retained: string[], capture: string[]) {
  let next = 0;
  for (const value of retained) {
    const found = capture.indexOf(value, next);
    if (found === -1) return false;
    next = found + 1;
  }
  return true;
}

describe("ESPN fixture projections", () => {
  it("retains source nodes and preserves source array order for every rebuilt fixture", () => {
    const ftHome = ft.rosters[0].roster.map((row) => row.athlete.displayName);
    const ftAway = ft.rosters[1].roster.map((row) => row.athlete.displayName);
    const ftEventIds = ft.keyEvents.map((event) => event.id);
    const liveEventIds = live.keyEvents.map((event) => event.id);
    const captureHome = [
      "Alisson Becker", "Virgil van Dijk", "Ibrahima Konaté", "Andy Robertson",
      "Curtis Jones", "Dominik Szoboszlai", "Alexis Mac Allister", "Ryan Gravenberch",
      "Cody Gakpo", "Rio Ngumoha", "Mohamed Salah", "Jeremie Frimpong",
      "Federico Chiesa", "Milos Kerkez", "Giorgi Mamardashvili", "Trey Nyoni",
      "Wataru Endo", "Florian Wirtz", "Alexander Isak", "Joe Gomez",
    ];
    const captureAway = [
      "Caoimhín Kelleher", "Nathan Collins", "Sepp van den Berg", "Keane Lewis-Potter",
      "Michael Kayode", "Mathias Jensen", "Vitaly Janelt", "Jordan Henderson",
      "Igor Thiago", "Kevin Schade", "Dango Ouattara", "Ethan Pinnock",
      "Kristoffer Ajer", "Reiss Nelson", "Aaron Hickey", "Kaye Furo",
      "Hákon Valdimarsson", "Romelle Donovan", "Josh Dasilva", "Mikkel Damsgaard",
    ];
    const captureEvents = [
      "47763606", "47764458", "47764533", "47764767", "47764803",
      "47764892", "47765052", "47765118", "47765208",
    ];

    expect(ft.header.competitions[0].competitors.map((row) => row.team.displayName)).toEqual([
      "Liverpool", "Brentford",
    ]);
    expect(ftHome).toHaveLength(4);
    expect(ftAway).toHaveLength(4);
    expect(isSubsequence(ftHome, captureHome)).toBe(true);
    expect(isSubsequence(ftAway, captureAway)).toBe(true);
    expect(isSubsequence(ftEventIds, captureEvents)).toBe(true);

    expect(pre.header.competitions[0].competitors.map((row) => row.team.displayName)).toEqual([
      "Arsenal", "Coventry City",
    ]);
    expect(pre.rosters.map((row) => row.homeAway)).toEqual(["home", "away"]);
    expect(pre.odds.map((row) => row.provider.name)).toEqual(["DraftKings", "Bet 365"]);

    expect(live.rosters[1].roster.map((row) => row.athlete.displayName)).toEqual([
      "Caoimhín Kelleher", "Nathan Collins", "Keane Lewis-Potter", "Kevin Schade",
    ]);
    expect(liveEventIds).toEqual(captureEvents.slice(0, 2));
    expect(live.header.competitions[0].competitors.map((row) => row.score)).toEqual([
      "0", "0",
    ]);

    console.log(
      "fixture projection: ft retained nodes=4 roster entries/3 events, order=fidelity; " +
        "pre retained nodes=2 competitors/2 rosters/2 odds, order=fidelity; " +
        "live retained nodes=4 roster entries/2 first-half events, order=fidelity",
    );
  });
});
