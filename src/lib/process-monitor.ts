import { alerts } from "./alerts";
import { log, serializeError } from "./log";

declare global { var __sqProcessHandlers: boolean | undefined }

/**
 * Last-resort capture of crashes and rejected promises. An uncaught exception is logged, alerted (bounded wait) and the process exits with
 * code 1 exactly as Node would, so the supervisor restarts it. Unhandled rejections are logged and alerted but do not stop the process.
 * Installed in production (or when MONITOR_PROCESS_HANDLERS=1); development keeps Node's default behaviour.
 */
export function installProcessHandlers(name: string) {
  if (globalThis.__sqProcessHandlers) return false;
  if (process.env.NODE_ENV !== "production" && process.env.MONITOR_PROCESS_HANDLERS !== "1") return false;
  globalThis.__sqProcessHandlers = true;
  process.on("unhandledRejection", (reason) => {
    log("error", "process.unhandled_rejection", { process: name, error: serializeError(reason) });
    void alerts.raise("process.unhandled_rejection", `Unhandled promise rejection in ${name}`, { process: name, error: serializeError(reason).message }, { severity: "warning", cooldownMs: 15 * 60_000 }).catch(() => undefined);
  });
  process.on("uncaughtException", (error) => {
    log("error", "process.crash", { process: name, error: serializeError(error) });
    const done = () => process.exit(1);
    Promise.race([alerts.raise("process.crash", `${name} crashed and is restarting`, { process: name, error: serializeError(error).message }, { severity: "critical", cooldownMs: 60_000 }), new Promise((r) => setTimeout(r, 3000))]).then(done, done);
  });
  return true;
}
