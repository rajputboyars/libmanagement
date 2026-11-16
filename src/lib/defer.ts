import { after } from "next/server";
import { log, serializeError } from "./log";

/**
 * Post-response work that must still finish on a serverless host.
 *
 * On Vercel a function can be frozen as soon as the response is sent, so a bare "fire and forget" promise (an alert, a push notification,
 * an index build) may never complete. `after()` from Next.js keeps the invocation alive (via the platform's waitUntil) until the work settles
 * without delaying the response. Outside a request scope (scripts, the worker, start-up hooks, tests) `after()` throws; there the work simply
 * starts immediately and runs on the long-lived process.
 *
 * Failures inside the deferred work are always caught: they are logged (scrubbed) as `deferred.failed` with the label, and, unless
 * `report: false`, counted through `onFailure` (default: none) so callers can raise an alert. Nothing here can throw into the caller.
 */
export type Scheduler = (callback: () => Promise<void>) => void;
const nextAfter: Scheduler = (callback) => after(callback);

export type DeferOptions = { label: string; /** called with the error after it was logged; must not throw */ onFailure?: (error: unknown) => void };

export function defer(work: Promise<unknown> | (() => Promise<unknown>), opts: DeferOptions, scheduler: Scheduler = nextAfter) {
  // A function is started lazily inside the scheduled callback; a promise is already running (the caller started it), and `after` keeps it alive.
  // An already-running promise could reject before the scheduled callback awaits it: mark it handled now (the callback still observes the failure).
  if (typeof work !== "function") work.catch(() => undefined);
  const run = async () => {
    try {
      await (typeof work === "function" ? work() : work);
    } catch (error) {
      log("error", "deferred.failed", { label: opts.label, error: serializeError(error) });
      try { opts.onFailure?.(error); } catch { /* reporting must never throw */ }
    }
  };
  try {
    scheduler(run);
  } catch {
    // Not inside a request scope: run now on the long-lived process.
    void run();
  }
}
