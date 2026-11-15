import assert from "node:assert/strict";
import test from "node:test";
import { createHmac } from "node:crypto";
import { sign, verifySignature } from "../src/lib/saas";
import { billingConfigProblems } from "../src/lib/billing-config";
import { MAX_PAYMENT_PAISE, reviewAmount, validatePaymentEntity, validateRefundEntity } from "../src/lib/billing-validate";
import { comparePayments, fetchProviderPayments, type LocalPayment, type ProviderPayment } from "../src/lib/billing-reconcile";
import { providerConfig, razorpayBase } from "../src/lib/billing";
import { scrubText } from "../src/lib/log";

process.env.SESSION_SECRET = "unit-test-session-secret-with-32-plus-chars";
const SECRET = "whsec_test_0123456789abcdef";
const body = JSON.stringify({ entity: "event", event: "payment.captured", payload: { payment: { entity: { id: "pay_AbCdEf123456", amount: 29900, currency: "INR" } } } });

test("webhook signature: official HMAC-SHA256 hex over the raw body; everything else is rejected", () => {
  const good = createHmac("sha256", SECRET).update(body).digest("hex");
  assert.equal(sign(body, SECRET), good);
  assert.equal(verifySignature(body, good, SECRET), true);
  assert.equal(verifySignature(body, ` ${good} `, SECRET), true, "surrounding whitespace in the header is tolerated");
  for (const bad of [null, "", "0".repeat(64), good.slice(0, -1), good + "0", good.toUpperCase(), "not-hex", good.replace(/.$/, (c) => (c === "0" ? "1" : "0"))]) assert.equal(verifySignature(body, bad, SECRET), false, String(bad).slice(0, 20));
  assert.equal(verifySignature(body + " ", good, SECRET), false, "a one-byte change to the body invalidates the signature");
  assert.equal(verifySignature(body.replace("29900", "1"), good, SECRET), false, "tampered amount");
  assert.equal(verifySignature(body, good, "another-secret-another-secret"), false, "wrong secret");
  assert.equal(verifySignature(body, good, ""), false, "an empty secret never verifies");
  assert.equal(verifySignature(body, sign(body, ""), ""), false);
});

const base = { provider: "razorpay", kind: "captured" as const, subscriptionOrgId: "org1", providerSubscriptionId: "sub_AbC123" };
const goodPay = { id: "pay_AbCdEf123456", amount: 29900, currency: "INR", status: "captured", notes: { organizationId: "org1" }, subscription_id: "sub_AbC123" };

test("payment validation: amount, currency, ids, tenant and subscription must all agree", () => {
  assert.deepEqual(validatePaymentEntity(goodPay, base), { ok: true });
  const code = (pay: object, o: Partial<typeof base> & object = {}) => { const v = validatePaymentEntity(pay as never, { ...base, ...o } as never); return v.ok ? "ok" : v.code; };
  assert.equal(code({ ...goodPay, amount: 0 }), "amount");
  assert.equal(code({ ...goodPay, amount: -5 }), "amount");
  assert.equal(code({ ...goodPay, amount: 299.5 }), "amount", "fractional paise");
  assert.equal(code({ ...goodPay, amount: "29900" }), "amount", "string amount");
  assert.equal(code({ ...goodPay, amount: Number.NaN }), "amount");
  assert.equal(code({ ...goodPay, amount: MAX_PAYMENT_PAISE + 1 }), "amount");
  assert.equal(code({ ...goodPay, currency: "USD" }), "currency");
  assert.equal(code({ ...goodPay, currency: undefined }), "currency", "the live gateway always sends a currency");
  assert.equal(code({ ...goodPay, currency: undefined }, { provider: "sandbox" }), "ok", "the local sandbox may omit it");
  assert.equal(code({ ...goodPay, currency: "usd" }, { provider: "sandbox" }), "currency");
  assert.equal(code({ ...goodPay, id: "order_123" }), "payment-id");
  assert.equal(code({ ...goodPay, id: "" }), "payment-id");
  assert.equal(code({ ...goodPay, status: "authorized" }), "status", "an authorized-only payment is not money received");
  assert.equal(code({ ...goodPay, status: "failed" }), "status");
  assert.equal(code({ ...goodPay, notes: { organizationId: "org2" } }), "tenant", "payment notes name another organization");
  assert.equal(code({ ...goodPay, subscription_id: "sub_Other999" }), "subscription");
  assert.equal(code(goodPay, { checkoutId: "c1", checkoutOrgId: "org2" } as never), "tenant", "checkout of another organization");
  assert.equal(code({ ...goodPay, notes: { checkoutId: "c9" } }, { checkoutId: "c1" } as never), "checkout");
  assert.equal(code({ ...goodPay, status: "failed" }, { kind: "failed" } as never), "ok");
  assert.equal(code(null as never), "payment-id");
});

