export const MATCH_COPY = {
  segments: "Fixtures & results | Table",
  yourGw: (gw: number) => `Your GW${gw}`,
  entered: (entered: number, total: number, toGo: number) =>
    `entered in ${entered} of ${total} · ${toGo} to go`,
  ordinal: (ordinal: string, fieldSize: number) =>
    `${ordinal} of ${fieldSize}`,
  notIn: (gw: number) => `You're not in GW${gw}`,
  provisional: "Provisional · updates live",
  liveRace: "View live race ›",
  twoWays: "You called it two ways",
  sameCall: (home: number, away: number) =>
    `You called ${home}–${away} in both`,
  result: "Right result",
  exact: "Exact",
  miss: "Miss",
  pointsPending: "— pts",
  tiebreak: (value: string) => `Tiebreak · ${value}`,
  overflow: (count: number, label: string) => `…${count} more · ${label}`,
  lockRule: (gw: number) =>
    `Your picks lock at the GW${gw} deadline, not at kickoff.`,
  yourCalls: "Your calls",
  room: "The room",
  insights: "Insights · reference only",
  teamNews: "Team news",
  editAll: (gw: number) => `Edit all picks → GW${gw} entry sheet`,
  editRule:
    "One fixture is never edited on its own — the whole gameweek is one entry.",
  dateTbc: "Date TBC",
  expectedGoals: "Expected goals",
  momentum: "Momentum · post-match only",
  fixturesAndResults: "Fixtures & results",
  table: "Table",
  futureCaveat: "Future fixtures are subject to change.",
  pointsDiffer:
    "Your points differ by league this week, so each row carries its own.",
  notEntered: (gw: number) => `Not entered in GW${gw}`,
  lockedAwaiting: "Locked · awaiting results",
  settling: "Settling",
  recalculating: "Recalculating · money hidden",
  calledOffSettling: "All fixtures called off · settling",
  syncIssue: "We couldn't verify this gameweek yet.",
  ineligible: "Before your time in this league",
  invalid: "Entry incomplete at the deadline",
  viewRecap: "View league recap ›",
  gameweekVoid: "Gameweek void",
  winners: "Winners",
  roomReveal:
    "Names now, scorelines at the deadline. Then everyone's whole gameweek reveals at once — including Sunday's fixtures on Friday night.",
  livePoints: (points: number) => `Right now ${points} pts`,
  scoringRule: "3 for an exact scoreline, 1 for the right result.",
  liveStatsNote:
    "ESPN · every 2 minutes · xG shows only when the feed carries it",
  postPollNote:
    "The three below arrive on a four-hourly poll — within about 4h of full time.",
  correctedResult: "Corrected result",
  correctedResultAt: (date: string) => `Corrected result · ${date}`,
  home: "Home",
  viewMatches: "View matches",
  back: "Back",
  gwLabel: (gw: number) => `GW${gw}`,
  previousGw: (gw: number) => `← GW${gw}`,
  nextGw: (gw: number) => `GW${gw} →`,
  settledRecap: (gw: number) => `GW${gw} settled ·`,
  pointsValue: (points: number) => `${points} pts`,
  notEnteredShort: "Not entered",
  entryStarted: "Entry started",
  lockedIn: "Locked in",
  entryNeedsUpdate: "Entry needs an update",
  satOut: "You sat this one out",
  enterGw: "Enter GW",
  editPicks: "Edit picks",
  leagues: (entered: number, total: number) =>
    `${entered} of ${total} leagues`,
  inWithAnte: (ante: number) =>
    `You're in · ante ₹${ante.toLocaleString("en-IN")}`,
  notInWithAnte: (gw: number, ante: number) =>
    `You're not in GW${gw} yet · ante ₹${ante.toLocaleString("en-IN")}`,
  notInYetWithAnte: (ante: number) =>
    `You're not in yet · ante ₹${ante.toLocaleString("en-IN")}`,
  roomLocks: (league: string, deadline: string) =>
    `${league} · locks ${deadline}`,
  noTableData: "No table data yet.",
  club: "Club",
  played: "P",
  goalDifference: "GD",
  points: "Pts",
  insightsMark: "Insights",
  odds: "Odds",
  model: "Model",
  form: "Form",
  headToHead: "Head to head",
  tableWindow: "Table window",
  predictedXi: "Predicted XI",
  timeline: "Timeline",
  matchStats: "Match stats",
  playerStats: "Player stats",
  commentary: "Commentary",
  retrospective: "Retrospective",
  shotMap: "Shot map",
  playerOfMatch: "Player of the Match",
  whatIfGoal: (
    club: string,
    points: number,
    ordinal: string,
    fieldSize: number,
  ) =>
    `One more ${club} goal takes you to ${points} pts and ${ordinal} of ${fieldSize}.`,
  standing: (ordinal: string, fieldSize: number, points: number) =>
    `${ordinal} of ${fieldSize} · ${points} pts`,
  retrospectiveModel: (
    actual: string,
    actualChance: number | null,
    top: string,
  ) =>
    actualChance == null
      ? `The model's top score was ${top}; the match ended ${actual}.`
      : `The model gave ${actual} a ${actualChance}% chance. Its top score was ${top}.`,
} as const;
