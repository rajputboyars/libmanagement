import { test } from "node:test";
import assert from "node:assert/strict";
import { paidUpStatus, resolveStudentAccess, studentFeatureForPath } from "../src/lib/student-access";

const now = new Date("2026-10-22T10:00:00Z");
const m = (over: Record<string, unknown> = {}) => ({ start: "2026-10-01T00:00:00Z", end: "2026-10-31T00:00:00Z", status: "active", amount: 120000, discount: 0, paid: 120000, ...over });

test("paid up needs an active membership today with nothing due", () => {
  assert.deepEqual(paidUpStatus([m()], now), { paidUp: true, reason: "paid", duePaise: 0 });
  assert.deepEqual(paidUpStatus([m({ paid: 100000 })], now), { paidUp: false, reason: "dues", duePaise: 20000 });
  assert.equal(paidUpStatus([m({ paid: 100000, discount: 20000 })], now).paidUp, true);
  assert.equal(paidUpStatus([m({ status: "paused" })], now).reason, "no-membership");
  assert.equal(paidUpStatus([m({ end: "2026-10-20T00:00:00Z" })], now).reason, "no-membership");
  assert.equal(paidUpStatus([], now).paidUp, false);
  // Two current memberships: one fully paid is enough.
  assert.equal(paidUpStatus([m({ paid: 0 }), m()], now).paidUp, true);
});

test("only premium features are locked, and only when not paid up", () => {
  assert.deepEqual(resolveStudentAccess(["doubts", "planner", "unknown"], [m()], now).locked, []);
  assert.deepEqual(resolveStudentAccess(["doubts", "planner", "unknown"], [m({ paid: 0 })], now).locked, ["doubts", "planner"]);
  assert.deepEqual(resolveStudentAccess([], [], now).locked, []);
});

test("pages map to their feature", () => {
  assert.equal(studentFeatureForPath("/app/prep"), "exam-prep");
  assert.equal(studentFeatureForPath("/app/report"), "weekly-report");
  assert.equal(studentFeatureForPath("/app/focus"), null);
});
