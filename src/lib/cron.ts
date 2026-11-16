import { log, scrubText } from "./log";

/**
 * One execution of the scheduled jobs (Vercel Cron -> GET /api/jobs/run). Dependencies are injected so the behaviour is unit-tested:
 *  - unauthorized callers get 401 and nothing runs; repeated attempts raise a rate alert;
 *  - a run that is skipped because another run holds the lock sends no heartbeat and no alert (that is how duplicate execution is prevented);
 *  - the SUCCESS heartbeat is sent only after every job finished without error;
 *  - any failed job or unexpected exception raises `cron.failed` through the alert manager, sends the failure heartbeat and answers HTTP 500
 *    (Vercel shows the cron run as failed); the next fully successful run sends one recovery notice.
 * Heartbeats and alerts are awaited here on purpose: nobody is waiting for a cron response, and finishing them before returning is the most
 * reliable way to complete them on a serverless host.
 */
export type CronDeps = {
  authorized: boolean;
  connect: () => Promise<unknown>;
  run: () => Promise<{ results: Record<string, unknown>; skipped?: string }>;
  ping: (url: string | undefined) => Promise<boolean>;
  alerts: {
    raise: (key: string, title: string, details?: Record<string, unknown>, opts?: { severity?: "info" | "warning" | "critical"; cooldownMs?: number }) => Promise<boolean>;
    resolve: (key: string, details?: Record<string, unknown>, opts?: { force?: boolean; title?: string }) => Promise<boolean>;
    recordFailure: (key: string, opts: { title: string; threshold?: number; windowMs?: number; details?: Record<string, unknown> }) => Promise<boolean>;
  };
  /** whether the previous scheduled run ended in failure (persisted), so a recovery notice can be sent by a fresh instance */
  previousRunFailed: () => Promise<boolean>;
  recordRun: (status: "ok" | "failed", detail?: string) => Promise<void>;
  env: Record<string, string | undefined>;
};

export const heartbeatUrls = (env: Record<string, string | undefined>) => {
  const ok = env.JOBS_HEARTBEAT_URL || env.WORKER_HEARTBEAT_URL;
  return { ok, fail: env.JOBS_HEARTBEAT_FAIL_URL || (ok ? `${ok.replace(/\/+$/, "")}/fail` : undefined) };
};

const failed = (results: Record<string, unknown>) => Object.entries(results).filter(([, v]) => !!v && typeof v === "object" && "error" in (v as object)).map(([name]) => name);

export async function executeCron(d: CronDeps): Promise<{ status: number; body: Record<string, unknown> }> {
  if (!d.authorized) {
    log("warn", "cron.unauthorized");
    await d.alerts.recordFailure("cron.unauthorized", { title: "Repeated unauthorized calls to the cron endpoint", threshold: 5, windowMs: 10 * 60_000, details: { hint: "CRON_SECRET mismatch after a change, or someone probing /api/jobs/run" } }).catch(() => false);
    return { status: 401, body: { error: "Unauthorized" } };
  }
  const urls = heartbeatUrls(d.env);
  const wasFailing = await d.previousRunFailed().catch(() => false);
  const fail = async (title: string, details: Record<string, unknown>, detail: string) => {
    await d.recordRun("failed", detail).catch(() => undefined);
    await d.alerts.raise("cron.failed", title, details, { severity: "critical", cooldownMs: 6 * 3600_000 });
    await d.ping(urls.fail);
  };
  try {
    await d.connect();
    const outcome = await d.run();
    if (outcome.skipped) { log("info", "cron.skipped", { reason: outcome.skipped }); return { status: 200, body: { ok: true, skipped: true } }; }
    const bad = failed(outcome.results);
    if (bad.length) {
      await fail("Scheduled jobs finished with failures", { failedJobs: bad, nextStep: "docs/MONITORING.md#alert-worker" }, `failed: ${bad.join(",")}`);
      return { status: 500, body: { ok: false, failed: bad } };
    }
    await d.recordRun("ok").catch(() => undefined);
    if (wasFailing) await d.alerts.resolve("cron.failed", {}, { force: true, title: "Scheduled jobs finished with failures" });
    await d.ping(urls.ok); // only now: every job completed without error
    return { status: 200, body: { ok: true, result: outcome } };
  } catch (error) {
    const message = scrubText(error instanceof Error ? error.message : String(error)).slice(0, 200);
    log("error", "cron.exception", { message });
    await fail("Scheduled jobs could not run", { message, nextStep: "docs/MONITORING.md#alert-worker" }, `exception: ${message}`).catch(() => undefined);
    return { status: 500, body: { ok: false, error: "Scheduled jobs failed" } };
  }
}
