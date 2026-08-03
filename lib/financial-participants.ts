export type FinancialParticipantInputs = {
  membershipUserIds?: readonly string[];
  memberCompetitionUserIds?: readonly string[];
  contestResultUserIds?: readonly string[];
  gameweekEntryUserIds?: readonly string[];
  paymentPartyUserIds?: readonly string[];
};

export function financialParticipantIds(input: FinancialParticipantInputs): string[] {
  return [...new Set([
    ...(input.membershipUserIds ?? []),
    ...(input.memberCompetitionUserIds ?? []),
    ...(input.contestResultUserIds ?? []),
    ...(input.gameweekEntryUserIds ?? []),
    ...(input.paymentPartyUserIds ?? []),
  ])].sort();
}

export function isFinancialParticipant(userId: string, input: FinancialParticipantInputs): boolean {
  return financialParticipantIds(input).includes(userId);
}

