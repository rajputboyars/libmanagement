# Monitoring, alerting and operator runbook

> **Status: implemented and tested locally; external monitoring is NOT active.** No uptime probe, dead-man's-switch, alert destination or
> log collector has been configured, and **no alert has been delivered to a real destination** (the HTTP suite delivers alerts to a local
> HTTPS sink only). Do not report monitoring as live until the checklist at the end is ticked and a real triggered alert is evidenced.

## Infrastructure found (basis for the choices)

- Database: MongoDB Atlas (tier unknown). App hosting is **undetermined**: the repository has both a container image (`web` + `worker` targets) and a Vercel cron entry. Nothing here is tied to either.
- Existing before R11: JSON logs with redaction, request ids, `/api/health`, `/api/ready`, an error hook, a one-per-minute global alert limiter (which could hide a *different* alert), job heartbeat, R10 backup alerts.
- **No monitoring provider was chosen or integrated.** The design is provider-neutral: any uptime monitor, any dead-man's-switch (healthchecks-style `POST` ping) and any incoming webhook (Slack/Teams/Discord/PagerDuty-compatible JSON). An error-tracking SaaS (for example Sentry) was deliberately **not** added: its SDK would need verified compatibility with this Next.js version and the (still undecided) hosting target, and the structured logs + alert webhook already cover capture and notification. Revisit once hosting is chosen.
- Atlas: enable **Atlas Alerts** for the cluster (host down, replication lag, connections, disk) to your on-call email/webhook as an independent database-side signal.

## What the application provides

### Logging (`src/lib/log.ts`)
One JSON object per line on stdout: `ts`, `level`, `event`, `service`, `env`, `requestId`, plus event fields. Every value is scrubbed before it is written: keys such as password, cookie, authorization, token, session, secret, seed, totp, recovery, uri, card, email, phone are replaced by `[redacted]`; free text is scrubbed for **database URIs** (credentials *and* hosts), `Bearer` tokens, `name=value` cookie/session/password pairs, JWTs, email addresses, long digit runs (phones, cards), recovery-code shapes, payment key ids and long opaque strings (TOTP seeds, keys, hashes). Request bodies and database records are never logged. Errors are logged as `{name, message, digest, code, stack(first 8 frames)}`, scrubbed; **stack traces appear only in server logs, never in responses**. Logging never throws.

### Error capture
- Route errors: every API route's `catch` calls `reportUnexpected(error, route)` (`src/lib/api-errors.ts`). It separates **unexpected** errors (database/driver failures, TypeError/ReferenceError…) from ordinary business errors (validation, plan limits, permissions, duplicate keys, "seat already taken"), which are never alerted. Unexpected ones are logged as `api.unexpected_error`, counted toward the error-rate alert and raise a deduplicated alert.
- Uncaught errors in routes/rendering: `onRequestError` in `src/instrumentation.ts`.
- Process level (production, web and worker): `uncaughtException` logs, alerts (3 s bound) and **exits 1 exactly as Node would** so the supervisor restarts the process; `unhandledRejection` logs and alerts but does not stop the process.

### Health endpoints (public, uncached, no business data)
| Endpoint | Purpose | Behaviour |
|---|---|---|
| `GET` / `HEAD /api/health` | **Liveness**: the process can answer | `200 {"status":"ok","uptimeSeconds":n}`. Never touches MongoDB or any dependency. Use for restarts/orchestrator liveness and frequent probes. |
| `GET /api/ready` | **Readiness**: should receive traffic | `200` ready / `503` not ready. Checks configuration validity and a MongoDB ping with a **3 s timeout** (`READY_DB_TIMEOUT_MS`). Body: `status`, `degraded`, `alerting` (`configured`/`not-configured`), `checks.{config,database,jobs}` with coarse `ok`/`detail`. No hostnames, versions, error text, key names, counts, or tenant/business data. `degraded:true` (still 200) means the job heartbeat is stale. A failed probe raises `db.unavailable`; a later success sends the recovery notice. |

External uptime monitoring: probe `GET https://<domain>/api/ready` every 1 minute (alert after 2 consecutive failures) for availability, and `GET /api/health` for process liveness. Probe from outside your network and from at least two regions if the provider allows.

### Alerts (`src/lib/alerts.ts`, destination `ALERT_WEBHOOK_URL`)
- **Format:** JSON `{ text, key, title, status: "firing"|"resolved", severity, environment, at, occurrences, suppressedSinceLast, otherAlertsSuppressed, details, runbook }` (`text` is Slack/Teams/Discord-compatible). `details` is scrubbed. `runbook` points to the anchors below.
- **Deduplication:** one notice per key per cooldown (default 15 min; 30 min for per-route errors); repeats are counted and summarised in the next notice.
- **Storm protection:** at most 10 notices per 10 minutes across all keys; the rest are counted ("otherAlertsSuppressed").
- **Cross-instance:** when MongoDB is reachable a shared claim stops several instances sending the same alert; if MongoDB is the failing component it **fails open** (an alert beats silence).
- **Recovery:** `RESOLVED` notices for database outage, API error rate, worker failure and backup failures/stale/integrity once the condition clears.
- **Safety:** `https://` required in production (plain `http://` is refused); 4 s timeout; redirects refused; delivery failures are logged (`alert.delivery_failed`, rate limited) and counted, **never thrown**, and request paths never wait for delivery.