test("amount review flags over- and under-charges but never blocks; coupons explain a discount", () => {
  assert.equal(reviewAmount({ amountPaise: 29900, listPaise: 29900, hasCoupon: false }), null);
  assert.match(reviewAmount({ amountPaise: 59900, listPaise: 29900, hasCoupon: true })!, /more than the plan price/);
  assert.match(reviewAmount({ amountPaise: 100, listPaise: 29900, hasCoupon: false })!, /less than the plan price/);
  assert.equal(reviewAmount({ amountPaise: 20000, listPaise: 29900, hasCoupon: true }), null);
  assert.equal(reviewAmount({ amountPaise: 500, listPaise: 0, hasCoupon: false }), null, "free plans have no list price to compare");
});

test("refund validation", () => {
  assert.deepEqual(validateRefundEntity({ id: "rfnd_1", amount: 100, payment_id: "pay_1" }), { ok: true });
  for (const r of [{ amount: 100, payment_id: "pay_1" }, { id: "r", amount: 0, payment_id: "p" }, { id: "r", amount: 1.5, payment_id: "p" }, { id: "r", amount: 5, currency: "USD", payment_id: "p" }, { id: "r", amount: 5 }]) assert.equal(validateRefundEntity(r).ok, false, JSON.stringify(r));
});

test("gateway configuration: partial, malformed and test/live mix-ups are errors; messages never contain secret values", () => {
  const keys = ["RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET", "RAZORPAY_WEBHOOK_SECRET"];
  const env = (o: Record<string, string>) => ({ NODE_ENV: "production", APP_URL: "https://app.example.in", ...o });
  const errors = (e: Record<string, string | undefined>) => billingConfigProblems(e).filter((p) => p.level === "error").map((p) => p.key);
  const test_ = { RAZORPAY_KEY_ID: "rzp_test_AbCdEf1234", RAZORPAY_KEY_SECRET: "keysecretkeysecret1234", RAZORPAY_WEBHOOK_SECRET: "webhooksecret-1234567" };
  const live = { ...test_, RAZORPAY_KEY_ID: "rzp_live_AbCdEf1234" };
  assert.deepEqual(billingConfigProblems(env({})), [], "not configured at all is the warning path, not an error");
  assert.deepEqual(errors(env(test_)), []);
  assert.deepEqual(errors(env(live)), []);
  assert.deepEqual(errors(env({ RAZORPAY_KEY_ID: test_.RAZORPAY_KEY_ID })), ["RAZORPAY_*"], "partial configuration");
  assert.deepEqual(errors(env({ RAZORPAY_KEY_ID: test_.RAZORPAY_KEY_ID, RAZORPAY_WEBHOOK_SECRET: test_.RAZORPAY_WEBHOOK_SECRET })), ["RAZORPAY_*"]);
  assert.ok(errors(env({ ...test_, RAZORPAY_KEY_ID: "key_abcdef123456" })).includes("RAZORPAY_KEY_ID"), "malformed key id");
  assert.ok(errors({ ...live, NODE_ENV: "development", APP_URL: "http://localhost:3000" }).includes("RAZORPAY_KEY_ID"), "a live key outside production is refused");
  assert.ok(errors({ ...live, NODE_ENV: "production", APP_URL: "http://app.example.in" }).includes("APP_URL"), "live billing needs https");
  assert.ok(errors(env({ ...test_, BILLING_EXPECT_MODE: "live" })).includes("BILLING_EXPECT_MODE"), "a test key where live is expected");
  assert.ok(errors(env({ ...live, BILLING_EXPECT_MODE: "test" })).includes("BILLING_EXPECT_MODE"), "a live key where test is expected");
  assert.deepEqual(errors(env({ ...live, BILLING_EXPECT_MODE: "live" })), []);
  assert.ok(errors(env({ ...test_, BILLING_EXPECT_MODE: "maybe" })).includes("BILLING_EXPECT_MODE"));
  assert.ok(errors(env({ ...test_, RAZORPAY_WEBHOOK_SECRET: test_.RAZORPAY_KEY_SECRET })).includes("RAZORPAY_WEBHOOK_SECRET"), "webhook secret must differ from the key secret");
  assert.ok(errors(env({ ...test_, RAZORPAY_WEBHOOK_SECRET: "short" })).includes("RAZORPAY_WEBHOOK_SECRET"));
  assert.ok(errors(env({ ...test_, ALLOW_BILLING_SANDBOX: "1" })).includes("ALLOW_BILLING_SANDBOX"));
  assert.ok(errors(env({ ...live, RAZORPAY_API_BASE: "http://evil.test" })).includes("RAZORPAY_API_BASE"), "a live key can never be redirected");
  assert.ok(!errors(env({ ...test_, RAZORPAY_API_BASE: "http://127.0.0.1:9" })).includes("RAZORPAY_API_BASE"), "a test key may use a local simulator (warning only)");
  const all = JSON.stringify([env(test_), live, { ...live, NODE_ENV: "development" }, { ...test_, RAZORPAY_WEBHOOK_SECRET: test_.RAZORPAY_KEY_SECRET }].flatMap((e) => billingConfigProblems(e)));
  for (const v of [...keys.map((k) => (test_ as Record<string, string>)[k]), live.RAZORPAY_KEY_ID]) assert.ok(!all.includes(v), `problem messages never echo ${v.slice(0, 8)}…`);
});

