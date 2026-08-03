export type TransitionState = "preparing" | "captain_adopt" | "member_waiting" | "adopted" | "blocked" | "archived";

export function transitionState(input: { competitionStatus: string; hasParticipation: boolean; isCaptain: boolean; otherActiveCompetition: boolean }): TransitionState {
  if (input.competitionStatus === "preparing") return "preparing";
  if (input.competitionStatus === "archived") return "archived";
  if (input.hasParticipation) return "adopted";
  if (input.otherActiveCompetition) return "blocked";
  return input.isCaptain ? "captain_adopt" : "member_waiting";
}

