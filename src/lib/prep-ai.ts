import { validateImportRow } from "./prep";

const enabled = () => process.env.STUDYQUEST_AI_PROVIDER === "ollama";

async function chat(prompt: string, json: boolean) {
  const url = new URL("/api/chat", process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434");
  if (!["http:", "https:"].includes(url.protocol)) return null;
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: process.env.OLLAMA_MODEL || "llama3.2", stream: false, ...(json ? { format: "json" } : {}), messages: [{ role: "user", content: prompt }] }),
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) return null;
    return ((await response.json()) as { message?: { content?: string } }).message?.content ?? null;
  } catch {
    return null;
  }
}

export const aiConfigured = enabled;

/** Plain-language rewrite of an existing explanation. Never replaces the stored explanation. */
export async function simplifyExplanation(explanation: string) {
  if (!enabled()) return null;
  const text = await chat(`Rewrite this exam-question explanation in simpler words for a student, in at most 4 sentences. Do not add new facts.\n\n${explanation.slice(0, 1500)}`, false);
  const clean = text?.trim().replace(/\s+/g, " ");
  return clean && clean.length >= 20 && clean.length <= 1200 && !/[<>]/.test(clean) ? clean : null;
}

/** Drafts practice questions. Output is validated like any import and must be human-reviewed before publishing. */
export async function draftQuestions(input: { exam: string; subject: string; topic: string; difficulty: string; count: number }) {
  if (!enabled()) return null;
  const text = await chat(
    `Write ${input.count} original multiple-choice practice questions for the ${input.exam} exam on "${input.topic}" (${input.subject}), difficulty ${input.difficulty}. Do not copy real exam questions. Return strict JSON: {"questions":[{"prompt":string,"options":string[4],"correctIndex":number,"explanation":string}]}`,
    true,
  );
  if (!text) return null;
  try {
    const parsed = JSON.parse(text) as { questions?: unknown };
    if (!Array.isArray(parsed.questions)) return null;
    return parsed.questions.slice(0, input.count).map((row) => validateImportRow({ ...(row as object), difficulty: input.difficulty }));
  } catch {
    return null;
  }
}
