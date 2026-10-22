import { test } from "node:test";
import assert from "node:assert/strict";
import {
  price,
  reward,
  level,
  overlaps,
  streak,
  canComplete,
} from "../src/lib/rules";
test("pricing counts only confirmed payments and supports discounts and partial payments", () => {
  assert.deepEqual(price(150000, 10000, 50000), {
    total: 140000,
    due: 90000,
    status: "partial",
  });
  assert.equal(price(100, 0, 100).status, "paid");
  assert.equal(price(100, 0, 0).status, "unpaid");
  assert.throws(() => price(100, 101, 0));
  assert.throws(() => price(100, 0, 101));
  assert.throws(() => price(NaN, 0, 0));
});
test("overlap excludes touching shifts and includes full-day conflicts", () => {
  assert.equal(
    overlaps({ start: 360, end: 720 }, { start: 720, end: 1080 }),
    false,
  );
  assert.equal(
    overlaps({ start: 0, end: 1440 }, { start: 720, end: 1080 }),
    true,
  );
  assert.equal(
    overlaps({ start: 600, end: 800 }, { start: 700, end: 900 }),
    true,
  );
});
test("reward grants cannot exceed the daily cap", () => {
  assert.equal(reward(95, 10), 5);
  assert.equal(reward(100, 50), 0);
  assert.equal(reward(0, 10), 10);
  assert.equal(reward(110, 10), 0);
});
test("levels increase with cumulative XP", () => {
  assert.equal(level(0), 1);
  assert.equal(level(49), 1);
  assert.equal(level(50), 2);
  assert.equal(level(200), 3);
});
test("streak permits today to be incomplete and explicit rest days", () => {
  assert.equal(streak(["2026-10-14", "2026-10-15"], "2026-10-16"), 2);
  assert.equal(
    streak(["2026-10-13", "2026-10-15"], "2026-10-16", ["2026-10-14"]),
    2,
  );
  assert.equal(streak(["2026-10-13"], "2026-10-16"), 0);
});
test("timer requires 25 server-verified active minutes; pause time never counts", () => {
  const now = new Date("2026-10-16T12:00:00Z");
  assert.equal(
    canComplete(
      {
        state: "running",
        activeSeconds: 0,
        lastResumedAt: new Date(+now - 1499000),
      },
      now,
    ),
    false,
  );
  assert.equal(
    canComplete(
      {
        state: "running",
        activeSeconds: 0,
        lastResumedAt: new Date(+now - 1500000),
      },
      now,
    ),
    true,
  );
  assert.equal(
    canComplete(
      {
        state: "paused",
        activeSeconds: 100,
        lastResumedAt: new Date(+now - 7200000),
      },
      now,
    ),
    false,
  );
  assert.equal(
    canComplete(
      { state: "complete", activeSeconds: 1500, lastResumedAt: now },
      now,
    ),
    false,
  );
});

test("focus length, XP and break follow the chosen session length", async () => {
  const { focusLength, focusXP, breakMinutes, canComplete } = await import("../src/lib/rules");
  assert.equal(focusLength(45), 45);
  assert.equal(focusLength(30), 25); // unknown lengths fall back to 25
  assert.equal(focusLength(undefined), 25);
  assert.deepEqual([25, 45, 60].map(focusXP), [10, 18, 24]);
  assert.deepEqual([25, 45, 60].map(breakMinutes), [5, 10, 10]);
  const now = new Date();
  const paused = (activeSeconds: number, targetMinutes?: number) => ({ state: "paused", activeSeconds, lastResumedAt: now, targetMinutes });
  assert.equal(canComplete(paused(1500), now), true); // old sessions count as 25 minutes
  assert.equal(canComplete(paused(1500, 45), now), false);
  assert.equal(canComplete(paused(2700, 45), now), true);
});
