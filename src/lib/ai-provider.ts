export type DoubtRequest = {
  question: string;
  subject: string;
  difficulty: "foundation" | "standard" | "advanced";
  imageBase64?: string;
};

export type DoubtAnswer = {
  provider: "ollama" | "fallback";
  steps: string[];
  hints: string[];
  answer: string;
  disclaimer: string;
};

const disclaimer = "AI assistance can be incomplete or incorrect. Verify important exam answers with your syllabus, teacher, or an authoritative source.";

export async function solveDoubt(input: DoubtRequest): Promise<DoubtAnswer> {
  if (process.env.STUDYQUEST_AI_PROVIDER === "ollama") {
    try {
      return await ollama(input);
    } catch {
      return fallback(input);
    }
  }
  return fallback(input);
}

async function ollama(input: DoubtRequest): Promise<DoubtAnswer> {
  const base = process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434";
  const url = new URL("/api/chat", base);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error("Invalid Ollama URL");
  const prompt = [
    "You are a careful study tutor. Never claim certainty or predict exam results.",
    `Subject: ${input.subject}. Difficulty: ${input.difficulty}.`,
    `Question: ${input.question || "Explain the attached question image."}`,
    "Return strict JSON with keys steps (string array), hints (string array), answer (string). Give 2-6 concise reasoning steps, then 1-3 hints.",
  ].join("\n");
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: process.env.OLLAMA_MODEL || "llama3.2",
      stream: false,
      format: "json",
      messages: [{ role: "user", content: prompt, ...(input.imageBase64 ? { images: [input.imageBase64] } : {}) }],
    }),
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new Error("Ollama unavailable");
  const payload = await response.json() as { message?: { content?: string } };
  const parsed = JSON.parse(payload.message?.content || "{}") as { steps?: unknown; hints?: unknown; answer?: unknown };
  if (!Array.isArray(parsed.steps) || !parsed.steps.length || typeof parsed.answer !== "string") throw new Error("Invalid provider response");
  return {
    provider: "ollama",
    steps: parsed.steps.filter((item): item is string => typeof item === "string").slice(0, 6),
    hints: Array.isArray(parsed.hints) ? parsed.hints.filter((item): item is string => typeof item === "string").slice(0, 3) : [],
    answer: parsed.answer.slice(0, 4000),
    disclaimer,
  };
}

function fallback(input: DoubtRequest): DoubtAnswer {
  const questionCue = input.question.trim() ? `Restate the known facts and the exact unknown in “${input.question.trim().slice(0, 140)}${input.question.length > 140 ? "…" : ""}”.` : "Transcribe the important facts, labels, units, and the exact unknown from the image.";
  const subjectStep = /math|quant|physics/i.test(input.subject)
    ? "Choose the governing formula or theorem, define every variable, and check that units are compatible."
    : /chem/i.test(input.subject)
      ? "Identify the species, conditions, conservation rules, and the reaction or principle that connects them."
      : /bio/i.test(input.subject)
        ? "Identify the biological process, its inputs and outputs, then connect structure to function."
        : "Locate the relevant concept in your syllabus, define it precisely, and separate evidence from interpretation.";
  return {
    provider: "fallback",
    steps: [
      questionCue,
      subjectStep,
      "Work one small step at a time and write why each step follows from the previous one.",
      "Check the result against the wording, units, edge cases, and any options provided.",
    ],
    hints: ["Try naming the first principle you would use before calculating or recalling details.", "If stuck, solve a simpler version of the same question and transfer the pattern."],
    answer: "The configured AI tutor is unavailable, so StudyQuest has provided a safe problem-solving path instead of inventing a final answer.",
    disclaimer,
  };
}

export function validateImageData(dataUrl?: string) {
  if (!dataUrl) return null;
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!match) throw new Error("Use a PNG, JPEG, or WebP image");
  const buffer = Buffer.from(match[2], "base64");
  if (!buffer.length || buffer.length > 2 * 1024 * 1024) throw new Error("Image must be smaller than 2 MB");
  const png = buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const jpeg = buffer[0] === 0xff && buffer[1] === 0xd8 && buffer.at(-2) === 0xff && buffer.at(-1) === 0xd9;
  const webp = buffer.subarray(0, 4).toString() === "RIFF" && buffer.subarray(8, 12).toString() === "WEBP";
  if (!png && !jpeg && !webp) throw new Error("Image content does not match its file type");
  return { mime: match[1], buffer, base64: match[2] };
}
