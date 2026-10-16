export type WeeklyInputs = {
  metrics: { accuracy: number | null; answeredQuestions: number; weakTopicCount: number; dueNow: number; reviewedThisWeek: number };
  trends: { accuracy: number | null; questions: number; revisions: number }[];
  focusMinutes: { current: number; previous: number };
  weakTopicTitles: string[];
};
export type WeeklyGoal = { id: string; label: string; target: number; unit: string };

const hours = (minutes: number) => `${Math.round((minutes / 60) * 10) / 10} h`;

/** Deterministic, evidence-only summary. Anything without data is stated as missing, never estimated. */
export function buildWeeklySummary(input: WeeklyInputs) {
  const current = input.trends[input.trends.length - 1];
  const previous = input.trends[input.trends.length - 2];
  const observations: string[] = [];
  observations.push(input.focusMinutes.current ? `You completed ${hours(input.focusMinutes.current)} of verified focus this week${input.focusMinutes.previous ? ` (${hours(input.focusMinutes.previous)} last week)` : ""}.` : "No completed focus sessions are recorded this week.");
  if (current?.questions) {
    const change = previous?.questions && current.accuracy !== null && previous.accuracy !== null ? current.accuracy - previous.accuracy : null;
    observations.push(`You answered ${current.questions} scored question${current.questions === 1 ? "" : "s"} with ${current.accuracy}% accuracy${change === null ? "" : ` (${change >= 0 ? "+" : ""}${change} points versus last week)`}.`);
  } else observations.push("No scored quiz answers this week, so accuracy is not shown.");
  observations.push(input.metrics.reviewedThisWeek ? `You completed ${input.metrics.reviewedThisWeek} revision${input.metrics.reviewedThisWeek === 1 ? "" : "s"}.` : "No revisions were completed this week.");
  if (input.metrics.dueNow) observations.push(`${input.metrics.dueNow} revision${input.metrics.dueNow === 1 ? " is" : "s are"} due now.`);
  if (input.weakTopicTitles.length) observations.push(`Topics with the strongest evidence of difficulty: ${input.weakTopicTitles.slice(0, 3).join(", ")}.`);

  const base = Math.max(input.focusMinutes.current, input.focusMinutes.previous);
  const goals: WeeklyGoal[] = [];
  if (base) goals.push({ id: "focus", label: "Focus time", target: Math.ceil((base * 1.1) / 30) * 30, unit: "minutes" });
  else goals.push({ id: "focus", label: "Focus time", target: 120, unit: "minutes" });
  goals.push({ id: "revisions", label: "Complete revisions", target: Math.min(20, Math.max(3, input.metrics.dueNow, input.metrics.reviewedThisWeek)), unit: "revisions" });
  if (input.metrics.weakTopicCount) goals.push({ id: "quizzes", label: "Short topic quizzes on priority topics", target: Math.min(5, input.metrics.weakTopicCount + 1), unit: "quizzes" });
  return { observations, goals, basis: "Verified focus sessions, scored quiz answers and completed revisions" };
}

export function deterministicNarrative(summary: ReturnType<typeof buildWeeklySummary>) {
  return `${summary.observations.join(" ")} Suggested goals for next week: ${summary.goals.map((g) => `${g.label.toLowerCase()} ${g.target} ${g.unit}`).join("; ")}. These are suggestions from your own activity, not predictions.`;
}

const unsupported = /(\bchance(s)?\b|\bprobab|\blikel(y|ihood)\b|\bguarantee|\bwill (pass|clear|crack|qualify|get selected)|\bselection\b|\bpredict|\bpercentile\b|\brank\b|\bcutoff\b|\bscore (of )?\d{2,3}\b)/i;
/** AI wording is accepted only if short, plain, and free of exam-outcome claims; otherwise callers fall back. */
export function safeNarrative(text: unknown, summary: ReturnType<typeof buildWeeklySummary>) {
  if (typeof text !== "string") return null;
  const value = text.trim().replace(/\s+/g, " ");
  if (value.length < 40 || value.length > 900 || unsupported.test(value) || /[<>]/.test(value)) return null;
  const allowed = new Set(summary.observations.join(" ").match(/\d+(\.\d+)?/g) || []);
  for (const goal of summary.goals) allowed.add(String(goal.target));
  const stray = (value.match(/\d+(\.\d+)?/g) || []).filter((n) => !allowed.has(n));
  return stray.length ? null : value;
}

export async function aiNarrative(summary: ReturnType<typeof buildWeeklySummary>) {
  if (process.env.STUDYQUEST_AI_PROVIDER !== "ollama") return null;
  try {
    const url = new URL("/api/chat", process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434");
    if (!["http:", "https:"].includes(url.protocol)) return null;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: process.env.OLLAMA_MODEL || "llama3.2",
        stream: false,
        messages: [{ role: "user", content: `Rewrite these verified study facts as a warm, plain 3-4 sentence weekly note for a student. Use only the numbers given. Do not predict results, chances, ranks or selection.\nFacts: ${summary.observations.join(" ")}\nGoals: ${summary.goals.map((g) => `${g.label} ${g.target} ${g.unit}`).join("; ")}` }],
      }),
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) return null;
    const payload = (await response.json()) as { message?: { content?: string } };
    return safeNarrative(payload.message?.content, summary);
  } catch {
    return null;
  }
}
