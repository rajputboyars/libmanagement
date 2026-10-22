import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_HOURS, clockLabel, libraryClock, todayStatus, upcomingHolidays } from "../src/lib/library-hours";

// 2026-10-21 is a Wednesday. 04:30 UTC = 10:00 IST, 17:00 UTC = 22:30 IST.
const morning = new Date("2026-10-21T04:30:00Z");
const late = new Date("2026-10-21T17:00:00Z");

test("library clock uses India time", () => {
  assert.deepEqual(libraryClock(morning), { day: 3, date: "2026-10-21", minutes: 600 });
});

test("today status: open, closed day, holiday and unknown", () => {
  assert.deepEqual(todayStatus(DEFAULT_HOURS, [], morning), { kind: "open", open: 360, close: 1320, openNow: true });
  assert.equal((todayStatus(DEFAULT_HOURS, [], late) as { openNow: boolean }).openNow, false);
  const wedClosed = DEFAULT_HOURS.map((h) => (h.day === 3 ? { ...h, closed: true } : h));
  assert.deepEqual(todayStatus(wedClosed, [], morning), { kind: "closed" });
  assert.deepEqual(todayStatus(DEFAULT_HOURS, [{ date: "2026-10-21", note: "Diwali" }], morning), { kind: "holiday", note: "Diwali" });
  assert.deepEqual(todayStatus(undefined, undefined, morning), { kind: "unknown" });
});

test("upcoming holidays skip past dates and sort", () => {
  const list = upcomingHolidays([{ date: "2026-12-25", note: "Christmas" }, { date: "2026-10-01", note: "Past" }, { date: "2026-10-21", note: "Today" }], morning);
  assert.deepEqual(list.map((h) => h.note), ["Today", "Christmas"]);
});

test("clock labels", () => {
  assert.equal(clockLabel(360), "6:00 AM");
  assert.equal(clockLabel(0), "12:00 AM");
  assert.equal(clockLabel(1320), "10:00 PM");
  assert.equal(clockLabel(750), "12:30 PM");
});
