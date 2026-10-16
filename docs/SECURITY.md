# Security controls (OWASP ASVS v4 reference)

Status key: **Implemented** (code + test evidence), **Partial**, **Not implemented**. Evidence is in `scripts/test-http.ts` (HTTP workflow), `tests/*.test.ts` and `RELEASE_READINESS.md`.

| ASVS area | Control | Status |
|---|---|---|
| V2 Authentication | bcrypt (cost 12); 10+ char passwords; per-account lockout (8 failures / 15 min) and per-source throttle using a shared MongoDB counter; constant-time response for unknown accounts; password reset with single-use, 30-minute, hashed tokens; reset/change/sign-out-everywhere revoke all sessions | Implemented |
| V2 MFA | No multi-factor authentication for owners or admins | **Not implemented** (recommended before large-scale launch) |
| V3 Session | HS256 JWT in HttpOnly, SameSite=Lax, Secure (production) cookie; 7-day expiry; server-side revocation through `sessionVersion`; deleted accounts cannot authenticate; cached client data cleared on sign-out | Implemented |
| V4 Access control | Role checks on every route; tenant scoping by `libraryId`; organization and branch membership verified server-side (never trusting client ids); platform-admin only admin APIs; IDOR tests for receipts, attempts, tickets, results, imports | Implemented |
| V5 Validation | Zod on every mutating route; Mongo operator injection rejected; regex input escaped; CSV imports validated with row-level errors; uploads signature-checked (images) | Implemented |
| V5 Output / XSS | React escaping; no `dangerouslySetInnerHTML` except JSON-LD with `<` escaped; generated SVG cards XML-escaped and served with a restrictive CSP | Implemented |
| V7 Errors and logging | Structured logs with redaction; safe error messages (no stack traces or driver errors to clients); correlation ids; audit logs for privileged actions | Implemented |
| V8 Data protection | Private-by-default student profiles; data export and account deletion; PII excluded from logs; secrets only in environment | Implemented |
| V9 Communications | HSTS (production), CSP `upgrade-insecure-requests`; TLS terminated at the proxy (deployment responsibility) | Partial (needs HTTPS deployment) |
| V10/V13 API | CSRF: Origin check plus SameSite=Lax; webhook HMAC verified on the raw body with constant-time compare; idempotent event processing | Implemented |
| V12 Files | Doubt-solver images: size and magic-byte validation; no executable uploads | Implemented |
| V14 Configuration | Security headers (CSP, X-Frame-Options DENY, nosniff, Referrer-Policy, Permissions-Policy, COOP); environment validation (`/api/ready`); production dependency audit clean | Implemented |

## Known gaps and accepted risks

1. **CSP allows `'unsafe-inline'` scripts** (required by Next.js inline hydration data without a nonce pipeline). All other directives are strict. Follow-up: nonce-based CSP via the proxy. Severity: Medium.
2. **No MFA** for owners/admins. Severity: High for production at scale; mitigated by lockout and strong-password rules.
3. **Dev-only dependency advisory:** `braces` (ReDoS) via `eslint-config-next` → fast-glob. Not shipped to production; `npm audit --omit=dev` reports 0 vulnerabilities. Fix requires a breaking lint-tooling upgrade. Severity: Low.
4. **Rate limiting** for general APIs is per-process memory; only authentication, registration, reset and similar flows use the shared MongoDB limiter. Severity: Medium for multi-instance deployments.
5. Email delivery for password reset requires a configured provider; without it, reset links are only visible in non-production sandboxes.
6. Age assurance for minors relies on staff-attested guardian consent; there is no automated verification.

## Reporting

Security reports should go to a monitored address (to be defined by the business) and be triaged within 2 business days.
