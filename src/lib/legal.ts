/**
 * Single source of truth for the published legal documents. Safe to import from client and server code (no server dependencies).
 * To publish a new version of the Terms or the Privacy Notice: change the text, bump the version here and add a line to LEGAL_CHANGELOG.
 * Existing users are then asked (never forced) to accept the new version; sign-ups and paid checkouts require the current one.
 */
export const LEGAL_VERSIONS = { terms: "2026-11-16", privacy: "2026-11-16" } as const;
export type LegalKind = keyof typeof LEGAL_VERSIONS;
/** "draft" until a qualified lawyer has reviewed the text. Flip only with written evidence of that review (docs/LEGAL_COMPLIANCE.md). */
export const LEGAL_REVIEW_STATUS: "draft" | "reviewed" = "draft";
export const LEGAL_CHANGELOG: { version: string; kind: LegalKind | "both"; note: string }[] = [
  { version: "2026-11-16", kind: "both", note: "First full text, written from the platform's actual data practices. Draft pending legal review." },
];

/** What a person can consent to. `terms` covers the Terms of Service and acknowledgement of the Privacy Notice and is required to use the service. `marketing` is optional and never bundled. */
export const CONSENT_KINDS = ["terms", "marketing"] as const;
export type ConsentKind = (typeof CONSENT_KINDS)[number];
/** The version string recorded for a consent kind: both legal documents for `terms`, a separate counter for `marketing`. */
export const consentVersion = (kind: ConsentKind) => (kind === "terms" ? `${LEGAL_VERSIONS.terms}|${LEGAL_VERSIONS.privacy}` : "marketing-v1");

export type ConsentRow = { kind: string; version: string; accepted: boolean; createdAt?: Date | string };
/** Latest decision per kind (records are append-only; the newest wins). */
export function latestConsents(rows: ConsentRow[]) {
  const out = new Map<string, ConsentRow>();
  for (const r of [...rows].sort((a, b) => +new Date(a.createdAt ?? 0) - +new Date(b.createdAt ?? 0))) out.set(r.kind, r);
  return out;
}
/** True when the person has not accepted the CURRENT Terms+Privacy versions. This only drives a prompt, never a lock-out of existing accounts. */
export function termsNeedAcceptance(rows: ConsentRow[]) {
  const t = latestConsents(rows).get("terms");
  return !t || !t.accepted || t.version !== consentVersion("terms");
}
