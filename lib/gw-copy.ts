const gameweekName = (number: number) => `Gameweek ${number}`;

export const GW_BADGE_COPY = {
  open: "OPEN",
  entered: "ENTERED",
  locked: "LOCKED",
  live: "LIVE",
  settled: "SETTLED",
  void: "VOID",
  actionNeeded: "ACTION NEEDED",
  recalculating: "RECALCULATING",
  archived: "ARCHIVED",
  upcoming: "UPCOMING",
  /** Home hub multi-competition variant labels a locked-not-live row "Submitted", not "Locked". */
  submitted: "SUBMITTED",
} as const;

export type EntryStatusKey =
  | "notEnteredOpen"
  | "enteredOpen"
  | "submittedLocked"
  | "live"
  | "won"
  | "lost"
  | "void"
  | "syncIssue";

/** The eight entry states from the Foundations reference table. */
export const ENTRY_STATUS_COPY = {
  notEnteredOpen: "Not entered · Open until Sat 2:18pm",
  enteredOpen: "Entered · Editable until Sat 2:18pm",
  submittedLocked: "Submitted · Locked at 2:18pm",
  live: "Live · 3rd of 12",
  won: "Won · 1st of 12 · +₹480",
  lost: "Lost · 9th of 12 · −₹100",
  void: "Void · Gameweek called off · Stake returned",
  syncIssue: "Sync issue · We’ll retry shortly",
} as const satisfies Record<EntryStatusKey, string>;

export const FEEDBACK_COPY = {
  title: "Report a bug",
  hint: "A little context helps us fix it.",
  placeholder: "What broke? What did you expect?",
  close: "Close bug report",
  sent: "Sent — thanks",
  button: "Bug?",
  cancel: "Cancel",
  send: "Send",
  sending: "Sending…",
  required: "Tell us what went wrong.",
  tooLong: "Feedback must be 2,000 characters or fewer.",
  signInAgain: "Please sign in again.",
  tooMany: "Too many reports. Please try again later.",
  sendError: "Couldn’t send the report. Please try again.",
  devTitle: "Bug reports",
  devSubtitle: "Unresolved reports, newest first.",
  created: "Created",
  user: "User",
  path: "Path",
  league: "League",
  message: "Message",
  version: "Version",
  action: "Action",
  resolve: "Resolve",
  empty: "No unresolved reports.",
} as const;

export const FOUNDATIONS_COPY = {
  eyebrow: "Foundations",
  title: "Foundations harness",
  datetime: "Friendly datetime",
  datetimeNote: "Browser-local display with a pinned reference instant.",
  table: "Table standard",
  tableNote: "Twenty rows; drag the table sideways to check the sticky player column.",
  tableAriaLabel: "Foundations table",
  entryStatus: "Entry status copy",
} as const;

