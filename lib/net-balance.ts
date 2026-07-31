export type VersionPair = {
  inputVersion: number;
  settledVersion: number;
};

/** X-P5-1 shared predicate. Every PL money surface must call this before summing. */
export function isGameweekResultDirty(versions: VersionPair): boolean {
  return versions.inputVersion > versions.settledVersion;
}

export type NetBalanceInput = {
  ledger: "pl" | "wc";
  inputVersion: number;
  settledVersion: number;
  amountInr: number;
};

export function netBalance(input: NetBalanceInput): number | "suppressed" {
  if (
    input.ledger === "pl" &&
    isGameweekResultDirty({
      inputVersion: input.inputVersion,
      settledVersion: input.settledVersion,
    })
  ) {
    return "suppressed";
  }
  return input.amountInr;
}
