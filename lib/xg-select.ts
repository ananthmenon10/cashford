import { ageLabel } from "./view-format";

export type ProviderXgRow = {
  provider: "fotmob" | "understat";
  xg_home: number | string | null;
  xg_away: number | string | null;
  xg_model: string | null;
  xg_fetched_at: string | null;
  xg_ok: boolean;
  fixtureKickoffAt: string | null;
};

export type SelectedXg = {
  home: number;
  away: number;
  provider: "FotMob" | "Understat";
  model: string;
  fetchedAt: string;
  age: string;
};

export function selectXg(
  rows: readonly ProviderXgRow[],
  now: Date,
): SelectedXg | undefined {
  const valid = rows.filter((row) => {
    if (
      !row.xg_ok ||
      row.xg_home == null ||
      row.xg_away == null ||
      !row.xg_model ||
      !row.xg_fetched_at ||
      !row.fixtureKickoffAt
    ) {
      return false;
    }
    const home = Number(row.xg_home);
    const away = Number(row.xg_away);
    return (
      Number.isFinite(home) &&
      Number.isFinite(away) &&
      new Date(row.xg_fetched_at).getTime() >=
        new Date(row.fixtureKickoffAt).getTime()
    );
  });
  const selected =
    valid.find((row) => row.provider === "fotmob") ??
    valid.find((row) => row.provider === "understat");
  if (!selected) return undefined;
  return {
    home: Number(selected.xg_home),
    away: Number(selected.xg_away),
    provider: selected.provider === "fotmob" ? "FotMob" : "Understat",
    model: selected.xg_model!,
    fetchedAt: selected.xg_fetched_at!,
    age: ageLabel(selected.xg_fetched_at!, now),
  };
}
