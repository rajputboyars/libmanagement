# Security controls (OWASP ASVS v4 reference)

Status key: **Implemented** (code + test evidence), **Partial**, **Not implemented**. Evidence is in `scripts/test-http.ts` (HTTP workflow), `tests/*.test.ts` and `RELEASE_READINESS.md`.

| ASVS area | Control | Status |
|---|---|---|
| V2 Authentication | bcrypt (cost 12); 10+ char passwords; per-account lockout (8 failures / 15 min) and per-source throttle using a shared MongoDB counter; constant-time response for unknown accounts; password reset with single-use, 30-minute, hashed tokens; reset/change/sign-out-everywhere revoke all sessions | Implemented |
| V2 MFA | Optional TOTP two-step sign-in (RFC 6238, authenticator apps) for every role; 10 single-use recovery codes stored as salted scrypt hashes; seed encrypted at rest (AES-256-GCM); a TOTP step can be used once (replay protection); 5 failures per 15 minutes lock the second step per account; password required to enable, disable or regenerate codes; reset links and password changes cannot bypass it | Implemented (optional per account; not enforced) |
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
2. **Two-step sign-in is optional.** It is not enforced for owners or administrators; enforcement (a policy flag per role) is a follow-up. There is no self-service recovery when both the authenticator and all recovery codes are lost: an operator runs `npm run reset-2fa` after verifying the person's identity out of band (see "Two-step sign-in operations"). SMS and email codes are deliberately not offered. Severity: Medium until enforced for administrators.
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

## Reporting

Security reports should go to a monitored address (to be defined by the business) and be triaged within 2 business days.
