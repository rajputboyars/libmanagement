# Payments: gateway, webhooks, reconciliation and runbook

> **Status: implemented and verified against a LOCAL gateway simulator and the local sandbox. NOT verified against Razorpay itself.**
> No Razorpay test or live credentials exist, so nothing here has been sent to or received from the real gateway, **no real transaction of any
> kind has been made, and live payments are explicitly pending** (see "Live verification checklist").

## Provider and architecture (as found)

- **Provider:** Razorpay **Subscriptions** (recurring plan billing for library owners, INR, amounts in integer paise). A clearly labelled **local sandbox** provider exists for development: it moves no money and is refused in production unless `ALLOW_BILLING_SANDBOX=1` (which is a configuration error).
- Students' fees inside a library (cash/UPI recorded by owners) are a separate ledger and are **not** processed by the gateway.
- **Lifecycle:** owner picks a plan → `POST /api/billing {action:"checkout"}` creates a Razorpay subscription server-side (secret key, Basic auth) and a local `BillingCheckout` (status `created`; **nothing is activated**) → owner pays on the gateway's page → Razorpay sends **signed webhooks** to `POST /api/billing/webhook` → the signature is verified over the raw body → the event is stored once (unique `provider+eventId`) → validated → the invoice and payment are written **in one transaction** → the subscription changes only on verified lifecycle events (`subscription.activated|charged|pending|halted|cancelled|completed`) and only forward in provider time → notifications/audit. Receipts are the `BillingInvoice` (sequential number, tax decomposed from the charged amount).
- **The browser is never trusted:** there is no endpoint that accepts a client "payment succeeded". `PUT /api/billing` (sandbox completion) returns 403 whenever gateway credentials are configured.

## Audit findings and what R12 changed

| # | Finding | Severity | Resolution |
|---|---|---|---|
| 1 | Webhook signature (HMAC-SHA256 hex of the raw body, constant-time compare) and event-id de-duplication were correct | – | Kept; extended tests (tamper, wrong secret, key-secret-as-webhook-secret, case, whitespace, empty secret). |
| 2 | Payment **currency and amount were not validated** (any number accepted, negative/fractional/USD possible) | High | Strict validation: positive whole paise, ≤ ₹10,00,000, currency `INR` (required for the gateway), payment id shape, status must match the event. Failures change nothing, are stored as `rejected` with a reason, answered `200` (no retry storm) and alert. |
| 3 | **Tenant/subscription cross-checks missing** (payment notes, checkout, subscription id) | High | Mismatched organization, checkout or subscription is rejected; refunds must belong to the same organization. |
| 4 | **Invoice and payment were two separate writes**: a database/network failure between them left an orphan invoice whose unique payment id then made every retry fail permanently | High | One MongoDB transaction; a rolled-back attempt also consumes no invoice number; a concurrent duplicate is detected (duplicate key) and treated as already recorded. |
| 5 | **Refunds were not idempotent by refund id** (a re-delivery under a new event id double-counted) | High | Refund ids are recorded per payment and applied once, with an optimistic concurrency check; refunds are capped at the payment amount and flagged; refunds of failed payments or other tenants' payments are rejected. |
| 6 | Amount vs plan price was never compared | Medium | Over-charges and un-explained under-charges are **recorded** (money exists) but flagged `needsReview` and alerted. |
| 7 | **Partial gateway settings silently fell back to the sandbox**; a malformed or live key could run outside production | High | Partial settings disable checkouts (no sandbox fallback); key-id format, live-key-outside-production, https for live, `BILLING_EXPECT_MODE` test/live expectation, secret reuse and weak webhook secret are configuration **errors** (readiness fails, `config.invalid` alert); a live key can never be redirected to another API base. |
| 8 | No provider-side reconciliation (only local invoice↔payment checks) | Medium | `reconcileWithProvider` + daily job + `npm run billing:reconcile`: compares the gateway's payments with local records (missing either side, amount, currency, status, refunds). Report-only. |
| 9 | Abandoned checkouts stayed `created` forever | Low | Closed after 7 days by the reconciliation job (never touches the subscription). |
| 10 | Webhook route had no DB-outage or error handling; repeated bad signatures went unnoticed | Medium | 503 when the database is down (the gateway retries), errors reported; ≥10 signature failures in 10 min raise `billing.webhook-signature` (rotated secret or probing). |
| 11 | Existing and unchanged | – | INR/paise handling, plan/coupon/tax calculations, entitlement rules, stale-event ordering guard, grace period, referral rules, audit trail, tenant ownership of billing screens. |

## Environment variables

| Variable | Required | Notes |
|---|---|---|
| `RAZORPAY_KEY_ID` | yes (all three or none) | `rzp_test_…` for test mode, `rzp_live_…` for live. The prefix decides the mode; test data is marked `sandbox` and never counts as revenue or referral qualification. |
| `RAZORPAY_KEY_SECRET` | yes | Server-side only. Used for the API (Basic auth). |
| `RAZORPAY_WEBHOOK_SECRET` | yes | The secret configured on the webhook in the Razorpay dashboard. **Different** from the key secret, ≥ 16 random characters. |
| `BILLING_EXPECT_MODE` | recommended | `live` in production, `test` in staging: a mismatching key is a configuration error. |
| `APP_URL` | yes | `https://` canonical origin (required for live keys). |
| `ALLOW_BILLING_SANDBOX` | never in production | Local sandbox only; an error together with gateway keys. |
| `RAZORPAY_API_BASE` | tests only | Honoured **only for `rzp_test_` keys**, to point at a local simulator; an error with a live key. |

