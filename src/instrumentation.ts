import { checkEnv } from "./lib/env";

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { log } = await import("./lib/log");
  const { alerts, notify } = await import("./lib/alerts");
  const { installProcessHandlers } = await import("./lib/process-monitor");
  installProcessHandlers("web");
  const issues = checkEnv();
  for (const i of issues) log(i.level === "error" ? "error" : "warn", "config.issue", { key: i.key, message: i.message });
  const errors = issues.filter((i) => i.level === "error");
  if (process.env.NODE_ENV === "production" && errors.length) {
    log("error", "config.invalid", { count: errors.length });
    notify(alerts.raise("config.invalid", "Production configuration is invalid", { keys: errors.map((e) => e.key) }, { severity: "critical", cooldownMs: 60 * 60_000 }));
  }
  log("info", "server.started");
}

/** Called by Next for every uncaught server error in routes, actions and rendering. Never throws, never delays the response. */
export async function onRequestError(error: unknown, request: { path: string; method: string; headers: Record<string, string | string[] | undefined> }, context: { routePath: string; routeType: string }) {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
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
