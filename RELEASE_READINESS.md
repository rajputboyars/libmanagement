ACCEPTED (design limit): documented in README under Offline behaviour 

**Release decision: NOT READY for production launch.**
The application passes every automated check that can run without real infrastructure, but mandatory production controls that need accounts, infrastructure or people (backups on the real database, monitoring and alerting, live payment gateway, email delivery, HTTPS domain, legal pages, a pilot) have not been done and cannot be done from the codebase. Nothing here has been deployed, no live credentials were used and no live payment was made.

Last verified: 2026-10-17 on Windows 10 / Node 24 / local disposable MongoDB replica sets.
Status values: **PASS** · **FAIL** · **BLOCKED** (needs external access) · **NOT TESTED**. A category is PASS only if every mandatory item in it is evidenced.

## Summary

| # | Category | Status | Severity of what remains |
|---|---|---|---|
| 1 | Functionality | PASS (automated) / pilot pending | Low |
| 2 | Security | PARTIAL (TOTP two-step sign-in is mandatory for owners and platform admins since R9, nonce-based CSP since R8; an independent review remains) | Medium |
| 3 | Data integrity | PASS (automated) | Low |
| 4 | Payments | PASS in sandbox · **BLOCKED** for live | Critical |
| 5 | Performance | **FAIL** on landing page target; others PASS | Medium |
| 6 | Accessibility | PASS (automated) / manual NOT TESTED | Low |
| 7 | Reliability | PASS (automated) · load NOT TESTED | Medium |
| 8 | Backups / restoration | Encrypted off-site backup, checks and verified restore IMPLEMENTED and drilled on a disposable database · **BLOCKED** (no production backup, bucket, key or Atlas Cloud Backup configured) | Critical |
| 9 | Monitoring | Logging, scrubbing, health, deduplicated alerting and backup monitoring IMPLEMENTED and tested locally · **BLOCKED** (no external monitoring configured or verified) | Critical |
| 10 | Documentation | PASS (legal pages are placeholders) | High |
| 11 | Deployment | PARTIAL (image built, nothing deployed) | High |
| 12 | Pilot acceptance | **NOT TESTED** | High |

## Evidence

### Build and test results (final run)
| Check | Result | Evidence |
|---|---|---|
| Typecheck | PASS | `npm run typecheck` |
| Lint | PASS | `npm run lint`, 0 errors, 0 warnings |
| Unit tests | PASS | 183 tests: 180 pass, 0 fail, 3 skipped (the database tests, which run in the integration suite) |
| Integration | PASS | 4 pass: tenant scope and concurrent seat writes, token signing, backup→restore drill, encrypted backup → check → verified restore |
| HTTP workflow ("E2E") | PASS | `npm run test:http`: one continuous workflow against a production build and real MongoDB replica set |
| Production build | PASS | `npm run build` |
| Production dependency audit | PASS | `npm audit --omit=dev`: 0 vulnerabilities |
| Dev dependency audit | 5 high (dev-only) | `braces` ReDoS via `eslint-config-next`; not shipped; fix needs a breaking lint upgrade |
| Browser-driven E2E (Playwright) | **NOT TESTED** | Not installed; the HTTP workflow covers the same flows at API level and screens were checked with Chrome (see Accessibility/Responsive) |
| Container image (web) | PASS | `docker build --target web` succeeds; container runs as non-root, `/api/health` 200, `/api/ready` returns 503 when the database is unreachable (correct), CSP/HSTS/X-Frame-Options present |
| Container image (worker) | PASS (build only) | `docker build --target worker` succeeds (2.9 GB because it carries dev dependencies; slim it before production). The worker process itself was exercised through the integration/HTTP suites, not run from the image |

A defect found and fixed in this phase: `package-lock.json` was missing `@emnapi/*` packages, so `npm ci` failed on Linux (CI and Docker). Fixed by adding them as devDependencies; `npm ci` now succeeds in the container.

### 1. Functionality — PASS (automated), pilot pending
Phases 1–5 features pass the HTTP workflow: registration, onboarding, admission, seat allocation and conflict prevention, memberships and renewal, payments (partial, overpayment, idempotent), attendance, focus sessions and XP, quizzes and mock tests, mistakes/flashcards/notes, community and moderation, maintenance, discovery/waitlist, CRM, branches, billing, support, imports, privacy.
Remaining: real-world use (see Pilot). Severity Low.

