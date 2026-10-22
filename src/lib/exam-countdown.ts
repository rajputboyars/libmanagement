// Exam countdown on the student home screen, counted in India dates.
import { libraryClock } from "./library-hours";

/** Whole days from today (India date) to the exam date; negative when the exam has passed. */
export function daysUntil(examDate: string, now = new Date()) {
  const today = libraryClock(now).date;
  return Math.round((Date.parse(`${examDate}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000);
}

export function countdownText(days: number, title: string) {
  if (days > 1) return `${days} days to ${title}`;
  if (days === 1) return `${title} is tomorrow`;
  if (days === 0) return `${title} is today. All the best!`;
  return `${title} was ${-days} day${days === -1 ? "" : "s"} ago. Set your next exam date.`;
}
