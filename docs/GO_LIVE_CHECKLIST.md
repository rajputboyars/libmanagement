# Go-live checklist: remaining real-world actions

> Written at the R15 final audit (2026-11-16). **Pilot: NO-GO. Public launch: NO-GO.** Every item below is **open**: none has been done or
> verified, and nothing external was contacted by engineering. Tick an item only when its evidence exists. Record evidence in
> `pilot-evidence.json` (copy of `docs/pilot-evidence.template.json`: date `YYYY-MM-DD`, a **named person**, a reference such as a link, ticket,
> screenshot id or archive name), then run `npm run pilot:gate -- --profile <staging|production> --url https://<host>`. The pilot may begin only
> when the gate reports every item PASS **and** the approvals in section 8 are given. Names/roles in "Who" are placeholders: the business assigns
> real people. Related: docs/PILOT_RUNBOOK.md (procedures), RELEASE_READINESS.md (status), docs/BILLING.md, docs/MONITORING.md,
> docs/BACKUP_RESTORE.md, docs/LEGAL_COMPLIANCE.md.

Order matters: 1 → 2 → 3 can run in parallel with 5 and 6; 4 needs 1; 7 needs 1–3; 8 is last.

## 1. Hosting and environment

| # | Action | Who | Evidence required | Must happen before |
|---|---|---|---|---|
| 1.1 | **Decide the host** for the container path (VM or container service, region, TLS-terminating proxy). Vercel is not supported for the pilot | Business owner + engineering lead | Written decision naming provider, region, egress IP | everything below |
| 1.2 | Create **separate staging and production** environments (separate secrets, databases, webhooks). Staging must never use the production database | Operator | Environment inventory (names, no secrets) | 1.3 |
| 1.3 | Generate and store secrets in a secret manager: `SESSION_SECRET`, a **dedicated `TWO_FACTOR_KEY`** (back up offline: losing it makes authenticators unusable), webhook URLs. Set `APP_ENV`, `NODE_ENV=production`, `APP_URL` (https), `TRUST_PROXY=1`, `EMAIL_WEBHOOK_URL`, `ALERT_WEBHOOK_URL`, `BILLING_EXPECT_MODE`. Do not edit `.env.production` in the repository; configure the host | Operator | `npm run env:check -- --profile staging|production --role web\|worker` all clean (attach output, names only) | 1.4 |
| 1.4 | **Email delivery**: choose a provider/relay, set `EMAIL_WEBHOOK_URL` (+ token), verify a real password-reset email arrives | Operator | Screenshot/log of a delivered reset email (`auth.reset_email_not_configured` absent) | 7.x |
| 1.5 | **Build and publish images** from the release commit (`docker build --target web`, `--target worker`) on a machine with Docker, or a green CI `image` job; scan and slim the worker image (earlier size 2.9 GB) | Engineering | Image tags + commit id + scan output | 1.6 |
| 1.6 | **Push the branch and get a green hosted CI run** (typecheck, lint, tests, build, audit, image) | Engineering | CI run link | 1.7 |
| 1.7 | **Deploy staging** (web + one worker) and run `npm run smoke -- --url https://<staging>` (add `SMOKE_EMAIL`/`SMOKE_PASSWORD` of a dedicated student smoke account to verify cookie flags); all checks PASS, items marked NOT VERIFIED done by hand (runbook 5.2: new owner is sent to mandatory 2FA enrolment; no dashboard API before enrolment) | Operator | Smoke output, deployment record (`stagingDeployment`) | 2.x, 3.x, 4.x |
| 1.8 | **Rehearse rollback** on staging (redeploy previous tags; confirm readiness) | Operator | Dated record (`rollbackRehearsed`) | pilot approval |
| 1.9 | Repeat 1.3, 1.7 for **production** only after the pilot go decision; production stays closed to real users until section 8 | Operator | env:check + smoke output | public/pilot start |

## 2. Atlas and backup/restore