Test and live credentials are separate Razorpay accounts/modes: use a **separate environment** (secrets, database, webhook) for each. Live keys are refused unless `NODE_ENV=production` on an https `APP_URL`. Validation messages name variables and never print values; logs and alerts scrub key ids, Basic-auth headers and secrets.

## Razorpay dashboard setup (to be done by an operator)

1. Create the plans (Starter/Pro/Business, monthly and annual) in **Test mode** and store each plan id in the matching `SaaSPlan.providerPlanIds.razorpay.{monthly,annual}` via Admin → Plans.
2. Webhook URL: `https://<domain>/api/billing/webhook`; secret = `RAZORPAY_WEBHOOK_SECRET`; events: `subscription.activated`, `subscription.charged`, `subscription.pending`, `subscription.halted`, `subscription.cancelled`, `subscription.completed`, `payment.captured`, `payment.failed`, `refund.processed` (and `subscription.authenticated`).
3. Repeat in **Live mode** with live keys only for the production deployment, after the checklist below.

Webhook contract for the gateway: **200** = handled / duplicate / deliberately ignored or rejected (do not retry), **400** = bad signature or malformed, **413** too large, **5xx** = retry later (the gateway retries failed deliveries for ~24 h).

## Operator runbook

### Failed webhooks
Admin → Billing shows recent events and the failed count. A `failed` event is retried automatically (up to 5 attempts, daily job) and can be re-run with **Retry** (stored payload, already signature-verified). Common causes: database outage (clears itself), "event does not match any subscription yet" (arrived before the checkout was stored; retry after a minute), "refund arrived before its payment". Persistent failure: read `BillingWebhookEvent.error`, fix the cause, retry.

### Rejected events (`billing.anomaly.*` alert)
The event was validly signed but failed validation (currency, amount, payment id, tenant/subscription/checkout mismatch, bad refund). **Nothing was recorded.** Find it in `BillingWebhookEvent` with `status:"rejected"` (the `error` field names the rule). If real money moved at the gateway (check the Razorpay dashboard), do not edit the event: reconcile manually (see below), refund at the gateway if the charge is wrong, and note the decision in the audit log. A currency or tenant rejection for a payment you cannot explain is a security incident.

### Payments needing review (`billing.review` alert)
`BillingPayment.needsReview = true` with `reviewReason` (over-charge, un-explained discount, refunds above the payment). The payment IS recorded and the plan follows the gateway's lifecycle events. Finance confirms the amount against the Razorpay dashboard, corrects the gateway side (refund/offer) if wrong, then clears the flag.

### Reconciliation mismatches (`billing.provider-mismatch`, `billing.reconciliation` alerts)
Run `npm run billing:reconcile -- --days 30` (read-only; needs `MONGODB_URI` and the matching key pair). Types: `missing-locally` (gateway has money, no local record: a webhook was never delivered or was rejected → in the dashboard use **Resend** on the webhook delivery, or replay with Admin → Billing → Retry), `missing-at-provider` (local says paid, gateway does not know it: investigate before trusting the record; never delete financial records), `amount`/`currency`/`status`/`refund` differences (compare both sides, fix at the source of truth: the gateway). `billing.reconcile-unavailable` means the gateway API could not be reached or the keys are wrong.

### Rotating the webhook secret
Change it in the Razorpay dashboard and the environment at the same time. Until the deployment restarts, deliveries fail signature verification (HTTP 400, repeated → `billing.webhook-signature` alert); Razorpay retries, then re-send missed events from the dashboard.

### Incident: suspected forged webhooks
Signature failures are logged as `billing.webhook_rejected` (no body logged). Rotate the webhook secret, review `BillingWebhookEvent` since the suspected time, run reconciliation.

## Verification performed (and what it does not prove)

- Unit: signature verification, payment/refund validation, amount review, configuration rules, provider selection, secret scrubbing, reconciliation comparison and pagination.
- Integration (real MongoDB): transaction atomicity with an injected failure and a clean retry; 6-way concurrent and repeated delivery; rejected-event matrix; tenant isolation; declined payment leaves plan/period/captured totals unchanged; refund idempotency; delayed events; abandoned checkout job; reconciliation against a simulated gateway listing.
- HTTP end to end (production build, a **local gateway simulator** implementing the subscription/cancel/payments endpoints with Basic-auth check): checkout creation and outage, no browser-side confirmation path, signature/shape matrix, successful payment with the final database state and the receipt visible only to its tenant, duplicate and parallel deliveries, every mismatch type, over-charge flag, declined payment, refunds, delayed delivery, reconciliation, no credentials in logs/responses, live-key refusal without https, partial settings never becoming the sandbox.
- **Not proven:** acceptance of the requests by the real Razorpay API (field names, plan ids, offer handling, payload shapes beyond the documented ones), real signature headers from Razorpay, real payment methods (cards/UPI/3-D Secure/mandates), real declines, real refund flows, GST/tax compliance, settlement to a bank account.

## Live verification checklist (all pending, operator-owned, needs explicit approval for any real charge)

- [ ] Razorpay account activated/KYC complete; GST and payment-compliance review done.
- [ ] Test mode: plans created and linked; a checkout paid with Razorpay's **test cards/UPI**; webhook deliveries observed (dashboard) and verified in the database; failed-payment and refund tests; `npm run billing:reconcile` clean. Record evidence in RELEASE_READINESS.md.
- [ ] Production environment: `BILLING_EXPECT_MODE=live`, live keys in the secret manager, live webhook configured, `/api/ready` configuration check green.
- [ ] **Approved** low-value live transaction (explicit written approval, refunded afterwards), verified end to end including reconciliation. Not performed by engineering without that approval.
