export type MatchSide = "home" | "away";

export type MatchLineupPlayer = { name: string; shirt: number | null };
export type MatchLineupSide = {
  formation: string;
  players: MatchLineupPlayer[];
};

export type MatchPlayerStatRow = {
  name: string;
  team: MatchSide;
  goals: number;
  assists: number;
  totalShots: number;
  shotsOnTarget: number;
  saves: number;
  goalsConceded: number;
  yellowCards: number;
  redCards: number;
};

export type MatchShotResult =
  | "goal"
  | "saved"
  | "blocked"
  | "off_target"
  | "other";

export type MatchShot = {
  x: number;
  y: number;
  xg: number;
  minute: number;
  player: string;
  team: MatchSide;
  result: MatchShotResult;
};
