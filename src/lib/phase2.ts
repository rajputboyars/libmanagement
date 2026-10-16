export const EXAM_KEYS = ["ssc", "banking", "railway", "upsc", "neet", "custom"] as const;
export type ExamKey = (typeof EXAM_KEYS)[number];

export const REVISION_INTERVALS = [1, 3, 7, 14, 30, 60] as const;
export type PlanningTopic = { id: string; title: string; subject: string; estimatedMinutes: number; weak?: boolean };
export type Availability = Record<string, number>;
export type PlannedTask = {
  topicId?: string;
  title: string;
  kind: "study" | "revision" | "mock" | "rest";
  scheduledFor: Date;
  durationMinutes: number;
};

const dayNames = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

export function nextRevisionDate(reviewedAt: Date, completedReviews: number) {
  const interval = REVISION_INTERVALS[Math.min(Math.max(completedReviews, 0), REVISION_INTERVALS.length - 1)];
  const next = new Date(reviewedAt);
  next.setUTCDate(next.getUTCDate() + interval);
  return next;
}

export function generateDeterministicPlan(input: {
  startDate: Date;
  examDate: Date;
  availability: Availability;
  topics: PlanningTopic[];
  maxWeeks?: number;
}) {
  const start = new Date(input.startDate);
  start.setUTCHours(12, 0, 0, 0);
  const exam = new Date(input.examDate);
  exam.setUTCHours(12, 0, 0, 0);
  const maxEnd = new Date(start);
  maxEnd.setUTCDate(maxEnd.getUTCDate() + (input.maxWeeks ?? 12) * 7);
  const end = exam < maxEnd ? exam : maxEnd;
  const queue = [...input.topics]
    .sort((a, b) => Number(Boolean(b.weak)) - Number(Boolean(a.weak)) || a.subject.localeCompare(b.subject) || a.title.localeCompare(b.title))
    .flatMap((topic) => {
      const chunks = Math.max(1, Math.ceil(Math.max(topic.estimatedMinutes, 25) / 50));
      return Array.from({ length: chunks }, (_, index) => ({ ...topic, chunk: index + 1, chunks }));
    });
  const tasks: PlannedTask[] = [];
  let cursor = 0;
  let studySessions = 0;
  for (let date = new Date(start); date < end; date.setUTCDate(date.getUTCDate() + 1)) {
    const available = Math.max(0, Math.min(360, Number(input.availability[dayNames[date.getUTCDay()]] ?? 0)));
    if (available < 25) {
      if (date.getUTCDay() === 0) tasks.push({ title: "Recovery day", kind: "rest", scheduledFor: new Date(date), durationMinutes: 0 });
      continue;
    }
    let remaining = available;
    while (cursor < queue.length && remaining >= 25) {
      const item = queue[cursor++];
      const durationMinutes = Math.min(50, remaining);
      tasks.push({ topicId: item.id, title: item.chunks > 1 ? `${item.title} · part ${item.chunk}` : item.title, kind: "study", scheduledFor: new Date(date), durationMinutes });
      remaining -= durationMinutes;
      studySessions += 1;
      if (studySessions % 3 === 0 && remaining >= 20) {
        tasks.push({ topicId: item.id, title: `Recall · ${item.title}`, kind: "revision", scheduledFor: new Date(date), durationMinutes: 20 });
        remaining -= 20;
      }
      if (studySessions % 8 === 0 && remaining >= 30) {
        tasks.push({ title: "Checkpoint mock", kind: "mock", scheduledFor: new Date(date), durationMinutes: 30 });
        remaining -= 30;
      }
    }
    if (cursor >= queue.length) break;
  }
  return { tasks, unscheduledTopicIds: [...new Set(queue.slice(cursor).map((item) => item.id))] };
}

export function scoreQuiz(
  questions: Array<{ id: string; correctIndex: number; topicId?: string }>,
  answers: Array<{ questionId: string; selectedIndex: number }>,
) {
  const submitted = new Map(answers.map((answer) => [answer.questionId, answer.selectedIndex]));
  const details = questions.map((question) => ({ questionId: question.id, topicId: question.topicId, correct: submitted.get(question.id) === question.correctIndex }));
  const correct = details.filter((answer) => answer.correct).length;
  const accuracy = questions.length ? Math.round((correct / questions.length) * 100) : 0;
  const topicBreakdown = Object.values(details.reduce<Record<string, { topicId: string; total: number; correct: number }>>((all, answer) => {
    const topicId = answer.topicId ?? "general";
    all[topicId] ??= { topicId, total: 0, correct: 0 };
    all[topicId].total += 1;
    all[topicId].correct += Number(answer.correct);
    return all;
  }, {}));
  return { correct, total: questions.length, accuracy, details, topicBreakdown };
}

export const GARDEN_STAGES = [
  { key: "seed", label: "Seed", minimum: 0 },
  { key: "sprout", label: "Sprout", minimum: 50 },
  { key: "sapling", label: "Sapling", minimum: 150 },
  { key: "bloom", label: "Bloom", minimum: 350 },
  { key: "canopy", label: "Canopy", minimum: 700 },
] as const;
export const PLANT_COLLECTION = [
  { key: "fern", name: "Focus Fern", unlockAt: 0, rarity: "common" },
  { key: "lavender", name: "Recall Lavender", unlockAt: 250, rarity: "rare" },
  { key: "bonsai", name: "Mastery Bonsai", unlockAt: 600, rarity: "epic" },
] as const;

export function gardenState(growthPoints: number) {
  const points = Math.max(0, Math.floor(growthPoints));
  const stage = [...GARDEN_STAGES].reverse().find((candidate) => points >= candidate.minimum) ?? GARDEN_STAGES[0];
  const next = GARDEN_STAGES.find((candidate) => candidate.minimum > points);
  return { points, stage, next, progress: next ? Math.round(((points - stage.minimum) / (next.minimum - stage.minimum)) * 100) : 100, unlockedPlants: PLANT_COLLECTION.filter((plant) => points >= plant.unlockAt) };
}

export function startOfStudyWeek(date = new Date()) {
  const value = new Date(date);
  value.setUTCHours(0, 0, 0, 0);
  value.setUTCDate(value.getUTCDate() - ((value.getUTCDay() + 6) % 7));
  return value;
}