export const LEAGUE_CARD_COPY = {
  nextAction: "Next action",
  gameweekStatus: "Gameweek status",
  gameweekResult: "Gameweek result",
  archive: "Archive",
  competitionStatus: "Competition status",
  net: "Net",
  position: "Position",
  seasonPosition: "Season rank",
  gameweekPosition: "GW rank",
  finalRank: "Final rank",
  closes: "Closes",
  countdownPrefix: "in",
  openBadge: GW_BADGE_COPY.open,
  enteredBadge: GW_BADGE_COPY.entered,
  lockedBadge: GW_BADGE_COPY.locked,
  liveBadge: GW_BADGE_COPY.live,
  settledBadge: GW_BADGE_COPY.settled,
  voidBadge: GW_BADGE_COPY.void,
  actionNeededBadge: GW_BADGE_COPY.actionNeeded,
  recalculatingBadge: GW_BADGE_COPY.recalculating,
  archivedBadge: GW_BADGE_COPY.archived,
  upcomingBadge: GW_BADGE_COPY.upcoming,
  enterGameweek: (number: number) => `Enter GW${number}`,
  editGameweek: (number: number) => `Edit GW${number}`,
  liveGameweek: (matches: number) => `Live · ${matches} matches playing`,
  pointsUpdate: "Points update as matches finish",
  settledGameweek: (number: number) => `GW${number} settled`,
  wonDetail: (amountInr: number) => ({
    prefix: "You won ",
    amount: `₹${Math.abs(amountInr).toLocaleString("en-IN")}`,
    suffix: " · result posted",
  }),
  lostDetail: (amountInr: number) => ({
    prefix: "You lost ",
    amount: `₹${Math.abs(amountInr).toLocaleString("en-IN")}`,
    suffix: " · result posted",
  }),
  breakEvenDetail: "You broke even · result posted",
  settledSecondaryWon: (amountInr: number) => `Settled · you won ₹${Math.abs(amountInr).toLocaleString("en-IN")}`,
  settledSecondaryLost: (amountInr: number) => `Settled · you lost ₹${Math.abs(amountInr).toLocaleString("en-IN")}`,
  settledSecondaryBreakEven: "Settled · you broke even",
  makePredictions: "Make predictions",
  editPredictions: "Edit predictions",
  viewLivePoints: "View live points",
  seeResult: (number: number) => `See GW${number} result`,
  openArchive: "Open archive",
  viewWorldCupArchive: "View World Cup archive",
  adoptPremierLeague: "Adopt Premier League",
  archivedCompetition: (competition: string) => `${competition} · read-only`,
  archivedDetail: "World Cup 2026 · no live competition",
  firstGameweekUpcoming: "First GW upcoming",
  entriesOpenFriday: "entries open Friday",
  waitingForGameweek: (number: number) => `Waiting for GW${number}`,
  pot: (amountInr: number) => `Pot ₹${amountInr.toLocaleString("en-IN")}`,
  enteredCount: (entered: number, eligible: number) => `${entered}/${eligible} entered`,
  memberCount: (count: number) => `${count} members`,
  noLivePot: "No live pot",
  readOnly: "Read-only",
  rank: (rank: number) => `#${rank}`,
  gameweekTag: (number: number) => `GW${number}`,
  gameweekTitle: (number: number) => `GW${number}`,
  viewer: (rank: number | null) => rank == null ? "You —" : `You · #${rank}`,
  liveRank: (rank: number | null) => rank == null ? "— now" : `#${rank} now`,
  missingValue: "—",
  separator: "·",
  arrow: "→",
  mutedArrow: "·",
  duesChip: (count: number) => count === 1 ? "1 payment needs your answer" : `${count} payments need your answer`,
} as const;

/** Home hub · Option A: competition scope chips + GW navigator (segmented strip). */
export const HOME_HUB_COPY = {
  competitionScopeAria: "Competition scope",
  gwNavigatorAria: "Gameweek navigator",
  previousGameweek: "Previous gameweek",
  nextGameweek: "Next gameweek",
  jumpToGameweek: "Jump to gameweek",
  gameweekLabel: (number: number) => `GW${number}`,
  gameweekOption: (number: number, isCurrent: boolean) => isCurrent ? `GW${number} (current)` : `GW${number}`,
  /** Navigator pill main segment: "GW4 · OPEN" — the badge-style state segment appended to the
   * plain gameweek label, built from a copy constant (GW_BADGE_COPY) rather than assembled inline. */
  gameweekStateLabel: (number: number, state: string) => `${HOME_HUB_COPY.gameweekLabel(number)} · ${state}`,
  closesInPrefix: "closes in",
  /** Scope chip label: "Premier League · GW4" (or just the name when the scope has no GW yet). */
  scopeChip: (competitionName: string, gameweekNumber: number | null) =>
    gameweekNumber != null
      ? `${competitionName} · ${HOME_HUB_COPY.gameweekLabel(gameweekNumber)}`
      : competitionName,
  scopeHelper: "Selected competition drives the GW position, entries, fixtures, and table.",
  /** Nav-anywhere row below the navigator pill: "Previous GW3" / "Next GW5". */
  navAnywherePrevious: (number: number) => `Previous ${HOME_HUB_COPY.gameweekLabel(number)}`,
  navAnywhereNext: (number: number) => `Next ${HOME_HUB_COPY.gameweekLabel(number)}`,
} as const;