### 2. Security — FAIL for launch (mandatory controls missing)
Implemented and tested (see docs/SECURITY.md for the ASVS mapping):
- Brute-force protection (8 failures lock an account; 9th attempt returns 429 even with the correct password); constant-time response for unknown accounts.
- Password reset (single-use, expiring, hashed tokens), password change and sign-out-everywhere all revoke existing sessions server-side; deleted accounts cannot sign in. Expired, forged-secret tokens rejected.
- CSRF: cross-origin and `Sec-Fetch-Site: cross-site` writes rejected (403).
- Authorization: 20 sensitive endpoints reject unauthenticated callers; admin/owner endpoints closed to students; cross-tenant branch, ticket, result, attempt and import access denied; NoSQL operator injection and self-registration as admin rejected.
- CSP, frame-ancestors none, nosniff, HSTS (production), referrer and permissions policies; `X-Robots-Tag: noindex` on private routes; request ids on every response; readiness never leaks secrets; log redaction unit-tested.
- Privacy: data export, account deletion with anonymisation (financial records kept), organization deletion request workflow.

Remaining (mandatory before launch):
| Issue | Severity | Action |
|---|---|---|
| Two-step sign-in is enforced for owners and platform admins (R9); recovery is operator-assisted (`npm run reset-2fa`) | Low | Set a dedicated `TWO_FACTOR_KEY` before launch, enrol at least two platform admins, store their recovery codes offline, announce the change to existing owners |
| CSP `style-src` keeps `'unsafe-inline'` (scripts are nonce-only since R8) | Low | Documented exception: inline styles cannot execute script (see docs/SECURITY.md) |
| General API rate limits are per-process memory | Medium | Move to the shared limiter or an edge/WAF limit before running multiple instances |
| No independent security review or penetration test | High | Commission before launch |

### 3. Data integrity — PASS (automated)
- Transactions protect memberships, payments, imports, deletions; unique keys make payments, XP, webhook events and imports idempotent.
- Concurrency tests: four simultaneous claims on one seat → exactly one assignment; five simultaneous focus-reward requests → one XP record; six simultaneous identical webhook deliveries → one invoice and one payment.
- Reconciliation checks (memberships ↔ payments ↔ seat assignments ↔ dues) pass on imported pilot-shaped data and on the restored database in the backup drill.
- Existing-database migration (`migrate:orgs`) is additive and idempotent; tested lazily through registration and the organization workflow. **Not run against a production-sized copy** (NOT TESTED) — do so on staging with a restored copy before release.

### 4. Payments — PASS (sandbox) · BLOCKED (live)
Library fee payments and SaaS billing are separate code paths.
- Library fees: server-side amounts, partial payments, overpayment blocked, idempotency keys, receipts scoped to owner/payer, duplicate concurrent requests safe.
- SaaS billing (sandbox + Razorpay-shaped signed events): invalid signature rejected (400); duplicate and concurrent deliveries deduplicated; out-of-order events cannot revive a cancelled subscription; refund-before-payment retried; failed payment leaves the current plan untouched and records a failed invoice; past-due grace then restriction; checkout alone never activates a plan; plan changes only after a verified payment; invoice tax derived only from configuration; coupon and credit rules; referral credit only after a verified live payment, idempotent. Reconciliation job reports (never silently fixes) discrepancies.
- **BLOCKED:** no Razorpay credentials were available. The real gateway request format, webhook payload shapes and signature header behaviour are implemented from documentation but **untested against Razorpay's test mode**. Live credentials were not requested or used.
Required actions: obtain `rzp_test_` keys; run checkout + webhook end to end on staging; obtain tax/GST and payment-compliance review; written approval before live keys. Severity Critical.

### 5. Performance — FAIL on the landing page target
Lighthouse mobile emulation (simulated 4× CPU / slow 4G), production build served locally, no database:
| Page | Perf | LCP | CLS | TBT | Notes |
|---|---|---|---|---|---|
| `/privacy` | 99 | 1.9 s | 0.003 | 90 ms | PASS |
| `/login` | 93 | 2.5 s | 0 | 230 ms | PASS (at the LCP limit) |
| `/` (landing) | **84** | **3.0 s** | 0 | 410 ms | **FAIL** (target ≥ 90 and LCP ≤ 2.5 s) |

