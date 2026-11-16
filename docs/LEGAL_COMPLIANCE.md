# Legal, privacy and compliance readiness

> **Status: DRAFT. Nothing here is legal or tax advice, and nothing has been reviewed by a lawyer or chartered accountant.** The Privacy Notice
> (`/privacy`) and Terms of Service (`/terms`) were written from how the platform actually behaves (traced in code, see "Data inventory").
> They show a visible **"Draft pending legal review"** notice and highlighted `[placeholders]` for every fact only the business can supply.
> No company name, address, registration or tax number, contact detail or grievance officer was invented. **Do not describe the platform as
> compliant, certified or lawyer-approved** until the checklist below is complete and evidenced. To go live, change `LEGAL_REVIEW_STATUS`
> in `src/lib/legal.ts` to `"reviewed"` only with written evidence of the review.

## What the product now does

| Area | Implementation |
|---|---|
| Legal pages | `/privacy` and `/terms`: public (signed-out), responsive, in the existing design system, versioned, with a table of contents, changelog and a draft banner. Linked from the public footer, sign-in, registration, account activation, student join, the billing screen and the Security & privacy page. |
| Versioning | `src/lib/legal.ts`: `LEGAL_VERSIONS` (terms, privacy), `LEGAL_CHANGELOG`, `LEGAL_REVIEW_STATUS`. Publishing a new version = edit text, bump the version, add a changelog line. |
| Consent capture | `ConsentRecord` (append-only): user reference, kind (`terms` or `marketing`), version, accepted flag, timestamp, source (`register`, `invite-activation`, `prompt`, `settings`, `checkout`). No IP address or other personal data is stored with it. |
| Required consent | **Registration requires `acceptTerms: true`, enforced on the server** (a direct API call without it gets `400 terms-required` and creates no account). Accounts created by a library (import/invitation) must accept before activation (the reset link is not consumed by a refusal). **Subscribing requires the current Terms** (accepted at checkout if not yet). |
| Optional consent | Marketing email is a **separate, optional, unticked** checkbox; it is never inferred from accepting the Terms and can be switched on/off under Security & privacy (each change is a new record). No marketing campaigns exist yet; the record is only so a choice can be honoured. |
| Existing users | **No lock-out.** People without a record, or with an older version, see a dismissible banner and an "Accept current Terms" button; the account keeps working. |
| Privacy | `GET /api/consent` returns only the caller's own state (no user parameter); consent history is part of the person's data export; consent records are not tenant data and are not visible to library owners. |

## Data inventory (traced in the implementation, basis of the Privacy Notice)