export const LEAGUE_CARD_HARNESS_COPY = {
  eyebrow: "League card",
  title: "League card harness",
  note: "Option B · split card · all 10 states",
  referenceNow: "Pinned reference instant",
  leagues: {
    kkBois: "KK Bois",
    solidYenneBoys: "Solid Yenne Boys",
  },
  competitions: {
    premierLeague: "Premier League 2026-27",
    worldCup: "World Cup 2026",
  },
  states: {
    S1: "S1 · Open · not entered",
    S2: "S2 · Open · entered",
    S3: "S3 · Live · mid-gameweek",
    S4: "S4 · Settled · won",
    S5: "S5 · Settled · lost",
    S6: "S6 · Settled + open",
    S7: "S7 · Live + open",
    S8: "S8 · Pending payment",
    S9: "S9 · Archived-only",
    S10: "S10 · First gameweek upcoming",
  },
  variants: {
    cl2Locked: "Variant · CL2 · Locked awaiting results",
    cl3NoLive: "Variant · CL3 · No live matches",
    cl4AwaitingSettlement: "Variant · CL4 · Awaiting settlement",
    cl7Void: "Variant · CL7 · Void",
    cl10AllVoid: "Variant · CL10 · All fixtures void",
    vp3ActionNeeded: "Variant · VP3 · Action needed",
    vp0Ineligible: "Variant · VP0 · Not eligible",
    vp5Invalid: "Variant · VP5 · Invalid entry",
    duesOnLive: "Variant · Live · Dues additive",
    breakEven: "Variant · Settled · Break-even",
    satOut: "Variant · Settled · Sat out",
  },
} as const;

export const C1 = (number: number) => `${gameweekName(number)} is open`;
export const C2 = (deadline: string) => `Deadline ${deadline}`;
export const C2Prefix = "Deadline";
export const C3 = (stakeInr: number) => `Enter for ₹${stakeInr.toLocaleString("en-IN")}`;
/** C4 takes the gameweek's real fixture count — it is per-gameweek, never a hardcoded 10. */
export const C4 = (fixtureCount: number) =>
  `You’ll predict all ${fixtureCount} scorelines. You can edit until the deadline.`;
export const C5 = (potInr: number, entered: number, eligible: number) =>
  `Pot ₹${potInr.toLocaleString("en-IN")} · ${entered} entered of ${eligible}`;
export const C5b = (potInr: number, lockedIn: number, eligible: number) =>
  `Pot ₹${potInr.toLocaleString("en-IN")} · ${lockedIn} locked in of ${eligible}`;
export const C6 = (number: number) => `You’re in for ${gameweekName(number)}`;
export const C7 = "Edit picks";
export const C8 = "Your last saved picks stand. Edit any time before the deadline.";
export const C9 = "Entry is final — you can’t withdraw once you’re in.";
export const C10 = (number: number) => `${gameweekName(number)} is locked`;
export const C11 = "Picks are visible to everyone now.";
export const C12 = (number: number) => `${gameweekName(number)} is live`;
export const C13 = "Points update as matches finish.";
export const C14 = (final: number, total: number) => `Provisional — ${final} of ${total} matches final`;
export const C15 = (number: number) => `You won ${gameweekName(number)}`;
export const C16 = (number: number) => `${gameweekName(number)} is settled`;
export const C17 = (amountInr: number) => `+₹${Math.abs(amountInr).toLocaleString("en-IN")}`;
export const C18 = (amountInr: number) => `−₹${Math.abs(amountInr).toLocaleString("en-IN")}`;
export const C19 = "3 points for an exact scoreline, 1 for the right result.";
export const C20 =
  "Tied on points? Most exact scorelines wins, then closest on goals, then the pot splits.";
export const C21 = (number: number) => `Your picks — ${gameweekName(number)}`;
export const C23 = "Save picks";
export const C24 = C3;
export const C25 = "Likely scores";
export const C26 = (number: number) => `${gameweekName(number)} was void`;
export const C27 = "Only one person entered, so the ante went back.";
export const C28 = "Nobody entered this gameweek.";
export const C29 = "No Premier League matches this week.";
export const C30 = (number: number, deadline: string) =>
  `${gameweekName(number)} open · deadline ${deadline}`;
export const C30Prefix = (number: number) =>
  `${gameweekName(number)} open · deadline`;
