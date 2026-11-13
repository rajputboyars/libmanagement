# Backup, restore and recovery

> **Status: implemented and drilled on a disposable database; NOT yet running in production.** No production backup exists, no object-storage
> bucket or encryption key has been created, and nothing here has been run against the real database. Do not treat backups as complete until the
> "Go-live checklist" at the bottom is ticked and a restore from the *real* backup into staging has been recorded.

## Infrastructure found (what this design is based on)

- Database: **MongoDB Atlas** (`mongodb+srv://…mongodb.net` in the local and production env files; only variable *names* and the host type were inspected, no credentials were read or used). Which Atlas tier is used is **unknown**.
- App hosting: container image (`Dockerfile`, `web` and `worker` targets) and a Vercel cron definition. No cloud CLI, `mongodump`, object storage or secret manager is configured in this repository or on the build machine.
- Existing before R10: an unencrypted, directory-only logical backup/restore helper (kept as a library) and a drill test.

## Strategy (two layers)

| Layer | What | Status |
|---|---|---|
| **1. Atlas Cloud Backup (primary)** | Managed snapshots with continuous point-in-time recovery, encrypted at rest by Atlas, retained per policy | **Not verified: needs Atlas project access.** Cloud Backup is not available on the free/shared tiers (check your tier in Atlas); it needs a dedicated cluster (M10 or larger). If the cluster cannot have it, layer 2 is the only backup. |
| **2. Encrypted logical backups to off-site object storage (implemented)** | Consistent logical dump of every collection, client-side AES-256-GCM encryption, upload to S3-compatible storage (AWS S3, Cloudflare R2, Backblaze B2, MinIO), sidecar summary, retention, health checks | **Implemented and tested; not configured in production.** |

Layer 2 is a *logical* dump taken while the database is live, so it is not point-in-time consistent across collections (writes during the dump may be split across it). It is the portable, verifiable, independent copy; layer 1 is what gives the 15-minute RPO. Without layer 1 the RPO equals the backup interval (24 hours with the daily schedule).

## Backup (layer 2)

`npm run backup:run [-- --prune]` (`scripts/backup.ts`):

1. Dumps every collection (read-only; Extended JSON keeps ObjectIds and dates exact) into a private temporary directory.
2. Verifies the dump locally (checksums), refuses to publish an **empty** database (wrong connection string or an emptied database).
3. Packs and **encrypts** it (AES-256-GCM, authenticated header, random IV) into one file `studyquest-<db>-<UTC timestamp>.sqbak`.
4. Uploads it, **confirms the stored object's size**, then writes the sidecar `….sqbak.json` last (counts and sizes only, no customer data). An archive without a sidecar is "incomplete".
5. Wipes the plaintext temporary directory (also on failure), then runs a post-backup check. Any failure exits non-zero, logs `backup.failed` and posts to `ALERT_WEBHOOK_URL`.

The plaintext exists only in the temporary directory while a run is in progress (`BACKUP_TMP_DIR`, default the OS temp directory, mode 0700). Run backups on a host you control; encrypted disk is recommended.

### Schedule and retention

- Daily at 02:00 IST (`.github/workflows/backup.yml`), plus a weekly deep check. **The workflow is inactive until its secrets exist.**
- Retention (`npm run backup:prune`, also `--prune` on `backup:run`): every backup for 35 days, the newest backup of each of the last 12 months, and never fewer than the newest 3. Configure with `BACKUP_RETENTION_DAYS` and `BACKUP_RETENTION_MONTHS`. Incomplete backups are never counted and never deleted automatically (the health check reports them).
- Prefer a bucket lifecycle rule for expiry when your provider supports it, and keep the app credentials from being able to delete (see permissions).

### Where it runs (important)

GitHub-hosted runners have changing IP addresses and Atlas blocks unknown addresses. Choose one:
(a) run `npm run backup:run` from a fixed-IP host (your worker VM or a self-hosted runner) whose address is on the Atlas **IP access list** and call it from cron, or
(b) allow GitHub's runner ranges in Atlas (broad, not recommended). The workflow in the repository is the template for (a) with a self-hosted runner: set `runs-on` accordingly.

## Storage, encryption and keys

