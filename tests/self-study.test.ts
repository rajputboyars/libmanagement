import { test } from "node:test";
import assert from "node:assert/strict";
import { bySubject, fixedByRetries, change, chapterComplete, energyPattern, focusQuality, goalStatus, heatLevel, heatmap, planKeptRate, stepsDone } from "../src/lib/self-study";

test("focus quality drops 8 points per distraction", () => {
  assert.deepEqual([0, 1, 2, 20].map(focusQuality), [100, 92, 84, 0]);
});

test("heatmap buckets sessions by India date", () => {
  const now = new Date("2026-10-23T06:00:00Z");
  // 20:00 UTC on Oct 22 is Oct 23 in India.
  const h = heatmap([{ completedAt: "2026-10-22T20:00:00Z", activeSeconds: 1500 }, { completedAt: "2026-10-22T05:00:00Z", activeSeconds: 3600 }], now, 3);
  assert.deepEqual(h, [{ date: "2026-10-21", minutes: 0 }, { date: "2026-10-22", minutes: 60 }, { date: "2026-10-23", minutes: 25 }]);
  assert.deepEqual([0, 30, 90, 200, 400].map(heatLevel), [0, 1, 2, 3, 4]);
});

test("minutes by subject", () => {
  assert.deepEqual(bySubject([{ subject: "Polity", activeSeconds: 1500 }, { subject: "", activeSeconds: 600 }, { subject: "Polity", activeSeconds: 1500 }]), [{ subject: "Polity", minutes: 50 }, { subject: "Untagged", minutes: 10 }]);
});

test("plan kept rate", () => {
  assert.equal(planKeptRate([{ tasks: [{ done: true }, { done: false }] }, { tasks: [{ done: true }, { done: true }] }]), 75);
  assert.equal(planKeptRate([]), null);
});

test("chapter steps", () => {
  assert.equal(stepsDone({ read: true, notes: true }), 2);
  assert.equal(chapterComplete({ read: true, notes: true, rev1: true, rev2: true, pyq: true }), true);
  assert.equal(chapterComplete(null), false);
});

test("goal on track compares chapters done with time used", () => {
  const created = new Date("2026-10-01T00:00:00Z"), deadline = new Date("2026-10-31T00:00:00Z"), now = new Date("2026-10-16T00:00:00Z");
  assert.equal(goalStatus(5, 10, created, deadline, now).state, "on-track");
  assert.equal(goalStatus(2, 10, created, deadline, now).state, "behind");
  assert.equal(goalStatus(10, 10, created, deadline, now).state, "done");
  assert.equal(goalStatus(3, 10, created, deadline, new Date("2026-11-02T00:00:00Z")).state, "missed");
});

test("energy pattern", () => {
  const minutes = new Map([["a", 200], ["b", 100], ["c", 100], ["d", 50]]);
  assert.deepEqual(energyPattern([{ day: "a", energy: 5 }, { day: "b", energy: 4 }, { day: "c", energy: 2 }, { day: "d", energy: 1 }], minutes), { highMinutes: 150, lowMinutes: 75, morePercent: 100 });
  assert.equal(energyPattern([{ day: "a", energy: 5 }], minutes), null);
  assert.equal(change(120, 100), 20);
  assert.equal(change(5, 0), null);
});

test("two correct retries in a row fix a mistake", () => {
  assert.equal(fixedByRetries([{ correct: true }, { correct: true }]), true);
  assert.equal(fixedByRetries([{ correct: true }, { correct: false }, { correct: true }]), false);
  assert.equal(fixedByRetries([{ correct: true }]), false);
});