export const C31Prefix = "You owe ";
export const C32Prefix = "You’re owed ";
export const C31 = (amountInr: number) => `${C31Prefix}₹${Math.abs(amountInr).toLocaleString("en-IN")}`;
export const C32 = (amountInr: number) => `${C32Prefix}₹${Math.abs(amountInr).toLocaleString("en-IN")}`;
export const C33 = "Settled up";
export const C34 = "Which competition?";
export const C35 = "Ante per gameweek";
export const C36 = "Everyone puts in the same amount each gameweek.";
export const C37 = GW_BADGE_COPY.open;
export const C38 = GW_BADGE_COPY.entered;
export const C39 = GW_BADGE_COPY.locked;
export const C40 = GW_BADGE_COPY.live;
export const C41 = GW_BADGE_COPY.settled;
export const C42 = GW_BADGE_COPY.void;
export const C43 = GW_BADGE_COPY.actionNeeded;
export const C44 = GW_BADGE_COPY.actionNeeded;
export const C45 = (number: number) => `A match was added to ${gameweekName(number)}`;
export const C46 = "Your entry needs one more pick before the deadline, or it won’t count.";
export const C47 = "Add the missing pick";
export const C48 = (number: number) => `Your ${gameweekName(number)} entry didn’t count`;
export const C49 = "It was incomplete at the deadline, so you staked nothing and won nothing.";
export const C50 = "Didn’t count";
export const C51 = "Use these picks in your other leagues?";
export const C52 = (league: string, stakeInr: number) =>
  `${league} — ₹${stakeInr.toLocaleString("en-IN")} ante`;
export const C53 = (count: number) => `Enter in ${count} more leagues`;
export const C54 = (league: string) => `The ante in ${league} changed. Open that league to enter.`;
export const C55 = "The deadline passed. Your last saved picks stand.";
export const C55b =
  "The deadline passed. You aren’t entered in this gameweek, so you have no stake in the pot.";
export const C56 = "Couldn’t save your picks. Try again.";
export const C57 = (number: number, matches: number) =>
  `${gameweekName(number)} has two matchdays. All ${matches} matches count.`;
export const C58 = (number: number) =>
  `${gameweekName(number)} is closed. Results start once matches finish.`;
export const C59 = "All matches are final. Working out the pot.";
export const C60 = "A score changed. These numbers are being worked out again.";
export const C61 = "Updated after a score correction";
export const C62 = "Updated after a fixture change";
export const C63 = "Updated after a correction";
export const C64 = "We can’t show this gameweek’s result yet. It’s being looked into.";
export const C65 = (number: number) => `You join from ${gameweekName(number)}`;
export const C66 = "You sat this one out";
export const C67 = (league: string, number: number, deadline: string) =>
  `${league} — ${gameweekName(number)} closes ${deadline}. Get your picks in.`;
export const C68 = (stakeInr: number, league: string) =>
  `Enter for ₹${stakeInr.toLocaleString("en-IN")} in ${league}`;
export const C69 = "This competition is finished.";
export const C70 = "This league hasn’t started a competition yet.";
/** C71 — the shared dirty-result badge label. */
export const C71 = GW_BADGE_COPY.recalculating;
export const C72 = "Every match in this gameweek was called off.";
export const C73 = "Your session expired. Sign in again.";
export const C74 = "This gameweek changed. Reload the page and try again.";
export const C75 = "Your entry wasn’t found. Return to the league and enter again.";
export const C76 = "You can’t enter this gameweek from this league.";
export const C77 = "Check every score and try saving again.";
export const C78 = "Your saved picks can’t be copied from this league.";
export const C79 = "Nothing was copied to your other leagues.";
export const C80 = (league: string) => `${league} has no pot for this gameweek.`;
export const C81 = (league: string) => `${league} is closed for this gameweek.`;
export const C82 = (league: string) => `You can’t enter this gameweek in ${league}.`;
export const C83 = (league: string) =>
  `Your saved picks can’t be copied to ${league}. Reload this gameweek first.`;
export const C84 = "Cashford";
export const C85 = "Build version";
export const C86 = "Sign out";

export const GW_TABS = {
  gameweek: "Gameweek",
  season: "Season",
  dues: "Dues",
  table: "Table",
} as const;

