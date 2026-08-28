export type DuesNetByUser = Readonly<Record<string, number>>;

export type DuesRankByUser = Record<string, number>;

export function rankDues(
  netByUser: DuesNetByUser | "suppressed",
): DuesRankByUser | null {
  if (netByUser === "suppressed") return null;

  const ranked = Object.entries(netByUser).sort(([, a], [, b]) => b - a);
  const ranks: DuesRankByUser = {};
  let previousNet: number | undefined;
  let previousRank = 0;

  ranked.forEach(([userId, netInr], index) => {
    if (index === 0 || netInr !== previousNet) previousRank = index + 1;
    ranks[userId] = previousRank;
    previousNet = netInr;
  });

  return ranks;
}
