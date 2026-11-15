import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CONSENT_KINDS, LEGAL_CHANGELOG, LEGAL_REVIEW_STATUS, LEGAL_VERSIONS, consentVersion, latestConsents, termsNeedAcceptance } from "../src/lib/legal";

const T = (v: string, accepted = true, at = "2026-11-16T10:00:00Z", kind = "terms") => ({ kind, version: v, accepted, createdAt: at });

test("consent logic: newest record wins, a changed version asks again, absence is a prompt", () => {
  const current = consentVersion("terms");
  assert.equal(current, `${LEGAL_VERSIONS.terms}|${LEGAL_VERSIONS.privacy}`);
  assert.equal(termsNeedAcceptance([]), true, "no record: prompt (never a block)");
  assert.equal(termsNeedAcceptance([T(current)]), false);
  assert.equal(termsNeedAcceptance([T("1999-01-01|1999-01-01")]), true, "an older version needs re-acceptance");
  assert.equal(termsNeedAcceptance([T("1999-01-01|1999-01-01", true, "2026-01-01T00:00:00Z"), T(current, true, "2026-11-16T00:00:00Z")]), false, "the newest wins");
  assert.equal(termsNeedAcceptance([T(current, true, "2026-01-01T00:00:00Z"), T(current, false, "2026-11-16T00:00:00Z")]), true, "a later decline is honoured");
  assert.equal(termsNeedAcceptance([T(current, true, "2026-01-01T00:00:00Z", "terms"), T("marketing-v1", true, "2026-11-17T00:00:00Z", "marketing")]), false, "marketing never affects the Terms");
  assert.equal(termsNeedAcceptance([T("marketing-v1", true, undefined, "marketing")]), true, "marketing never counts as accepting the Terms");
  const latest = latestConsents([T(current, true, "2026-01-01T00:00:00Z", "marketing"), T(current, false, "2026-02-01T00:00:00Z", "marketing")]);
  assert.equal(latest.get("marketing")!.accepted, false);
  assert.deepEqual([...CONSENT_KINDS], ["terms", "marketing"]);
  assert.notEqual(consentVersion("marketing"), consentVersion("terms"));
});

test("versions are tracked: every published version has a changelog entry and a status", () => {
  for (const v of Object.values(LEGAL_VERSIONS)) assert.match(v, /^\d{4}-\d{2}-\d{2}$/);
  for (const kind of ["terms", "privacy"] as const) assert.ok(LEGAL_CHANGELOG.some((c) => (c.kind === kind || c.kind === "both") && c.version === LEGAL_VERSIONS[kind]), `${kind} version ${LEGAL_VERSIONS[kind]} is in the changelog`);
  assert.equal(LEGAL_REVIEW_STATUS, "draft", "stays draft until a lawyer's written review exists (docs/LEGAL_COMPLIANCE.md)");
});

async function html(path: string) {
  const mod = await import(path);
  return renderToStaticMarkup(createElement(mod.default));
}
const text = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&#x27;|&apos;/g, "'").replace(/\s+/g, " ");

test("Privacy Notice covers the actual data practices and invents no company details", async () => {
  const h = await html("../src/app/privacy/page");
  const t = text(h);
  for (const id of ["who", "collect", "why", "share", "cookies", "security", "retention", "rights", "children", "grievance"]) assert.ok(h.includes(`id="${id}"`), `section ${id}`);
  for (const must of ["Razorpay", "MongoDB Atlas", "sq-session", "attendance", "geofence|location", "guardian", "Delete my account|delete your account", "Download my data", "Grievance Officer", "Digital Personal Data Protection", "under 18", "marketing", "Backups", "tenant|one library", "do not sell"]) assert.ok(new RegExp(must, "i").test(t), `mentions ${must}`);
  assert.match(t, /We do not save the coordinates/);
  assert.match(t, /do not use advertising or third-party analytics trackers/i);
  assert.ok(!/we (do not|don't) collect (any )?(personal )?(data|information)/i.test(t), "never claims no data is collected");
  assert.match(t, /Draft pending legal review/);
  assert.ok((h.match(/data-placeholder="true"/g) ?? []).length >= 20, "owner-supplied details are marked, not invented");
  // nothing that looks like a real contact detail or registration number outside placeholders
  const outside = text(h.replace(/<span class="legal-ph"[^>]*>.*?<\/span>/g, " "));
  assert.ok(!/[\w.+-]+@[\w-]+\.[\w.-]+/.test(outside), "no email address outside placeholders");
  assert.ok(!/\b\d{10}\b|\+91|\bCIN\b\s*[:-]?\s*[A-Z]\d{5}|\bGSTIN\b\s*[:-]?\s*\d{2}[A-Z]{5}/.test(outside), "no phone, CIN or GSTIN values");
  assert.ok(h.includes(`data-legal-version="privacy">${LEGAL_VERSIONS.privacy}`));
});

test("Terms of Service cover subscription, payments, roles, conduct, termination and separate library fees", async () => {
  const h = await html("../src/app/terms/page");
  const t = text(h);
  for (const id of ["accounts", "owners", "students", "fees", "billing", "payments", "use", "service", "suspension", "ip", "liability", "disputes", "contact"]) assert.ok(h.includes(`id="${id}"`), `section ${id}`);
  for (const must of ["Razorpay", "grace period", "Cancellation", "Refunds", "Acceptable use", "export", "governed by the laws of India", "StudyQuest platform fees", "Library fees", "not a party", "Consumer Protection Act", "two-step"]) assert.ok(new RegExp(must, "i").test(t), `mentions ${must}`);
  assert.match(t, /never sees your card number/i);
  assert.match(t, /does not collect your library fees|does not receive or hold that money/i);
  assert.match(t, /GST treatment of platform fees/);
  assert.ok(!/GSTIN\s*[:-]?\s*\d{2}[A-Z]{5}/.test(t));
  assert.match(t, /Draft pending legal review/);
  assert.ok((h.match(/data-placeholder="true"/g) ?? []).length >= 10);
  assert.ok(h.includes(`data-legal-version="terms">${LEGAL_VERSIONS.terms}`));
  assert.ok(h.includes('href="/privacy"'), "the Terms link to the Privacy Notice");
});
