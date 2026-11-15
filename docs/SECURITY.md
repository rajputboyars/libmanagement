# Security controls (OWASP ASVS v4 reference)

Status key: **Implemented** (code + test evidence), **Partial**, **Not implemented**. Evidence is in `scripts/test-http.ts` (HTTP workflow), `tests/*.test.ts` and `RELEASE_READINESS.md`.

| ASVS area | Control | Status |
|---|---|---|
| V2 Authentication | bcrypt (cost 12); 10+ char passwords; per-account lockout (8 failures / 15 min) and per-source throttle using a shared MongoDB counter; constant-time response for unknown accounts; password reset with single-use, 30-minute, hashed tokens; reset/change/sign-out-everywhere revoke all sessions | Implemented |
| V2 MFA | **Mandatory** TOTP two-step sign-in for library owners and platform admins (enforced server-side, R9), optional for staff and students (RFC 6238, authenticator apps); 10 single-use recovery codes stored as salted scrypt hashes; seed encrypted at rest (AES-256-GCM); a TOTP step can be used once (replay protection); 5 failures per 15 minutes lock the second step per account; password required to enable, disable or regenerate codes; reset links and password changes cannot bypass it | Implemented (enforced for owners and platform admins) |
| V3 Session | HS256 JWT in HttpOnly, SameSite=Lax, Secure (production) cookie; 7-day expiry; server-side revocation through `sessionVersion`; deleted accounts cannot authenticate; cached client data cleared on sign-out | Implemented |
| V4 Access control | Role checks on every route; tenant scoping by `libraryId`; organization and branch membership verified server-side (never trusting client ids); platform-admin only admin APIs; IDOR tests for receipts, attempts, tickets, results, imports | Implemented |
| V5 Validation | Zod on every mutating route; Mongo operator injection rejected; regex input escaped; CSV imports validated with row-level errors; uploads signature-checked (images) | Implemented |
| V5 Output / XSS | React escaping; no `dangerouslySetInnerHTML` except JSON-LD with `<` escaped; generated SVG cards XML-escaped and served with a restrictive CSP | Implemented |
| V7 Errors and logging | Structured logs with redaction; safe error messages (no stack traces or driver errors to clients); correlation ids; audit logs for privileged actions | Implemented |
| V8 Data protection | Private-by-default student profiles; data export and account deletion; PII excluded from logs; secrets only in environment | Implemented |
| V9 Communications | HSTS (production), CSP `upgrade-insecure-requests`; TLS terminated at the proxy (deployment responsibility) | Partial (needs HTTPS deployment) |
| V10/V13 API | CSRF: Origin check plus SameSite=Lax; webhook HMAC verified on the raw body with constant-time compare; idempotent event processing | Implemented |
| V12 Files | Doubt-solver images: size and magic-byte validation; no executable uploads | Implemented |
| V14 Configuration | Nonce-based CSP per request (no `unsafe-inline`/`unsafe-eval` for scripts, no host allow-list, `strict-dynamic`); security headers (X-Frame-Options DENY, nosniff, Referrer-Policy, Permissions-Policy, COOP); environment validation (`/api/ready`); production dependency audit clean | Implemented |

## Known gaps and accepted risks

1. **CSP style exception.** Scripts are nonce-only (built per request in `src/proxy.ts`, policy in `src/lib/csp.ts`; every page is rendered per request so the nonce can be applied). `style-src` keeps `'unsafe-inline'` because React `style` attributes, Next's inlined CSS and the chart library emit inline styles that cannot carry a nonce. Inline styles cannot execute script. Severity: Low.
2. **Two-step sign-in is mandatory for owners and platform admins, optional for staff and students** (see "Mandatory two-step sign-in" below). There is no self-service recovery when both the authenticator and all recovery codes are lost: an operator runs `npm run reset-2fa` after verifying the person's identity out of band; the account then has no access until it enrols again. SMS and email codes are deliberately not offered. Severity: Low (accepted: operator-assisted recovery).
3. **Dev-only dependency advisory:** `braces` (ReDoS) via `eslint-config-next` → fast-glob. Not shipped to production; `npm audit --omit=dev` reports 0 vulnerabilities. Fix requires a breaking lint-tooling upgrade. Severity: Low.
4. **Rate limiting** for general APIs is per-process memory; only authentication, registration, reset and similar flows use the shared MongoDB limiter. Severity: Medium for multi-instance deployments.
5. Email delivery for password reset requires a configured provider; without it, reset links are only visible in non-production sandboxes.
6. Age assurance for minors relies on staff-attested guardian consent; there is no automated verification.

