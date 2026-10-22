import { test } from "node:test";
import assert from "node:assert/strict";
import { countdownText, daysUntil } from "../src/lib/exam-countdown";

test("days until the exam use the India date", () => {
  // 20:00 UTC on Oct 21 is already Oct 22 in India.
  assert.equal(daysUntil("2026-10-25", new Date("2026-10-21T20:00:00Z")), 3);
  assert.equal(daysUntil("2026-10-22", new Date("2026-10-21T20:00:00Z")), 0);
  assert.equal(daysUntil("2026-10-20", new Date("2026-10-22T05:00:00Z")), -2);
});

test("countdown text", () => {
  assert.equal(countdownText(42, "SSC"), "42 days to SSC");
  assert.equal(countdownText(1, "SSC"), "SSC is tomorrow");
  assert.equal(countdownText(0, "SSC"), "SSC is today. All the best!");
  assert.equal(countdownText(-2, "SSC"), "SSC was 2 days ago. Set your next exam date.");
});