export const GW_UI_COPY = {
  back: "Back",
  previousGameweek: "Previous gameweek",
  nextGameweek: "Next gameweek",
  competitionArchived: "ARCHIVED",
  entryRequiresJs: "Turn on JavaScript to save picks.",
  brandName: C84,
  buildVersion: C85,
  signOut: C86,
  homeTitle: "Your leagues",
  noLeagues: "No leagues yet",
  noLeaguesBody: "Start your own or wait for an invite from your captain.",
  createLeague: "Create a league",
  newLeague: "New league",
  joinCode: "Join with a code",
  members: "members",
  player: "player",
  players: "players",
  yourNet: "Your net",
  gameweekNavigation: "Gameweek navigation",
  allGameweeks: "All gameweeks",
  chooseGameweek: "Choose a week to open its state and matches.",
  seasonHistory: "Gameweek history",
  seasonTotals: "Running totals",
  points: "Points",
  exacts: "Exacts",
  entered: "Entered",
  net: "Net",
  name: "Name",
  rank: "Rank",
  score: "Score",
  picks: "Picks",
  pot: "Pot",
  ante: "Ante",
  deadline: "Deadline",
  settledResult: "Settled result",
  currentStanding: "Current standing",
  voidFixture: "This match doesn’t count.",
  syncIssue: C64,
  tryAgain: "Try again",
  close: "Close",
  joinLeague: "Join league",
  thatLeague: "That league",
  leagueName: "League name",
  chooseCompetition: C34,
  noActiveCompetitions: "There isn’t an active competition to start yet.",
  competitionsUnavailable: "Competitions could not be loaded. Try again.",
  competition: "Competition",
  formatGameweek: "Gameweek",
  formatCup: "Cup",
  joined: "Joined",
  loading: "Loading",
  decreaseHome: "Decrease home score",
  increaseHome: "Increase home score",
  decreaseAway: "Decrease away score",
  increaseAway: "Increase away score",
  saving: "Saving",
  saved: "Picks saved",
  reloadGameweek: "Reload gameweek",
  sessionExpired: C73,
  signInAgain: "Sign in again",
  backToLeague: "Back to league",
  notNow: "Not now",
  selected: "selected",
  calledOff: "Called off",
  rules: "How scoring and tiebreakers work",
  settleUp: "Settle up",
  you: "you",
  duesEmpty: "Dues update as cup matches settle.",
  homeTabsAria: "Home",
  leagueTabsAria: "League tabs",
  locked: "Locked",
} as const;

export function ordinalCopy(value: number): string {
  const suffix = value % 100 >= 11 && value % 100 <= 13
    ? "th"
    : value % 10 === 1
      ? "st"
      : value % 10 === 2
        ? "nd"
        : value % 10 === 3
          ? "rd"
          : "th";
  return `${value}${suffix}`;
}

export const LEAGUE_SCREEN_COPY = {
  deadline: "Deadline",
  opens: "Opens",
  upcoming: "Upcoming",
  open: "Open",
  live: "Live",
  settled: "Settled",
  locked: "Locked · matches in progress",
  void: "Void",
  selected: "selected",
  matches: (number: number) => `Matches · GW${number}`,
  fixtures: (count: number) => `${count} fixtures`,
  openMatches: (number: number) => `Open Gameweek ${number} matches`,
  seasonKicker: (competition: string) => `${competition} / season so far`,
  seasonTitle: (name: string | null) => name?.trim() ? `${name}’s season` : "Your season",
  rankOf: (rank: number | null, total: number) => `${rank == null ? "—" : `#${rank}`} of ${total}`,
  seasonNet: "Season net",
  points: (value: number | "suppressed") => value === "suppressed" ? C60 : `${value} pts`,
  exacts: (value: number) => `${value} exacts`,
  entries: (value: number) => `${value} entries`,
  historyCount: (value: number) => `${value} gameweeks`,
  gameweekName: (number: number) => `Gameweek ${number}`,
  gameweek: (number: number, state: string) => `GW${number} · ${state}`,
  statusWithMatches: (state: string, count: number) => `${state} · ${count} matches`,
  openDeadline: "Entries open · deadline",
  upcomingDeadline: "Upcoming · deadline",
  sheetOpen: "open",
  sheetSoon: "soon",
  notEntered: "Not entered · no result to show",
  settledResult: "Settled result",
  historyWinner: (name: string) => `Winner ${name}`,
  winnerMatches: (name: string, count: number) => `Winner ${name} · ${count} matches`,
  historyResult: (rank: number) => ` · your result ${ordinalCopy(rank)}`,
  clubs: (count: number) => `${count} clubs`,
  players: (count: number) => `${count} players`,
  playerTableTitle: "League standings",
  playerTableAria: "League standings with sticky player column",
  playerTableSource: "Player column stays in view",
  playerStickyHint: "Player stays pinned while values move",
  playerTableFoot: (count: number) => `${count} players shown · identity column pinned`,
  clubTableTitle: "Club standings",
  clubTableAria: "Complete club standings with sticky club column",
  clubTableSource: (count: number) => `Pinned club identity · ${count} complete rows`,
  clubStickyHint: "Club column stays pinned when table is wide",
  clubTableFoot: (count: number) => `${count} of ${count} clubs shown · identity column pinned`,
  player: "Player",
  club: "Club",
  played: "P",
  record: "W–D–L",
  goalDifference: "GD",
  pointsShort: "Pts",
  enteredShort: "In",
  netShort: "Net",
} as const;

