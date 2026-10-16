import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildLearningIntelligence, weekStart } from "../src/lib/learning";

describe("deterministic learning intelligence", () => {
  const now = new Date("2026-10-16T12:00:00.000Z");

  it("prioritizes repeated mistakes, weak selections and overdue revisions", () => {
    const result = buildLearningIntelligence({
      now,
      topics: [
        { id: "weak", title: "Geometry", subject: "Math" },
        { id: "strong", title: "Algebra", subject: "Math" },
      ],
      attempts: [
        { submittedAt: new Date("2026-10-15T12:00:00.000Z"), topicBreakdown: [{ topicId: "weak", total: 5, correct: 2 }, { topicId: "strong", total: 5, correct: 5 }] },
        { submittedAt: new Date("2026-10-14T12:00:00.000Z"), topicBreakdown: [{ topicId: "weak", total: 5, correct: 3 }] },
      ],
      progress: [{ topicId: "weak", mastery: 45, status: "studying" }, { topicId: "strong", mastery: 90, status: "completed" }],
      revisions: [{ topicId: "weak", nextDueAt: new Date("2026-10-15T12:00:00.000Z"), intervalIndex: 1, history: [] }],
      explicitWeakTopicIds: ["weak"],
    });
    assert.equal(result.topics[0].id, "weak");
    assert.equal(result.topics[0].accuracy, 50);
    assert.equal(result.topics[0].repeatedMistakes, 2);
    assert.ok(result.topics[0].priority >= 70);
    assert.equal(result.recommendations[0].topicId, "weak");
    assert.equal(result.metrics.accuracy, 67);
  });

  it("leaves unsupported accuracy empty instead of inventing a value", () => {
    const result = buildLearningIntelligence({
      now,
      topics: [{ id: "new", title: "New topic" }],
      attempts: [],
      progress: [],
      revisions: [],
    });
    assert.equal(result.metrics.accuracy, null);
    assert.equal(result.topics[0].accuracy, null);
    assert.match(result.topics[0].reason, /Not enough quiz evidence/);
  });

  it("counts verified reviews while excluding snoozes and reschedules", () => {
    const result = buildLearningIntelligence({
      now,
      topics: [{ id: "topic", title: "Topic" }],
      attempts: [],
      progress: [],
      revisions: [{
        topicId: "topic",
        nextDueAt: new Date("2026-10-20T00:00:00.000Z"),
        intervalIndex: 2,
        history: [
          { reviewedAt: new Date("2026-10-13T00:00:00.000Z"), event: "review", confidence: 4 },
          { reviewedAt: new Date("2026-10-14T00:00:00.000Z"), event: "snooze" },
          { reviewedAt: new Date("2026-10-15T00:00:00.000Z"), event: "reschedule" },
        ],
      }],
    });
    assert.equal(result.metrics.reviewedThisWeek, 1);
    assert.equal(result.trends.at(-1)?.revisions, 1);
  });

  it("uses Monday as the stable study week boundary", () => {
    assert.equal(weekStart(new Date("2026-10-16T12:00:00.000Z")).toISOString(), "2026-10-12T00:00:00.000Z");
  });
});
