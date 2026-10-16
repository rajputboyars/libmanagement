export type QuizTopicBreakdown = { topicId: string; total: number; correct: number };
export type QuizSignal = { submittedAt: Date; topicBreakdown: QuizTopicBreakdown[] };
export type ProgressSignal = { topicId: string; mastery: number; status: string };
export type RevisionSignal = {
  topicId: string;
  nextDueAt: Date;
  intervalIndex: number;
  history: Array<{ reviewedAt?: Date; confidence?: number; event?: string }>;
};
export type TopicLabel = { id: string; title: string; subject?: string };

const clamp = (value: number, minimum = 0, maximum = 100) => Math.min(maximum, Math.max(minimum, value));

export function buildLearningIntelligence(input: {
  now: Date;
  topics: TopicLabel[];
  attempts: QuizSignal[];
  progress: ProgressSignal[];
  revisions: RevisionSignal[];
  explicitWeakTopicIds?: string[];
}) {
  const progress = new Map(input.progress.map((item) => [item.topicId, item]));
  const revisions = new Map(input.revisions.map((item) => [item.topicId, item]));
  const explicitWeak = new Set(input.explicitWeakTopicIds || []);
  const attempts = [...input.attempts].sort((a, b) => b.submittedAt.getTime() - a.submittedAt.getTime());
  const topics = input.topics.map((topic) => {
    const observations = attempts.flatMap((attempt) => attempt.topicBreakdown.filter((entry) => entry.topicId === topic.id));
    const total = observations.reduce((sum, entry) => sum + entry.total, 0);
    const correct = observations.reduce((sum, entry) => sum + entry.correct, 0);
    const accuracy = total ? Math.round((correct / total) * 100) : null;
    const recent = observations.slice(0, 3);
    const recentTotal = recent.reduce((sum, entry) => sum + entry.total, 0);
    const recentCorrect = recent.reduce((sum, entry) => sum + entry.correct, 0);
    const recentAccuracy = recentTotal ? Math.round((recentCorrect / recentTotal) * 100) : null;
    const repeatedMistakes = recent.filter((entry) => entry.correct < entry.total).length;
    const topicProgress = progress.get(topic.id);
    const revision = revisions.get(topic.id);
    const overdue = Boolean(revision && revision.nextDueAt <= input.now);
    const mastery = topicProgress?.mastery ?? 0;
    const evidenceScore = accuracy === null ? 25 : (100 - accuracy) * 0.46;
    const priority = Math.round(clamp(
      evidenceScore + Math.min(24, repeatedMistakes * 8) + (overdue ? 18 : 0) + (explicitWeak.has(topic.id) ? 12 : 0) + (100 - mastery) * 0.08,
    ));
    const reason = repeatedMistakes >= 2
      ? `${repeatedMistakes} recent quizzes contained mistakes`
      : overdue
        ? "Revision is due"
        : accuracy !== null && accuracy < 70
          ? `${accuracy}% verified quiz accuracy`
          : total === 0
            ? "Not enough quiz evidence yet"
            : "Keep this topic active";
    return {
      ...topic,
      attemptedQuestions: total,
      correctAnswers: correct,
      accuracy,
      recentAccuracy,
      repeatedMistakes,
      mastery,
      overdue,
      revisionLevel: revision?.intervalIndex ?? 0,
      priority,
      reason,
    };
  }).sort((a, b) => b.priority - a.priority || a.title.localeCompare(b.title));

  const totals = topics.reduce((all, topic) => ({ total: all.total + topic.attemptedQuestions, correct: all.correct + topic.correctAnswers }), { total: 0, correct: 0 });
  const reviewedThisWeek = input.revisions.reduce((count, revision) => count + revision.history.filter((entry) => entry.event !== "snooze" && entry.event !== "reschedule" && entry.reviewedAt && entry.reviewedAt >= weekStart(input.now)).length, 0);
  const dueNow = input.revisions.filter((revision) => revision.nextDueAt <= input.now).length;
  const weakTopics = topics.filter((topic) => topic.priority >= 55).slice(0, 5);
  const recommendations = weakTopics.slice(0, 3).map((topic, index) => ({
    topicId: topic.id,
    title: index === 0 ? `Start with ${topic.title}` : `Reinforce ${topic.title}`,
    reason: topic.reason,
    action: topic.overdue ? "Complete a focused revision" : topic.attemptedQuestions ? "Take a short topic quiz" : "Study the topic, then test recall",
    minutes: topic.overdue ? 20 : 30,
    priority: topic.priority,
  }));
  if (!recommendations.length) recommendations.push({ topicId: "general", title: "Maintain your learning rhythm", reason: "No high-priority weakness is visible in verified activity", action: "Complete one revision and one short quiz", minutes: 30, priority: 30 });

  return {
    generatedAt: new Date(input.now),
    metrics: {
      accuracy: totals.total ? Math.round((totals.correct / totals.total) * 100) : null,
      answeredQuestions: totals.total,
      weakTopicCount: weakTopics.length,
      dueNow,
      reviewedThisWeek,
    },
    topics,
    weakTopics,
    recommendations,
    trends: buildWeeklyTrends(input.now, attempts, input.revisions),
  };
}

export function weekStart(value: Date) {
  const date = new Date(value);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  return date;
}

function buildWeeklyTrends(now: Date, attempts: QuizSignal[], revisions: RevisionSignal[]) {
  const current = weekStart(now);
  return Array.from({ length: 8 }, (_, index) => {
    const start = new Date(current);
    start.setUTCDate(start.getUTCDate() - (7 - index) * 7);
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 7);
    const weeklyAttempts = attempts.filter((attempt) => attempt.submittedAt >= start && attempt.submittedAt < end);
    const totals = weeklyAttempts.flatMap((attempt) => attempt.topicBreakdown).reduce((all, entry) => ({ total: all.total + entry.total, correct: all.correct + entry.correct }), { total: 0, correct: 0 });
    const reviewed = revisions.reduce((count, revision) => count + revision.history.filter((entry) => entry.event !== "snooze" && entry.event !== "reschedule" && entry.reviewedAt && entry.reviewedAt >= start && entry.reviewedAt < end).length, 0);
    return {
      week: start.toISOString().slice(5, 10),
      start: start.toISOString(),
      accuracy: totals.total ? Math.round((totals.correct / totals.total) * 100) : null,
      questions: totals.total,
      revisions: reviewed,
    };
  });
}
