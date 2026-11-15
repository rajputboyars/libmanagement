import type { ClientSession, Types } from "mongoose";
import { ConsentRecord } from "./ops-models";
import { CONSENT_KINDS, LEGAL_VERSIONS, consentVersion, latestConsents, termsNeedAcceptance, type ConsentKind } from "./legal";

type Id = Types.ObjectId | string;
export type ConsentSource = "register" | "invite-activation" | "prompt" | "settings" | "checkout";

/** Appends consent decisions. Never updates or deletes earlier records. */
export async function recordConsent(userId: Id, entries: { kind: ConsentKind; accepted: boolean }[], source: ConsentSource, opts: { session?: ClientSession } = {}) {
  if (!entries.length) return;
  await ConsentRecord.create(entries.map((e) => ({ userId, kind: e.kind, version: consentVersion(e.kind), accepted: e.accepted, source })), { session: opts.session, ordered: true });
}

/** The caller's own consent state. Reads only the given user's records. */
export async function consentStatus(userId: Id) {
  const rows = await ConsentRecord.find({ userId }).sort({ createdAt: 1 }).select("kind version accepted source createdAt").lean<{ kind: string; version: string; accepted: boolean; source: string; createdAt: Date }[]>();
  const latest = latestConsents(rows);
  const view = (k: ConsentKind) => { const r = latest.get(k); return r ? { accepted: r.accepted, version: r.version, at: r.createdAt, current: r.version === consentVersion(k), source: (r as { source?: string }).source } : null; };
  return { versions: LEGAL_VERSIONS, terms: view("terms"), marketing: view("marketing"), termsNeedAcceptance: termsNeedAcceptance(rows), history: rows.length };
}
export { CONSENT_KINDS };
