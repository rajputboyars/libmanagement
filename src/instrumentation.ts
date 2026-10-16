import { checkEnv } from "./lib/env";

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { log } = await import("./lib/log");
  const issues = checkEnv();
  for (const i of issues) log(i.level === "error" ? "error" : "warn", "config.issue", { key: i.key, message: i.message });
  if (process.env.NODE_ENV === "production" && issues.some((i) => i.level === "error")) log("error", "config.invalid", { count: issues.filter((i) => i.level === "error").length });
  log("info", "server.started");
}

/** Called by Next for every uncaught server error in routes, actions and rendering. */
export async function onRequestError(error: unknown, request: { path: string; method: string; headers: Record<string, string | string[] | undefined> }, context: { routePath: string; routeType: string }) {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { alert, log } = await import("./lib/log");
  const err = error as { message?: string; digest?: string; name?: string };
  const requestId = String(request.headers["x-request-id"] ?? "");
  log("error", "request.error", { path: request.path, method: request.method, route: context.routePath, type: context.routeType, name: err.name, message: err.message, digest: err.digest, requestId });
  if (!/NEXT_NOT_FOUND|NEXT_REDIRECT/.test(String(err.message))) await alert("request.error", { route: context.routePath, message: err.message });
}