export const GW_CREATE_COPY = {
  title: "Create a league",
  subtitle: "Start a league for the current competition.",
  namePlaceholder: "Your league name",
  inviteUrl: "Invite URL",
  slugPlaceholder: "your-league-name",
  checking: "Checking…",
  available: "Available",
  taken: "That URL is already taken.",
  anteHelp: C36,
  create: "Create league",
  creating: "Creating…",
  shareBody: "Share the link with your group.",
  inviteLink: "Invite link",
  shortCode: "Short code",
  copied: "Copied",
  copyLink: "Copy link",
  copyCode: "Copy code",
  shareWhatsApp: "Share on WhatsApp",
  openLeague: "Open league",
} as const;

/** Entry & Create reference frame — 0-0 default picks, muted until touched, quick-score
 * shortcuts, and the confirm guard for saving with picks still at their untouched default. */
export const ENTRY_SHEET_COPY = {
  tapHint: "Tap a likely scoreline",
  oneTapBadge: "ONE TAP PICKS",
  defaultTag: "DEFAULT 0–0",
  realPickLabel: "REAL PICK",
  homeLabel: "Home",
  awayLabel: "Away",
  chosenProgress: (touched: number, total: number) => `${touched}/${total} chosen`,
  quickScoresAria: (home: string, away: string) => `Common scores for ${home} versus ${away}`,
  picksLeftAtZero: (count: number) =>
    count === 1 ? "1 pick left at 0-0" : `${count} picks left at 0-0`,
  confirmHint: "Use a shortcut for a likely score, or leave 0–0 as your real prediction.",
  confirmAgain: (count: number) =>
    count === 1
      ? "Tap again to save 1 pick at 0-0"
      : `Tap again to save ${count} picks at 0-0`,
} as const;

export const GW_JOIN_COPY = {
  title: "Join a league",
  subtitle: "Enter the 8-character code from your captain.",
  inviteCode: "Invite code",
  codePlaceholder: "A1B2C3D4",
  lookingUp: "Looking up…",
  findLeague: "Find league",
  inviteNotFound: "Invite not found",
  invalidInvite: "This link is invalid. Ask your captain to share a fresh one.",
  linkExpired: "Link expired",
  inactiveInvite: "This invite link is no longer active.",
  freshInvite: "Ask the captain for a new link.",
  logIn: "Log in",
  archivedLeague: "This league is no longer accepting new members.",
  createdLeague: "You created this league.",
  jumpBack: "Jump back in.",
  createAccount: "Create account to join",
  existingAccount: "I already have an account — log in",
  joining: "Joining…",
  join: "Join league",
} as const;

export const GW_ACTION_COPY = {
  signInToCreate: "You must be logged in to create a league.",
  nameRequired: "League name is required.",
  nameTooLong: "League name must be 60 chars or fewer.",
  competitionRequired: "Pick a competition for this league.",
  urlTaken: "That league URL is taken — pick another.",
  createFailed: "Something went wrong. Please try again.",
  inactiveInvite: GW_JOIN_COPY.inactiveInvite,
  codeNotFound: "No active league found for that code.",
} as const;

export const LEAGUE_MANAGE_COPY = {
  inviteGenerationFailed: "Could not generate a unique invite after 3 attempts.",
  cannotRemoveCaptain: "Cannot remove the league captain.",
} as const;

export const createLiveCopy = (league: string) => `${league} is live`;
export const shareInviteCopy = (league: string, link: string, code: string) =>
  `Join ${league} on Cashford.\n${link}\n\nCode: ${code}`;
