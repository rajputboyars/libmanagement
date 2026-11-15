// Encrypted backups to off-site storage, integrity checks, retention, monitoring status and verified restores.  See docs/BACKUP_RESTORE.md.
//   npm run backup:run                                  take, encrypt and upload a backup (+ --prune to apply retention)
//   npm run backup:check [-- --deep]                    fail loudly when backups are missing, stale, incomplete or corrupted
//   npm run backup:status                               last successful backup, last integrity check; exit 1 when unhealthy
//   npm run backup:list | backup:prune
//   RESTORE_TARGET_URI=<NEW empty db uri> npm run backup:restore -- --environment staging [--archive <name>] [--confirm "<db>@<host>"]
// Monitoring: failures and stale/corrupted backups raise a deduplicated alert (ALERT_WEBHOOK_URL) and a recovery notice follows the next
// success. BACKUP_HEARTBEAT_URL / BACKUP_CHECK_HEARTBEAT_URL are pinged after each success (and "<url>/fail" after a failure) so that an
// external dead-man's-switch notices when the scheduled job simply STOPS RUNNING.
// BACKUP_PROTECTED_TARGETS: extra databases never to restore into, separated by ";" (URIs or host1,host2/db).
// Source: BACKUP_SOURCE_URI (preferred: a read-only database user) or MONGODB_URI. Restore NEVER uses MONGODB_URI as the target,
// refuses the live database, refuses non-empty targets, and without --confirm only verifies the archive (dry run).
import { alerts, ping } from "../src/lib/alerts";
import { log } from "../src/lib/log";
import { scrubSecrets } from "../src/lib/backup";
import { parseKeyRing } from "../src/lib/backup-crypto";
import { storeFromEnv } from "../src/lib/backup-store";
import { DEFAULT_RETENTION, checkBackups, listBackups, pruneBackups, restoreFromStore, runBackup } from "../src/lib/backup-ops";
import { readStatus, statusReport, writeStatus } from "../src/lib/backup-status";

const arg = (name: string) => { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : undefined; };
const flag = (name: string) => process.argv.includes(`--${name}`);
const num = (v: string | undefined, d: number) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : d; };
const policy = () => ({ keepDays: num(process.env.BACKUP_RETENTION_DAYS, DEFAULT_RETENTION.keepDays), keepMonthly: num(process.env.BACKUP_RETENTION_MONTHS, DEFAULT_RETENTION.keepMonthly), keepMinimum: DEFAULT_RETENTION.keepMinimum });
const failUrl = (url: string | undefined, explicit: string | undefined) => explicit || (url ? `${url.replace(/\/+$/, "")}/fail` : undefined);

