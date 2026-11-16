import { BillingPayment } from "./saas-models";
import { providerConfig, razorpayBase, type ProviderConfig } from "./billing";
import { log, scrubText } from "./log";

/**
 * Provider-side reconciliation: compares the gateway's own list of payments (the source of truth for money received) with the local
 * BillingPayment records. It only REPORTS: nothing is created, changed or refunded automatically.
 */
export type ProviderPayment = { id: string; amount: number; currency: string; status: string; amount_refunded?: number; created_at?: number };
export type LocalPayment = { providerPaymentId: string; amountPaise: number; status: string; refundedPaise: number; currency?: string; capturedAt?: Date; createdAt?: Date };
export type Discrepancy = { type: "missing-locally" | "missing-at-provider" | "amount" | "currency" | "status" | "refund"; paymentId: string; detail: string };

const PAID = new Set(["captured", "refunded"]);
const LOCAL_PAID = new Set(["captured", "partially_refunded", "refunded"]);

/** Pure comparison (unit-tested). `complete` = the provider listing was not truncated, so absence at the provider is meaningful. */
export function comparePayments(provider: ProviderPayment[], local: LocalPayment[], opts: { complete: boolean; windowStartSec: number; nowSec?: number }): Discrepancy[] {
  const nowSec = opts.nowSec ?? Math.floor(Date.now() / 1000);
  const out: Discrepancy[] = [];
  const mine = new Map(local.map((l) => [l.providerPaymentId, l]));
  const theirs = new Map(provider.map((p) => [p.id, p]));
  for (const p of provider) {
    const l = mine.get(p.id);
    if (!l) { if (PAID.has(p.status)) out.push({ type: "missing-locally", paymentId: p.id, detail: `gateway ${p.status} ${p.amount} ${p.currency} but no local record (webhook missed or rejected)` }); continue; }
    if (p.currency !== "INR") out.push({ type: "currency", paymentId: p.id, detail: `gateway currency is ${String(p.currency).slice(0, 8)}` });
    if (p.amount !== l.amountPaise) out.push({ type: "amount", paymentId: p.id, detail: `gateway ${p.amount} paise, local ${l.amountPaise} paise` });
    if (p.status === "failed" && LOCAL_PAID.has(l.status)) out.push({ type: "status", paymentId: p.id, detail: "gateway says failed, local says paid" });
    if (PAID.has(p.status) && l.status === "failed") out.push({ type: "status", paymentId: p.id, detail: "gateway says paid, local says failed" });
    if (p.status === "refunded" && l.status !== "refunded") out.push({ type: "status", paymentId: p.id, detail: `gateway fully refunded, local status ${l.status}` });
    if (PAID.has(p.status) && (p.amount_refunded ?? 0) !== l.refundedPaise) out.push({ type: "refund", paymentId: p.id, detail: `gateway refunded ${p.amount_refunded ?? 0} paise, local ${l.refundedPaise} paise` });
  }
  if (opts.complete) {
    for (const l of local) {
      if (!LOCAL_PAID.has(l.status) || theirs.has(l.providerPaymentId)) continue;
      const at = (l.capturedAt ?? l.createdAt)?.getTime() ?? 0;
      // Ignore payments at the window edges (not yet listed / listed in the previous window): one hour of margin each side.
      if (at / 1000 >= opts.windowStartSec + 3600 && at / 1000 <= nowSec - 3600) out.push({ type: "missing-at-provider", paymentId: l.providerPaymentId, detail: "recorded as paid locally but unknown to the gateway" });
    }
  }
  return out;
}

/** Reads the gateway's payments for [from, to] (official `GET /payments`, paginated, read-only). */
export async function fetchProviderPayments(cfg: Pick<ProviderConfig, "keyId" | "keySecret">, range: { from: number; to: number }, opts: { fetch?: typeof fetch; maxPages?: number } = {}) {
  const doFetch = opts.fetch ?? fetch, max = opts.maxPages ?? 50, items: ProviderPayment[] = [];
  const auth = `Basic ${Buffer.from(`${cfg.keyId}:${cfg.keySecret}`).toString("base64")}`;
  for (let page = 0; page < max; page++) {
    const url = `${razorpayBase(cfg)}/payments?from=${range.from}&to=${range.to}&count=100&skip=${page * 100}`;
    const res = await doFetch(url, { headers: { Authorization: auth }, signal: AbortSignal.timeout(20000) });
    const json = (await res.json().catch(() => ({}))) as { items?: ProviderPayment[]; error?: { description?: string } };
    if (!res.ok) throw new Error(`gateway answered HTTP ${res.status}: ${scrubText(json.error?.description ?? "request failed")}`);
    const batch = json.items ?? [];
    items.push(...batch.map((p) => ({ id: String(p.id), amount: Number(p.amount), currency: String(p.currency), status: String(p.status), amount_refunded: Number(p.amount_refunded ?? 0), created_at: p.created_at })));
    if (batch.length < 100) return { items, complete: true };
  }
  return { items, complete: false };
}

export type ReconcileReport = { ok: boolean; mode: string; windowDays: number; providerPayments: number; localPayments: number; complete: boolean; discrepancies: Discrepancy[] };
export async function reconcileWithProvider(opts: { days?: number; now?: Date; cfg?: ProviderConfig; fetch?: typeof fetch } = {}): Promise<ReconcileReport> {
  const cfg = opts.cfg ?? providerConfig();
  if (cfg.provider !== "razorpay" || !cfg.keyId || !cfg.keySecret) throw new Error("Provider reconciliation needs Razorpay credentials");
  const days = opts.days ?? 7, now = opts.now ?? new Date();
  const to = Math.floor(now.getTime() / 1000), from = to - days * 86400;
  const remote = await fetchProviderPayments(cfg, { from, to }, { fetch: opts.fetch });
  const since = new Date(from * 1000);
  const local = await BillingPayment.find({ provider: "razorpay", mode: cfg.mode, $or: [{ capturedAt: { $gte: since } }, { createdAt: { $gte: since } }] }).lean<LocalPayment[]>();
  const discrepancies = comparePayments(remote.items, local, { complete: remote.complete, windowStartSec: from });
  if (discrepancies.length) log("error", "billing.reconciliation_mismatch", { count: discrepancies.length, sample: discrepancies.slice(0, 5) });
  return { ok: discrepancies.length === 0, mode: cfg.mode, windowDays: days, providerPayments: remote.items.length, localPayments: local.length, complete: remote.complete, discrepancies };
}