Before/after: first-load JavaScript on public pages **466 KB → 192 KB gzip** (−59%) by route-level code splitting (workspace, charts and forms no longer ship to public pages). Earlier baseline Lighthouse scores were not recorded before optimisation (only bundle size), so no before/after Lighthouse claim is made.
Not measured (NOT TESTED): INP (needs real interaction/field data; TBT is the only lab proxy), API response-time percentiles, large student tables (1,000+ rows), seat-grid rendering at 500 seats, dashboard analytics query latency under data volume, mobile network field performance.
Changes made: database compound indexes for hot queries, connection pool settings, dynamic imports, CSS/JS splitting, no continuous animation during study sessions was pre-existing.
Remaining: landing page style/layout cost (~1 s on throttled CPU) — server-render the landing page and split CSS. Severity Medium.

### 6. Accessibility — PASS (automated), manual NOT TESTED
- Lighthouse accessibility **100** on: `/`, `/login`, `/privacy`, `/pricing`, `/discover`, `/demo`, `/l/<slug>`, owner (`/owner`, seats, payments, billing, CRM, import, support, onboarding, maintenance, branches), student (`/app`, prep, focus, community, security), admin (business, question bank). Issues found and fixed: heading order, unlabeled selects, unlabeled file input, invalid ARIA attribute, low-contrast 7–8 px badge text.
- Responsive audit (`scripts/responsive-audit.mjs`, Chrome DevTools Protocol) across 320, 360, 390, 430, 768, 820, 1024, 1280, 1440 and 1920 px on public pages; and 320, 390, 768, 1024, 1440 px on owner, student and admin pages: **0 horizontal-scroll failures**. Touch targets: text links raised to 44 px; header icon buttons 40 px; two decorative/compact links remain below 32 px width on phones (e.g. "View all", landing "Log in" icon link), above WCAG 2.2 minimum (24 px).
- Visual regression: baseline screenshot hashes stored in `artifacts/visual` (117 page/viewport pairs); the audit reports CHANGED on any difference. This is a hash comparison, not a perceptual diff.
- NOT TESTED: screen-reader walkthroughs, full keyboard-only journeys, 200% zoom, forced-colors mode, chart accessibility with assistive tech (charts have text summaries nearby, not verified).

### 7. Reliability — PASS (automated), load NOT TESTED
- Jobs (membership expiry, fee and revision reminders, trial/billing/payment/onboarding reminders, weekly reports, notification retries, billing reconciliation) are idempotent: a second run sends nothing new; one failing job does not stop others; each run recorded in `JobRun`; `/api/ready` flags stale jobs; worker has a shared lock.
- PWA (tested 2026-10-17 with `scripts/pwa-check.mjs`, headless Chrome, production build): **32/32 automated checks PASS** (25 original + 7 regression checks for the fixes below) — valid manifest, 192/512/maskable PNG icons with correct pixel sizes, Chrome reports no installability errors, service worker activates, precache holds only the offline page and icons, static assets cached on the second visit, no `/api` responses and no HTML cached, dedicated offline page shown on offline navigation (with the worker target also offline), API calls fail while offline, in-app offline banner appears and clears, `clear-caches` empties all caches, `sw.js` is never HTTP-cached.
  **PWA bugs found and FIXED (verified by `scripts/pwa-check.mjs`):**
  | # | Bug | Severity | Fix |
  |---|---|---|---|
  | P1 | Owners, staff and admins who open the installed app land on `/app?source=pwa` (the student area) and see "This workspace requires a different role" | Medium |  FIXED: `Experience` redirects signed-in people to their own workspace (owner/staff → `/owner`, admin → `/super-admin`, student → `/app`); verified for owner, admin and student |
  | P2 | The fixed offline banner (87 px tall at 390 px wide) overlaps the 66 px mobile bottom navigation (banner y 701–788, nav y 734–800), blocking taps on nav items while offline | Medium |  FIXED: banner is now a sticky bar at the top with shorter text; verified no overlap with the bottom nav (banner y 0–58, nav y 734–800) |
  | P3 | Starting a focus session while offline shows a raw "Failed to fetch" error instead of a friendly message; the Begin focus button stays enabled | Low |  FIXED: failed requests while offline now report "You're offline. Reconnect and try again. Nothing was saved or confirmed."; verified on Begin focus |
  | P4 | The service worker's runtime cache is unbounded and its name never changes, so old hashed `/_next/static` chunks accumulate across deployments | Low |  FIXED: cache renamed v2, runtime entries capped at 120 with serialised oldest-first eviction; verified with 150 distinct assets (87 retained) |
  | P5 | Signed-out users opening the installed app get the "Interactive preview" student sample instead of the sign-in page | Low |  FIXED: signed-out `?source=pwa` launches redirect to `/login`; verified |
  | P6 | Offline support is limited by design: only the offline page works offline (no cached app shell, no offline focus timer); previously visited pages are not available offline | Info |  ACCEPTED design limit; documented in README (Offline behaviour) |
  **Not tested:** installation on a real phone (Android Chrome add-to-home-screen, iOS Safari), service-worker update flow after a new deployment, push notifications (not implemented).