async function main() {
  const mode = process.argv[2];
  if (mode === "run") {
    const uri = process.env.BACKUP_SOURCE_URI || process.env.MONGODB_URI;
    if (!uri) throw new Error("Set BACKUP_SOURCE_URI (read-only user, preferred) or MONGODB_URI");
    const store = storeFromEnv(), ring = parseKeyRing(process.env.BACKUP_ENCRYPTION_KEYS);
    const previous = await readStatus(store);
    let r;
    try { r = await runBackup({ uri, store, ring }); }
    catch (e) {
      const message = scrubSecrets(e instanceof Error ? e.message : String(e));
      log("error", "backup.failed", { message });
      await alerts.raise("backup.failed", "Database backup FAILED", { message, nextStep: "docs/MONITORING.md#alert-backup" });
      await writeStatus(store, { failing: { backup: true } }, previous);
      await ping(failUrl(process.env.BACKUP_HEARTBEAT_URL, process.env.BACKUP_HEARTBEAT_FAIL_URL));
      throw e;
    }
    log("info", "backup.completed", { name: r.name, documents: r.sidecar.documents, collections: r.sidecar.collections, bytes: r.sidecar.size, keyId: r.sidecar.keyId, ms: r.sidecar.durationMs });
    console.log(`Backup ${r.name} stored in ${store.label}: ${r.sidecar.collections} collections, ${r.sidecar.documents} documents, ${r.sidecar.size} bytes (encrypted, key ${r.sidecar.keyId}).`);
    await writeStatus(store, { lastBackup: { name: r.name, at: r.sidecar.createdAt, documents: r.sidecar.documents, collections: r.sidecar.collections, bytes: r.sidecar.size, keyId: r.sidecar.keyId, durationMs: r.sidecar.durationMs }, failing: { backup: false } }, previous);
    if (previous?.failing?.backup) await alerts.resolve("backup.failed", { name: r.name }, { force: true, title: "Database backup FAILED" });
    if (flag("prune")) { const p = await pruneBackups({ store, policy: policy() }); console.log(`Retention: kept ${p.kept.length}, removed ${p.removed.length}.`); }
    const c = await checkBackups({ store });
    if (!c.ok) throw new Error(`Post-backup check failed: ${c.problems.join("; ")}`);
    await ping(process.env.BACKUP_HEARTBEAT_URL);
  } else if (mode === "check") {
    const store = storeFromEnv();
    const deep = flag("deep");
    const previous = await readStatus(store);
    const r = await checkBackups({ store, deep: deep ? { ring: parseKeyRing(process.env.BACKUP_ENCRYPTION_KEYS) } : undefined, maxAgeHours: num(arg("max-age-hours") ?? process.env.BACKUP_MAX_AGE_HOURS, 26), minCount: num(process.env.BACKUP_MIN_COUNT, 1) });
    console.log(JSON.stringify(r, null, 2));
    await writeStatus(store, { lastCheck: { at: r.checkedAt, ok: r.ok, deep, problems: r.problems.slice(0, 10), latestAgeHours: r.latest?.ageHours }, failing: { check: !r.ok } }, previous);
    if (!r.ok) {
      const stale = r.problems.some((p) => /stale|No backups exist/.test(p));
      log("error", "backup.check_failed", { problems: r.problems });
      await alerts.raise(stale ? "backup.stale" : "backup.check_failed", stale ? "Backups are missing or STALE" : "Backup integrity check FAILED", { problems: r.problems, latest: r.latest, deep });
      await ping(failUrl(process.env.BACKUP_CHECK_HEARTBEAT_URL, process.env.BACKUP_CHECK_HEARTBEAT_FAIL_URL));
      process.exitCode = 1;
    } else {
      log("info", "backup.check_ok", { latest: r.latest, backups: r.backups, deep: r.deep });
      if (previous?.failing?.check) { await alerts.resolve("backup.check_failed", { latest: r.latest }, { force: true, title: "Backup integrity check FAILED" }); await alerts.resolve("backup.stale", { latest: r.latest }, { force: true, title: "Backups are missing or STALE" }); }
      await ping(process.env.BACKUP_CHECK_HEARTBEAT_URL);
    }
  } else if (mode === "status") {
    const r = await statusReport(storeFromEnv(), { maxAgeHours: num(arg("max-age-hours") ?? process.env.BACKUP_MAX_AGE_HOURS, 26) });
    console.log(JSON.stringify(r, null, 2));
    if (!r.ok) process.exitCode = 1;
  } else if (mode === "list") {
    console.table(await listBackups(storeFromEnv()));
  } else if (mode === "prune") {
    const p = await pruneBackups({ store: storeFromEnv(), policy: policy() });
    console.log(`Kept ${p.kept.length}, removed ${p.removed.length}`);
  } else if (mode === "restore") {
    const targetUri = process.env.RESTORE_TARGET_URI || arg("target-uri");
    const environment = arg("environment");
    if (!targetUri || !environment) throw new Error('Usage: RESTORE_TARGET_URI=<new empty database uri> restore --environment <staging|qa|drill|recovery> [--archive <name>] [--confirm "<db>@<host>"]');
    const r = await restoreFromStore({ store: storeFromEnv(), ring: parseKeyRing(process.env.BACKUP_ENCRYPTION_KEYS), archive: arg("archive") && arg("archive") !== "latest" ? arg("archive") : undefined, targetUri, environment, confirm: arg("confirm"), protectedUris: [process.env.MONGODB_URI, process.env.BACKUP_SOURCE_URI, process.env.BACKUP_PROTECTED_TARGETS] });
    console.log(JSON.stringify(r, null, 2));
    console.log(r.ok ? (r.dryRun ? "DRY RUN OK: archive decrypts and verifies. Nothing was restored." : `RESTORE VERIFIED into ${r.target}: counts, indexes, tenant counts and relationships match the backup.`) : "RESTORE FAILED: see problems. Do not use the target database; drop it and start again.");
    if (!r.ok) process.exitCode = 1;
  } else throw new Error("Usage: run [--prune] | check [--deep] | status | list | prune | restore");
}
main().then(() => process.exit(process.exitCode ?? 0)).catch(async (e) => {
  console.error(scrubSecrets(e instanceof Error ? e.message : String(e)));
  process.exit(1);
});
