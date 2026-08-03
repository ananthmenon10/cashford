import { simplifyDebts, type Transfer } from "./settlement";
import { isGameweekResultDirty } from "./net-balance";
import { paymentAdjustment, type PaymentStatus } from "./payment-state";

export type DuesGameweekVersion = { inputVersion: number; settledVersion: number | null };
export type DuesGameMovement = { userId: string; netInr: number };
export type DuesTransfer = { fromUserId: string; toUserId: string; amountInr: number; reversed?: boolean };
export type DuesPayment = {
  kind: "payment" | "reversal";
  payerUserId: string;
  receiverUserId: string;
  amountInr: number;
  status: PaymentStatus;
};

export type DuesLedgerClean = {
  status: "clean";
  netByUser: Record<string, number>;
  plan: Transfer[];
  gameNetByUser: Record<string, number>;
  paymentNetByUser: Record<string, number>;
  transferNetByUser: Record<string, number>;
  parityOk: true;
};
export type DuesLedgerSuppressed = { status: "recalculating"; reason: "dirty_gameweek" };
export type DuesLedgerIssue = {
  status: "sync_issue";
  detailFingerprint: string;
  gameNetByUser: Record<string, number>;
  transferNetByUser: Record<string, number>;
};
export type DuesLedger = DuesLedgerClean | DuesLedgerSuppressed | DuesLedgerIssue;

function add(map: Map<string, number>, userId: string, amount: number) {
  map.set(userId, (map.get(userId) ?? 0) + amount);
}

function recordMap(map: Map<string, number>): Record<string, number> {
  return Object.fromEntries([...map.entries()].sort(([a], [b]) => a.localeCompare(b)));
}

export function isDuesLedgerDirty(versions: readonly DuesGameweekVersion[]): boolean {
  return versions.some((version) =>
    version.settledVersion == null
      ? version.inputVersion > 0
      : isGameweekResultDirty({ inputVersion: version.inputVersion, settledVersion: version.settledVersion }),
  );
}

export function foldGameNet(
  participantIds: readonly string[],
  movements: readonly DuesGameMovement[],
): Record<string, number> {
  const result = new Map(participantIds.map((id) => [id, 0] as const));
  for (const movement of movements) add(result, movement.userId, movement.netInr);
  return recordMap(result);
}

export function foldTransferNet(
  participantIds: readonly string[],
  transfers: readonly DuesTransfer[],
): Record<string, number> {
  const result = new Map(participantIds.map((id) => [id, 0] as const));
  for (const transfer of transfers) {
    if (transfer.reversed) continue;
    add(result, transfer.fromUserId, -transfer.amountInr);
    add(result, transfer.toUserId, transfer.amountInr);
  }
  return recordMap(result);
}

export function foldPaymentNet(
  participantIds: readonly string[],
  payments: readonly DuesPayment[],
): Record<string, number> {
  const result = new Map(participantIds.map((id) => [id, 0] as const));
  for (const payment of payments) {
    const adjustment = paymentAdjustment(
      payment.status,
      payment.payerUserId,
      payment.receiverUserId,
      payment.kind === "reversal" ? -payment.amountInr : payment.amountInr,
    );
    for (const [userId, amount] of adjustment) add(result, userId, amount);
  }
  return recordMap(result);
}

export function ledgerSum(values: Record<string, number>): number {
  return Object.values(values).reduce((sum, value) => sum + value, 0);
}

export function duesDetailFingerprint(detail: unknown): string {
  if (Array.isArray(detail)) return `[${detail.map(duesDetailFingerprint).join(",")}]`;
  if (detail && typeof detail === "object") {
    return `{${Object.entries(detail as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${JSON.stringify(key)}:${duesDetailFingerprint(value)}`).join(",")}}`;
  }
  return JSON.stringify(detail);
}

export function buildDuesLedger(input: {
  participantIds: readonly string[];
  gameweekVersions: readonly DuesGameweekVersion[];
  resultMovements: readonly DuesGameMovement[];
  transferMovements: readonly DuesTransfer[];
  payments: readonly DuesPayment[];
}): DuesLedger {
  if (isDuesLedgerDirty(input.gameweekVersions)) return { status: "recalculating", reason: "dirty_gameweek" };

  const gameNetByUser = foldGameNet(input.participantIds, input.resultMovements);
  const transferNetByUser = foldTransferNet(input.participantIds, input.transferMovements);
  const parityOk = JSON.stringify(gameNetByUser) === JSON.stringify(transferNetByUser);
  if (!parityOk || ledgerSum(gameNetByUser) !== 0 || ledgerSum(transferNetByUser) !== 0) {
    const detail = { game: gameNetByUser, transfers: transferNetByUser };
    return {
      status: "sync_issue",
      detailFingerprint: duesDetailFingerprint(detail),
      gameNetByUser,
      transferNetByUser,
    };
  }

  const paymentNetByUser = foldPaymentNet(input.participantIds, input.payments);
  const netByUser = Object.fromEntries(input.participantIds.map((id) => [
    id,
    (gameNetByUser[id] ?? 0) + (paymentNetByUser[id] ?? 0),
  ]));
  if (ledgerSum(paymentNetByUser) !== 0 || ledgerSum(netByUser) !== 0) {
    const detail = { game: gameNetByUser, payments: paymentNetByUser, combined: netByUser };
    return {
      status: "sync_issue",
      detailFingerprint: duesDetailFingerprint(detail),
      gameNetByUser,
      transferNetByUser,
    };
  }
  return {
    status: "clean",
    netByUser,
    plan: simplifyDebts(netByUser),
    gameNetByUser,
    paymentNetByUser,
    transferNetByUser,
    parityOk: true,
  };
}

export const buildCombinedDuesLedger = buildDuesLedger;