- **Destination:** S3-compatible bucket in a *different account/provider or at least a different failure domain* from the database. Enable **bucket versioning and object lock/retention** where available (ransomware and accidental-deletion protection) and a lifecycle rule for old versions. Local disk of the application host is **not** a backup destination; `BACKUP_DIR` exists only for a mounted off-site volume and for drills.
- **Encryption:** client-side AES-256-GCM before upload, so the provider never sees plaintext. The key ring is `BACKUP_ENCRYPTION_KEYS="id1:<base64 32 bytes>,id2:…"`. The **first** key encrypts new backups; **all** listed keys decrypt (rotation: prepend a new key, keep old ones until their backups expire). Generate: `node -e "console.log('k1:'+require('crypto').randomBytes(32).toString('base64'))"`.
- **Key custody:** store the key ring in the secret manager **and** an offline copy held by two named people. **Losing the key makes every backup unreadable.** The key is independent of `SESSION_SECRET` and `TWO_FACTOR_KEY`.
- **No public exposure:** backups live only in the bucket; the application has no route that serves them, and the app's runtime environment does not need any backup variable. Do not give the web/worker processes the backup credentials.

## Environment variables and permissions

| Variable | Used by | Notes |
|---|---|---|
| `BACKUP_SOURCE_URI` (or `MONGODB_URI`) | backup | Use a dedicated **read-only** Atlas database user (role `read` on the application database). |
| `BACKUP_ENCRYPTION_KEYS` | backup, check --deep, restore | See above. |
| `BACKUP_S3_BUCKET`, `BACKUP_S3_REGION`, `BACKUP_S3_ACCESS_KEY_ID`, `BACKUP_S3_SECRET_ACCESS_KEY` | all | Optional `BACKUP_S3_ENDPOINT` (R2/B2/MinIO) and `BACKUP_S3_PREFIX` (default `studyquest/`). |
| `BACKUP_DIR` | all | Mounted off-site volume or drills only. Ignored when `BACKUP_S3_BUCKET` is set. |
| `BACKUP_RETENTION_DAYS`, `BACKUP_RETENTION_MONTHS`, `BACKUP_MAX_AGE_HOURS` (default 26), `BACKUP_MIN_COUNT` | prune/check | |
| `RESTORE_TARGET_URI` | restore | The **new, empty** database to restore into (preferred over `--target-uri`, which shows in process lists). |
| `BACKUP_PROTECTED_TARGETS` | restore | Extra databases never to restore into, separated by `;` (URIs or `host1,host2/db`). `MONGODB_URI` and `BACKUP_SOURCE_URI` are always protected. |
| `ALERT_WEBHOOK_URL` | run, check | Failure/stale alerts (existing alert channel). |

Least privilege: the **backup job** needs read on the database and `PutObject` + `ListBucket` (+ `GetObject` for checks) on the bucket; only the **retention job** needs `DeleteObject`. The **restore operator** needs `GetObject`/`ListBucket`, the key ring, and `readWrite` on the *target* database only. Nobody should hold production write credentials to run a restore drill.

## Health checks and alerts

`npm run backup:check [-- --deep]` exits non-zero and alerts when: no backup exists, the newest is older than 26 hours (stale), an archive has no sidecar after an hour (incomplete), a sidecar has no archive (missing), the stored size differs from the recorded size (truncated/corrupted), too few complete backups exist, or (with `--deep`) the newest archive cannot be downloaded, **decrypted (GCM authentication)** or fails its collection checksums. A warning is raised if the newest backup has fewer than half the previous documents. Run the quick check daily and the deep check weekly (`backup.yml`). **No alert destination exists yet**, so alerts are unverified until `ALERT_WEBHOOK_URL` is configured (see MONITORING.md).

## Restore runbook

Never restore over the live database. The tool enforces this: the target must be a **new, empty database** with an explicit name, must not match `MONGODB_URI`/`BACKUP_SOURCE_URI`/`BACKUP_PROTECTED_TARGETS` (same host and database, credentials and case ignored), and the environment must be declared.

1. Declare the incident or drill, freeze writes if this is a real recovery (maintenance page, stop workers), and note the start time.
2. Create the **new empty** database/cluster (staging, QA or a recovery cluster) and a user with `readWrite` on it.
3. List backups: `npm run backup:list`. Choose one (default: newest complete).
4. **Dry run** (downloads, decrypts, authenticates and checksum-verifies; writes nothing):
   ```bash
   RESTORE_TARGET_URI="<new empty database uri>" npm run backup:restore -- --environment staging
   ```
   It prints the exact confirmation string, e.g. `--confirm "restore_check@cluster1.example.mongodb.net"`.
