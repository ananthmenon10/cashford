/**
 * Friendly dates for the product UI.
 *
 * A server render has no reliable access to the viewer's browser timezone. UI
 * components therefore pass the browser timezone after mount. Server-side
 * callers must pass an explicit timezone, which keeps tests and non-UI jobs
 * deterministic instead of silently using the server's timezone.
 */

export type DateInput = Date | string | number;

export type FriendlyDateTimeOptions = {
  timeZone?: string;
  now?: DateInput;
  relative?: boolean;
  includeTimeZone?: boolean;
};

export type FriendlyTimeOptions = {
  timeZone?: string;
  includeWeekday?: boolean;
  includeTimeZone?: boolean;
};

function asDate(value: DateInput, error = "invalid-datetime"): Date {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(error);
  return date;
}

export function getLocalTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

function resolvedTimeZone(timeZone?: string): string {
  return timeZone ?? getLocalTimeZone();
}

function cleanIntl(value: string): string {
  return value.replace(/\u202f/g, " ");
}

function timeZoneAbbreviation(date: Date, timeZone: string): string {
  if (timeZone === "Asia/Kolkata" || timeZone === "Asia/Calcutta") return "IST";
  return (
    new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      timeZone,
      timeZoneName: "short",
    })
      .formatToParts(date)
      .find((part) => part.type === "timeZoneName")?.value ?? ""
  );
}

function calendarKey(value: Date, timeZone: string): number {
  const [year, month, day] = calendarDateKey(value, timeZone)
    .split("-")
    .map(Number);
  return Date.UTC(year, month - 1, day);
}

export function calendarDateKey(value: DateInput, timeZone: string): string {
  const date = asDate(value);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  if (!year || !month || !day) throw new Error("invalid-calendar-date");
  return `${year}-${month}-${day}`;
}

function relativeLabel(value: Date, now: Date, timeZone: string): string | null {
  const days = Math.round(
    (calendarKey(value, timeZone) - calendarKey(now, timeZone)) / 86_400_000,
  );
  if (Math.abs(days) >= 7) return null;
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days === -1) return "yesterday";
  return days > 0 ? `in ${days} days` : `${Math.abs(days)} days ago`;
}

export function formatFriendlyDateTime(
  value: DateInput,
  options: FriendlyDateTimeOptions = {},
): string {
  const date = asDate(value);
  const timeZone = resolvedTimeZone(options.timeZone);
  const main = cleanIntl(
    new Intl.DateTimeFormat("en-GB", {
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
      timeZone,
    }).format(date),
  );
  const zone = options.includeTimeZone
    ? timeZoneAbbreviation(date, timeZone)
    : "";
  const relative =
    options.relative === false
      ? null
      : relativeLabel(date, options.now == null ? new Date() : asDate(options.now), timeZone);
  return `${main}${zone ? ` ${zone}` : ""}${relative ? ` (${relative})` : ""}`;
}

export function formatFriendlyDate(
  value: DateInput,
  options: {
    timeZone?: string;
    includeTimeZone?: boolean;
    includeYear?: boolean;
  } = {},
): string {
  const date = asDate(value);
  const timeZone = resolvedTimeZone(options.timeZone);
  const main = cleanIntl(
    new Intl.DateTimeFormat("en-GB", {
      weekday: "short",
      day: "numeric",
      month: "short",
      ...(options.includeYear === false ? {} : { year: "numeric" as const }),
      timeZone,
    }).format(date),
  );
  const zone = options.includeTimeZone
    ? timeZoneAbbreviation(date, timeZone)
    : "";
  return `${main}${zone ? ` ${zone}` : ""}`;
}

export function formatFriendlyTime(
  value: DateInput,
  options: FriendlyTimeOptions = {},
): string {
  const date = asDate(value);
  const timeZone = resolvedTimeZone(options.timeZone);
  const main = cleanIntl(
    new Intl.DateTimeFormat("en-GB", {
      ...(options.includeWeekday ? { weekday: "short" as const } : {}),
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
      timeZone,
    }).format(date),
  );
  const zone = options.includeTimeZone
    ? timeZoneAbbreviation(date, timeZone)
    : "";
  return `${main}${zone ? ` ${zone}` : ""}`;
}

export function formatShortWeekday(
  value: DateInput,
  options: { timeZone?: string } = {},
): string {
  const date = asDate(value);
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    timeZone: resolvedTimeZone(options.timeZone),
  }).format(date);
}
