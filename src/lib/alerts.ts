import { defer } from "./defer";
import { log, redact, scrubText } from "./log";

/**
 * Operational alerting through ALERT_WEBHOOK_URL (Slack/Teams/Discord-style JSON webhook, or any HTTPS endpoint that accepts JSON).
 *  - Deduplication: one notification per key per cooldown; repeats are counted and summarised in the next one.
 *  - Storm protection: at most `maxPerWindow` notifications per window across all keys; the rest are counted, not sent.
 *  - Recovery: resolve(key) sends a single "resolved" notice if (and only if) that key was firing.
 *  - Safety: nothing here ever throws or blocks business code for longer than `timeoutMs`; an unreachable webhook is logged and counted.
 * State is per process. When MongoDB is reachable, the default instance also takes a shared claim so several instances do not each send the
 * same alert; if MongoDB is the thing that is down, it fails open (an alert is better than silence).
 */
export type Severity = "info" | "warning" | "critical";
export type AlertDeps = {
  fetch?: typeof fetch;
  now?: () => number;
  url?: () => string | undefined;
  environment?: () => string | undefined;
  claim?: (key: string, cooldownSec: number) => Promise<boolean>;
  cooldownMs?: number;
  maxPerWindow?: number;
  windowMs?: number;
  timeoutMs?: number;
};
type State = { firing: boolean; firstAt: number; lastSentAt: number; occurrences: number; suppressed: number; title: string; severity: Severity };
type RateState = { times: number[]; threshold: number; windowMs: number; title: string };

export const RUNBOOK = "docs/MONITORING.md";

