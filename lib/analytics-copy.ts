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
  trendHead: (count: number) => `Last ${count} GWs · pts / fixture`,
  trendRange: (first: number, last: number) => first === last ? `GW${first}` : `GW${first}–GW${last}`,
  netTrendTitle: "Net trend",
  netTrendSub: (count: number) => `Last ${count} GWs`,
  netTrendSubStarted: (count: number, started: string) => `Last ${count} GWs · started ${started}`,
  trendAria: (first: number, last: number, from: string, to: string) =>
    `Points per fixture from GW${first} to GW${last}, ${from} to ${to}`,
  trendExcludedVoid: (n: number) => `${n} void gameweek${n === 1 ? "" : "s"} left out.`,
  trendExcludedNotEntered: (n: number) => `${n} gameweek${n === 1 ? "" : "s"} you sat out left out.`,
  trendExcludedDirty: (n: number) => `${n} gameweek${n === 1 ? "" : "s"} still recalculating.`,
  trendExcludedNoFixtures: (n: number) =>
    `${n} gameweek${n === 1 ? "" : "s"} with no counted fixtures left out.`,
  modulesTitle: "Modules",
  modulesLoading: "Loading modules…",
  modulesError: "Modules could not be loaded.",
  modulesRetry: "Try again",
  modulesNoScope: "Choose a settled competition to see modules.",
  apiInvalidScope: "Invalid analytics scope.",
  apiNotFound: "Not found.",
  apiUnavailable: "Analytics modules are unavailable.",
  youVsRoomTitle: "You vs the room",
  youVsRoomWindow: (gameweeks: number, others: number) =>
    `Over your ${gameweeks} settled gameweek${gameweeks === 1 ? "" : "s"} · ${others} others`,
  roomExcluded: (gameweeks: string) => `${gameweeks} left out of the room comparison.`,
  youLabel: "You",
  roomAverage: (count: number) => `Other ${count} average`,
  exactRate: "Exact rate",
  resultRate: "Result rate",
  avgGoalMiss: "Average goal miss",
  last5Form: "Last-5 form",
  lowerIsBetter: "lower is better",
  roomSentence: (metric: string, side: "ahead" | "behind") =>
    side === "ahead" ? `You lead the room on ${metric}.` : `The room leads you on ${metric}.`,
  rivalryTitle: "Rivalry",
  rivalrySelectLabel: "Rival",
  rivalryWon: "Won",
  rivalryLost: "Lost",
  rivalryTied: "Tied",
  rivalryExacts: "Exacts",
  rivalryFootnote: (shared: number, settled: number) =>
    `${shared} shared gameweek${shared === 1 ? "" : "s"} of ${settled} settled.`,
  rivalryExcluded: (gameweeks: string) => `${gameweeks} left out of the rivalry window.`,
  rivalryRun: (owner: "you" | "rival", length: number) =>
    `${owner === "you" ? "You" : "Your rival"} lead${owner === "you" ? "" : "s"} the current run ${length}.`,
  habitsTitle: "Prediction habits",
  habitsPicks: (count: number) => `${count} settled pick${count === 1 ? "" : "s"}`,
  habitsMostCalled: "Most-called scoreline",
  habitsMostCalledValue: (home: number, away: number, count: number, total: number) =>
    `${home}–${away} · ${count} of ${total} picks`,
  habitsDrawRate: "Draw rate",
  habitsActualDrawRate: "Actual draws",
  habitsHomeBias: "Home bias",
  habitsActualHomeWinRate: "Actual home wins",
  habitsGoals: "Goals predicted vs scored",
  habitsConsensus: "Consensus split",
  habitsWithCrowd: "With crowd",
  habitsAgainstCrowd: "Against crowd",
  habitsNoConsensus: "No consensus",
  habitsScoreline: (home: number, away: number) => `${home}–${away}`,
  habitsGoalsSummary: (predicted: string, scored: string) => `${predicted} · ${scored}`,
  habitsAgainstSentence: (correct: number, count: number) =>
    `Against the crowd, you got ${correct} of ${count} right.`,
  habitsExcluded: (gameweeks: string) => `${gameweeks} left out of prediction habits.`,
} as const;
