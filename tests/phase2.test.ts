import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { generateDeterministicPlan, gardenState, nextRevisionDate, scoreQuiz } from "../src/lib/phase2";

describe("Phase 2 learning rules", () => {
  it("prioritizes weak topics and stays inside daily availability", () => {
    const result = generateDeterministicPlan({
      startDate: new Date("2026-10-19T00:00:00.000Z"),
      examDate: new Date("2026-11-30T00:00:00.000Z"),
      availability: { mon: 100, tue: 0, wed: 50, thu: 0, fri: 0, sat: 0, sun: 0 },
      topics: [
        { id: "strong", title: "Algebra", subject: "Math", estimatedMinutes: 50 },
        { id: "weak", title: "Geometry", subject: "Math", estimatedMinutes: 50, weak: true },
      ],
    });
    assert.deepEqual({ topicId: result.tasks[0].topicId, kind: result.tasks[0].kind, durationMinutes: result.tasks[0].durationMinutes }, { topicId: "weak", kind: "study", durationMinutes: 50 });
    const dailyMinutes = result.tasks.filter((task) => task.scheduledFor.toISOString().startsWith("2026-10-19")).reduce((sum, task) => sum + task.durationMinutes, 0);
    assert.ok(dailyMinutes <= 100);
  });

  it("uses fixed spaced-repetition intervals", () => {
    assert.equal(nextRevisionDate(new Date("2026-10-16T00:00:00.000Z"), 0).toISOString(), "2026-10-17T00:00:00.000Z");
    assert.equal(nextRevisionDate(new Date("2026-10-16T00:00:00.000Z"), 5).toISOString(), "2026-12-15T00:00:00.000Z");
  });

  it("scores only server question truth and reports weak topics", () => {
    const score = scoreQuiz(
      [{ id: "q1", correctIndex: 1, topicId: "math" }, { id: "q2", correctIndex: 0, topicId: "science" }],
      [{ questionId: "q1", selectedIndex: 1 }, { questionId: "q2", selectedIndex: 1 }],
    );
    assert.deepEqual({ correct: score.correct, total: score.total, accuracy: score.accuracy }, { correct: 1, total: 2, accuracy: 50 });
    assert.deepEqual(score.topicBreakdown.find((topic) => topic.topicId === "science"), { topicId: "science", correct: 0, total: 1 });
  });

  it("never reduces garden progress and unlocks collectible plants", () => {
    assert.equal(gardenState(-20).points, 0);
    assert.equal(gardenState(360).stage.key, "bloom");
    assert.equal(gardenState(360).progress, 3);
    assert.deepEqual(gardenState(700).unlockedPlants.map((plant) => plant.key), ["fern", "lavender", "bonsai"]);
  });
});
