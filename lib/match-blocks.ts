import { ageLabel } from "./view-format";

export type Sourced<T> = T & {
  source: string;
  fetchedAt: string;
  age: string;
};

function semanticallyEmpty(value: unknown): boolean {
  if (value == null) return true;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") {
    const values = Object.values(value);
    return values.length === 0 || values.every(semanticallyEmpty);
  }
  return false;
}

export function sourcedBlock<T extends object>(
  value: T | null | undefined,
  meta: { ok: boolean; source: string; fetchedAt: string | null },
  now: Date,
): Sourced<T> | undefined {
  if (!meta.ok || !meta.fetchedAt || !value || semanticallyEmpty(value)) {
    return undefined;
  }
  return {
    ...value,
    source: meta.source,
    fetchedAt: meta.fetchedAt,
    age: ageLabel(meta.fetchedAt, now),
  };
}

export function arrayBlock<T>(
  values: readonly T[] | null | undefined,
  key: string,
  meta: { ok: boolean; source: string; fetchedAt: string | null },
  now: Date,
): Sourced<Record<string, readonly T[]>> | undefined {
  if (!values?.length) return undefined;
  return sourcedBlock({ [key]: values }, meta, now);
}

export function hasSemanticallyEmptyValue(value: unknown): boolean {
  if (value == null) return false;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value !== "object") return false;
  return Object.entries(value).some(
    ([key, child]) =>
      !["notes", "yourCalls", "leagueOptions"].includes(key) &&
      (semanticallyEmpty(child) || hasSemanticallyEmptyValue(child)),
  );
}