## Two-step sign-in operations

- **Enrolment:** Security & privacy page → "Two-step sign-in". Password → scan QR (or type the key) → enter the 6-digit code → save the 10 recovery codes (shown once). Enabling signs out other devices.
- **Sign-in:** password first; the server answers `twoFactorRequired` with a 5-minute challenge token (not a session; `currentUser()` rejects it) and sets no cookie until `POST /api/auth/2fa-login` succeeds with a code or a recovery code.
- **Limits:** 5 wrong codes per account per 15 minutes (shared MongoDB counter, cleared on success), plus a per-source limit. Counters live in the existing `RateLimit` collection under keys `2fa:*`.
- **Password reset** (`/api/auth/reset`) returns a challenge, not a session, for accounts with two-step sign-in. Changing the password and deleting the account also require a code.
- **Data model (backward compatible, no migration):** optional `User.twoFactorEnabled` (default false), `twoFactorEnabledAt`, and `select:false` fields `twoFactorSecretEnc`, `twoFactorPendingEnc`, `twoFactorLastStep`, `twoFactorRecovery`. Existing accounts are unaffected.
- **Key management:** the seed is encrypted with a key derived (HKDF) from `TWO_FACTOR_KEY`, or from `SESSION_SECRET` when it is not set. **Rotating that value makes every enrolled authenticator unusable** (users then need recovery codes or an operator reset), so set a dedicated `TWO_FACTOR_KEY` before launch and treat it like a database credential.
- **Lost authenticator and recovery codes:** `RESET_2FA_EMAIL=person@example.in npm run reset-2fa` (operator only). Record who approved it.
- **Logging:** only events (`auth.2fa_enabled`, `auth.2fa_disabled`, `auth.2fa_failed`, `auth.2fa_locked`, `auth.2fa_recovery_used`) with the user id and source address. Codes, seeds and hashes are never logged (the logger also redacts `code`, `secret`, `hash`, `token`, `otp`).

## Mandatory two-step sign-in (R9)

- **Policy:** `requiresTwoFactor(role)` in `src/lib/two-factor-policy.ts` is true for `owner` and `super-admin` only. Staff and students keep the optional flow.
- **The gate is `currentUser()`** (`src/lib/auth.ts`), the one function every API route and server guard uses. A privileged account whose `twoFactorEnabled` is false gets `null`, so it has no usable session: not for the workspace, billing, exports, platform or any other API. It is evaluated against the database on every request, so it covers sessions issued before the policy, accounts that just gained a privileged role (promotion takes effect immediately), and accounts reset by an operator. There is no per-account exemption, default code or environment switch.
- **Sign-in for a privileged account that has not enrolled** (login, owner sign-up and password reset all behave alike): no cookie is set. The response is `{ twoFactorEnrollmentRequired, enrollmentToken, role }`. The enrolment token is a 15-minute signed token with its own purpose (`2fa-enroll`); `currentUser()` rejects it as a session and `2fa-login` rejects it as a challenge. It is accepted only by `2fa-setup` and `2fa-enable` (and only for an owner or platform admin who is not enrolled yet, not suspended or deleted, and whose session version still matches), and it dies when enrolment completes. Logging out is simply discarding it. Disable, recovery-code regeneration and every other API refuse it.
- **Enrolment** reuses the R8 implementation unchanged: password re-check, encrypted pending seed, code verification, hashed single-use recovery codes. Only after a correct code does the server issue a normal session (and every earlier session is revoked). The UI (`EnrollmentStep`) shows authenticator-app instructions, QR and manual key, the code field and the recovery codes, which must be acknowledged before continuing.
- **Turning it off is refused** for owners and platform admins (`2fa-disable` returns 403). Password change, password reset and account deletion still require the second factor, as in R8, and reset or change cannot create a session for an account that is not enrolled.
- **Recovery:** the recovery codes work exactly as in R8. If the authenticator and all codes are lost, an operator runs `RESET_2FA_EMAIL=person@example.in npm run reset-2fa`. That ends all sessions and clears the seed and codes; the owner or admin then has NO access until they sign in with their password and enrol again. The reset grants nothing by itself.
- **Last platform administrator:** to avoid being locked out, (1) keep the recovery codes of every platform admin offline, ideally enrol two platform admin accounts, and (2) if the only admin loses both authenticator and codes, an operator with database/shell access runs the reset command above for that account, then the admin enrols again. Creating an admin with `npm run bootstrap-admin` needs no 2FA at creation: the first sign-in goes through enrolment. Keep `TWO_FACTOR_KEY` backed up: losing or rotating it makes every enrolled authenticator unusable until each affected account is reset.
- **Migration:** none. Existing owners and admins who have not enrolled are asked to enrol at their next sign-in (their old sessions stop working immediately), so announce the change to owners before deploying.
- **Logging:** only events (`auth.2fa_enabled`, `auth.2fa_failed`, `auth.2fa_locked`, ...) with user ids. Enrolment tokens, seeds, codes and recovery codes are never logged; the HTTP suite asserts this against the server log.