- **Accounts:** name, email, bcrypt password hash, role, session cookie `sq-session` (HttpOnly, 7 days). Owners/admins: TOTP seed (encrypted), recovery codes (hashed).
- **Library owners/orgs:** library name/address/city/description/facilities/hours, geofence point, billing email, optional GSTIN, subscription/invoice/payment references (Razorpay ids, amount, status, method label, refunds), staff roles, audit logs, support tickets, CRM leads (prospect name/phone/email entered by owners), imported/invited students (name, email, phone).
- **Students:** memberships, seat, fees and payments recorded by libraries, attendance times; study data (sessions, goals, XP/coins, plans, tests, notes, flashcards, doubts with optional image stored in the database), community profile (alias, age band, guardian name/contact for minors, library approval), leaderboard opt-in, friends, posts, web-push address (opt-in).
- **Location:** a device reading is sent at punch time only to compare with the library geofence; coordinates are **not stored** (the schema has no field for them). Re-verify if punch code changes.
- **Cookies/storage:** one essential session cookie; localStorage UI preferences; service worker caches only the offline page. No analytics, advertising or third-party tracker scripts were found in `src`.
- **Processors/recipients:** MongoDB Atlas (database), hosting provider **(undecided)**, Razorpay (owner subscription payments; card/UPI data never reaches us), email provider **(not chosen; webhook relay)**, optional WhatsApp provider, browser push services, backup storage **(not chosen)**, monitoring/alerting **(not chosen)**. The AI "doubt solver" uses a self-hosted Ollama model or a built-in fallback (no third-party AI).
- **Retention:** student deletion erases study data and anonymises the account (library fee/attendance/membership records stay in the library's books); owner deletion is by reviewed request; sessions 7 days; reset links short-lived; backups planned 35 days + 12 monthly (not yet enabled); logs scrubbed (retention depends on the undecided log service); invoices kept as tax law requires.

## Indian legal framework: what was researched and what is still an assumption

Research used secondary summaries of the primary texts because the official PDFs could not be machine-read here. **Every item below must be verified by counsel against the Gazette text.**

- **Digital Personal Data Protection Act, 2023** and the **Digital Personal Data Protection Rules, 2025**: notified by the Government in **November 2025** (sources give 13 or 14 November). Commencement is **phased**: the institutional provisions (including the Data Protection Board) took effect on publication; consent-manager provisions after 12 months; the **main obligations for data fiduciaries (notice, consent, children's data, security safeguards, breach intimation, retention/erasure, data-principal rights, grievance redressal) after 18 months, i.e. around mid-May 2027**. Sources: PIB releases ([backgrounder](https://www.pib.gov.in/PressReleasePage.aspx?PRID=2190014&reg=3&lang=2), [Data Protection Board release](https://www.pib.gov.in/PressReleasePage.aspx?PRID=2190655&reg=48&lang=2), [PDF note](https://static.pib.gov.in/WriteReadData/specificdocs/documents/2025/nov/doc20251117695301.pdf)), [Storyboard18](https://www.storyboard18.com/amp/digital/breaking-govt-notifies-final-dpdp-rules-sets-staggered-rollout-with-key-obligations-for-data-fiduciaries-84201.htm), [Mondaq](https://www.mondaq.com/india/data-protection/1713500/regulatory-update-notification-of-the-digital-personal-data-protection-rules-2025), [AMSS](https://www.amsshardul.com/insight/enforcement-of-the-dpdp-act-and-notification-of-the-dpdp-rules/). *Verify:* exact dates and rule numbers on [meity.gov.in](https://www.meity.gov.in/). The launch date relative to May 2027 decides whether the main obligations already bind. Reported specifics to verify: data principals' requests answered within a maximum of 90 days; penalties up to ₹250 crore for failing to maintain reasonable security safeguards; a digital Data Protection Board with appeals to TDSAT.
- **Children (under 18):** verifiable consent of a parent/guardian before processing a child's data (DPDP Act s.9 and the Rules), with a **narrow** Fourth-Schedule exemption for educational institutions limited to tracking/behavioural monitoring for educational activities or safety, and a prohibition on targeted advertising to children. Commentary differs on how far the exemption reaches and whether **coaching/study libraries count as "educational institutions"** ([S.S. Rana](https://ssrana.in/articles/schools-coaching-centres-platforms-processing-childrens-data-are-you-compliant/), [Acavya](https://acavya.com/guides/verifiable-parental-consent-dpdp-rules), [Pacta](https://www.pacta.in/post/impact-of-dpdp-rules-on-educational-institutions-part-ii-of-a-3-part-series), [Amitrix](https://amitrix.in/blog/dpdp-act-for-schools/)). The 72-hour breach-report and one-year log-retention figures that circulate were **not confirmed** by the sources reviewed.
- **Until the DPDP obligations commence,** the Information Technology Act, 2000 (including s.43A) and the SPDI Rules, 2011 are the operative data-protection rules for sensitive personal data: counsel to confirm applicability, consent and reasonable-security expectations. Also to check: CERT-In incident-reporting directions (2022), IT intermediary rules for the community/posts features, Consumer Protection Act 2019 and E-Commerce Rules (subscription, refund and grievance disclosures), and RBI rules for the payment aggregator role (Razorpay's, not ours).
- **Platform roles:** the pages describe StudyQuest as deciding purposes for accounts/study tools/billing, and as storing library member records on the library's behalf. Whether that is "data fiduciary" vs "data processor" (and joint arrangements) is a **legal conclusion not made here**; counsel to decide and, if needed, add a data-processing agreement for libraries.

## Payments and tax (what the code does; what a CA must confirm)

- **Roles:** StudyQuest sells subscriptions to library owners; **Razorpay** (a payment aggregator regulated by RBI) collects the money and handles card/UPI data. Our system records only Razorpay ids, amount, status, method label and refunds, and treats a payment as real only on a signed Razorpay confirmation (docs/BILLING.md). Library fees recorded by owners for students are **not** processed by StudyQuest or Razorpay.
- **Invoices:** a sequential number (prefix + year + counter), plan, period, amounts in paise, tax mode `none`/`inclusive`/`exclusive` with a platform-wide rate, optional GSTIN field on the organization. **Not implemented / needs CA review:** whether and at what rate GST applies to subscription fees; StudyQuest's GST registration/turnover threshold and GSTIN on invoices; HSN/SAC code; place of supply and CGST/SGST vs IGST split by customer state; customer GSTIN capture and B2B invoice format; credit notes for refunds; e-invoicing thresholds; TDS/TCS and reverse-charge questions; retention periods for invoices. Do not enable tax display until a CA signs off the configuration.
- **Refund/cancellation policy:** the Terms contain a placeholder; the technical behaviour is cancel-at-period-end, grace period (default 7 days) then free-plan limits, refunds only as issued at the gateway.

## Owner-supplied details still missing (all shown as highlighted placeholders)

Legal name of the operator and registered address; CIN/registration number (if any); privacy contact email; **Grievance Officer** (name, designation, email, phone, postal address, hours, acknowledgement and resolution periods); support/legal email; effective dates; hosting provider and region; database region; email, WhatsApp/SMS, backup storage and monitoring providers; log and invoice/consent retention periods; breach-notification wording; trial terms; refund policy (eligibility, window, partial periods); GST statement; liability cap period; dispute-resolution mechanism, seat and jurisdiction; any uptime commitment; cross-border transfer statement.

## Review checklist (tick only with evidence)

- [ ] Counsel reviewed `/privacy` and `/terms` line by line; written approval recorded; `LEGAL_REVIEW_STATUS` set to `reviewed`; all placeholders replaced; draft banner gone; effective date set; version bumped.
- [ ] Counsel decided the DPDP role of StudyQuest vs libraries; data-processing terms with library owners if needed; list of processors finalised (and cross-border position if any).
- [ ] Children's data: decision on age gating, verifiable parental consent, the Fourth-Schedule exemption for libraries, and the changes needed at sign-up and library-join before under-18s are served. (Today the platform does **not** verify age or collect general guardian consent; only the optional community feature collects guardian details for minors.)
- [ ] DPDP notice/consent text matches the final rules in force at launch; consent withdrawal, 90-day response process and grievance workflow operational; Data Protection Board complaint route stated.
- [ ] Retention schedule approved (invoices, consent records, logs, backups) and implemented; backups deletion behaviour documented.
- [ ] Breach response plan written (who decides, authority and user notification, CERT-In) and rehearsed.
- [ ] CA signed off GST/invoice configuration (see above) and refund/credit-note handling; Razorpay account/KYC and its settlement terms checked.
- [ ] Grievance Officer appointed and contactable; privacy inbox monitored.
- [ ] Marketing: if campaigns are introduced, send only to people whose latest `marketing` record is accepted, include unsubscribe, and update the Privacy Notice.
- [ ] Re-run the legal tests (`tests/legal.test.ts` and the HTTP suite R13 block) after any text or version change.

## Operating the versions

1. Edit the page text. 2. Bump the version in `src/lib/legal.ts` and add a changelog entry. 3. Deploy: signed-in people without the new version see a banner (never a lock-out); new sign-ups and new subscriptions record the new version. 4. To see who accepted which version, query `ConsentRecord` by `version` (counts only; do not expose individual records to other tenants).
