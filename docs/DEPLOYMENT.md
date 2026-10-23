# Deployment guide

StudyQuest is a Next.js 16 application plus an optional background worker, backed by MongoDB (a replica set is required for transactions).
Nothing in this repository deploys itself or creates infrastructure. Every step below is run by a person with authority over the target environment.

## 1. Environments

| | Development | Staging | Production |
|---|---|---|---|
| Purpose | local work | rehearsal with production-like config | real users |
| `NODE_ENV` | development | production | production |
| `APP_URL` | `http://127.0.0.1:3000` | `https://staging.<domain>` | `https://<domain>` |
| MongoDB | local replica set or Atlas dev cluster | separate cluster/database, **never** production data | production cluster with backups |
| Razorpay | unset (local sandbox) | `rzp_test_*` keys | `rzp_live_*` keys, enabled only with written approval |
| `ALLOW_BILLING_SANDBOX` | optional | never | **must be unset** (readiness fails otherwise) |
| Email / alerts | optional | real provider, test recipients | real provider and on-call recipients |

Use a different `SESSION_SECRET` in every environment (`openssl rand -base64 48`). Secrets live in the host secret manager or environment, never in git.

## 2. Required configuration

`GET /api/ready` validates configuration and the database. Fix every `error` it reports before taking traffic. See `.env.example` for all variables. The essentials:

- `MONGODB_URI` — replica set URI (transactions protect payments, memberships and imports).
- `SESSION_SECRET` — at least 32 random characters.
- `APP_URL` — canonical `https://` origin.
- `TRUST_PROXY=1` — **only** when the app sits behind a proxy or load balancer that overwrites `X-Forwarded-For`; otherwise per-IP limits share one bucket.
- `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` — to take subscription payments.
- `EMAIL_WEBHOOK_URL` (+ `EMAIL_WEBHOOK_TOKEN`) — password-reset, invitation and billing emails.
- `ALERT_WEBHOOK_URL` — Slack/Teams/PagerDuty-compatible incoming webhook for alerts.
- `CRON_SECRET` — only if jobs are triggered over HTTP instead of by the worker.

## 3. Build and run

### Node (no container)
```bash
npm ci
npm run build
NODE_ENV=production npm start
```
Run behind a TLS-terminating reverse proxy (nginx, Caddy, a cloud load balancer). Redirect HTTP to HTTPS; the app sends HSTS in production.

### Container
```bash
docker build --target web    -t studyquest-web .
docker build --target worker -t studyquest-worker .
docker run -p 3000:3000 --env-file prod.env studyquest-web
docker run --env-file prod.env studyquest-worker
```

## 4. Background worker

One or more worker processes run all idempotent jobs every `JOB_INTERVAL_MINUTES` (default 15): membership expiry, fee-due and revision reminders, trial and billing reminders, notification retries, billing reconciliation and weekly reports. A shared lock prevents duplicated work; running two workers is safe.
On Vercel, `vercel.json` runs the jobs daily at 08:00 IST via Vercel Cron (`GET /api/jobs/run` with `Authorization: Bearer $CRON_SECRET`, sent by Vercel when `CRON_SECRET` is set). Elsewhere, schedule `POST /api/jobs/run` with header `x-cron-secret: $CRON_SECRET` every 15 minutes.
`/api/ready` reports `degraded` if no job has succeeded within `JOBS_MAX_AGE_HOURS` (default 26).

## 5. Payment gateway setup (Razorpay)

1. Create the plans in the Razorpay dashboard; paste each plan id into **Super admin → Business → Plans & pricing** (monthly and annual).
2. Register the webhook `https://<domain>/api/billing/webhook` with events `subscription.*`, `payment.captured`, `payment.failed`, `refund.processed`; use the same secret as `RAZORPAY_WEBHOOK_SECRET`.
3. Test with `rzp_test_*` keys end to end on staging (checkout, webhook, invoice) before any live key is configured.
4. Switching to live keys is a deliberate, approved change. Test-mode data is flagged `sandbox` and never counted as revenue.

## 6. Release procedure

1. CI green on the release commit (typecheck, lint, unit, integration, HTTP workflow, build, audit).
2. Deploy to **staging**; check `/api/ready`; run the pilot import dry run.
3. Take a fresh database backup (see BACKUP_RESTORE.md) and record its location in the release notes.
4. Run `npm run migrate:orgs -- --dry`; review the output; apply only with approval. Migrations are additive (new collections and fields), so the previous release keeps working against the migrated database.
5. Deploy production with a rolling or blue/green strategy; watch `/api/ready`, the error rate and the webhook failure alert for 30 minutes.

## 7. Rollback

- **Code:** redeploy the previous image or commit. Schema changes are additive and backward compatible, so no database rollback is normally needed.
- **Data:** restore only with approval, into a *new* database, verify, then switch `MONGODB_URI` (BACKUP_RESTORE.md). Never restore over the live database.
- **Payments:** a rollback never replays or reverses gateway events; webhook processing is idempotent, and failed events can be retried from the admin Billing tab.

## 8. Indexes

Hot-path compound indexes are created automatically (online, idempotent) on first connection. For large existing databases, create them in a quiet period before the first release (see `src/lib/indexes.ts`).

## 9. HTTPS and domain

Point DNS at the proxy, issue a certificate (managed or ACME), force HTTPS and set `APP_URL` to the final origin. Verify `Strict-Transport-Security`, the Content-Security-Policy and `X-Frame-Options` headers on responses, and that `/robots.txt` and `/sitemap.xml` use the production origin.
