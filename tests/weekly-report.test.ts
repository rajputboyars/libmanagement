import { test } from "node:test";
import assert from "node:assert/strict";
import { summarize, weekDates } from "../src/lib/weekly-report";

test("week dates are the last 7 days ending today", () => {
  const dates = weekDates(new Date("2026-10-21T10:00:00Z"));
  assert.equal(dates.length, 7);
  assert.equal(dates[0], "2026-10-15");
  assert.equal(dates[6], "2026-10-21");
});

test("summary adds minutes per day, visits, XP, goal days and test average", () => {
  const dates = weekDates(new Date("2026-10-21T10:00:00Z"));
  const r = summarize({
    dates,
    sessions: [
      { completedAt: new Date("2026-10-20T06:00:00Z"), activeSeconds: 1500 },
      { completedAt: new Date("2026-10-20T08:00:00Z"), activeSeconds: 2700 },
      { completedAt: new Date("2026-10-21T06:00:00Z"), activeSeconds: 3600 },
      { completedAt: new Date("2026-10-01T06:00:00Z"), activeSeconds: 3600 }, // outside the week: ignored
    ],
    visitDays: ["2026-10-20", "2026-10-20", "2026-10-21", "2026-09-30"],
    xp: [{ day: "2026-10-20", amount: 28, source: "focus:a" }, { day: "2026-10-21", amount: 24, source: "focus:b" }, { day: "2026-10-01", amount: 99, source: "focus:c" }],
    allFocusDays: ["2026-10-20", "2026-10-21"],
    restDays: [],
    tests: [{ percent: 70 }, { percent: 81 }, { percent: null }],
    goalMinutes: 60,
  });
  assert.equal(r.days.find((d) => d.date === "2026-10-20")?.minutes, 70);
  assert.equal(r.focusMinutes, 130);
  assert.equal(r.visits, 2);
  assert.equal(r.xp, 52);
  assert.equal(r.streak, 2);
  assert.equal(r.goalDays, 2);
  assert.equal(r.tests, 3);
  assert.equal(r.avgScore, 76);
});
