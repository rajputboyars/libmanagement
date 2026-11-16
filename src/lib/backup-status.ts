import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BackupStore } from "./backup-store";
import { listBackups } from "./backup-ops";

/**
 * Small status object kept NEXT TO the backups (never in the application database, which the backup job can only read).
 * It records the last successful backup, the last integrity check and whether an alert was left firing, so that short-lived jobs can send
 * recovery notices and operators can read the state with `npm run backup:status`.
 */
export const STATUS_OBJECT = "backup-status.json";
export type BackupStatus = {
  updatedAt: string;
  lastBackup?: { name: string; at: string; documents: number; collections: number; bytes: number; keyId: string; durationMs: number };
  lastCheck?: { at: string; ok: boolean; deep: boolean; problems: string[]; latestAgeHours?: number };
  failing?: { backup?: boolean; check?: boolean };
};

export async function readStatus(store: BackupStore): Promise<BackupStatus | null> {
  const dir = mkdtempSync(join(tmpdir(), "sq-status-"));
  try {
    if (!(await store.list()).some((o) => o.name === STATUS_OBJECT)) return null;
    await store.get(STATUS_OBJECT, join(dir, "s.json"));
    return JSON.parse(readFileSync(join(dir, "s.json"), "utf8")) as BackupStatus;
  } catch { return null; } finally { rmSync(dir, { recursive: true, force: true }); }
}
/** Best effort: a status write failure never fails a backup. Returns whether it was written. */
export async function writeStatus(store: BackupStore, patch: Partial<BackupStatus>, previous?: BackupStatus | null) {
  const dir = mkdtempSync(join(tmpdir(), "sq-status-"));
  try {
    const next: BackupStatus = { ...(previous ?? {}), ...patch, failing: { ...(previous?.failing ?? {}), ...(patch.failing ?? {}) }, updatedAt: new Date().toISOString() };
    writeFileSync(join(dir, "s.json"), JSON.stringify(next, null, 2));
    await store.put(STATUS_OBJECT, join(dir, "s.json"));
    return true;
  } catch { return false; } finally { rmSync(dir, { recursive: true, force: true }); }
}

export type StatusReport = { ok: boolean; now: string; lastSuccessfulBackupAt?: string; ageHours?: number; lastIntegrityCheck?: BackupStatus["lastCheck"]; completeBackups: number; problems: string[] };
/** Combines the status object with the real contents of the store (the store is the source of truth for backup age). */
export async function statusReport(store: BackupStore, opts: { now?: Date; maxAgeHours?: number } = {}): Promise<StatusReport> {
  const now = opts.now ?? new Date(), maxAge = opts.maxAgeHours ?? 26;
  const problems: string[] = [];
  const complete = (await listBackups(store)).filter((b) => b.complete);
  const status = await readStatus(store);
  const report: StatusReport = { ok: false, now: now.toISOString(), completeBackups: complete.length, problems, lastIntegrityCheck: status?.lastCheck };
  if (!complete.length) problems.push("No complete backup exists");
  else {
    report.lastSuccessfulBackupAt = complete[0].createdAt;
    report.ageHours = Math.round(((now.getTime() - new Date(complete[0].createdAt).getTime()) / 3600_000) * 10) / 10;
    if (report.ageHours > maxAge) problems.push(`Last successful backup is ${report.ageHours}h old (limit ${maxAge}h)`);
  }
  if (!status?.lastCheck) problems.push("No integrity check has been recorded yet");
  else {
    if (!status.lastCheck.ok) problems.push(`Last integrity check FAILED: ${status.lastCheck.problems.slice(0, 3).join("; ")}`);
    if (now.getTime() - new Date(status.lastCheck.at).getTime() > 8 * 86400_000) problems.push("Last integrity check is older than 8 days (the weekly deep check is not running)");
  }
  report.ok = problems.length === 0;
  return report;
}