## Backups and restore (R10)

- **Policy:** daily encrypted logical backups to off-site S3-compatible storage with 35-day / 12-month retention, plus (to be enabled) Atlas Cloud Backup with point-in-time recovery. See docs/BACKUP_RESTORE.md for the schedule, storage, restore steps and the go-live checklist. **Not active in production yet.**
- **Encryption and keys:** every archive is encrypted client-side with AES-256-GCM (authenticated header, random IV) before upload; keys come from `BACKUP_ENCRYPTION_KEYS` (rotatable ring, separate from `SESSION_SECRET` and `TWO_FACTOR_KEY`). The key must be in the secret manager and held offline by two custodians; losing it makes every backup unreadable.
- **Credentials:** the backup job needs a read-only database user and bucket write/list credentials; only the retention job may delete; the restore operator needs the key ring and `readWrite` on the target database only. None of these variables belong in the web or worker processes. Connection strings are scrubbed from errors; logs and alerts carry only archive names, counts and sizes, never customer data or credentials.
- **No public exposure:** the application has no route that serves backups; archives exist only in the bucket and in a private temporary directory (mode 0700) that is wiped after every run.
- **Restore safety:** targets must be new, empty and explicitly named; the live database is refused; non-empty targets are never overwritten; a typed `<db>@<host>` confirmation is required (otherwise dry run); decrypted data is released only after GCM authentication and checksum verification; success needs verified counts, indexes, per-tenant counts and zero cross-tenant references.
- **Residual risks:** the logical dump is not point-in-time consistent (Atlas continuous backup covers that); anyone holding both the key and bucket read access can read all data; the plaintext temporary directory depends on the backup host's disk protection.

## Observability and alerting (R11)

- **Logging hygiene:** JSON logs with request id and severity; every field is scrubbed (keys such as password, cookie, authorization, token, session, seed, totp, recovery, uri, card, email, phone; and free-text patterns for database URIs including hosts, Bearer tokens, `name=value` cookie/password pairs, JWTs, emails, long digit runs, recovery-code shapes, payment key ids and long opaque strings). Request bodies and database records are never logged. Logging and alerting never throw.
- **No internal detail to users:** stack traces and driver errors are logged server-side only; the health endpoints return coarse state only (no hostnames, versions, configuration key names, counts or tenant data) and are uncached.
- **Alert channel:** `ALERT_WEBHOOK_URL` must be https in production, is called with a 4 s timeout and no redirects, carries scrubbed context and a runbook pointer, is deduplicated and storm-limited, and delivery failures are logged but never affect login, payments or any business workflow (verified in the HTTP suite with a webhook that returns 500). Treat the URL as a secret; it lets anyone post to your on-call channel.
- **Crash handling:** an uncaught exception is logged and alerted, then the process exits with code 1 (same as Node's default); rejections are logged and alerted without stopping the process.
- **Residual risks:** monitoring is not active until the operator checklist in docs/MONITORING.md is completed; alert state is per process (shared MongoDB claim reduces duplicates but fails open); the webhook is the only notification path, so also use an external uptime monitor and dead-man's-switches that alert independently of this application.

## Reporting

Security reports should go to a monitored address (to be defined by the business) and be triaged within 2 business days.