test("provider selection fails closed: partial gateway settings never become the sandbox, live keys cannot be redirected", () => {
  const saved = { ...process.env };
  try {
    for (const k of ["RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET", "RAZORPAY_WEBHOOK_SECRET", "RAZORPAY_API_BASE", "ALLOW_BILLING_SANDBOX", "BILLING_EXPECT_MODE"]) delete process.env[k];
    const mutable = process.env as Record<string, string | undefined>;
    mutable.NODE_ENV = "test";
    assert.equal(providerConfig().provider, "sandbox");
    process.env.RAZORPAY_KEY_ID = "rzp_test_AbCdEf1234";
    const partial = providerConfig();
    assert.deepEqual([partial.provider, partial.usable, partial.configured], ["razorpay", false, false], "one variable set: no sandbox fallback, checkouts off");
    process.env.RAZORPAY_KEY_SECRET = "keysecretkeysecret1234"; process.env.RAZORPAY_WEBHOOK_SECRET = "webhooksecret-1234567";
    const full = providerConfig();
    assert.deepEqual([full.provider, full.mode, full.usable], ["razorpay", "sandbox", true], "rzp_test_ keys are TEST mode");
    process.env.RAZORPAY_KEY_ID = "rzp_live_AbCdEf1234";
    const liveHere = providerConfig();
    assert.equal(liveHere.mode, "live");
    assert.equal(liveHere.usable, false, "a live key is unusable outside production");
    mutable.NODE_ENV = "production"; process.env.APP_URL = "https://app.example.in";
    assert.equal(providerConfig().usable, true);
    assert.equal(razorpayBase({ keyId: "rzp_live_AbCdEf1234" }, { RAZORPAY_API_BASE: "http://evil.test" }), "https://api.razorpay.com/v1");
    assert.equal(razorpayBase({ keyId: "rzp_test_AbCdEf1234" }, { RAZORPAY_API_BASE: "http://127.0.0.1:9/v1/" }), "http://127.0.0.1:9/v1");
    assert.equal(razorpayBase({ keyId: "rzp_test_AbCdEf1234" }, {}), "https://api.razorpay.com/v1");
  } finally { for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k]; Object.assign(process.env, saved); }
});

test("secrets never survive log scrubbing: key ids, basic-auth headers and webhook secrets", () => {
  const text = `call failed Authorization: Basic ${Buffer.from("rzp_live_AbCdEf1234:keysecretkeysecret1234").toString("base64")} key rzp_live_AbCdEf1234 secret=keysecretkeysecret1234 whsec=webhooksecret-1234567890abcdef`;
  const clean = scrubText(text);
  for (const s of ["rzp_live_AbCdEf1234", "keysecretkeysecret1234", "cnpwX2xpdmVf"]) assert.ok(!clean.includes(s), s);
});

