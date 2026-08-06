// Step 8 — copy home for the Analytics feed (components/AnalyticsFeed.tsx). Follows the plain
// object + small template-function convention of lib/match-copy.ts. Every user-visible literal
// for the new feed lives here — amounts are never baked in (rendered via components/ui `inr` at
// display time, same pattern HOME_ENTRY_STATUS_COPY uses for dates via LocalTime).

export const ANALYTICS_COPY = {
  tabTitle: "Analytics",
  filterLabel: "League",
  liveKicker: "Live",
  archiveKicker: "Archived",
  myFormTitle: "My form",
  seasonNet: "season net",
  record: "record",
  noLeagues: "Join a league to see analytics here.",
  noSections: "No settled activity yet.",
  archiveNote: "Final settled",
  allTimeNet: "All-time net",
  allTimeNoHistory: "Nothing settled across your leagues yet.",
  /** Fix-round item 4: leagueCount now folds into the same line as the gameweek marker, matching
   * the canon frame's "Two leagues · through GW6" tone (digit form, per the same frame's own
   * "3 LEAGUES · 2 COMPETITIONS" scope-meta line). */
  liveThrough: (leagueCount: number, gameweek: number) =>
    `${leagueCount} league${leagueCount === 1 ? "" : "s"} · through GW${gameweek}`,
  myFormSub: (leagueName: string, competitionName: string) => `${leagueName} · ${competitionName}`,
  recordLine: (correct: number, incorrect: number, voided: number) =>
    `${correct}–${incorrect}–${voided}`,
  /** Archive my-form sample size — counted fixture-picks (each cup-format prediction is one
   * fixture-pick). */
  sampleNote: (count: number) =>
    count === 1
      ? "1 counted fixture-pick for this league."
      : `${count} counted fixture-picks for this league.`,
  /** Live my-form sample size — fix-round item 1: gameweeksEntered counts settled GAMEWEEKS, not
   * fixture-picks (a gameweek can hold several fixtures), so this needed its own copy rather than
   * reusing sampleNote's fixture-pick wording. */
  gameweekNote: (count: number) =>
    count === 1
      ? "1 settled gameweek in this league."
      : `${count} settled gameweeks in this league.`,
  noFormHistory: "No settled fixtures yet for this league.",
  allTimeStrip: (leagueCount: number, competitionCount: number, settledRounds: number) =>
    `${leagueCount} league${leagueCount === 1 ? "" : "s"} · ${competitionCount} competition${competitionCount === 1 ? "" : "s"} · ${settledRounds} settled round${settledRounds === 1 ? "" : "s"}`,
} as const;
