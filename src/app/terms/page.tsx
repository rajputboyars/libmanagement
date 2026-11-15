import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage, Ph } from "@/components/legal";

export const metadata: Metadata = { title: "Terms of Service", description: "Terms of Service for StudyQuest.", alternates: { canonical: "/terms" } };

const toc: [string, string][] = [
  ["about", "About these terms"], ["accounts", "Accounts"], ["owners", "Library owners and staff"], ["students", "Students and library agreements"], ["fees", "Two kinds of fees"],
  ["billing", "Platform subscription and billing"], ["payments", "Payment processing, failed payments, cancellations and refunds"], ["use", "Acceptable use"], ["service", "Availability and maintenance"],
  ["suspension", "Suspension, termination, export and deletion"], ["ip", "Intellectual property and content"], ["liability", "Warranties and liability"], ["disputes", "Governing law and disputes"], ["contact", "Contact and changes"],
];

export default function Page() {
  return (
    <LegalPage kind="terms" title="Terms of Service" toc={toc} intro="These terms are the agreement between you and StudyQuest for using the website and app. Please read them together with the Privacy Notice.">
      <h2 id="about">1. About these terms</h2>
      <p>StudyQuest is operated by <Ph>legal name of the operating company or person</Ph>, <Ph>registered address</Ph> (“StudyQuest”, “we”). By creating an account, or by using StudyQuest after these terms are shown to you, you agree to them and confirm you have read our <Link href="/privacy">Privacy Notice</Link>. If you are under 18, your parent or guardian should read and agree on your behalf. <Ph>Counsel to confirm the position on minors’ capacity to contract and the wording needed</Ph>.</p>
      <p>You can ask for a copy of these terms and earlier versions at any time (section 14).</p>

      <h2 id="accounts">2. Accounts</h2>
      <ul>
        <li>Give accurate information, keep your password safe and tell us at once if you suspect misuse. You are responsible for what happens under your account.</li>
        <li>Library owners and platform administrators must protect their account with two-step sign-in. Lost authenticators are recovered with your recovery codes or through an identity-verified request to us.</li>
        <li>One person, one account. Do not share logins; staff get their own accounts from the owner.</li>
      </ul>

      <h2 id="owners">3. Library owners and staff</h2>
      <ul>
        <li>You decide which staff have access and what each role may do, and you are responsible for their use of the platform and for removing access when someone leaves.</li>
        <li>You are responsible for the records you enter about your members (admissions, fees, attendance, notes), for their accuracy, and for having the right to enter them. You decide why that personal data is collected and must give your members the notices and obtain the consents that the law requires of you. StudyQuest stores and processes those records on your behalf and under your instructions. <Ph>Counsel to confirm and, if needed, add a data-processing addendum between StudyQuest and library owners</Ph>.</li>
        <li>You must not add people to your library who have not agreed to join it, or import records you are not entitled to hold.</li>
        <li>You are responsible for your own taxes, licences and obligations as a library business, including any GST charged to your members.</li>
      </ul>

      <h2 id="students">4. Students and library agreements</h2>
      <ul>
        <li>A student account lets you use the study tools and, if you join a library with its Library ID, lets that library record your membership, seat, fees and attendance.</li>
        <li><strong>The library, not StudyQuest, is your counterparty for your membership.</strong> Seat allocation, library hours, rules, fees, refunds and disputes about your membership are between you and the library. StudyQuest is not a party to that agreement and does not collect your library fees.</li>
        <li>You can leave a library or delete your account from the app. Library fee, membership and attendance records remain in the library’s books in anonymised form (see the Privacy Notice).</li>
      </ul>

      <h2 id="fees">5. Two kinds of fees: please read this</h2>
      <table>
        <thead><tr><th></th><th>StudyQuest platform fees</th><th>Library fees</th></tr></thead>
        <tbody>
          <tr><td>Who pays whom</td><td>The library owner pays StudyQuest for a subscription plan.</td><td>A student pays the library for membership, a seat or services.</td></tr>
          <tr><td>Who sets the price</td><td>StudyQuest (see the Pricing page and your invoice).</td><td>The library.</td></tr>
          <tr><td>Where it is recorded</td><td>StudyQuest invoices, paid through Razorpay.</td><td>The library’s own fee and receipt records in the software. These are entries the library makes; StudyQuest does not receive or hold that money.</td></tr>
          <tr><td>Refunds and disputes</td><td>Section 7 of these terms.</td><td>Between the student and the library.</td></tr>
        </tbody>
      </table>

      <h2 id="billing">6. Platform subscription and billing</h2>
      <ul>
        <li>Plans, limits, features and prices are shown on the Pricing page and in the Billing screen at the time you subscribe. A free plan is available with limits. A trial may be offered on some plans; the length is shown when it is offered. <Ph>Trial terms and what happens at its end, as finally decided</Ph></li>
        <li>Paid plans renew automatically every month or year, as you choose, until you cancel. Prices are in Indian rupees. Applicable taxes are shown on the invoice. <Ph>GST treatment of platform fees (rate, GSTIN, place of supply, invoice format) to be confirmed by a chartered accountant before charging</Ph></li>
        <li>We may change prices or plans with notice shown in the app and by email. A change takes effect at your next renewal; you can cancel before then.</li>
        <li>Coupons and referral credits apply as described when you use them and have no cash value.</li>
        <li>To subscribe you must have accepted the current Terms; you can do this at checkout.</li>
      </ul>

      <h2 id="payments">7. Payment processing, failed payments, cancellations and refunds</h2>
      <ul>
        <li><strong>Payment processor.</strong> Subscription payments are collected through Razorpay. You enter payment details on Razorpay’s pages; StudyQuest never sees your card number, UPI PIN or bank login. Razorpay’s own terms and privacy policy apply to that processing. StudyQuest’s records of a payment follow the signed confirmations Razorpay sends us; a payment is treated as made only when Razorpay confirms it.</li>
        <li><strong>Failed payments.</strong> If a renewal payment fails, your plan stays active for a grace period (currently 7 days), we notify you, and you can update your payment method in Billing. If payment still fails, your account returns to the free plan’s limits. We never delete your data because of non-payment, and you can still export it.</li>
        <li><strong>Cancellation.</strong> You can cancel any time from Billing. Cancellation stops future renewals; paid features continue until the end of the period you have paid for.</li>
        <li><strong>Refunds.</strong> <Ph>Refund policy as decided by the business: eligibility, time limit, partial-period treatment</Ph>. Where we agree to a refund, it is returned through Razorpay to the original payment method and appears on your invoice; timing depends on your bank. Fees you paid to a library are not refundable by StudyQuest.</li>
        <li><strong>Mistaken or unrecognised charges.</strong> Write to us at once at the contact below with the payment reference; we will investigate against Razorpay’s records.</li>
      </ul>

      <h2 id="use">8. Acceptable use</h2>
      <p>You must not: break the law or others’ rights; access another library’s or user’s data or try to bypass access controls or limits; probe, scan or attack the service; upload malware; scrape or resell the service; impersonate others; post unlawful, abusive, hateful, sexual, or misleading content (including in community features and doubts); contact minors inappropriately; use the service to send spam; submit false payment information or abuse coupons and referrals; or let anyone use your account. Community features are moderated by libraries and by us, and content or profiles may be removed.</p>

      <h2 id="service">9. Availability and maintenance</h2>
      <p>We work to keep StudyQuest available but do not promise uninterrupted service. We may carry out maintenance, add or remove features, and apply technical limits. We will try to give notice of planned downtime. Study timers and similar tools rely on your device and connection. The service is not a substitute for your library’s own records where the law requires you to keep them; export your data regularly. <Ph>Any uptime commitment (service level) the business wishes to make</Ph>.</p>

      <h2 id="suspension">10. Suspension, termination, export and deletion</h2>
      <ul>
        <li>You can stop using StudyQuest at any time. Students can delete their account in the app; owners can request organization deletion, which we review (invoices may have to be kept by law).</li>
        <li>We may suspend or end access if you break these terms, put others or the service at risk, do not pay, or if the law requires. Where possible we will tell you why and give you a chance to fix the problem first. A suspended account cannot sign in; its data is kept while the issue is resolved.</li>
        <li>Data export remains available when a plan lapses. After termination we keep and delete data as described in the Privacy Notice.</li>
      </ul>

      <h2 id="ip">11. Intellectual property and content</h2>
      <p>StudyQuest, its software, design and branding belong to us or our licensors; we give you a limited, non-exclusive, non-transferable right to use the service under these terms. You keep ownership of content you add (records, notes, posts, uploads) and give us the permission needed to store, process and display it to run the service for you and the people you choose. Question banks and study content we provide are for your personal study and may not be copied or resold. <Ph>Counsel to confirm licence wording and any content takedown process</Ph>.</p>

      <h2 id="liability">12. Warranties and liability</h2>
      <p>The service is provided “as is”. Study tools, plans, AI-assisted explanations and reports are aids and can be wrong; they are not professional or exam-outcome advice. To the extent the law allows, we are not liable for indirect or consequential losses or loss of profit or data, and our total liability for a claim is limited to the platform fees you paid us in the <Ph>period, for example 12 months</Ph> before it arose. Nothing here limits liability that cannot lawfully be limited. <Ph>Counsel to confirm the limits and the indemnity wording appropriate under Indian law</Ph>.</p>

      <h2 id="disputes">13. Governing law and disputes</h2>
      <p>These terms are governed by the laws of India. Please write to us first so we can try to resolve a dispute informally. <Ph>Dispute-resolution mechanism (for example arbitration, seat and language) and the courts with jurisdiction, as decided with counsel</Ph>. Consumers keep any rights they have under the Consumer Protection Act, 2019 and other mandatory law.</p>

      <h2 id="contact">14. Contact and changes</h2>
      <p>Contact: <Ph>support / legal email address</Ph>, <Ph>postal address</Ph>. Grievance Officer: see the <Link href="/privacy#grievance">Privacy Notice</Link>. We may update these terms; the version number at the top changes, signed-in users are told in the app, and we ask you to accept the new version where acceptance is needed (for example before a new subscription). Using the service after a change that does not need your acceptance means you accept it; if you disagree, you can stop using the service and delete your account.</p>
    </LegalPage>
  );
}
