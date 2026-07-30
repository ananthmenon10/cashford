const IST_LOCALE = "en-IN";
const IST_ZONE = "Asia/Kolkata";

type DateInput = Date | string | number;

function asDate(value: DateInput): Date {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("invalid-deadline");
  return date;
}

function parts(value: DateInput) {
  const values = new Intl.DateTimeFormat(IST_LOCALE, {
    timeZone: IST_ZONE,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).formatToParts(asDate(value));
  return Object.fromEntries(values.map((part) => [part.type, part.value]));
}

export function formatIstDeadline(value: DateInput): string {
  const valueParts = parts(value);
  return `${valueParts.weekday} ${valueParts.day} ${valueParts.month}, ${valueParts.hour}:${valueParts.minute} ${valueParts.dayPeriod.toLowerCase()} IST`;
}

export function formatIstCompact(value: DateInput): string {
  const valueParts = parts(value);
  return `${valueParts.weekday} ${valueParts.hour}:${valueParts.minute} ${valueParts.dayPeriod.toLowerCase()}`;
}
