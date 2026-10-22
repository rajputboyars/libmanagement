// Library opening hours and holidays. Times are minutes from midnight in library time (India, Asia/Kolkata).
export type DayHours = { day: number; open: number; close: number; closed: boolean };
export type Holiday = { date: string; note: string };
export type TodayStatus =
  | { kind: "unknown" }
  | { kind: "holiday"; note: string }
  | { kind: "closed" }
  | { kind: "open"; open: number; close: number; openNow: boolean };

export const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export const DEFAULT_HOURS: DayHours[] = DAY_NAMES.map((_, day) => ({ day, open: 360, close: 1320, closed: false }));

/** Day of week, YYYY-MM-DD date and minutes since midnight in India time. */
export function libraryClock(now = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short", hourCycle: "h23" })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.weekday);
  return { day, date: `${parts.year}-${parts.month}-${parts.day}`, minutes: Number(parts.hour) * 60 + Number(parts.minute) };
}

export function todayStatus(hours: DayHours[] | undefined, holidays: Holiday[] | undefined, now = new Date()): TodayStatus {
  const clock = libraryClock(now);
  const holiday = holidays?.find((h) => h.date === clock.date);
  if (holiday) return { kind: "holiday", note: holiday.note };
  const today = hours?.find((h) => h.day === clock.day);
  if (!today) return { kind: "unknown" };
  if (today.closed) return { kind: "closed" };
  return { kind: "open", open: today.open, close: today.close, openNow: clock.minutes >= today.open && clock.minutes < today.close };
}

/** Holidays from today onwards, soonest first. */
export function upcomingHolidays(holidays: Holiday[] | undefined, now = new Date(), limit = 5) {
  const today = libraryClock(now).date;
  return [...(holidays ?? [])].filter((h) => h.date >= today).sort((a, b) => a.date.localeCompare(b.date)).slice(0, limit);
}

/** 360 → "6:00 AM". */
export function clockLabel(minutes: number) {
  const h = Math.floor(minutes / 60) % 24, m = minutes % 60;
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}
