import { test } from "node:test";
import assert from "node:assert/strict";

// Payment pipeline against a disposable MongoDB replica set: signature-verified events through the REAL ingest path.
const enabled = !!process.env.TEST_MONGODB_URI;
const withDb = (uri: string, name: string) => uri.replace(/\/(\?|$)/, `/${name}$1`);

test("billing webhooks: atomic, idempotent, validated, tenant-safe and reconcilable", { skip: !enabled }, async () => {
  process.env.SESSION_SECRET = "integration-session-secret-with-32-plus-chars";
  for (const k of ["RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET", "RAZORPAY_WEBHOOK_SECRET", "ALLOW_BILLING_SANDBOX"]) delete process.env[k];
  const mongoose = (await import("mongoose")).default;
  await mongoose.connect(withDb(process.env.TEST_MONGODB_URI!, "billing_it"));
  const S = await import("../src/lib/saas-models");
  const { ensurePlans, createOrganization } = await import("../src/lib/saas-server");
  const { ingestWebhook, providerConfig, testHooks } = await import("../src/lib/billing");
  const { sign } = await import("../src/lib/saas");
  const { reconcileWithProvider } = await import("../src/lib/billing-reconcile");
  const { runAllJobs } = await import("../src/lib/jobs");
  await ensurePlans();
  const cfg = providerConfig();
  assert.equal(cfg.provider, "sandbox");
  const oid = () => new mongoose.Types.ObjectId();

  async function tenant(label: string) {
    const org = await createOrganization({ ownerId: oid(), name: `Org ${label}`, libraryIds: [] });
    const subId = `sandbox_sub_${label}`;
    await S.SaaSSubscription.updateOne({ organizationId: org._id }, { providerSubscriptionId: subId });
    const checkout = await S.BillingCheckout.create({ organizationId: org._id, planKey: "starter", planVersion: 1, interval: "monthly", provider: "sandbox", mode: "sandbox", providerSubscriptionId: subId });
    return { org, subId, checkout };
  }
  const now = Math.floor(Date.now() / 1000);
  let n = 0;
  const send = async (payload: unknown, eventId = `evt_${++n}_${Date.now()}`, badSignature = false) => {
    const raw = JSON.stringify(payload);
    return ingestWebhook(raw, badSignature ? "0".repeat(64) : sign(raw, cfg.webhookSecret), eventId);
  };
  const charged = (subId: string, paymentId: string, amount = 29900, extra: Record<string, unknown> = {}, at = now) => ({ entity: "event", event: "subscription.charged", created_at: at, payload: { subscription: { entity: { id: subId, current_start: at, current_end: at + 2592000 } }, payment: { entity: { id: paymentId, amount, currency: "INR", status: "captured", ...extra } } } });
  const counts = async (orgId: unknown, paymentId?: string) => ({
    invoices: await S.BillingInvoice.countDocuments(paymentId ? { providerPaymentId: paymentId } : { organizationId: orgId }),
    payments: await S.BillingPayment.countDocuments(paymentId ? { providerPaymentId: paymentId } : { organizationId: orgId }),
  });

  // 1) A failure between the invoice write and the payment write leaves NOTHING behind, and the provider's retry then succeeds exactly once.
  const A = await tenant("A");
  let armed = true;
  testHooks.afterInvoice = async () => { if (armed) { armed = false; throw new Error("simulated database failure"); } };
  const evt = "evt_atomic_1";
  const first = await send(charged(A.subId, "pay_Atomic0001"), evt);
  assert.equal(first.status, 500, "the gateway is told to retry");
  assert.deepEqual(await counts(A.org._id, "pay_Atomic0001"), { invoices: 0, payments: 0 }, "no orphan invoice after the failed transaction");
  assert.equal((await S.BillingWebhookEvent.findOne({ eventId: evt }))!.status, "failed");
  const seqBefore = (await S.PlatformSettings.findOne({ key: "default" }))!.invoiceSeq;
  const retry = await send(charged(A.subId, "pay_Atomic0001"), evt);
  assert.equal(retry.status, 200);
  assert.deepEqual(await counts(A.org._id, "pay_Atomic0001"), { invoices: 1, payments: 1 });
  assert.equal((await S.PlatformSettings.findOne({ key: "default" }))!.invoiceSeq, seqBefore + 1, "the rolled-back attempt consumed no invoice number");
  testHooks.afterInvoice = undefined;
  const sub = await S.SaaSSubscription.findOne({ organizationId: A.org._id });
  assert.equal(sub!.status, "active"); assert.equal(sub!.planKey, "starter");
  const pay = await S.BillingPayment.findOne({ providerPaymentId: "pay_Atomic0001" });
  assert.deepEqual([pay!.amountPaise, pay!.currency, pay!.status, pay!.needsReview], [29900, "INR", "captured", false]);

  // 2) The same payment delivered concurrently under different event ids, and again later, creates one invoice and one payment.
  const B = await tenant("B");
  const results = await Promise.all(Array.from({ length: 6 }, (_, i) => send(charged(B.subId, "pay_Race00001"), `evt_race_${i}`)));
  for (const r of results) assert.ok([200, 500].includes(r.status));
  for (const i of [0, 1, 2, 3, 4, 5]) await send(charged(B.subId, "pay_Race00001"), `evt_race_${i}`); // provider retries
  assert.deepEqual(await counts(B.org._id, "pay_Race00001"), { invoices: 1, payments: 1 }, "no duplicate invoice, payment or receipt number");
  const viaCaptured = { entity: "event", event: "payment.captured", created_at: now + 1, payload: { payment: { entity: { id: "pay_Race00001", amount: 29900, currency: "INR", status: "captured", notes: { organizationId: String(B.org._id) }, subscription_id: B.subId } }, subscription: { entity: { id: B.subId } } } };
  await send(viaCaptured);
  assert.deepEqual(await counts(B.org._id, "pay_Race00001"), { invoices: 1, payments: 1 }, "payment.captured after subscription.charged is the same payment");

  // 3) Events that fail validation change nothing, are marked rejected with a reason, and are not retried (HTTP 200).
  const C = await tenant("C");
  const D = await tenant("D");
  const snapshot = async () => JSON.stringify([await S.BillingInvoice.countDocuments({ organizationId: C.org._id }), await S.BillingPayment.countDocuments({ organizationId: C.org._id }), (await S.SaaSSubscription.findOne({ organizationId: C.org._id }))!.status, (await S.SaaSSubscription.findOne({ organizationId: C.org._id }))!.planKey]);
  const before = await snapshot();
  const bads: [string, unknown, string][] = [
    ["currency", charged(C.subId, "pay_Usd000001", 29900, { currency: "USD" }), "currency"],
    ["zero amount", charged(C.subId, "pay_Zero00001", 0), "amount"],
    ["negative amount", charged(C.subId, "pay_Neg000001", -29900), "amount"],
    ["fractional amount", charged(C.subId, "pay_Frac00001", 299.5), "amount"],
    ["string amount", charged(C.subId, "pay_Str000001", "29900" as never), "amount"],
    ["authorized only", charged(C.subId, "pay_Auth00001", 29900, { status: "authorized" }), "status"],
    ["other tenant in notes", charged(C.subId, "pay_Tenant001", 29900, { notes: { organizationId: String(D.org._id) } }), "tenant"],
    ["other subscription", charged(C.subId, "pay_Sub000001", 29900, { subscription_id: D.subId }), "subscription"],
    ["no payment entity", { entity: "event", event: "subscription.charged", created_at: now, payload: { subscription: { entity: { id: C.subId } } } }, "payment-id"],
  ];
  for (const [label, payload, code] of bads) {
    const r = await send(payload, `evt_bad_${label.replace(/\W/g, "")}`);
    assert.equal(r.status, 200, `${label}: no retry storm`);
    assert.equal((r as { outcome?: string }).outcome, "rejected", label);
    const ev = await S.BillingWebhookEvent.findOne({ eventId: `evt_bad_${label.replace(/\W/g, "")}` });
    assert.equal(ev!.status, "rejected"); assert.ok(ev!.error!.startsWith(code), `${label}: ${ev!.error}`);
  }
  assert.equal(await snapshot(), before, "rejected events never create invoices or payments and never activate or change a subscription");
  assert.deepEqual(await counts(D.org._id), { invoices: 0, payments: 0 }, "the other tenant is untouched");
  assert.equal((await send(charged(C.subId, "pay_BadSig0001"), "evt_badsig", true)).status, 400);
  assert.equal((await S.BillingWebhookEvent.findOne({ eventId: "evt_badsig" })), null, "an invalid signature is not even stored");

  // 4) An unexpected amount is recorded (the money exists) but flagged for review; a coupon explains a discount.
  const E = await tenant("E");
  await send(charged(E.subId, "pay_Over00001", 59900));
  const over = await S.BillingPayment.findOne({ providerPaymentId: "pay_Over00001" });
  assert.equal(over!.needsReview, true); assert.match(over!.reviewReason!, /more than the plan price/);
  await send(charged(E.subId, "pay_Under0001", 100));
  assert.equal((await S.BillingPayment.findOne({ providerPaymentId: "pay_Under0001" }))!.needsReview, true);
  assert.equal(await S.BillingPayment.countDocuments({ needsReview: true, organizationId: E.org._id }), 2);

  // 5) Declined payment: a failed invoice/payment, no captured money, the existing plan untouched; then past_due after the gateway says so.
  const F = await tenant("F");
  await send(charged(F.subId, "pay_Good00001")); // active starter
  const planBefore = (await S.SaaSSubscription.findOne({ organizationId: F.org._id }))!;
  const failedEvent = (id: string, at = now + 10) => ({ entity: "event", event: "payment.failed", created_at: at, payload: { subscription: { entity: { id: F.subId } }, payment: { entity: { id, amount: 29900, currency: "INR", status: "failed", error_description: "Card declined" } } } });
  await send(failedEvent("pay_Fail00001"));
  await send(failedEvent("pay_Fail00001")); // duplicate delivery
  const failed = await S.BillingPayment.find({ organizationId: F.org._id, status: "failed" });
  assert.equal(failed.length, 1);
  assert.equal((await S.BillingInvoice.findOne({ providerPaymentId: "pay_Fail00001" }))!.status, "failed");
  const captured = await S.BillingPayment.find({ organizationId: F.org._id, status: "captured" });
  assert.deepEqual(captured.map((p) => p.providerPaymentId), ["pay_Good00001"], "a decline adds no captured money");
  const planAfter = (await S.SaaSSubscription.findOne({ organizationId: F.org._id }))!;
  assert.deepEqual([planAfter.planKey, planAfter.status, +planAfter.currentPeriodEnd!], [planBefore.planKey, "active", +planBefore.currentPeriodEnd!], "a failed payment never alters the paid plan or period");
  await send({ entity: "event", event: "subscription.pending", created_at: now + 20, payload: { subscription: { entity: { id: F.subId } } } });
  assert.equal((await S.SaaSSubscription.findOne({ organizationId: F.org._id }))!.status, "past_due");
  assert.equal((await send({ ...failedEvent("pay_Fail00002"), payload: { subscription: { entity: { id: F.subId } }, payment: { entity: { id: "pay_Fail00002", amount: 29900, currency: "EUR" } } } })).status, 200);
  assert.equal(await S.BillingPayment.countDocuments({ providerPaymentId: "pay_Fail00002" }), 0, "a failed-payment event is validated like any other");

  // 6) Refunds: counted once per refund id (even under different event ids), partial then full, capped, tenant-checked, never for failed payments.
  const G = await tenant("G");
  await send(charged(G.subId, "pay_Refd00001", 29900));
  const refundEv = (refundId: string, amount: number, payment = "pay_Refd00001", at = now + 5) => ({ entity: "event", event: "refund.processed", created_at: at, payload: { subscription: { entity: { id: G.subId } }, refund: { entity: { id: refundId, payment_id: payment, amount, currency: "INR" } } } });
  await send(refundEv("rfnd_000001", 10000));
  await send(refundEv("rfnd_000001", 10000)); // same refund, new event id
  await send(refundEv("rfnd_000001", 10000), "evt_refund_dup_fixed"); await send(refundEv("rfnd_000001", 10000), "evt_refund_dup_fixed");
  let p = await S.BillingPayment.findOne({ providerPaymentId: "pay_Refd00001" });
  assert.deepEqual([p!.refundedPaise, p!.status], [10000, "partially_refunded"]);
  assert.equal((await S.BillingInvoice.findOne({ providerPaymentId: "pay_Refd00001" }))!.refundedPaise, 10000);
  await send(refundEv("rfnd_000002", 19900));
  p = await S.BillingPayment.findOne({ providerPaymentId: "pay_Refd00001" });
  assert.deepEqual([p!.refundedPaise, p!.status, p!.needsReview], [29900, "refunded", false]);
  await send(refundEv("rfnd_000003", 500));
  p = await S.BillingPayment.findOne({ providerPaymentId: "pay_Refd00001" });
  assert.equal(p!.refundedPaise, 29900, "refunds are capped at the payment amount");
  assert.equal(p!.needsReview, true);
  assert.equal((await send(refundEv("rfnd_000004", 100, "pay_Fail00001"))).status, 200, "a refund of a payment from another tenant is rejected");
  assert.equal(await S.BillingPayment.countDocuments({ providerPaymentId: "pay_Fail00001", refundedPaise: { $gt: 0 } }), 0);
  assert.equal(((await send({ ...refundEv("rfnd_000005", 100), payload: { subscription: { entity: { id: G.subId } }, refund: { entity: { id: "rfnd_000005", payment_id: "pay_Refd00001", amount: 100, currency: "USD" } } } })) as { outcome?: string }).outcome, "rejected");

  // 7) Delayed delivery: an older payment arriving after a newer cancellation is recorded without reviving the subscription.
  const H = await tenant("H");
  await send(charged(H.subId, "pay_Late00001", 29900, {}, now));
  await send({ entity: "event", event: "subscription.cancelled", created_at: now + 100, payload: { subscription: { entity: { id: H.subId, current_end: now + 2592000 } } } });
  await send(charged(H.subId, "pay_Late00002", 29900, {}, now + 50));
  assert.equal((await S.SaaSSubscription.findOne({ organizationId: H.org._id }))!.status, "canceled");
  assert.equal(await S.BillingPayment.countDocuments({ providerPaymentId: "pay_Late00002" }), 1);

  // 8) Abandoned checkouts are closed by the reconciliation job and never touch the subscription.
  const I = await tenant("I");
  await S.BillingCheckout.collection.updateOne({ _id: I.checkout._id }, { $set: { createdAt: new Date(Date.now() - 9 * 86400000) } });
  const subI = JSON.stringify((await S.SaaSSubscription.findOne({ organizationId: I.org._id }))!.toObject());
  await runAllJobs(new Date(), { force: true });
  assert.equal((await S.BillingCheckout.findById(I.checkout._id))!.status, "abandoned");
  assert.equal(JSON.stringify((await S.SaaSSubscription.findOne({ organizationId: I.org._id }))!.toObject()).includes('"status":"active"'), JSON.stringify(JSON.parse(subI)).includes('"status":"active"'));

  // 9) Reconciliation against a simulated gateway listing: matches, a webhook that never arrived, an amount difference, a refund difference.
  const J = await tenant("J");
  const rec = (id: string, amount: number, status = "captured", refundedPaise = 0) => S.BillingPayment.create({ organizationId: J.org._id, provider: "razorpay", providerPaymentId: id, providerSubscriptionId: "sub_x", amountPaise: amount, status, refundedPaise, mode: "sandbox", capturedAt: new Date(Date.now() - 6 * 3600_000) });
  await rec("pay_Match0001", 29900); await rec("pay_Amount001", 29900); await rec("pay_Refund001", 29900, "partially_refunded", 10000); await rec("pay_Ghost0001", 29900);
  const gateway = [
    { id: "pay_Match0001", amount: 29900, currency: "INR", status: "captured", amount_refunded: 0 },
    { id: "pay_Amount001", amount: 59900, currency: "INR", status: "captured", amount_refunded: 0 },
    { id: "pay_Refund001", amount: 29900, currency: "INR", status: "captured", amount_refunded: 20000 },
    { id: "pay_Missing01", amount: 29900, currency: "INR", status: "captured", amount_refunded: 0 },
    { id: "pay_Declined1", amount: 29900, currency: "INR", status: "failed", amount_refunded: 0 },
  ];
  const fake = (async () => new Response(JSON.stringify({ items: gateway }), { status: 200 })) as never;
  const report = await reconcileWithProvider({ cfg: { provider: "razorpay", mode: "sandbox", keyId: "rzp_test_AbCdEf1234", keySecret: "keysecretkeysecret1234", webhookSecret: "x", configured: true, usable: true }, fetch: fake, days: 7 });
  assert.equal(report.ok, false);
  assert.deepEqual(report.discrepancies.map((d) => `${d.type}:${d.paymentId}`).sort(), ["amount:pay_Amount001", "missing-at-provider:pay_Ghost0001", "missing-locally:pay_Missing01", "refund:pay_Refund001"]);
  assert.ok(!JSON.stringify(report).includes("keysecretkeysecret1234"), "the report carries no credentials");
  const unreachable = (async () => new Response("{}", { status: 503 })) as never;
  await assert.rejects(reconcileWithProvider({ cfg: { provider: "razorpay", mode: "sandbox", keyId: "rzp_test_AbCdEf1234", keySecret: "x", webhookSecret: "x", configured: true, usable: true }, fetch: unreachable }), /HTTP 503/);

  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});