| # | Action | Who | Evidence required | Must happen before |
|---|---|---|---|---|
| 2.1 | Confirm the **Atlas tier** and whether Cloud Backup/PITR is available; enable it with the intended retention, **or** accept in writing that recovery means the latest encrypted logical backup (up to ~24 h of data lost, longer RTO) | Business owner (+ operator) | Screenshot id or the signed acceptance (`atlasBackupOrPitr`) | accepting any real data |
| 2.2 | Add the **egress IP** of the backup host and the web/worker hosts to the Atlas IP access list; create a dedicated **read-only** backup user and a least-privilege app user | Operator | Atlas access list + user list (no passwords) | 2.4 |
| 2.3 | Create the **off-site bucket** in a separate failure domain (versioning/object lock on, least-privilege keys: backup = put/list/get, retention job only = delete). Generate `BACKUP_ENCRYPTION_KEYS` and store it in the secret manager **and** offline with two custodians | Operator + two key custodians | Bucket config, custodian names (no key material) | 2.4 |
| 2.4 | Set `BACKUP_*` **on the backup host only** (`npm run env:check -- --profile production --role backup`), run `npm run backup:run -- --prune`, then `npm run backup:check -- --deep` and `npm run backup:status` | Operator | Command output; status shows a fresh backup and a passing integrity check | 2.5 |
| 2.5 | **Restore the real backup into a new, isolated staging database** (`RESTORE_TARGET_URI=… npm run backup:restore -- --environment staging`, dry run, then `--confirm "<db>@<host>"`); sign in to staging on it | Operator | Archive name, duration, verification output (`backupRestoreDrill`) | **accepting any real pilot data** |
| 2.6 | Schedule daily backup and weekly deep check (`.github/workflows/backup.yml` with a runner whose IP is allow-listed, or cron on the backup host) and observe the **first scheduled run** succeed | Operator | Run links; heartbeat pings received | 3.x |

## 3. Monitoring and alerts

