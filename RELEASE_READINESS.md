ACCEPTED (design limit): documented in README under Offline behaviour 

**Release decision: NOT READY for production launch.**
The application passes every automated check that can run without real infrastructure, but mandatory production controls that need accounts, infrastructure or people (backups on the real database, monitoring and alerting, live payment gateway, email delivery, HTTPS domain, legal pages, a pilot) have not been done and cannot be done from the codebase. Nothing here has been deployed, no live credentials were used and no live payment was made.

Last verified: 2026-10-17 on Windows 10 / Node 24 / local disposable MongoDB replica sets.
Status values: **PASS** · **FAIL** · **BLOCKED** (needs external access) · **NOT TESTED**. A category is PASS only if every mandatory item in it is evidenced.

## Summary

| # | Category | Status | Severity of what remains |
|---|---|---|---|
| 1 | Functionality | PASS (automated) / pilot pending | Low |
| 2 | Security | PARTIAL → **FAIL for launch** (no MFA, CSP unsafe-inline) | High |
| 3 | Data integrity | PASS (automated) | Low |
| 4 | Payments | PASS in sandbox · **BLOCKED** for live | Critical |
| 5 | Performance | **FAIL** on landing page target; others PASS | Medium |
| 6 | Accessibility | PASS (automated) / manual NOT TESTED | Low |
| 7 | Reliability | PASS (automated) · load NOT TESTED | Medium |
| 8 | Backups / restoration | PASS (drill) · **BLOCKED** (real provider) | Critical |
| 9 | Monitoring | **BLOCKED** (not configured) | Critical |
| 10 | Documentation | PASS (legal pages are placeholders) | High |
| 11 | Deployment | PARTIAL (image built, nothing deployed) | High |
| 12 | Pilot acceptance | **NOT TESTED** | High |

## Evidence

### Build and test results (final run)
| Check | Result | Evidence |
|---|---|---|
| Typecheck | PASS | `npm run typecheck` |
| Lint | PASS | `npm run lint`, 0 errors, 0 warnings |
| Unit tests | PASS | 80 tests: 78 pass, 0 fail, 2 skipped (the database tests, which run in the integration suite) |
| Integration | PASS | 3 pass: tenant scope and concurrent seat writes, token signing, backup→restore drill |
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
| No multi-factor authentication for owners and platform admins | High | Implement TOTP/WebAuthn or document an accepted-risk decision by the business |
| CSP allows inline scripts (`'unsafe-inline'`) | Medium | Introduce nonce-based CSP via the proxy |
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

### 8. Backups / restoration — PASS (drill) · BLOCKED (real provider)
- Automated restore drill into a separate database passes (counts, ObjectId/date fidelity, payment reconciliation, unique indexes, refusal of non-empty/tampered targets) — docs/BACKUP_RESTORE.md.
- **BLOCKED:** provider backups are not enabled (no production database exists), and no restore from provider snapshots has been performed. RPO/RTO in the document are proposals. Severity Critical. Action: enable continuous backup, perform and record a restore into staging.

### 9. Monitoring — BLOCKED
Implemented: structured redacted JSON logs, request ids, health/readiness endpoints, global error hook, alert webhook, job heartbeat, audit logs, documented alert rules (docs/MONITORING.md).
**Not configured:** no provider, no uptime probe, no alert destination or recipients. Monitoring is **not active** and no alert has been verified end to end. Severity Critical. Action: follow docs/MONITORING.md steps 1–5 and record the evidence.

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

1. **Backups:** enable provider backups on the production database and complete a recorded restore into staging.
2. **Monitoring/alerting:** configure a provider, uptime probe, alert destination and recipients; verify with a real triggered alert.
3. **Payments:** run Razorpay test-mode end to end on staging; tax/GST and payment-compliance review; written approval before any live key.
4. **Security:** MFA (or a documented accepted-risk decision), nonce-based CSP, independent security review/penetration test.
5. **Legal:** lawyer-reviewed Privacy Policy and Terms; DPDP consent and children's-data review.
6. **Infrastructure:** production database cluster, domain and TLS, reverse proxy with `TRUST_PROXY=1`, secrets manager, email provider, run CI on the hosted service, create staging.
7. **Performance:** meet the landing-page targets (≥ 90, LCP ≤ 2.5 s) and measure large-table and API latency under load.
8. **Pilot:** complete the hometown-library pilot and record acceptance.

READY requires every item above to be PASS with evidence. This document must be updated, not replaced, as evidence arrives.
