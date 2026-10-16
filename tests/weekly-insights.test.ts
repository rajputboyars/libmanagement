import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildWeeklySummary, deterministicNarrative, safeNarrative } from "../src/lib/weekly-insights";

const metrics = { accuracy: 70, answeredQuestions: 20, weakTopicCount: 2, dueNow: 4, reviewedThisWeek: 3 };
describe("Weekly insights", () => {
  it("states missing data instead of inventing it", () => {
    const s = buildWeeklySummary({ metrics: { ...metrics, answeredQuestions: 0, reviewedThisWeek: 0, dueNow: 0, weakTopicCount: 0, accuracy: null }, trends: [{ accuracy: null, questions: 0, revisions: 0 }, { accuracy: null, questions: 0, revisions: 0 }], focusMinutes: { current: 0, previous: 0 }, weakTopicTitles: [] });
    assert.match(s.observations.join(" "), /No completed focus sessions/);
    assert.match(s.observations.join(" "), /accuracy is not shown/);
    assert.equal(s.goals.find((g) => g.id === "focus")?.target, 120);
  });
  it("reports week-over-week change and bounded goals", () => {
    const s = buildWeeklySummary({ metrics, trends: [{ accuracy: 60, questions: 10, revisions: 1 }, { accuracy: 70, questions: 20, revisions: 3 }], focusMinutes: { current: 300, previous: 240 }, weakTopicTitles: ["Algebra"] });
    assert.match(s.observations.join(" "), /\+10 points/);
    assert.equal(s.goals.find((g) => g.id === "focus")?.target, 330);
    assert.ok(deterministicNarrative(s).includes("not predictions"));
  });
  it("rejects AI wording with outcome claims or invented numbers", () => {
    const s = buildWeeklySummary({ metrics, trends: [{ accuracy: 60, questions: 10, revisions: 1 }, { accuracy: 70, questions: 20, revisions: 3 }], focusMinutes: { current: 300, previous: 240 }, weakTopicTitles: [] });
    const ok = "You studied 5 h this week and answered 20 questions with 70% accuracy. Keep a steady pace next week.";
    assert.equal(safeNarrative(ok, s), ok);
    assert.equal(safeNarrative("You have a high chance of selection if you keep going this way, which is great.", s), null);
    assert.equal(safeNarrative("You answered 45 questions and did great work across the whole week, well done.", s), null);
    assert.equal(safeNarrative(42, s), null);
  });
});
