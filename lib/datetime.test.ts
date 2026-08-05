import { describe, expect, it } from "vitest";
import {
  calendarDateKey,
  formatFriendlyDateTime,
  formatFriendlyTime,
} from "./datetime";

describe("formatFriendlyDateTime", () => {
  it("pins calendar-day keys to the requested timezone", () => {
    expect(calendarDateKey("2026-08-17T18:45:00.000Z", "Asia/Kolkata")).toBe(
      "2026-08-18",
    );
    expect(calendarDateKey("2026-08-17T18:45:00.000Z", "UTC")).toBe(
      "2026-08-17",
    );
  });

  it("formats a local India time with the friendly relative suffix", () => {
    expect(
      formatFriendlyDateTime("2026-08-22T14:00:00.000Z", {
        timeZone: "Asia/Kolkata",
        now: "2026-08-17T10:00:00.000Z",
      }),
    ).toBe("Sat 22 Aug, 7:30 pm (in 5 days)");
  });

  it("uses the pinned timezone for today, tomorrow, and past dates", () => {
    const options = {
      timeZone: "Europe/London",
      now: "2026-08-17T10:00:00.000Z",
    } as const;
    expect(formatFriendlyDateTime("2026-08-17T14:00:00.000Z", options)).toBe(
      "Mon 17 Aug, 3:00 pm (today)",
    );
    expect(formatFriendlyDateTime("2026-08-18T14:00:00.000Z", options)).toBe(
      "Tue 18 Aug, 3:00 pm (tomorrow)",
    );
    expect(formatFriendlyDateTime("2026-08-14T14:00:00.000Z", options)).toBe(
      "Fri 14 Aug, 3:00 pm (3 days ago)",
    );
  });

  it("handles a local midnight edge and omits relative text at seven days", () => {
    expect(
      formatFriendlyDateTime("2026-08-18T04:00:00.000Z", {
        timeZone: "America/New_York",
        now: "2026-08-18T03:30:00.000Z",
      }),
    ).toBe("Tue 18 Aug, 12:00 am (tomorrow)");
    expect(
      formatFriendlyDateTime("2026-08-24T14:00:00.000Z", {
        timeZone: "America/Los_Angeles",
        now: "2026-08-17T14:00:00.000Z",
      }),
    ).toBe("Mon 24 Aug, 7:00 am");
  });

  it("adds a timezone abbreviation only when requested", () => {
    expect(
      formatFriendlyDateTime("2026-08-22T14:00:00.000Z", {
        timeZone: "Asia/Kolkata",
        relative: false,
        includeTimeZone: true,
      }),
    ).toBe("Sat 22 Aug, 7:30 pm IST");
    expect(
      formatFriendlyTime("2026-08-22T14:00:00.000Z", {
        timeZone: "America/Los_Angeles",
        includeWeekday: true,
        includeTimeZone: true,
      }),
    ).toBe("Sat 7:00 am PDT");
  });
});
