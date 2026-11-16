import { checkEnv } from "./lib/env";

/**
 * Node.js-only start-up work. It lives in its own module so that `instrumentation.ts` (which Next.js also compiles for the Edge runtime)
 * never references Node-only APIs such as `process.exit`: the Edge bundle drops the dynamic import behind the `NEXT_RUNTIME` check.
 */
export async function registerNode(opts: { exit?: (code: number) => void } = {}) {
  const exit = opts.exit ?? ((code: number) => process.exit(code));
  const { log } = await import("./lib/log");
  const { alerts, notify } = await import("./lib/alerts");
  const { installProcessHandlers } = await import("./lib/process-monitor");
  installProcessHandlers("web");
  // Fail safe: with an explicit APP_ENV profile (or a Vercel environment mismatch), a deployment with configuration errors refuses to start instead of serving traffic.
  const { mustRefuseToStart } = await import("./lib/env-profile");
  const gate = mustRefuseToStart(process.env, "web");
  if (gate.refuse) {
    const errors = gate.problems.filter((p) => p.level === "error");
    for (const p of errors) log("error", "config.refused", { key: p.key, message: p.message });
    log("error", "server.refused_to_start", { profile: process.env.APP_ENV, errors: errors.length });
    await Promise.race([alerts.raise("config.refused", "Deployment refused to start: invalid configuration", { profile: process.env.APP_ENV, keys: errors.map((e) => e.key) }, { severity: "critical" }), new Promise((r) => setTimeout(r, 3000))]);
    exit(1);
    return;
  }
  if (process.env.NODE_ENV === "production" && !process.env.APP_ENV) log("warn", "config.app_env_missing", { note: "Set APP_ENV=staging or production to enable the deployment profile checks" });
  const issues = checkEnv();
  for (const i of issues) log(i.level === "error" ? "error" : "warn", "config.issue", { key: i.key, message: i.message });
  const errors = issues.filter((i) => i.level === "error");
  if (process.env.NODE_ENV === "production" && errors.length) {
    log("error", "config.invalid", { count: errors.length });
    notify(alerts.raise("config.invalid", "Production configuration is invalid", { keys: errors.map((e) => e.key) }, { severity: "critical", cooldownMs: 60 * 60_000 }));
  }
  log("info", "server.started");
}

export async function reportRequestError(error: unknown, request: { path: string; method: string; headers: Record<string, string | string[] | undefined> }, context: { routePath: string; routeType: string }) {
  try {
    const { log, serializeError } = await import("./lib/log");
    const { reportUnexpected } = await import("./lib/api-errors");
    const info = serializeError(error);
    if (/NEXT_NOT_FOUND|NEXT_REDIRECT/.test(info.message)) return;
    const requestId = String(request.headers["x-request-id"] ?? "");
    log("error", "request.error", { path: request.path.split("?")[0], method: request.method, route: context.routePath, type: context.routeType, error: info, requestId });
    // Uncaught means unexpected by definition, whatever the error type.
    reportUnexpected(error instanceof Error ? Object.assign(error, { name: error.name === "Error" ? "TypeError" : error.name }) : new TypeError(info.message), context.routePath);
  } catch {
    // monitoring must never break request handling
  }
}
