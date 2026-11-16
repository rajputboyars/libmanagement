# Controlled pilot runbook

> **Status today: NOT READY to begin a pilot with real libraries.** `npm run pilot:gate` reports **0 pass, 2 fail, 15 not verified** on the
> developer machine this was prepared on (2026-11-16). Nothing external has been verified: no staging or production host exists, no backup
> storage, uptime probe, alert destination, Razorpay credentials or Atlas backup setting has been checked, no legal review has happened, and
> **no real library, owner or student has been onboarded.** A staging deployment that boots is not "production-ready", and passing the gate
> is necessary but never sufficient: the approvals in section 3 are also required. Role names below are placeholders until the business names people. The concrete remaining actions, owners and evidence are in **docs/GO_LIVE_CHECKLIST.md** (R15 final audit: pilot NO-GO).

## 1. Deployment architecture (as found: Vercel + GitHub Actions)

The application is hosted on **Vercel** (Git-connected; plan and terms are **external decisions to confirm in the Vercel dashboard**) with **MongoDB Atlas**. R16 made the code serverless-compatible; nothing was deployed or changed in Vercel by that change.

| Concern | Where it runs | Notes |
|---|---|---|
| Web + API | Vercel Functions | Post-response work (alerts, push, index build) uses Next.js `after()` so it completes after the response (`src/lib/defer.ts`). |
| Scheduled jobs | **Vercel Cron**: daily `30 2 * * *` UTC -> `GET /api/jobs/run` with `Authorization: Bearer CRON_SECRET` | One run per day is the Hobby-compatible cadence (Hobby may run it any time inside the scheduled hour). Jobs are idempotent and a shared lock prevents overlapping runs. No permanent worker exists on Vercel; the `worker` container target is **not** part of this architecture. |
| Backups / integrity checks | **GitHub Actions** (`.github/workflows/backup.yml`) | Separate from Vercel Cron. Needs Atlas network access from GitHub runners (docs/BACKUP_RESTORE.md). |
| Database | MongoDB Atlas | Tier, backups, network access and connection limit: **NOT VERIFIED**, confirm in Atlas. |

**Open external decisions (cannot be verified from the repository):** whether the Vercel Hobby plan is acceptable for a commercial service (Hobby terms restrict use to personal, non-commercial use: **Hobby is NOT approved for commercial SaaS here**; confirm plan and terms in the dashboard, Pro is the likely requirement), the Production Branch, function region (deliberately not hard-coded; default `iad1`: choose one close to Atlas), Node version, Deployment Protection, and Hobby runtime-log retention (1 hour, so logs must be exported: docs/MONITORING.md). The Dockerfile/worker/container path remains in the repository as an alternative but is not the verified architecture.

## 2. Environments and configuration safety