export function createAlertManager(deps: AlertDeps = {}) {
  const now = deps.now ?? Date.now;
  const doFetch = deps.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  const url = deps.url ?? (() => process.env.ALERT_WEBHOOK_URL);
  const environment = deps.environment ?? (() => process.env.NODE_ENV);
  const cooldownDefault = deps.cooldownMs ?? 15 * 60_000;
  const maxPerWindow = deps.maxPerWindow ?? 10, windowMs = deps.windowMs ?? 10 * 60_000, timeoutMs = deps.timeoutMs ?? 4000;
  const states = new Map<string, State>();
  const rates = new Map<string, RateState>();
  const sent: number[] = [];
  let stormSuppressed = 0, deliveryFailures = 0, delivered = 0, lastFailureLogAt = 0, warnedUnconfigured = false;
  let lastDeliveryError: string | undefined;

  async function deliver(payload: Record<string, unknown>) {
    const target = url();
    if (!target) {
      if (!warnedUnconfigured) { warnedUnconfigured = true; log("warn", "alert.not_configured", { note: "ALERT_WEBHOOK_URL is not set: alerts are only logged" }); }
      return false;
    }
    try {
      const u = new URL(target);
      if (u.protocol !== "https:" && !(u.protocol === "http:" && environment() !== "production")) throw new Error("ALERT_WEBHOOK_URL must be https:// in production");
      const response = await doFetch(target, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload), signal: AbortSignal.timeout(timeoutMs), redirect: "error" });
      if (!response.ok) throw new Error(`webhook answered HTTP ${response.status}`);
      delivered++;
      return true;
    } catch (error) {
      deliveryFailures++;
      lastDeliveryError = scrubText(error instanceof Error ? error.message : String(error)).slice(0, 160);
      if (now() - lastFailureLogAt > 10 * 60_000) { lastFailureLogAt = now(); log("warn", "alert.delivery_failed", { reason: lastDeliveryError, failures: deliveryFailures }); }
      return false;
    }
  }

  const body = (key: string, title: string, status: "firing" | "resolved", severity: Severity, extra: Record<string, unknown>) => ({
    text: `[StudyQuest${environment() ? `:${environment()}` : ""}] ${status === "resolved" ? "RESOLVED" : severity.toUpperCase()}: ${title}`,
    key, title, status, severity, environment: environment(), at: new Date(now()).toISOString(), runbook: `${RUNBOOK}#alert-${key.split(".")[0]}`, ...extra,
  });

  async function raise(key: string, title: string, details: Record<string, unknown> = {}, opts: { severity?: Severity; cooldownMs?: number } = {}) {
    try {
      const severity = opts.severity ?? "critical";
      const cooldown = opts.cooldownMs ?? cooldownDefault;
      const t = now();
      const st = states.get(key) ?? { firing: false, firstAt: t, lastSentAt: 0, occurrences: 0, suppressed: 0, title, severity };
      st.occurrences++; st.title = title; st.severity = severity;
      states.set(key, st);
      log(severity === "info" ? "warn" : "error", `alert.${key}`, { title, ...details, occurrences: st.occurrences });
      if (st.firing && t - st.lastSentAt < cooldown) { st.suppressed++; return false; } // deduplicated
      while (sent.length && t - sent[0] > windowMs) sent.shift();
      if (sent.length >= maxPerWindow) { stormSuppressed++; st.suppressed++; return false; } // alert storm
      if (deps.claim) {
        const mine = await deps.claim(key, Math.max(1, Math.round(cooldown / 1000))).catch(() => true);
        if (!mine) { st.suppressed++; st.firing = true; st.lastSentAt = t; return false; } // another instance already sent it
      }
      const extra = { occurrences: st.occurrences, suppressedSinceLast: st.suppressed, otherAlertsSuppressed: stormSuppressed, details: redact(details) };
      st.firing = true; st.lastSentAt = t; st.suppressed = 0; stormSuppressed = 0; sent.push(t);
      return await deliver(body(key, title, "firing", severity, extra));
    } catch {
      return false; // alerting must never break the caller
    }
  }

  /** Sends a recovery notice if `key` was firing. */
  async function resolve(key: string, details: Record<string, unknown> = {}, opts: { force?: boolean; title?: string; severity?: Severity } = {}) {
    try {
      let st = states.get(key);
      // `force` is for short-lived processes (backup jobs) that learn from persisted state that the alert was firing in an earlier run.
      if (!st?.firing && opts.force) st = { firing: true, firstAt: now(), lastSentAt: 0, occurrences: 0, suppressed: 0, title: opts.title ?? key, severity: opts.severity ?? "critical" };
      if (!st?.firing) { states.delete(key); return false; }
      states.delete(key);
      log("info", `alert.${key}.resolved`, { title: st.title });
      if (deps.claim && !(await deps.claim(`resolved:${key}`, 60).catch(() => true))) return false; // another instance sends the recovery notice
      return await deliver(body(key, st.title, "resolved", st.severity, { outageMs: now() - st.firstAt, occurrences: st.occurrences, details: redact(details) }));
    } catch {
      return false;
    }
  }

  /** Counts one failure for a rate-based alert (e.g. API errors); raises when `threshold` failures happen within `windowMs`. */
  async function recordFailure(key: string, opts: { title: string; threshold?: number; windowMs?: number; details?: Record<string, unknown> }) {
    try {
      const r = rates.get(key) ?? { times: [], threshold: opts.threshold ?? 10, windowMs: opts.windowMs ?? 5 * 60_000, title: opts.title };
      rates.set(key, r);
      const t = now();
      r.times.push(t);
      while (r.times.length && t - r.times[0] > r.windowMs) r.times.shift();
      if (r.times.length >= r.threshold) return await raise(key, r.title, { failuresInWindow: r.times.length, windowSeconds: Math.round(r.windowMs / 1000), ...(opts.details ?? {}) });
      return false;
    } catch {
      return false;
    }
  }

  /** Resolves rate alerts that have calmed down (call periodically: worker tick, readiness probe). */
  async function sweep() {
    const t = now();
    for (const [key, r] of rates) {
      while (r.times.length && t - r.times[0] > r.windowMs) r.times.shift();
      if (states.get(key)?.firing && r.times.length < Math.ceil(r.threshold / 2)) await resolve(key, { failuresInWindow: r.times.length });
    }
  }

  return {
    raise, resolve, recordFailure, sweep,
    isFiring: (key: string) => !!states.get(key)?.firing,
    stats: () => ({ delivered, deliveryFailures, lastDeliveryError, firing: [...states].filter(([, s]) => s.firing).map(([k]) => k) }),
  };
}

/** Shared (MongoDB) claim: false when another instance already sent this alert within the cooldown. Fails open on any error or slowness. */
async function sharedClaim(key: string, cooldownSec: number) {
  const race = Promise.race([
    (async () => { const { limitedShared } = await import("./security"); return !(await limitedShared(`alert:${key}`, 0, cooldownSec)); })(),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(true), 1500).unref?.()),
  ]);
  return race.catch(() => true);
}

export const alerts = createAlertManager({ claim: sharedClaim });

/** Wrapper for request paths: alert delivery is never awaited by business code. On Vercel it runs through after() so the invocation stays alive until it finishes. */
export function notify(promise: Promise<unknown>) { defer(promise, { label: "alert" }); }

/** POSTs to a dead-man's-switch / heartbeat URL (healthchecks-style). Never throws. */
export async function ping(url: string | undefined, opts: { fetch?: typeof fetch; timeoutMs?: number } = {}) {
  if (!url) return false;
  try {
    const r = await (opts.fetch ?? fetch)(url, { method: "POST", signal: AbortSignal.timeout(opts.timeoutMs ?? 8000), redirect: "error" });
    return r.ok;
  } catch (error) {
    log("warn", "heartbeat.failed", { reason: scrubText(error instanceof Error ? error.message : String(error)).slice(0, 120) });
    return false;
  }
}
