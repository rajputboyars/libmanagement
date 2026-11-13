// Encrypted backups to off-site storage, integrity checks, retention and verified restores.  See docs/BACKUP_RESTORE.md.
//   npm run backup:run                                  take, encrypt and upload a backup (+ --prune to apply retention)
//   npm run backup:check [-- --deep]                    fail loudly when backups are missing, stale, incomplete or corrupted
//   npm run backup:list | backup:prune
//   RESTORE_TARGET_URI=<NEW empty db uri> npm run backup:restore -- --environment staging [--archive <name>] [--confirm "<db>@<host>"]
// BACKUP_PROTECTED_TARGETS: extra databases never to restore into, separated by ";" (URIs or host1,host2/db).
// Source: BACKUP_SOURCE_URI (preferred: a read-only database user) or MONGODB_URI. Restore NEVER uses MONGODB_URI as the target,
// refuses the live database, refuses non-empty targets, and without --confirm only verifies the archive (dry run).
import { alert, log } from "../src/lib/log";
import { scrubSecrets } from "../src/lib/backup";
import { parseKeyRing } from "../src/lib/backup-crypto";
import { storeFromEnv } from "../src/lib/backup-store";
import { DEFAULT_RETENTION, checkBackups, listBackups, pruneBackups, restoreFromStore, runBackup } from "../src/lib/backup-ops";

const arg = (name: string) => { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : undefined; };
const flag = (name: string) => process.argv.includes(`--${name}`);
const num = (v: string | undefined, d: number) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : d; };
const policy = () => ({ keepDays: num(process.env.BACKUP_RETENTION_DAYS, DEFAULT_RETENTION.keepDays), keepMonthly: num(process.env.BACKUP_RETENTION_MONTHS, DEFAULT_RETENTION.keepMonthly), keepMinimum: DEFAULT_RETENTION.keepMinimum });

async function main() {
  const mode = process.argv[2];
  if (mode === "run") {
    const uri = process.env.BACKUP_SOURCE_URI || process.env.MONGODB_URI;
    if (!uri) throw new Error("Set BACKUP_SOURCE_URI (read-only user, preferred) or MONGODB_URI");
    const store = storeFromEnv(), ring = parseKeyRing(process.env.BACKUP_ENCRYPTION_KEYS);
    const r = await runBackup({ uri, store, ring });
    log("info", "backup.completed", { name: r.name, documents: r.sidecar.documents, collections: r.sidecar.collections, bytes: r.sidecar.size, keyId: r.sidecar.keyId, ms: r.sidecar.durationMs });
    console.log(`Backup ${r.name} stored in ${store.label}: ${r.sidecar.collections} collections, ${r.sidecar.documents} documents, ${r.sidecar.size} bytes (encrypted, key ${r.sidecar.keyId}).`);
    if (flag("prune")) { const p = await pruneBackups({ store, policy: policy() }); console.log(`Retention: kept ${p.kept.length}, removed ${p.removed.length}.`); }
    const c = await checkBackups({ store });
    if (!c.ok) throw new Error(`Post-backup check failed: ${c.problems.join("; ")}`);
  } else if (mode === "check") {
    const store = storeFromEnv();
    const deep = flag("deep") ? { ring: parseKeyRing(process.env.BACKUP_ENCRYPTION_KEYS) } : undefined;
    const r = await checkBackups({ store, deep, maxAgeHours: num(arg("max-age-hours") ?? process.env.BACKUP_MAX_AGE_HOURS, 26), minCount: num(process.env.BACKUP_MIN_COUNT, 1) });
    console.log(JSON.stringify(r, null, 2));
    if (!r.ok) { log("error", "backup.check_failed", { problems: r.problems }); await alert("backup.check_failed", { problems: r.problems }); process.exitCode = 1; }
    else log("info", "backup.check_ok", { latest: r.latest, backups: r.backups, deep: r.deep });
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
  } else throw new Error("Usage: run [--prune] | check [--deep] | list | prune | restore");
}
main().then(() => process.exit(process.exitCode ?? 0)).catch(async (e) => {
  const message = scrubSecrets(e instanceof Error ? e.message : String(e));
  console.error(message);
  if (process.argv[2] === "run") { log("error", "backup.failed", { message }); await alert("backup.failed", { message }); }
  process.exit(1);
});