| Key | Meaning | Severity |
|---|---|---|
| `config.invalid` | production configuration has errors at boot | critical |
| `db.unavailable` | database unreachable (readiness probe, worker tick, driver errors) | critical |
| `api.error-rate` | ≥ 10 unexpected API errors in 5 min (`ALERT_API_ERRORS_PER_5MIN`) | critical |
| `api.unexpected.<route>` | an unexpected error in one route | warning |
| `process.crash` | web or worker process crashed and is restarting / failed to start | critical |
| `process.unhandled_rejection` | rejected promise nobody handled | warning |
| `worker.tick` | background worker iteration failed | critical |
| `job.failed`, `billing.reconciliation` | a scheduled job failed / billing discrepancies | critical |
| `backup.failed` | the backup run failed | critical |
| `backup.stale` | no backup, or the newest is older than 26 h | critical |
| `backup.check_failed` | missing/incomplete/truncated/corrupted backup or deep verification failed | critical |

## Backup monitoring

- **Last successful backup and integrity status:** `npm run backup:status` (JSON, exit 1 when unhealthy): last successful backup time and age, number of complete backups, last integrity check (time, deep or not, problems). It reads the store (the source of truth for backup age) and `backup-status.json` written next to the backups by `backup:run` / `backup:check`.
- **Explicit failures:** `backup:run` and `backup:check` raise `backup.failed` / `backup.stale` / `backup.check_failed` and send `RESOLVED` after the next success (state persisted in `backup-status.json`, because each run is a new process).
- **A scheduler that silently stops** (workflow disabled, host down, expired credentials, GitHub disables scheduled workflows after 60 days without repository activity) produces no failure at all. That is covered by a **dead-man's-switch**: create two heartbeat monitors in any healthchecks-compatible service and set `BACKUP_HEARTBEAT_URL` (expect a ping every 24 h, grace ~3 h) and `BACKUP_CHECK_HEARTBEAT_URL` (expect a ping every 7 days for the deep check, grace ~1 day). The jobs `POST` the URL after each success and `POST <url>/fail` (or `BACKUP_HEARTBEAT_FAIL_URL`) after a failure. The provider alerts when a ping is **missing**. `WORKER_HEARTBEAT_URL` does the same for the background worker (one ping per successful tick).
- The application deliberately does **not** read the backup bucket (it has no backup credentials), so `/api/ready` does not report backups.

## Operator procedures (anchors referenced by alert payloads)

### Alert: db
1. Confirm: `curl -s https://<domain>/api/ready` (expect 503 with `database.detail: unreachable`); check Atlas status and Atlas Alerts.
2. Common causes: Atlas cluster paused/maintenance, IP access list no longer includes the app/worker egress address, credentials rotated, connection string changed, network partition.
3. Fix the cause (do **not** restore a backup unless data is lost). The `RESOLVED` notice arrives with the next successful probe/tick.
4. If Atlas itself lost data or the cluster is gone, follow the restore runbook in BACKUP_RESTORE.md ("recovery" environment).

### Alert: backup
1. `npm run backup:status` and `npm run backup:check -- --deep` from the backup host.
2. `backup.failed`: read the alert `message` and the job log. Typical: Atlas access list/credentials, bucket credentials/permissions, full disk in `BACKUP_TMP_DIR`, key ring missing. Re-run `npm run backup:run`; success sends the recovery notice.
3. `backup.stale`: the scheduler is not running or failing silently. Check the scheduler (Actions → "Database backup", runner online, workflow not disabled) and the heartbeat monitor. Run a manual backup immediately.
4. `backup.check_failed` (corruption/truncation/decryption failure): treat as **urgent**: take a fresh backup now, verify it with `--deep`, investigate the bucket (versioning/object lock help recover earlier copies) and confirm the key ring still contains the key id in the archive header.
5. Record the incident and re-run a staging restore if the integrity of earlier backups is in doubt.

### Alert: api
`api.error-rate` / `api.unexpected.<route>`: find the route in the alert, filter logs by `event:"api.unexpected_error"` and the `requestId`; check recent deployments; roll back if the errors began with a release; check database health first (`db` alert usually accompanies).

### Alert: process
`process.crash`: the supervisor should have restarted the process; confirm with `/api/health`. Search logs for `process.crash` (scrubbed stack frames). Repeated crashes: roll back. `process.unhandled_rejection`: a bug (no restart); file it with the log line.