| # | Action | Who | Evidence required | Must happen before |
|---|---|---|---|---|
| 3.1 | Create the **alert webhook** (Slack/Teams/PagerDuty-compatible) and name recipients: primary, secondary, escalation | Business owner | Recipient list (names, channels) | 3.2 |
| 3.2 | **Prove alert delivery**: on staging stop the database (or block it) → exactly one `db.unavailable` alert, then the `RESOLVED` notice after restoring | Operator | Screenshots/message ids (`alertDelivery`) | pilot approval |
| 3.3 | **External uptime probes** from outside the network on `/api/ready` (1 min, alert after 2 failures) and `/api/health` | Operator | Probe config + one triggered alert (`uptimeProbes`) | pilot approval |
| 3.4 | **Heartbeat monitors** (dead-man's-switch): `BACKUP_HEARTBEAT_URL` (24 h), `BACKUP_CHECK_HEARTBEAT_URL` (7 days), `WORKER_HEARTBEAT_URL`; skip a run to prove a missed ping alerts | Operator | Monitor config + the missed-ping alert (`heartbeatMonitors`) | pilot approval |
| 3.5 | Enable **Atlas Alerts**; ship container stdout to a log service with saved searches (`event:api.unexpected_error`, `process.crash`, `alert.*`); record log retention | Operator | Alert config + saved searches | pilot start |

## 4. Razorpay

| # | Action | Who | Evidence required | Must happen before |
|---|---|---|---|---|
| 4.1 | Business Razorpay account activated (KYC) | Business owner | Account status (no keys in the evidence) | 4.2 |
| 4.2 | In **Test mode** create plans, link their ids in Admin → Plans, set `rzp_test_` keys + webhook secret **on staging** with `BILLING_EXPECT_MODE=test`; register `https://<staging>/api/billing/webhook` with the events in docs/BILLING.md | Operator | env:check clean; dashboard webhook screenshot | 4.3 |
| 4.3 | **Real test traffic**: pay with Razorpay test cards/UPI, a failed payment and a refund; confirm real webhook deliveries in the dashboard and the invoice/payment rows in the database (not just the screen) | Operator | Dated record + payment ids (`razorpayTestMode`) | 4.4 |
| 4.4 | `npm run billing:reconcile -- --days 7` clean against that traffic | Operator | Output (`paymentReconciliation`) | pilot approval |
| 4.5 | **Live payments are not part of the pilot.** Before any live key: written approval naming plan and amount, CA sign-off (section 5), a separate production webhook, `BILLING_EXPECT_MODE=live`, and an approved low-value live transaction that is refunded and reconciled | Business owner | Written approval + reconciliation record | public launch only |

## 5. Legal and CA review

| # | Action | Who | Evidence required | Must happen before |
|---|---|---|---|---|
| 5.1 | Supply every **placeholder**: legal entity, address, CIN/registration, privacy and support contacts, **Grievance Officer** (name, designation, email, phone, address, hours, acknowledgement/resolution periods), effective date, hosting/database region, email/WhatsApp/backup/monitoring providers, retention periods, breach wording, trial and **refund policy**, GST statement, liability cap period, dispute resolution and jurisdiction | Business owner | Completed list (docs/LEGAL_COMPLIANCE.md) | 5.2 |
| 5.2 | **Lawyer review** of `/privacy` and `/terms` line by line; DPDP Act/Rules position (verify the Gazette text and the ~May 2027 commencement), fiduciary/processor roles and any processing terms with libraries, children's-data decision (age gating, verifiable parental consent, educational exemption), cross-border position, CERT-In/breach process | Counsel | Written approval | 5.3 |
| 5.3 | Replace placeholders, remove the draft banner by setting `LEGAL_REVIEW_STATUS = "reviewed"` in `src/lib/legal.ts`, bump the version, add a changelog line, redeploy; re-run `tests/legal.test.ts` and the HTTP suite (update the draft-banner assertions deliberately) | Engineering | Commit + test run | pilot approval |
| 5.4 | **CA review** of GST/invoicing: applicability and rate, GSTIN, HSN/SAC, place of supply and tax split, customer GSTIN capture, credit notes for refunds, e-invoicing thresholds, invoice retention; set the tax configuration only after sign-off | Chartered accountant | Written sign-off | any paid plan |

## 6. Security review

| # | Action | Who | Evidence required | Must happen before |
|---|---|---|---|---|
| 6.1 | Commission an **independent security review / penetration test** of the staging deployment (auth, 2FA, tenant isolation, payments, CSP); fix findings | Business owner + external tester | Report + fix verification | public launch (recommended before real pilot data) |
| 6.2 | Enrol **at least two platform admins** in two-step sign-in (`npm run bootstrap-admin`, then sign in and enrol); store recovery codes offline; write down who can run `npm run reset-2fa` and how identity is verified | Operator | Names + dated confirmation (`twoPlatformAdminsEnrolled`) | 7.x |
| 6.3 | Replace per-process API rate limits with the shared limiter or an edge/WAF limit before running more than one web instance | Engineering | Change + test | multi-instance / public |
| 6.4 | Remove bootstrap/test variables from deployed environments (`ADMIN_PASSWORD`, `TEST_STUDENT_*`, `SEED_*`) | Operator | env:check shows no warnings | 1.7 |

## 7. Admin and staff onboarding

| # | Action | Who | Evidence required | Must happen before |
|---|---|---|---|---|
| 7.1 | Name the **pilot lead, support owner, engineering lead and business owner** with contact details; agree severity targets and the support channel (docs/PILOT_RUNBOOK.md §9) | Business owner | Contact sheet | pilot approval |
| 7.2 | Train pilot owners and staff (owner checklist in the runbook: registration with Terms, mandatory 2FA with offline recovery codes, setup, staff roles, student joining, exports) | Pilot lead | Attendance record (`staffTraining`) | each library's start |
| 7.3 | Exercise **export and account closure** on staging (student deletion, owner export, organization-deletion request) and verify in the database | Operator | Dated record (`exportAndClosure`) | pilot approval |
| 7.4 | Practise with synthetic data only: `npm run demo:seed -- --target-is-not-production --label "Training"` on staging, then `demo:purge` | Pilot lead | Notes | training |

## 8. Pilot agreements and approval (last)

| # | Action | Who | Evidence required | Must happen before |
|---|---|---|---|---|
| 8.1 | Each pilot library **agrees in writing** (named person, dates, the legal terms in force, no real charges, parallel paper records, data handling) | Business owner | Signed agreements (`pilotParticipantsAuthorized`) | onboarding any library |
| 8.2 | `npm run pilot:gate` reports **every item PASS** on the target environment | Operator | Gate output with 0 fail / 0 not verified | 8.3 |
| 8.3 | **Written go/no-go** from the business owner, with the limits: invite-only, at most 3 libraries (default proposal), no real customer charges, no bulk import, no migration of existing production data | Business owner | Signed decision | the first real library |
| 8.4 | Separate written approval for anything involving real money, real personal data of people who have not agreed, or bulk onboarding | Business owner | Signed approval | that activity |

**Public launch** additionally needs: a completed pilot with the exit criteria signed off (runbook §12), 4.5 (live payments) and 5.4, 6.1 and 6.3, performance and load work (landing page ≥ 90 / LCP ≤ 2.5 s; load, soak and failover tests), a manual accessibility audit, hosted CI and scanned images (1.5, 1.6), and the legal/DPDP position final.
