# Monitoring and alerting

## What the application provides (provider-neutral)

- **Structured JSON logs** on stdout (`src/lib/log.ts`): `ts, level, event, requestId, …`. Secrets, tokens, emails, phone numbers and JWTs are redacted before writing. Any collector can ingest them (Loki, Datadog, CloudWatch, ELK, Vector).
- **Correlation IDs:** `x-request-id` is attached to every request and response (`src/proxy.ts`) and included in error logs. Quote it in support tickets.
- **Health:** `GET /api/health` (liveness, no dependencies). `GET /api/ready` (configuration valid, MongoDB ping, job heartbeat; 503 when not ready; no secrets in the body).
- **Global error hook:** `src/instrumentation.ts` logs every uncaught server error and calls `ALERT_WEBHOOK_URL` (rate limited to one per minute) when configured.
- **Domain alerts** (logged as `alert.*` and sent to the webhook): job failure, billing reconciliation discrepancies, failed worker tick, unhandled request errors.
- **Audit trails:** privileged and financial actions are stored in `AuditLog` / `SaaSAuditLog` and visible in the admin Audit tab.
- **Job history:** every job run is recorded in `JobRun` with duration and result.

## Alert rules to configure in your monitoring provider

| Signal | Source | Threshold | Severity |
|---|---|---|---|
| Availability | external probe on `/api/ready` | 2 failures in 5 min | Critical |
| 5xx rate | proxy / APM | above 2% for 5 min | High |
| p95 API latency | proxy / APM | above 1.5 s for 10 min | Medium |
| Login failures | log events `auth.login_failed`, `auth.login_locked` | more than 50 per 10 min | Medium |
| Webhook failures | `/api/ready`, Admin → Billing failed count, log `alert.billing.reconciliation` | any | High |
| Job failures or stale jobs | `alert.job.failed`, `/api/ready` `degraded: true` | any | High |
| DB connection errors | `request.error` with Mongo messages | any | Critical |
| Notification delivery | `NotificationDelivery` with status `failed` | more than 10 per hour | Medium |
| Resource usage | host / container metrics | CPU or memory above 85% for 10 min | Medium |

## Setup steps (NOT YET DONE — requires accounts)

1. Choose a provider (for example Grafana Cloud, Datadog, Better Stack, or UptimeRobot plus Slack).
2. Ship container stdout to it and build a dashboard from the log fields above.
3. Create external uptime checks for `/api/ready` and `/api/health`.
4. Create an incoming webhook, set `ALERT_WEBHOOK_URL` and add the alert recipients below.
5. **Verify** by triggering a test: stop the database in staging and confirm the alert arrives; record the evidence in RELEASE_READINESS.md.

Alert recipients: _to be filled in by the business (primary on-call, secondary, escalation)._

Monitoring must not be reported as active until step 5 is evidenced.