const P = (id: string, amount: number, status = "captured", refunded = 0): ProviderPayment => ({ id, amount, currency: "INR", status, amount_refunded: refunded });
const L = (id: string, amount: number, status = "captured", refunded = 0, hoursAgo = 5): LocalPayment => ({ providerPaymentId: id, amountPaise: amount, status, refundedPaise: refunded, capturedAt: new Date(Date.now() - hoursAgo * 3600_000) });
const win = Math.floor(Date.now() / 1000) - 7 * 86400;

test("provider reconciliation compares gateway payments with local records", () => {
  assert.deepEqual(comparePayments([P("a", 100), P("b", 200, "refunded", 200)], [L("a", 100), L("b", 200, "refunded", 200)], { complete: true, windowStartSec: win }), []);
  const types = (p: ProviderPayment[], l: LocalPayment[], complete = true) => comparePayments(p, l, { complete, windowStartSec: win }).map((d) => `${d.type}:${d.paymentId}`).sort();
  assert.deepEqual(types([P("a", 100)], []), ["missing-locally:a"], "money received but no record (missed webhook)");
  assert.deepEqual(types([P("a", 100, "failed"), P("b", 100, "authorized")], []), [], "failed/authorized payments are not money received");
  assert.deepEqual(types([P("a", 100)], [L("a", 150)]), ["amount:a"]);
  assert.deepEqual(types([{ ...P("a", 100), currency: "USD" }], [L("a", 100)]), ["currency:a"]);
  assert.deepEqual(types([P("a", 100, "failed")], [L("a", 100)]), ["status:a"]);
  assert.deepEqual(types([P("a", 100)], [L("a", 100, "failed")]), ["status:a"]);
  assert.deepEqual(types([P("a", 100, "refunded", 100)], [L("a", 100, "captured", 0)]).sort(), ["refund:a", "status:a"]);
  assert.deepEqual(types([P("a", 100, "captured", 40)], [L("a", 100, "partially_refunded", 20)]), ["refund:a"]);
  assert.deepEqual(types([], [L("a", 100)]), ["missing-at-provider:a"]);
  assert.deepEqual(types([], [L("a", 100)], false), [], "absence only counts when the gateway listing is complete");
  assert.deepEqual(types([], [L("a", 100, "captured", 0, 0.1)]), [], "a payment from the last minutes may not be listed yet");
});

test("provider listing: pagination, auth header, errors without secrets", async () => {
  const calls: { url: string; auth: string }[] = [];
  const items = Array.from({ length: 230 }, (_, i) => ({ id: `pay_${String(i).padStart(8, "0")}`, amount: 100, currency: "INR", status: "captured", amount_refunded: 0 }));
  const fake = (async (url: string, init: { headers: Record<string, string> }) => {
    calls.push({ url, auth: init.headers.Authorization });
    const skip = Number(new URL(url).searchParams.get("skip"));
    return new Response(JSON.stringify({ items: items.slice(skip, skip + 100) }), { status: 200 });
  }) as never;
  const r = await fetchProviderPayments({ keyId: "rzp_test_AbCdEf1234", keySecret: "keysecretkeysecret1234" }, { from: 1, to: 2 }, { fetch: fake });
  assert.equal(r.items.length, 230); assert.equal(r.complete, true); assert.equal(calls.length, 3);
  assert.equal(calls[0].auth, `Basic ${Buffer.from("rzp_test_AbCdEf1234:keysecretkeysecret1234").toString("base64")}`);
  const capped = await fetchProviderPayments({ keyId: "rzp_test_AbCdEf1234", keySecret: "x" }, { from: 1, to: 2 }, { fetch: fake, maxPages: 2 });
  assert.equal(capped.complete, false, "a truncated listing is reported as incomplete");
  const denied = (async () => new Response(JSON.stringify({ error: { description: "Authentication failed for key rzp_test_AbCdEf1234" } }), { status: 401 })) as never;
  await assert.rejects(fetchProviderPayments({ keyId: "rzp_test_AbCdEf1234", keySecret: "x" }, { from: 1, to: 2 }, { fetch: denied }), (e: Error) => /HTTP 401/.test(e.message) && !e.message.includes("rzp_test_AbCdEf1234"));
});