### Alert: cron (`cron.failed`, `cron.unauthorized`)
On Vercel the jobs run from **Vercel Cron** (`GET /api/jobs/run`, daily). If any job fails or the run throws, the route raises one critical `cron.failed` alert (cooldown 6 h), pings `JOBS_HEARTBEAT_URL/fail` and answers HTTP 500 (Vercel shows the cron run as failed). The success heartbeat (`JOBS_HEARTBEAT_URL`, falls back to `WORKER_HEARTBEAT_URL`) is sent only after **all** jobs succeeded; a run skipped because another run holds the lock sends nothing. The first fully successful run after a failure sends one recovery notice. Give the heartbeat monitor a ~26 h grace period (Hobby cron may fire any time in its hour). `cron.unauthorized` means repeated calls without the right `CRON_SECRET` (rotated secret not redeployed, or probing). Re-running is safe: the jobs are idempotent.

### Post-response work and logs on Vercel
Alerts, push notifications and index creation run through `after()` (`src/lib/defer.ts`) so they finish after the response; a failure inside deferred work is logged as `deferred.failed` (scrubbed) and never reaches the user. Hobby keeps runtime logs for **1 hour** (Pro 1 day): export logs through a log drain or collector and treat the alert webhook as the primary signal. Confirm retention in the dashboard.

### Alert: worker / job / billing
`worker.tick`: check the worker process and database connectivity; `/api/ready` `degraded:true` indicates stale jobs. `job.failed`: the alert names the job (`JobRun` records the error); jobs are idempotent and can be re-run (`POST /api/jobs/run` with the cron secret). `billing.reconciliation`: follow DEPLOYMENT/BILLING notes and the Admin → Billing view.

### Alert: config
`config.invalid`: read `config.issue` lines in the startup log; fix the environment variable named there (HTTPS `APP_URL`, session secret, email webhook, sandbox billing off) and redeploy.

## Environment variables

| Variable | Where | Purpose |
|---|---|---|
| `ALERT_WEBHOOK_URL` | web, worker, backup job | HTTPS incoming-webhook URL (required for production alerting) |
| `ALERT_API_ERRORS_PER_5MIN` | web | error-rate threshold (default 10) |
| `READY_DB_TIMEOUT_MS` | web | readiness database probe timeout (default 3000) |
| `LOG_LEVEL` | all | `debug`/`info`/`warn`/`error` |
| `MONITOR_PROCESS_HANDLERS=1` | dev only | enable crash/rejection handlers outside production |
| `BACKUP_HEARTBEAT_URL`, `BACKUP_HEARTBEAT_FAIL_URL` | backup job | dead-man's-switch for daily backups |
| `BACKUP_CHECK_HEARTBEAT_URL`, `BACKUP_CHECK_HEARTBEAT_FAIL_URL` | backup job | dead-man's-switch for the weekly deep check |
| `WORKER_HEARTBEAT_URL` | worker | dead-man's-switch for the job worker |

Provider credentials stay server-side; none of these is exposed to the browser or required in development (unset = alerts are only logged, and the application says so: `alerting: "not-configured"`).

## Deployment instructions

1. Create an incoming webhook (Slack/Teams/Discord/PagerDuty events or any HTTPS endpoint accepting JSON) and set `ALERT_WEBHOOK_URL` on the web, worker and backup job (secret manager, not the repository).
2. Create an external uptime monitor on `/api/ready` (1 min, 2 failures) and `/api/health`; route its alerts to the same on-call channel.
3. Create three heartbeat monitors (backup daily, deep check weekly, worker) and set the `*_HEARTBEAT_URL` variables.
4. Ship container stdout to a log service and build saved searches for `level:error`, `event:request.error`, `event:api.unexpected_error`, `event:process.crash`, `event:alert.*`.
5. Enable Atlas Alerts.
6. Verify end to end (below).

## Verification procedure (to be performed and recorded by an operator)

1. In staging set `ALERT_WEBHOOK_URL`; stop the staging database (or block its network access): within ~1 probe cycle the `db.unavailable` alert must arrive once, and `RESOLVED` after restoring it.
2. Point `BACKUP_HEARTBEAT_URL` at a test monitor, skip a run, and confirm the missing-ping alert.
3. Run `npm run backup:check` against an empty bucket prefix and confirm `backup.stale`.
4. Record dates, who ran it and screenshots/ids of the received alerts in RELEASE_READINESS.md.

## Operator monitoring checklist (all unticked until done)

- [ ] Alert destination created, `ALERT_WEBHOOK_URL` set, on-call recipients named (primary, secondary, escalation): _to be filled in by the business_.
- [ ] External uptime probes on `/api/ready` and `/api/health` active.
- [ ] Heartbeat monitors for backup, deep check and worker active; one missed ping demonstrably alerts.
- [ ] Atlas Alerts enabled.
- [ ] Log collector receives stdout; saved searches/dashboards exist.
- [ ] `db.unavailable` test alert and its recovery received in staging (evidence recorded).
- [ ] Backup stale/failed alert received in staging (evidence recorded).
- [ ] Daily: glance at `npm run backup:status`; weekly: confirm the deep check ran; monthly: review suppressed-alert counts.