- Set **`APP_ENV=staging`** or **`APP_ENV=production`** on every process of a deployment. With it set, the web and worker processes **refuse to start** if the configuration has errors, and `/api/ready` fails until it is fixed (`src/lib/env-profile.ts`). Without it the application only warns (`config.app_env_missing`).
- Validate **before** deploying, per role, without printing values: `npm run env:check -- --profile staging|production --role web|worker|backup --env-file <file>` (or against the container's environment).
- What the profiles enforce: https `APP_URL` on a public domain; managed (non-local) `MONGODB_URI`; strong distinct `SESSION_SECRET`; a **dedicated `TWO_FACTOR_KEY`** (mandatory two-step sign-in for owners/admins depends on it); `TRUST_PROXY=1`; https `EMAIL_WEBHOOK_URL` and `ALERT_WEBHOOK_URL`; no sandbox billing; **backup/restore credentials only on the backup host**; **staging may only use `rzp_test_` keys and `BILLING_EXPECT_MODE=test`**; production must state `BILLING_EXPECT_MODE=live|test` explicitly and a mismatching key is an error; test keys are flagged as "no real money" and can never be treated as live (`src/lib/billing-config.ts`).
- Separate secrets, databases and webhooks for staging and production. **Staging must never point at the production database.**
- Result on the real files in this repository (names only): `.env.production` is **NOT READY** (missing `APP_ENV`, `TWO_FACTOR_KEY`, `EMAIL_WEBHOOK_URL`, `ALERT_WEBHOOK_URL`; no payment keys); `.env.local` is a development file. The Atlas cluster those files point to was **not contacted** and its purpose (dev/staging/prod) is unknown.

### Vercel environment-variable scoping (set in the dashboard; never in the repository)

Vercel provides `VERCEL_ENV` (`production` | `preview` | `development`) itself. The application cross-checks it and **refuses to start** on a mismatch (`src/lib/env-profile.ts`).

| Variable | Production | Preview | Development |
|---|---|---|---|
| `APP_ENV` | `production` (required: a Production deployment without it is refused) | `staging` (never `production`) | unset |
| `APP_URL` | the production `https://` domain | the staging domain, or unset: Preview deployment URLs (`VERCEL_URL`, `VERCEL_BRANCH_URL`) are then trusted for origin checks **in Preview only** | unset |
| `MONGODB_URI` | production cluster/database | **a separate staging database; never production credentials** | local database |
| `PROTECTED_DB_TARGETS` | not needed | production `host/db` (a Preview whose `MONGODB_URI` matches it refuses to start) | production `host/db` |
| `RAZORPAY_KEY_ID` / secret / webhook secret | live keys, Production only | **test keys only** (a `rzp_live_` key in Preview is refused) | test keys |
| `CRON_SECRET` | set (Vercel sends it as the Bearer token) | not needed (crons run on Production only) | not needed |
| `SESSION_SECRET`, `ALERT_WEBHOOK_URL`, encryption keys | distinct per scope | distinct per scope | distinct per scope |
| `JOBS_HEARTBEAT_URL` | production monitor | unset | unset |
| `MONGODB_POOL_SIZE` | optional (default 5 on Vercel) | optional | optional |

Tick "Production" only for production secrets. After any change, redeploy and check `/api/ready` on that deployment. Production origin/CSRF validation is unchanged: only the canonical `APP_URL` origin is accepted.

## 3. Pilot safeguards, entry criteria and approvals

**Defaults proposed for the business to confirm (nothing is approved yet):** invite-only, at most **3 libraries**, one at a time, each a named person who agreed in writing; no bulk or self-service sign-up promotion; **no real customer charges** (Razorpay test mode only; free plan or sandbox plans) unless written approval names the plan and amount; **no migration of existing production data**; pilot data stays in the pilot database only.

**Entry criteria: all must be PASS in `npm run pilot:gate -- --profile <p> --url https://<host>`:**
1. Configuration valid for the profile (all three roles).
2. Smoke test passes on the deployed URL (section 5).
3. Legal: Privacy Notice and Terms reviewed by a lawyer, placeholders filled, `LEGAL_REVIEW_STATUS = "reviewed"` (docs/LEGAL_COMPLIANCE.md).
4. A real backup exists, is fresh, passed its integrity check, **and a real restore into isolated staging was verified** (section 6.1) before any real pilot data is accepted.
5. Atlas Cloud Backup/PITR enabled, **or** the 24-hour RPO limitation accepted in writing.
6. External uptime probes, a delivered alert with recovery, and heartbeat monitors verified (section 6.2).
7. Razorpay **test mode** verified with real test credentials and real webhook deliveries, reconciliation clean (section 6.3).
8. Export and account closure exercised (section 6.4); rollback rehearsed (section 5.3).
9. At least two platform admins enrolled in two-step sign-in with recovery codes stored offline.
10. Pilot owners and staff trained; named support owner and escalation contact; each library's written agreement.

Evidence is recorded in `pilot-evidence.json` (copy of `docs/pilot-evidence.template.json`): date, **named person**, reference. It is operator-attested; the gate treats missing or incomplete entries as NOT VERIFIED. **Approvals (not automatable):** pilot go/no-go signed by the business owner; separate written approval for anything involving real money, real personal data of people who have not agreed, or bulk onboarding.

**Stop conditions: pause onboarding immediately and escalate (section 9) if any occurs:** a cross-tenant data exposure (S1); a payment recorded that did not happen or money taken without a record; data loss or corruption; a failed restore or no valid backup for 24 h; sign-in/2FA bypass; monitoring/alerting dead (no alert path) for more than 4 h; two S2 incidents in a week; a library or student asks to stop; legal/consent problem reported.

## 5. Deployment, smoke test and rollback (steps that mention images or a worker apply only to a container deployment; on Vercel use a Git deployment and Instant Rollback)

1. CI green on the release commit; note the commit id.
2. `npm run env:check` for each role (`web`, `worker`, `backup`) with the target environment's variables.
3. Build and tag the images from that commit (`docker build --target web|worker`); store them in a registry (a manually approved step).
4. Take or confirm a fresh backup of the target database **and record its name**.
5. Deploy `web` (health check `/api/health`, readiness `/api/ready`) and one `worker`; the old version keeps running until readiness is green (rolling).
6. Run the smoke test (5.1) and the manual checks (5.2). Watch `/api/ready`, alerts and logs for 30 minutes.
7. Record the image tags, commit id, backup name, smoke result and who did it.

### 5.1 Smoke test (read-only): `npm run smoke -- --url https://<host> [--expect-legal-reviewed]`
Checks HTTPS, liveness, readiness, **nonce-based CSP with no `unsafe-inline`/`unsafe-eval`**, security headers, **HSTS**, API CSP, public **Privacy/Terms routes signed out** (flags the draft notice), sign-in/registration pages link to the legal pages, signed-out API refusal, no stack traces, failed sign-in sets no cookie, robots. With `SMOKE_EMAIL`/`SMOKE_PASSWORD` of a dedicated student/staff smoke account (no two-step) it verifies the **session cookie flags** (HttpOnly, SameSite=Lax, Secure on https, ≤7 days). Anything it cannot check is printed `NOT VERIFIED`.

### 5.2 Manual post-deploy checks (not automatable)
- Register a **new owner** with a throwaway address: sign-in must go to the **two-step enrolment screen**, no dashboard API answers before enrolment, enrolling opens the owner dashboard; recovery codes shown. (Mandatory 2FA for owners/admins.)
- Password reset email arrives (proves the email provider).
- Registration shows the Terms checkbox (required) and the separate optional marketing checkbox.
- Trigger a test alert path (6.2) after any configuration change.

### 5.3 Rollback
Redeploy the previous image tags (web and worker). Schema changes are additive, so no database rollback is normally needed. Data restore is **only** into a new database via the verified procedure in `docs/BACKUP_RESTORE.md`, never over the live one. Rehearse once on staging and record it. Payments: a rollback never replays or reverses gateway events (docs/BILLING.md).

## 6. Operational verification (each produces evidence; none is done)

### 6.1 Backup and restore into isolated staging
`BACKUP_*` set on the backup host only. `npm run backup:run`, then `npm run backup:check -- --deep`, `npm run backup:status`. Restore into a **new empty staging database**: `RESTORE_TARGET_URI=… npm run backup:restore -- --environment staging` (dry run), then with `--confirm "<db>@<host>"`; the tool verifies counts, indexes, per-library counts and relationships. Sign in to staging pointed at it. Record the archive, duration and operator. Repeat after any change to backup configuration. **Before this is PASS, accept no real pilot data.**

### 6.2 Monitoring, alert delivery and heartbeats
Create the webhook and recipients, external probes on `/api/ready` (1 min, 2 failures) and `/api/health`, three heartbeat monitors (`BACKUP_HEARTBEAT_URL`, `BACKUP_CHECK_HEARTBEAT_URL`, `WORKER_HEARTBEAT_URL`), Atlas Alerts. Verify: stop the staging database → one `db.unavailable` alert, then the `RESOLVED` notice; skip a backup run → missed-heartbeat alert. Procedure and anchors: `docs/MONITORING.md`.

### 6.3 Atlas backup/PITR
In Atlas, confirm the tier supports Cloud Backup and that continuous backup/PITR is on with the retention you intend; record a screenshot id. If the tier cannot, record the written acceptance that recovery means the latest encrypted logical backup (up to 24 h of data lost) and a longer RTO.

### 6.4 Razorpay test mode, reconciliation, export and closure
With real `rzp_test_` credentials on **staging**: link plans, pay with Razorpay's test cards/UPI, confirm webhook deliveries in the dashboard and the invoice/payment rows in the database, trigger a failed payment and a refund, then `npm run billing:reconcile -- --days 7` (must be clean). **No real charge.** Export: Owner → export CSVs and Account & privacy → *Download my data*; closure: a student deletes their account (data erased, fee records anonymised) and an owner raises an organization-deletion request (reviewed manually). Verify in the database, not only the screen. Details: `docs/BILLING.md`.

## 7. Owner onboarding (repeat per library; about 60–90 minutes with the pilot lead)

Before: written agreement; the library's paper register copy; names of owner/staff; decide the support channel.
1. **Registration:** owner opens the site, registers as *Manage my study library* and ticks the required Terms/Privacy box (the marketing box is optional). 
2. **Mandatory two-step sign-in:** on first sign-in the owner is sent to enrolment: install an authenticator app, scan, enter the code, **store the 10 recovery codes offline**. Confirm the dashboard opens only afterwards.
3. **Setup guide** (`/owner/onboarding`): library name/address, seats (one label per physical seat), shifts, fee plans with real prices; **modules** the library will use (the rest stay off); location for punch-in if used.
4. **Plan:** pilot libraries stay on the free or sandbox/test plan unless approved otherwise; **do not enter real card details** on a test environment.
5. **Staff:** owner adds staff with the least permissions needed (custom roles); each staff member registers their own account first.
6. **Students:** share the **Library ID**; students register (accepting the Terms) and send a join request; the owner verifies each person and allots a seat. Alternative: register import → invitations (students accept the Terms when they activate). Import needs a dry run and matching control totals (docs/PILOT.md).
7. **Tenant check (pilot lead, first week):** the owner sees only their library; a second pilot library sees none of it; a student sees only their own data. The automated HTTP suite covers this (`R14` rehearsal block); repeat spot-checks manually on the live pilot.
8. **Parallel run** with the paper register for the agreed weeks (docs/PILOT.md); daily compare collections and attendance.
9. **Hand-over:** one-page checklist below, support contacts, severity guide.

**Owner one-page checklist:** ☐ registered with Terms ☐ two-step enrolled, recovery codes saved offline ☐ seats ☐ shifts ☐ plans ☐ modules chosen ☐ staff added with limited roles ☐ Library ID shared ☐ first student joined and verified ☐ first fee recorded and receipt checked ☐ attendance tested ☐ export downloaded once ☐ knows how to reach support.

### Synthetic demo data (training, rehearsals, demos)
`npm run demo:seed -- --target-is-not-production --label "Training"` creates **"[DEMO] Training"**: an organization flagged `isTest`, accounts on the undeliverable `@demo.invalid` domain, throwaway random password printed once, 5 synthetic students with seats, payments and attendance. It is excluded from revenue, weekly reports and pilot metrics, **refused when `APP_ENV=production`**, and `npm run demo:purge -- --target-is-not-production [--confirm]` removes only `isTest` organizations whose name starts with `[DEMO] ` and only data scoped to them (dry run by default). Never create demo data in a database that holds real libraries. The owner of a demo tenant must enrol in two-step sign-in like any owner.

## 8. Daily and weekly checks (pilot lead)

**Daily (10 min):** `/api/ready` green and `degraded:false`; no open alerts; `npm run backup:status` (last backup < 26 h, integrity check recorded); open support tickets by severity; failed/rejected webhook events (`npm run pilot:metrics`); compare paper vs software for each parallel-run library; check the error rate in logs (`event:api.unexpected_error`).
**Weekly:** deep backup check ran (`backup:check --deep`), heartbeat monitors green, pilot review with each owner (issues, time saved, trust in numbers), reconcile payments (`billing:reconcile`), review the metrics, update the evidence/stop-condition log, check that suspended/closed accounts were handled, review consent coverage.

## 9. Support, severity and escalation

**Reporting workflow:** owners/staff raise tickets in-app (Support) or on the agreed channel; always include the `x-request-id` shown with any error, the library, what was expected and what happened, and screenshots without personal data. The pilot lead logs every issue in one shared sheet (date, library, severity, owner, status, resolution, root cause).

| Severity | Definition | Examples | Target (proposal) | Owner |
|---|---|---|---|---|
| **S1 Critical** | Data exposure across libraries, data loss, money recorded wrongly at scale, sign-in/2FA bypass, platform down | one library sees another's data; payments missing after outage | respond ≤ 1 h, stop condition: pause onboarding, fix or roll back same day | Pilot lead → engineering lead <name> |
| **S2 High** | A library cannot do a core task (admit, collect fees, attendance) or a payment mismatch | all staff cannot sign in; dues clearly wrong | respond ≤ 4 h, workaround same day | Pilot lead |
| **S3 Medium** | Single user problem or wrong data with a workaround | one student cannot sign in; seat conflict | respond ≤ 1 business day | Support <name> |
| **S4 Low** | Cosmetic, question, improvement | wording, layout | weekly review | Support <name> |

Escalation: support <name> → pilot lead <name> → engineering lead <name> → business owner <name> (S1 immediately). Contact details are **to be supplied by the business**; none are invented here.

**Playbooks**
- **Login failure:** confirm email and account state (suspended? invited-not-activated?); lockout clears after 15 minutes; use *Forgot password* (resets sign out all devices); owners/admins with a lost authenticator: recovery code, else identity-verified `npm run reset-2fa` (operator, approval recorded; the person must re-enrol before any access). Check `auth.login_failed/locked` events by request id; a bad email provider shows as `auth.reset_email_not_configured`.
- **Incorrect dues:** compare the membership amount, discount and payments (reversed payments are excluded); never edit records directly: record a reversal with a reason and a corrected payment; run the reconciliation view; escalate S2 if systemic.
- **Seat conflicts:** the system blocks double allocation; if the hall disagrees, fix the physical truth, change the assignment in the seat map, record the reason; if two assignments overlap, treat as S2 and capture the request ids.
- **Attendance problems:** check the library's punch policy (QR/app/geofence), location accuracy (>100 m rejected), stale sessions (auto-closed after 16 h); manual check-in is available to staff; compare with the paper log.
- **Payment mismatches (platform billing):** `docs/BILLING.md` (rejected events, review flags, reconciliation mismatches); library fee payments: reversal flow, never delete.
- **Data export request:** the person uses Account & privacy → *Download my data*; owners export CSVs; confirm identity before any manual export for someone who cannot sign in; log it.
- **Account deletion / closure:** students self-serve (password + second factor if enabled); owners raise an organization deletion request reviewed by the pilot lead and business owner (invoices may have to be kept); library fee/attendance records stay anonymised; deleted data remains in encrypted backups until they expire (state this to the requester); record the request and completion.

## 10. Safe metrics (no personal data, no new tracking)

`npm run pilot:metrics` computes aggregates on demand from existing records: organizations/libraries (real only; demo/test excluded), owners and how many enrolled in two-step sign-in, students and how many have an active membership, attendance records and payments recorded in the last 7 days, open support tickets by priority, failed/rejected webhook events and payments needing review, and the share of users who accepted the current Terms. Libraries are shown as `org-1…` pseudonyms and a library with fewer than 3 active members appears only inside the totals. No names, emails, phone numbers, ids, free text or money amounts are output, and nothing is stored or sent anywhere. **No analytics or tracking was added**; do not add any without updating the Privacy Notice.

## 11. Incident response

1. **Detect/declare:** alert, user report or the daily check; declare severity (section 9) and name an incident lead; open a log (time, who, what).
2. **Contain:** S1 → pause onboarding; if data exposure, suspend affected access; preserve logs (scrubbed) and request ids.
3. **Diagnose:** `/api/ready`, alert payloads (`docs/MONITORING.md` runbooks), recent deploys, `api.unexpected_error` logs.
4. **Recover:** roll back (5.3) or fix forward; restore only via the verified procedure into a new database.
5. **Communicate:** affected owners promptly and factually; for a personal-data breach follow the legal process once defined (docs/LEGAL_COMPLIANCE.md: counsel to define notification duties).
6. **Review:** within 3 working days: cause, impact, what worked, actions, whether a stop condition triggered; update runbooks and tests.

## 12. Pilot exit criteria (all required before widening beyond the pilot)

- The pilot ran the agreed duration with parallel records: software and paper totals matched (collections, outstanding dues, attendance) within the agreed tolerance for each library.
- No open S1 or S2 incident; every S3 has a decision.
- No cross-tenant exposure, no unexplained payment or data discrepancy.
- Backups ran daily with passing deep checks; one **repeat restore** into staging succeeded during the pilot; alerts and heartbeats fired correctly in tests.
- Each owner's acceptance recorded (docs/PILOT.md table) and willing to continue.
- Metrics reviewed; support load sustainable; legal review complete and placeholders filled; GST/invoice and refund policy approved by the CA/business; if real payments are planned: Razorpay live verification with written approval.
- The business owner signs the exit decision. Until then the platform is **not** described as production-ready.
