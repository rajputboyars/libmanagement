import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { acceptsAnswers, attributedTime, checkpoint, cohortStanding, contentHash, flashReview, officialDateStatus, remainingMs, scoreAttempt, seededOrder, spreadOverdue, topicStrength, validateImportRow } from "../src/lib/prep";

const plan = [
  { questionId: "a", section: "Quant", marks: 2, negative: 0.5 },
  { questionId: "b", section: "Quant", marks: 2, negative: 0.5 },
  { questionId: "c", section: "English", marks: 1, negative: 0.25 },
  { questionId: "d", section: "English", marks: 1, negative: 0.25 },
];
const keys = [{ id: "a", correctIndex: 1, topicId: "t1" }, { id: "b", correctIndex: 0, topicId: "t1" }, { id: "c", correctIndex: 2, topicId: "t2" }, { id: "d", correctIndex: 3, topicId: "t2" }];

describe("Mock scoring", () => {
  it("applies marks, negative marking and leaves unattempted at zero", () => {
    const r = scoreAttempt(plan, keys, [{ questionId: "a", selectedIndex: 1 }, { questionId: "b", selectedIndex: 3 }, { questionId: "c", selectedIndex: null }]);
    assert.equal(r.score, 1.5);
    assert.equal(r.maxScore, 6);
    assert.deepEqual([r.correct, r.incorrect, r.unattempted], [1, 1, 2]);
    assert.equal(r.accuracy, 50);
    assert.equal(r.sections.find((s) => s.key === "Quant")?.score, 1.5);
  });
  it("can go negative but percent never does; no attempts gives null accuracy", () => {
    const r = scoreAttempt(plan, keys, [{ questionId: "a", selectedIndex: 0 }, { questionId: "b", selectedIndex: 1 }]);
    assert.equal(r.score, -1);
    assert.equal(r.percent, 0);
    assert.equal(scoreAttempt(plan, keys, []).accuracy, null);
  });
  it("ignores answers for questions outside the plan", () => {
    const r = scoreAttempt(plan, keys, [{ questionId: "zzz", selectedIndex: 0 }]);
    assert.equal(r.score, 0);
  });
});

describe("Timer rules", () => {
  const deadline = new Date("2026-01-01T10:00:00Z");
  it("derives remaining time from server timestamps only", () => {
    assert.equal(remainingMs(deadline, new Date("2026-01-01T09:59:00Z")), 60000);
    assert.equal(remainingMs(deadline, new Date("2026-01-01T10:05:00Z")), 0);
  });
  it("accepts autosaves only inside the grace window", () => {
    assert.equal(acceptsAnswers(deadline, new Date("2026-01-01T10:00:02Z")), true);
    assert.equal(acceptsAnswers(deadline, new Date("2026-01-01T10:00:04Z")), false);
  });
  it("attributes and caps per-question time", () => {
    assert.deepEqual(attributedTime({ questionId: "q", at: new Date(1000) }, new Date(31000)), { questionId: "q", ms: 30000 });
    assert.equal(attributedTime({ questionId: "q", at: new Date(0) }, new Date(10 * 60000))!.ms, 180000);
    assert.equal(attributedTime(undefined, new Date()), null);
  });
});

describe("Question bank", () => {
  it("detects duplicates regardless of case, spacing and option order", () => {
    assert.equal(contentHash("What is  2+2?", ["4", "5"]), contentHash("what is 2+2", ["5", "4"]));
    assert.notEqual(contentHash("What is 2+2?", ["4", "5"]), contentHash("What is 3+3?", ["6", "5"]));
  });
  it("validates import rows", () => {
    const ok = { prompt: "Which planet is largest?", options: ["Earth", "Jupiter"], correctIndex: 1, explanation: "Jupiter is the largest." };
    assert.ok("value" in validateImportRow(ok));
    for (const bad of [{ ...ok, correctIndex: 2 }, { ...ok, options: ["A", "a"] }, { ...ok, explanation: "" }, { ...ok, prompt: "short" }, { ...ok, options: ["A"] }])
      assert.ok("error" in validateImportRow(bad));
  });
});

describe("Cohort standing", () => {
  it("never ranks small cohorts", () => {
    const r = cohortStanding(50, [40, 60]);
    assert.equal(r.comparable, false);
  });
  it("ranks inside a cohort of at least ten", () => {
    const r = cohortStanding(50, [10, 20, 30, 40, 60, 70, 80, 45, 5]);
    assert.deepEqual(r, { comparable: true, rank: 4, total: 10 });
  });
});

describe("Analytics and revision rules", () => {
  it("classifies topic strength with a minimum sample", () => {
    assert.equal(topicStrength(4, 4), "insufficient");
    assert.equal(topicStrength(10, 8), "strong");
    assert.equal(topicStrength(10, 4), "weak");
    assert.equal(topicStrength(10, 6), "developing");
  });
  it("resets low-confidence cards and advances confident ones", () => {
    assert.deepEqual(flashReview(3, 1), { intervalIndex: 0, lapse: true });
    assert.deepEqual(flashReview(3, 4), { intervalIndex: 4, lapse: false });
    assert.equal(flashReview(5, 5).intervalIndex, 5);
  });
  it("spreads long-overdue cards across days, oldest first", () => {
    const now = new Date("2026-02-01T00:00:00Z");
    const cards = Array.from({ length: 31 }, (_, i) => ({ id: String(i), nextDueAt: new Date(now.getTime() - (40 - i) * 86400000) }));
    cards.push({ id: "fresh", nextDueAt: new Date(now.getTime() - 3600000) });
    const moved = spreadOverdue(cards, now, 15);
    assert.equal(moved.length, 31);
    assert.equal(moved[0].id, "0");
    assert.equal(moved.filter((m) => m.nextDueAt.getTime() === now.getTime()).length, 15);
    assert.equal(moved[30].nextDueAt.toISOString(), "2026-02-03T00:00:00.000Z");
  });
  it("orders daily sets deterministically per seed", () => {
    const ids = ["1", "2", "3", "4", "5", "6"];
    assert.deepEqual(seededOrder(ids, "u1:2026-01-01"), seededOrder([...ids].reverse(), "u1:2026-01-01"));
    assert.notDeepEqual(seededOrder(ids, "u1:2026-01-01"), seededOrder(ids, "u2:2026-01-01"));
  });
  it("reports checkpoints and stale official dates", () => {
    assert.deepEqual(checkpoint(60), [25, 50]);
    const now = new Date("2026-06-01T00:00:00Z");
    assert.equal(officialDateStatus(new Date("2026-05-01T00:00:00Z"), now), "verified");
    assert.equal(officialDateStatus(new Date("2026-01-01T00:00:00Z"), now), "needs-reverification");
  });
});