export const captainCopy = (captain: string) => `Captain: ${captain}`;
export const memberCountCopy = (count: number) =>
  `${count} ${count === 1 ? GW_UI_COPY.player : GW_UI_COPY.players}`;
export const competitionFormatCopy = (format: "gameweek" | "cup") =>
  format === "gameweek" ? GW_UI_COPY.formatGameweek : GW_UI_COPY.formatCup;
export const competitionSummaryCopy = (
  competition: string,
  format: "gameweek" | "cup",
) => `${competition} · ${competitionFormatCopy(format)}`;
export const anteSummaryCopy = (stakeInr: number) =>
  `₹${stakeInr.toLocaleString("en-IN")} ${C35.toLowerCase()}`;
export const joinAnteCopy = (stakeInr: number) =>
  `Join — ₹${stakeInr.toLocaleString("en-IN")} ante`;
export const manageLeagueCopy = (league: string) => `You manage ${league}`;
export const alreadyMemberCopy = (league: string) => `You’re already in ${league}`;
export const archivedLeagueCopy = (league: string) => `${league} is archived`;
export const owesPersonCopy = (name: string) => `You owe ${name}`;
export const owedByPersonCopy = (name: string) => `${name} owes you`;
export const lastWeekCopy = (gameweek: number, points: number) =>
  `Last week · ${gameweekName(gameweek)} · ${points} points`;

export type SettleCause = "initial" | "result_revision" | "membership_change" | "combined" | null;

export function correctionCopy(cause: SettleCause): string | null {
  if (cause === "initial" || cause == null) return null;
  if (cause === "result_revision") return C61;
  if (cause === "membership_change") return C62;
  return C63;
}

export function nudgeMessage({
  league,
  gw,
  deadline,
}: {
  league: string;
  gw: number;
  deadline: string;
}): string {
  return C67(league, gw, deadline);
}

export function voidReasonCopy(reason: "no_entrants" | "single_entrant" | "all_fixtures_void" | null) {
  if (reason === "single_entrant") return C27;
  if (reason === "no_entrants") return C28;
  return C72;
}

export function moneyCopy(amountInr: number): string {
  if (amountInr > 0) return C17(amountInr);
  if (amountInr < 0) return C18(amountInr);
  return `₹${amountInr.toLocaleString("en-IN")}`;
}

export type GwErrorCopyId =
  | "C54"
  | "C55"
  | "C55b"
  | "C56"
  | "C73"
  | "C74"
  | "C75"
  | "C76"
  | "C77"
  | "C78"
  | "C79"
  | "C80"
  | "C81"
  | "C82"
  | "C83";

export type GwMappedError = {
  id: GwErrorCopyId;
  copy: string;
  reload: boolean;
  readOnly: boolean;
  sessionExpired: boolean;
};

type ErrorRule = {
  pattern: RegExp;
  id: GwErrorCopyId;
  copy: string;
  reload?: boolean;
};

const zodMessagePattern =
  /(?:^|: )(?:Required|Expected .+|Invalid uuid|Array must contain .+|Number must be .+|Unrecognized key\(s\).*)$/i;

const entryMessageRules: readonly ErrorRule[] = [
  {
    pattern:
      /this gameweek has no fixtures to predict|(?:a )?prediction is missing for \d+ of \d+ fixtures|a prediction refers to a fixture that is not in this gameweek/i,
    id: "C74",
    copy: C74,
    reload: true,
  },
  {
    pattern:
      /no pot for this league and gameweek|gameweek does not belong to this pot’s competition|gameweek does not belong to this pot's competition|this league is not playing this competition|this league is archived|you are not a member of this league|you have left this league|this league is not eligible for this gameweek yet|you joined after this gameweek started/i,
    id: "C76",
    copy: C76,
  },
  {
    pattern: /you have not entered this gameweek yet/i,
    id: "C75",
    copy: C75,
  },
  {
    pattern:
      /invalid JSON body|league and gameweek are required|picks must be an array|duplicate fixture in picks|two predictions for the same fixture|every prediction must be a whole number between 0 and 99/i,
    id: "C77",
    copy: C77,
  },
  {
    pattern: zodMessagePattern,
    id: "C77",
    copy: C77,
  },
  {
    pattern: /entry was not written|picks were not written/i,
    id: "C56",
    copy: C56,
  },
];

