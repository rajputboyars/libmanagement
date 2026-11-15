export type Entity = Record<string, unknown>;
export type Verdict = { ok: true } | { ok: false; code: string; reason: string };

export const MAX_PAYMENT_PAISE = 100_000_000; // ₹10,00,000: anything above is treated as malformed for this product
const isInt = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v);

/**
 * Structural and tenant validation of a payment entity from a (signature-verified) event. A failure means the event must not touch
 * invoices, payments or subscriptions at all. `provider` "razorpay" is strict (id shape, currency required); the local sandbox only
 * requires a currency, when present, to be INR.
 */
export function validatePaymentEntity(pay: Entity, o: { provider: string; kind: "captured" | "failed"; subscriptionOrgId: string; providerSubscriptionId: string; checkoutId?: string; checkoutOrgId?: string }): Verdict {
  const bad = (code: string, reason: string): Verdict => ({ ok: false, code, reason });
  const strict = o.provider === "razorpay";
  if (!pay || typeof pay !== "object") return bad("payment-id", "payment entity is missing");
  if (typeof pay.id !== "string" || !pay.id) return bad("payment-id", "payment id is missing");
  if (strict && !/^pay_[A-Za-z0-9]{6,40}$/.test(pay.id)) return bad("payment-id", "payment id has an unexpected format");
  if (!isInt(pay.amount) || pay.amount <= 0) return bad("amount", "amount must be a positive whole number of paise");
  if (pay.amount > MAX_PAYMENT_PAISE) return bad("amount", "amount is implausibly large");
  if (pay.currency === undefined ? strict : pay.currency !== "INR") return bad("currency", `currency must be INR (got ${typeof pay.currency === "string" ? pay.currency.slice(0, 8) : "none"})`);
  if (pay.status !== undefined && pay.status !== (o.kind === "captured" ? "captured" : "failed")) return bad("status", `payment status "${String(pay.status).slice(0, 20)}" does not match a ${o.kind} event`);
  const notes = (pay.notes && typeof pay.notes === "object" ? pay.notes : {}) as Entity;
  if (typeof notes.organizationId === "string" && notes.organizationId && notes.organizationId !== o.subscriptionOrgId) return bad("tenant", "payment belongs to a different organization than its subscription");
  if (typeof notes.checkoutId === "string" && notes.checkoutId && o.checkoutId && notes.checkoutId !== o.checkoutId) return bad("checkout", "payment references a different checkout");
  if (o.checkoutOrgId && o.checkoutOrgId !== o.subscriptionOrgId) return bad("tenant", "checkout and subscription belong to different organizations");
  if (typeof pay.subscription_id === "string" && pay.subscription_id && o.providerSubscriptionId && pay.subscription_id !== o.providerSubscriptionId) return bad("subscription", "payment references a different subscription");
  return { ok: true };
}

/**
 * Compares what the gateway charged with the plan price. Returns a human-readable reason when finance should look at it, otherwise null.
 * The payment is still recorded (real money moved): this only flags it.
 */
export function reviewAmount(o: { amountPaise: number; listPaise: number; hasCoupon: boolean }): string | null {
  if (o.listPaise > 0 && o.amountPaise > o.listPaise) return `charged ${o.amountPaise} paise, more than the plan price ${o.listPaise}`;
  if (o.listPaise > 0 && o.amountPaise < o.listPaise && !o.hasCoupon) return `charged ${o.amountPaise} paise, less than the plan price ${o.listPaise}, with no coupon or offer on record`;
  return null;
}

/** Refund entity validation. */
export function validateRefundEntity(refund: Entity): Verdict {
  if (typeof refund.id !== "string" || !refund.id) return { ok: false, code: "refund-id", reason: "refund id is missing" };
  if (!isInt(refund.amount) || refund.amount <= 0 || refund.amount > MAX_PAYMENT_PAISE) return { ok: false, code: "amount", reason: "refund amount must be a positive whole number of paise" };
  if (refund.currency !== undefined && refund.currency !== "INR") return { ok: false, code: "currency", reason: "refund currency must be INR" };
  if (typeof refund.payment_id !== "string" || !refund.payment_id) return { ok: false, code: "payment-id", reason: "refund has no payment id" };
  return { ok: true };
}