5. **Restore** with the confirmation (`--environment` is one of `staging`, `qa`, `drill`, `recovery`; use `recovery` only for a new database that will become production):
   ```bash
   RESTORE_TARGET_URI="<new empty database uri>" npm run backup:restore -- --environment staging --archive <name> --confirm "<db>@<host>"
   ```
6. The tool **verifies the result and only then reports success**: every collection present with the exact document count; every index rebuilt (indexes are created before the data so unique constraints are enforced; TTL indexes are created last, after verification, so they cannot purge documents mid-check); **per-library (tenant) document counts identical** to the backup; referential relationships (membership→library/student, payment→membership **in the same library**, seat assignment→membership/seat, seat→library, library→owner, organisation members) reproduce the source exactly with **zero cross-tenant references**. Any mismatch prints `RESTORE FAILED`, exits 1 and the target must be dropped and the restore repeated.
7. Application checks on staging pointed at the restored database: sign in as an owner and a student; run the reconciliation view (`GET /api/pilot-import`) for one library; sample three students' memberships, payments and XP.
8. **Recovery only:** switch production `MONGODB_URI` to the verified database, restart web and worker, watch `/api/ready`, re-run billing webhook retries (idempotent), re-enrol nothing (two-step data is restored). Record actual RPO and RTO.

### Restore limitations and manual steps

- A logical restore loses everything written after the backup (RPO = backup age). Atlas continuous backup (layer 1) is what narrows this.
- Restores are not incremental and are single-threaded; time grows with data size (measure on your real data).
- A failed restore leaves a partial database; drop it. The tool never retries into a non-empty target.
- Sessions issued before the incident stay valid only if their session versions match the restored users.
- Secrets (`SESSION_SECRET`, `TWO_FACTOR_KEY`, billing keys, the backup key ring) are **not** in the database and must be recoverable from the secret manager; losing `TWO_FACTOR_KEY` makes restored authenticators unusable (operators reset them with `npm run reset-2fa`).

## Restore drill

`npm run backup:drill` starts a disposable in-memory MongoDB replica set, seeds multi-tenant data through the real models, then runs the real CLI end to end: backup → deep check → dry run → confirmed restore → independent per-tenant comparison (students, payment counts and sums, no cross-tenant payment references). It never reads `.env` files or touches any configured database. Run it after changes to the backup code; run the same procedure against the real backup in staging quarterly and record date, backup used, duration, result and operator.

### Evidence

- **Automated tests (every CI run):** `tests/backup-ops.test.ts` (encryption, tamper/truncation/wrong-key, key rotation, path-traversal, retention, S3 client against a signed S3-compatible endpoint, stale/missing/incomplete/truncated detection, target-safety rules, credential scrubbing) and `tests/backup-ops.integration.test.ts` (real MongoDB: backup, deep check, dry run, verified restore, damage detection including a payment moved to another tenant, non-empty/protected/mismatched targets, wrong key, tampered archive, failed upload, empty source, unreachable database).
- **Restore drill result (2026-11-14, disposable in-memory replica set, 3 tenants, 4,906 documents, 72 collections):** PASS. Backup 2.3 s, deep check 1.5 s, confirmed restore with full verification 5.6 s. These numbers are for a tiny dataset on a laptop and are **not** a production recovery time. See RELEASE_READINESS.md §8.
- **Not verified:** Atlas Cloud Backup (not enabled), real S3-compatible storage (tested only against a local signed endpoint, not a real provider), scheduled workflow, alert delivery, any restore from real production data, and any production recovery time.

## Go-live checklist (all unticked until done by an operator)

- [ ] Atlas tier confirmed; Cloud Backup with continuous PITR enabled (or the risk accepted in writing).
- [ ] Bucket created (separate failure domain), versioning/object lock on, least-privilege keys issued.
- [ ] `BACKUP_ENCRYPTION_KEYS` generated, stored in the secret manager and offline with two custodians.
- [ ] Read-only backup database user created; backup host IP added to the Atlas access list.
- [ ] Workflow secrets/cron installed; first scheduled backup observed to succeed.
- [ ] `ALERT_WEBHOOK_URL` set; a failing/stale backup demonstrably alerts.
- [ ] Restore of the real backup into staging performed, verified and recorded (with duration).
