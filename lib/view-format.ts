export function ageLabel(fetchedAt: string, now: Date): string {
  const minutes = Math.max(
    0,
    Math.floor((now.getTime() - new Date(fetchedAt).getTime()) / 60_000),
  );
  return minutes < 60
    ? `${minutes}m ago`
    : `${Math.floor(minutes / 60)}h ${minutes % 60}m ago`;
}

export function ordinal(value: number): string {
  const mod100 = value % 100;
  const suffix =
    mod100 >= 11 && mod100 <= 13
      ? "th"
      : value % 10 === 1
        ? "st"
        : value % 10 === 2
          ? "nd"
          : value % 10 === 3
            ? "rd"
            : "th";
  return `${value}${suffix}`;
}
