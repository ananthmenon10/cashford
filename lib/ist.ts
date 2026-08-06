const IST_ZONE = "Asia/Kolkata";
import {
  formatFriendlyDate,
  formatFriendlyDateTime,
  formatFriendlyTime,
  type DateInput,
} from "./datetime";

export function formatIstDeadline(value: DateInput): string {
  return formatFriendlyDateTime(value, {
    timeZone: IST_ZONE,
    relative: false,
    includeTimeZone: true,
  });
}

export function formatIstCompact(value: DateInput): string {
  return formatFriendlyTime(value, {
    timeZone: IST_ZONE,
    includeWeekday: true,
  });
}

/** Item 5: the archive freeze line ("Frozen at the final settlement on <date>") — a bare date,
 * no time, matching the rest of the app's server-side IST convention (no browser timezone
 * available at render time). */
export function formatIstDate(value: DateInput): string {
  return formatFriendlyDate(value, { timeZone: IST_ZONE });
}