- Load, soak and failover behaviour: **NOT TESTED**.

### 8. Backups / restoration — IMPLEMENTED + DRILLED (disposable) · BLOCKED (production)
Implemented in R10 (docs/BACKUP_RESTORE.md is the runbook):
- Encrypted logical backups (client-side AES-256-GCM, rotatable key ring) to S3-compatible off-site storage, sidecar summaries, retention (35 days + 12 monthly, minimum 3), daily schedule template (`.github/workflows/backup.yml`, inactive without secrets), failure alerts through the existing alert webhook.
- Health checks that report missing, stale, incomplete, truncated or corrupted backups; the weekly deep check downloads and decrypts the newest archive and verifies every checksum.
- Restore only into a new, empty, explicitly named database; the live database (`MONGODB_URI`, `BACKUP_SOURCE_URI`, `BACKUP_PROTECTED_TARGETS`) is refused; environment and a typed `<db>@<host>` confirmation are required (otherwise a dry run). Success is reported only after verification of collections, document counts, indexes, per-library (tenant) counts and cross-tenant-safe relationships.
- Tests: `tests/backup-ops.test.ts` (unit) and `tests/backup-ops.integration.test.ts` (real MongoDB): wrong key, tampered/truncated archives, unsafe archive names, failed upload, unreachable or empty source, protected/non-empty/unnamed targets, damage detection (lost rows, a payment moved to another tenant, a dropped index), no plaintext left behind, no credentials in errors.
- Restore drill (`npm run backup:drill`, disposable in-memory replica set, seeded through the real models, real CLI end to end):

```
DRILL RESULT: PASS  (2026-11-14, Windows laptop, MongoDB 7.0.14 in-memory replica set)
  tenants=3 students/tenant=60 documents=4906 collections=72 archive=105 KiB (encrypted)
  backup run (dump + encrypt + upload + checks)      2.3 s
  check --deep (download + decrypt + checksums)      1.5 s
  restore dry run                                    1.9 s
  restore --confirm (download, decrypt, restore, verify, TTL indexes)  5.6 s
    download 10 ms | decrypt+unpack 134 ms | verify-archive 52 ms | restore 3767 ms | verify-restored 202 ms | ttl-indexes 95 ms
  independent per-tenant comparison: students, payment counts and sums per library match; no payment references another tenant's membership
```
  These numbers are for a tiny dataset on a laptop and are **not** a production RTO or RPO.
- **BLOCKED / NOT VERIFIED (Critical):** no production database backup exists. Atlas Cloud Backup (continuous PITR) is not confirmed (needs a dedicated tier; the Atlas tier is unknown). No bucket, encryption key, read-only backup user or workflow secrets exist; the S3 client was exercised only against a local signed endpoint, never a real provider; the scheduled workflow has never run; alert delivery is unverified; no restore from a real backup into staging has been performed and no real recovery time is known. Action: complete the go-live checklist at the end of docs/BACKUP_RESTORE.md and record a restore into staging.

