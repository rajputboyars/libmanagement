import { alerts, notify } from "./alerts";
import { log, serializeError } from "./log";

const reported = new WeakSet<object>();

/**
 * Separates unexpected failures (database outages, programming errors) from ordinary business errors (validation, plan limits, permissions,
 * "seat already taken"), which routes deliberately turn into 4xx messages and must not page anyone.
 */
export function isUnexpected(error: unknown): boolean {
  if (!(error instanceof Error)) return true;
  const e = error as Error & { code?: unknown; errorLabels?: string[] };
  if (["ZodError", "PlanError", "AccessError", "CastError", "ValidationError", "ValidatorError", "VersionError", "DocumentNotFoundError"].includes(e.name)) return false;
  if (e.name === "MongoServerError") return e.code !== 11000 && !(e.errorLabels ?? []).includes("TransientTransactionError");
  if (/^Mongo\w*(Network|Topology|ServerSelection|Timeout|Pool|Parse)\w*Error$|^Mongoose\w*(ServerSelection|Network)\w*Error$/.test(e.name)) return true;
  if (/buffering timed out|ECONNREFUSED|ETIMEDOUT|ECONNRESET|server selection timed out/i.test(e.message)) return true;
  return ["TypeError", "ReferenceError", "RangeError", "SyntaxError", "EvalError"].includes(e.name);
}
const isDatabaseFailure = (e: unknown) => e instanceof Error && (/^Mongo/.test(e.name) || /^Mongoose\w*(ServerSelection|Network)/.test(e.name) || /buffering timed out|server selection timed out|ECONNREFUSED/i.test(e.message));

/**
 * Called from API route catch blocks. Logs unexpected errors (scrubbed, with request id), counts them toward the error-rate alert and
 * raises a deduplicated alert. Synchronous for the caller: delivery is fire-and-forget and can never delay or break the response.
 */
export function reportUnexpected(error: unknown, route: string) {
  try {
    if (typeof error === "object" && error) { if (reported.has(error)) return; reported.add(error); }
    if (!isUnexpected(error)) return;
    const info = serializeError(error);
    log("error", "api.unexpected_error", { route, error: info });
    notify(alerts.raise(`api.unexpected.${route}`, `Unexpected error in ${route}`, { route, name: info.name, message: info.message }, { severity: "warning", cooldownMs: 30 * 60_000 }));
    notify(alerts.recordFailure("api.error-rate", { title: "API error rate is high", threshold: Number(process.env.ALERT_API_ERRORS_PER_5MIN || 10), details: { lastRoute: route } }));
    if (isDatabaseFailure(error)) notify(alerts.raise("db.unavailable", "Database is unreachable from the application", { route }, { severity: "critical" }));
  } catch {
    // never let monitoring break the request
  }
}

/** Records the outcome of a database probe (readiness, worker tick): raises on failure and sends a recovery notice when it returns. */
export function reportDatabase(ok: boolean, detail?: string) {
  try {
    if (ok) notify(alerts.resolve("db.unavailable"));
    else notify(alerts.raise("db.unavailable", "Database is unreachable from the application", { detail }, { severity: "critical" }));
  } catch { /* ignore */ }
}
