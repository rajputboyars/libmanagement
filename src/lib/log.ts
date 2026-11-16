import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

type Level = "debug" | "info" | "warn" | "error";
const order: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const threshold = () => order[(process.env.LOG_LEVEL as Level) || "info"] ?? 20;

// Keys whose values are never written, whatever they contain.
const SENSITIVE = /pass(word)?|secret|token|authorization|cookie|signature|otp|totp|code|card|cvv|gstin|api[-_]?key|hash|email|phone|mobile|uri|dsn|connection|recovery|session|seed|credential|bearer|private/i;
const SECRET_PATTERNS: [RegExp, string][] = [
  [/mongodb(?:\+srv)?:\/\/[^\s"'<>]+/gi, "[db-uri]"], // connection strings (credentials AND internal topology)
  [/\bBearer\s+[\w.~+/=-]+/gi, "Bearer [redacted]"],
  [/\b(sq-session|session|token|authorization|cookie|password|secret)=[^\s;,&"']+/gi, "$1=[redacted]"],
  [/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[email]"],
  [/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, "[jwt]"],
  [/\brzp_(?:live|test)_\w+/g, "[payment-key]"],
  [/\b[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}\b/g, "[recovery-code]"], // recovery-code shape
  [/\b\d{10,}\b/g, "[number]"], // phone, card and account numbers
  [/\b[A-Za-z0-9_-]{32,}\b/g, "[token]"], // long opaque strings: seeds, keys, hashes
];
/** Scrubs secrets and personal data from free text. */
export function scrubText(text: string): string {
  let out = text;
  for (const [re, to] of SECRET_PATTERNS) out = out.replace(re, to);
  return out.length > 500 ? `${out.slice(0, 500)}…` : out;
}
/** Redacts sensitive keys and obvious secrets in free text before anything is written. */
export function redact(value: unknown, depth = 0): unknown {
  if (value == null || depth > 5) return value;
  if (typeof value === "string") return scrubText(value);
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => redact(v, depth + 1));
  if (value instanceof Error) return serializeError(value);
  if (typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).slice(0, 40).map(([k, v]) => [k, SENSITIVE.test(k) ? "[redacted]" : redact(v, depth + 1)]));
  return value;
}

/** A log-safe description of an error: name, scrubbed message, Next digest and the first stack frames (server logs only, never responses). */
export function serializeError(error: unknown) {
  if (!(error instanceof Error)) return { name: typeof error, message: scrubText(String(error)) };
  const e = error as Error & { digest?: string; code?: unknown };
  return { name: e.name, message: scrubText(e.message ?? ""), digest: e.digest, code: typeof e.code === "string" || typeof e.code === "number" ? e.code : undefined, stack: e.stack ? scrubText(e.stack.split("\n").slice(0, 8).join("\n")) : undefined };
}

const context = new AsyncLocalStorage<{ requestId: string }>();
export const withRequestId = <T>(requestId: string | null | undefined, fn: () => T) => context.run({ requestId: requestId || randomUUID() }, fn);
export const currentRequestId = () => context.getStore()?.requestId;

/** Structured JSON logs to stdout; any log collector (Loki, Datadog, CloudWatch, …) can ingest them. Never throws. */
export function log(level: Level, event: string, details: Record<string, unknown> = {}) {
  try {
    if (order[level] < threshold()) return;
    const line = JSON.stringify({ ts: new Date().toISOString(), level, event, service: "studyquest", env: process.env.NODE_ENV, requestId: currentRequestId(), ...(redact(details) as object) });
    (level === "error" ? console.error : level === "warn" ? console.warn : console.log)(line);
  } catch {
    // Logging must never break the code that called it.
  }
}

/**
 * Back-compatible alert entry point (see src/lib/alerts.ts for the full manager: deduplication, cooldowns, recovery notices).
 * Resolves true only when a webhook accepted the message; never throws.
 */
export async function alert(event: string, details: Record<string, unknown> = {}) {
  try {
    const { alerts } = await import("./alerts");
    return await alerts.raise(event, event, details);
  } catch {
    return false;
  }
}