### 9. Monitoring — IMPLEMENTED (R11) · BLOCKED (external)
Implemented and tested (docs/MONITORING.md is the runbook and operator checklist):
- Structured JSON logs (severity, timestamp, environment, request id) with scrubbing of passwords, cookies, authorization headers, session tokens, TOTP seeds, recovery codes, database URIs (credentials and hosts), JWTs, emails, phone/card numbers and payment key ids; no request bodies or records logged; stack frames only in server logs, never in responses.
- Capture: unexpected API errors (all route catch blocks, classified so business errors never page anyone), uncaught route/render errors, process crashes (log, alert, exit 1 as before) and unhandled rejections, worker failures.
- Liveness (`/api/health`, no dependencies) and readiness (`/api/ready`, bounded 3 s database probe, coarse body with no credentials, topology, key names or business data).
- Alerts via `ALERT_WEBHOOK_URL`: deduplication with cooldowns, storm cap, cross-instance claim (fails open), recovery notices, https-only in production, timeouts, never throws or blocks requests. Keys: config, database, API error rate/unexpected errors, crash, worker, jobs, billing, backup failed/stale/integrity.
- Backup monitoring: `npm run backup:status` (last successful backup, integrity-check state), persisted alert state for recovery notices, dead-man's-switch heartbeats (`BACKUP_HEARTBEAT_URL`, `BACKUP_CHECK_HEARTBEAT_URL`, `WORKER_HEARTBEAT_URL`) that detect a scheduler that silently stops.
- Tests: `tests/monitoring.test.ts` (scrubbing, dedup/cooldown/storm/recovery, delivery failure/hang/bad URL, cross-instance claim, error-rate, classification, heartbeat, backup status) and the HTTP suite (the **entire** suite, including sign-in and payments, runs while the alert webhook returns HTTP 500; health endpoints and leakage; an instance with an unreachable database keeps liveness up, fails readiness fast with no internals, answers users with generic errors, sends exactly one `db.unavailable` alert and logs no URI or secret).
- **BLOCKED / UNVERIFIED (Critical):** no monitoring provider is chosen (hosting undecided), no uptime probe, dead-man's-switch, log collector, alert destination or recipients exist, and **no alert has been delivered to a real destination** (delivery was verified only against a local HTTPS test sink). An error-tracking SaaS was not added (Next.js 16 / hosting compatibility unverified). Action: complete the checklist and verification procedure in docs/MONITORING.md and record evidence here.

### 10. Documentation — PASS (legal placeholders)
Present: README, DEPLOYMENT, BACKUP_RESTORE, MONITORING, SECURITY, PILOT, `.env.example` (no secrets), PROGRESS.
Privacy Policy and Terms of Service pages exist **as placeholders explicitly requiring legal review**. Severity High. Action: lawyer-reviewed text (DPDP Act 2023, children's data, payments, tax), named grievance contact.

### 11. Deployment — PARTIAL
Done: Dockerfile (web and worker targets), `.dockerignore`, GitHub Actions CI (verify, dependency audit, image build), health/readiness endpoints, environment validation (rejects weak secrets, non-https `APP_URL`, enabled sandbox billing in production), worker, deployment/rollback procedures, staging/production configuration table.
Verified: web image builds, runs non-root and serves health/readiness/headers correctly. Worker image builds (2.9 GB, not yet slimmed or run from the image).
Not done (needs authorization/infrastructure): CI has never run on the hosted service; no staging environment exists; no production domain, TLS, reverse proxy (`TRUST_PROXY`), secrets manager, database cluster, email provider or alert webhook. Nothing was deployed. Severity High.

### 12. Pilot acceptance — NOT TESTED
Tooling is ready and tested: validated CSV import with duplicate detection, seat/shift/plan mapping, control totals, all-or-nothing commit, idempotency, reconciliation view, invitations and activation (docs/PILOT.md, staff training guide, acceptance criteria). **No real library has been onboarded**; none of the pilot acceptance criteria (correct memberships for real students, dues reconciling with paper, daily owner operation, student activation) has been evidenced. Severity High.

## Exact blockers to READY

1. **Backups:** enable Atlas Cloud Backup (or accept the 24-hour RPO in writing), create the bucket, encryption key and read-only backup user, schedule and observe a real backup, verify alerting, and complete a recorded restore of that real backup into staging (checklist in docs/BACKUP_RESTORE.md).
2. **Monitoring/alerting:** create the alert webhook and recipients, external uptime probes on `/api/ready` and `/api/health`, the three heartbeat monitors and Atlas Alerts; verify a real `db.unavailable` alert and recovery and a missed-heartbeat alert, and record the evidence (checklist in docs/MONITORING.md).
3. **Payments:** run Razorpay test-mode end to end on staging; tax/GST and payment-compliance review; written approval before any live key.
4. **Security:** set `TWO_FACTOR_KEY` (mandatory two-step sign-in is enforced since R9), enrol two platform admins, independent security review/penetration test.
5. **Legal:** lawyer-reviewed Privacy Policy and Terms; DPDP consent and children's-data review.
6. **Infrastructure:** production database cluster, domain and TLS, reverse proxy with `TRUST_PROXY=1`, secrets manager, email provider, run CI on the hosted service, create staging.
7. **Performance:** meet the landing-page targets (≥ 90, LCP ≤ 2.5 s) and measure large-table and API latency under load.
8. **Pilot:** complete the hometown-library pilot and record acceptance.

READY requires every item above to be PASS with evidence. This document must be updated, not replaced, as evidence arrives.
