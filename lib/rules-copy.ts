// Copy for /rules — the gameweek-era game (Step 9, #13). Replaces the old World Cup per-match
// cup-format text. Mechanics sourced from lib/gameweek-points.ts (scoring) and
// lib/gameweek-settle.ts (winners, money, void rules) — the live engine, not lib/settlement.ts /
// lib/settle-contest.ts (that pair is the archived World Cup per-match engine).
export const RULES_COPY = {
  title: "How it works",

  basicsTitle: "The basics",
  basicsEntry:
    "Each gameweek, you pick a score for every match. Submit every pick as one entry.",
  basicsLock:
    "Picks lock at the gameweek deadline — not at kickoff. Miss the deadline and you sit that gameweek out.",
  basicsWhole:
    "One match is never edited on its own. The whole gameweek is one entry.",
  basicsAnte:
    "Your league sets an ante. Lose and you pay it. Win and you collect.",
  basicsInvalid:
    "Leave one score blank at the deadline and your entry doesn’t count for that gameweek. This can happen if a fixture is added after you enter — check for updates before the deadline.",

  scoringTitle: "Scoring",
  scoringIntro: "Each match pays points:",
  scoreExactLabel: "Exact score",
  scoreExactPts: "3 points",
  scoreResultLabel: "Right result, wrong score",
  scoreResultPts: "1 point",
  scoreMissLabel: "Wrong result",
  scoreMissPts: "0 points",
  scoringVoid: "A called-off match pays 0 to everyone, picked or not.",
  scoringSum: "Add up your points across the whole gameweek.",

  winnersTitle: "Winners",
  winnersLead: "Most points wins the gameweek.",
  tiebreak1Title: "Tied on points?",
  tiebreak1Body: "Whoever nailed more exact scores wins.",
  tiebreak2Title: "Still tied?",
  tiebreak2Body: "Add up how far each pick missed by, on the matches that finished. Lowest total wins.",
  tiebreak3Title: "Still tied after that?",
  tiebreak3Body: "Everyone left splits the pot.",

  moneyTitle: "Money",
  moneyLead:
    "The pot shown on your gameweek screen adds up everyone’s ante — winners and losers together. Only losers actually pay: each loser’s ante splits among the winners.",
  moneyOneWinner: "One winner? They collect every loser’s ante.",
  moneyThreeWinners: "Three winners? Each loser’s ante splits three ways among them.",
  moneyRounding:
    "When an ante won’t split evenly, any spare rupees go to a winner — never left over.",

  voidTitle: "When a gameweek voids",
  voidLead: "No money moves if:",
  voidNoEntrants: "Nobody entered.",
  voidSingleEntrant: "Only one person entered.",
  voidAllFixtures: "Every match in the gameweek got called off.",

  duesTitle: "Dues",
  duesBody:
    "The Dues tab tracks who owes whom, across every competition you’ve played in this league.",

  archiveTitle: "The World Cup archive",
  archiveRules:
    "The 2026 World Cup ran on its own rules — one stake per match, not one ante per gameweek. That tournament is over.",
  archiveWhere:
    "Find it in your league’s competition switcher, marked ARCHIVED. You can look. You can’t play.",
  archiveDues:
    "Money from the World Cup still counts. It sits in the same Dues tab as this season.",

  footer: "Your captain sets the ante.",
} as const;
