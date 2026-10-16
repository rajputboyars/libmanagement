import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

type Level = "debug" | "info" | "warn" | "error";
const order: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const threshold = () => order[(process.env.LOG_LEVEL as Level) || "info"] ?? 20;

const SENSITIVE = /pass(word)?|secret|token|authorization|cookie|signature|otp|code|card|cvv|gstin|api[-_]?key|hash|email|phone|mobile/i;
/** Redacts sensitive keys and obvious secrets in free text before anything is written. */
export function redact(value: unknown, depth = 0): unknown {
  if (value == null || depth > 5) return value;
  if (typeof value === "string") return value.length > 500 ? `${value.slice(0, 500)}…` : value.replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[email]").replace(/\b\d{10,}\b/g, "[number]").replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, "[jwt]");
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => redact(v, depth + 1));
  if (typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).slice(0, 40).map(([k, v]) => [k, SENSITIVE.test(k) ? "[redacted]" : redact(v, depth + 1)]));
  return value;
}

const context = new AsyncLocalStorage<{ requestId: string }>();
export const withRequestId = <T>(requestId: string | null | undefined, fn: () => T) => context.run({ requestId: requestId || randomUUID() }, fn);
export const currentRequestId = () => context.getStore()?.requestId;

/** Structured JSON logs to stdout; any log collector (Loki, Datadog, CloudWatch, …) can ingest them. */
export function log(level: Level, event: string, details: Record<string, unknown> = {}) {
  if (order[level] < threshold()) return;
  const line = JSON.stringify({ ts: new Date().toISOString(), level, event, service: "studyquest", env: process.env.NODE_ENV, requestId: currentRequestId(), ...(redact(details) as object) });
  (level === "error" ? console.error : level === "warn" ? console.warn : console.log)(line);
}

let lastAlert = 0;
/** Optional alert fan-out. A webhook is only called when ALERT_WEBHOOK_URL is configured; otherwise nothing is claimed as sent. */
export async function alert(event: string, details: Record<string, unknown> = {}) {
  log("error", `alert.${event}`, details);
  const url = process.env.ALERT_WEBHOOK_URL;
  if (!url || Date.now() - lastAlert < 60000) return false;
  lastAlert = Date.now();
  try {
    const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: `[StudyQuest] ${event}`, event, details: redact(details), at: new Date().toISOString() }), signal: AbortSignal.timeout(5000) });
    return response.ok;
  } catch {
    return false;
  }
}
