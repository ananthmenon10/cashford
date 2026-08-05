const IST_ZONE = "Asia/Kolkata";
import {
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