const mirrorMessageRules: readonly ErrorRule[] = [
  {
    pattern: /nothing was copied/i,
    id: "C79",
    copy: C79,
  },
  {
    pattern: /unknown gameweek|this gameweek has no fixtures to predict/i,
    id: "C74",
    copy: C74,
    reload: true,
  },
  {
    pattern:
      /you have not entered this gameweek in that league|finish your predictions in the source league first/i,
    id: "C78",
    copy: C78,
  },
  {
    pattern:
      /invalid JSON body|pick at least one league to mirror into|duplicate target league|the same league appears twice|the source league cannot also be a target/i,
    id: "C56",
    copy: C56,
  },
  {
    pattern: zodMessagePattern,
    id: "C56",
    copy: C56,
  },
  {
    pattern: /mirror did not run|mirror wrote \d+ of \d+ predictions for league/i,
    id: "C56",
    copy: C56,
  },
];

const fallbackError = (): GwMappedError => ({
  id: "C56",
  copy: C56,
  reload: false,
  readOnly: false,
  sessionExpired: false,
});

function mappedRule(rule: ErrorRule): GwMappedError {
  return {
    id: rule.id,
    copy: rule.copy,
    reload: rule.reload ?? false,
    readOnly: false,
    sessionExpired: false,
  };
}

export function entryErrorCopy(
  message: string | null | undefined,
  options: { noEntryAtSave: boolean; status: number },
): GwMappedError {
  const value = message?.trim() ?? "";
  if (/deadline has passed|gameweek is closed/i.test(value)) {
    return {
      id: options.noEntryAtSave ? "C55b" : "C55",
      copy: options.noEntryAtSave ? C55b : C55,
      reload: false,
      readOnly: true,
      sessionExpired: false,
    };
  }
  if (
    options.status === 401 ||
    /^(?:not signed in|not authenticated)$/i.test(value)
  ) {
    return {
      id: "C73",
      copy: C73,
      reload: false,
      readOnly: true,
      sessionExpired: true,
    };
  }
  if (options.status >= 500) return fallbackError();
  const rule = entryMessageRules.find((candidate) =>
    candidate.pattern.test(value),
  );
  return rule ? mappedRule(rule) : fallbackError();
}

export function mirrorErrorCopy(
  message: string | null | undefined,
  status: number,
): GwMappedError {
  const value = message?.trim() ?? "";
  if (
    status === 401 ||
    /^(?:not signed in|not authenticated)$/i.test(value)
  ) {
    return {
      id: "C73",
      copy: C73,
      reload: false,
      readOnly: true,
      sessionExpired: true,
    };
  }
  if (status >= 500) return fallbackError();
  const rule = mirrorMessageRules.find((candidate) =>
    candidate.pattern.test(value),
  );
  return rule ? mappedRule(rule) : fallbackError();
}

export function mirrorTargetErrorCopy(
  message: string | null | undefined,
  league: string,
): GwMappedError {
  const value = message?.trim() ?? "";
  if (/stake/i.test(value)) {
    return {
      ...fallbackError(),
      id: "C54",
      copy: C54(league),
      reload: true,
    };
  }
  if (/no pot for this league in this gameweek/i.test(value)) {
    return {
      ...fallbackError(),
      id: "C80",
      copy: C80(league),
    };
  }
  if (/this gameweek is closed|the deadline has passed/i.test(value)) {
    return {
      ...fallbackError(),
      id: "C81",
      copy: C81(league),
    };
  }
  if (
    /this league is not playing this competition|this league is archived|you are not a member of this league|you have left this league|this league is not eligible for this gameweek yet|you joined after this gameweek started/i.test(
      value,
    )
  ) {
    return {
      ...fallbackError(),
      id: "C82",
      copy: C82(league),
    };
  }
  if (/your predictions are out of date/i.test(value)) {
    return {
      ...fallbackError(),
      id: "C83",
      copy: C83(league),
      reload: true,
    };
  }
  return fallbackError();
}

export function relativeDeadline(milliseconds: number): string {
  if (milliseconds <= 0) return "Deadline passed";
  const minutes = Math.ceil(milliseconds / 60_000);
  if (minutes < 60) return `${minutes} min left`;
  const hours = Math.ceil(minutes / 60);
  if (hours < 24) return `${hours} hr left`;
  return `${Math.ceil(hours / 24)} days left`;
}
