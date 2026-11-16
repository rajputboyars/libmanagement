import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage, Ph } from "@/components/legal";

export const metadata: Metadata = { title: "Privacy Notice", description: "How StudyQuest collects, uses, shares and protects personal data.", alternates: { canonical: "/privacy" } };

const toc: [string, string][] = [
  ["who", "Who we are and our role"], ["collect", "What we collect"], ["why", "Why we use it"], ["share", "Who we share it with"], ["cookies", "Cookies, sessions and logs"],
  ["security", "How we protect it"], ["retention", "How long we keep it"], ["rights", "Your choices and rights"], ["children", "Children and students under 18"], ["grievance", "Questions and grievances"], ["changes-note", "Changes to this notice"],
];

export default function Page() {
  return (
    <LegalPage kind="privacy" title="Privacy Notice" toc={toc} intro="StudyQuest helps study libraries run their business and helps students build study habits. This notice explains, in plain language, what personal data the platform actually handles, why, who sees it, how long it is kept and what you can do about it.">
      <h2 id="who">1. Who we are and our role</h2>
      <p><strong>Operator:</strong> <Ph>legal name of the company or person operating StudyQuest</Ph>, <Ph>registered address</Ph>, <Ph>CIN / registration number, if any</Ph> (“StudyQuest”, “we”). Privacy contact: <Ph>privacy email address</Ph>. Grievance contact: see section 10.</p>
      <p>StudyQuest is used in three ways, and who decides what happens to your data depends on which:</p>
      <ul>
        <li><strong>Your account and the study tools</strong> (sign-in, security, study timer, plans, tests, notes, doubts, community, notifications, discovery of libraries): StudyQuest decides why and how this data is used.</li>
        <li><strong>A library’s own records about its members</strong> (admission, seat, attendance, membership, fees and receipts recorded by the library): the <strong>library</strong> decides what to record and why; StudyQuest provides the software and stores the records on the library’s behalf. If you are a student, the library you joined is the first place to ask about these records.</li>
        <li><strong>Our subscription billing</strong> (what library owners pay StudyQuest): StudyQuest is the seller; payment is processed by Razorpay (section 4).</li>
      </ul>
      <p className="legal-meta">The split above describes how the software works. <Ph>Counsel to confirm how the roles of “data fiduciary” and “data processor” apply under India’s Digital Personal Data Protection Act, 2023 and wording to be adjusted accordingly</Ph>.</p>

      <h2 id="collect">2. What we collect</h2>
      <p>This list reflects what the platform stores today. We do not use advertising or third-party analytics trackers on the site or in the app.</p>
      <table>
        <thead><tr><th>Who</th><th>What</th><th>Where it comes from</th></tr></thead>
        <tbody>
          <tr><td>Everyone</td><td>Name, email address, password (stored only as a one-way hash), role, sign-in and session records, security events (such as failed sign-ins) with network address, consent choices and the version accepted, support messages you send us.</td><td>You, and your device when you use the service.</td></tr>
          <tr><td>Library owners and staff</td><td>Library name, address, city, public description, facilities, opening hours and a location point (used to check that students punch in at the library); billing email and, optionally, GST number; subscription, invoice and payment references (Razorpay payment id, amount, status, payment type such as card or UPI, refund amounts); staff roles and permissions; audit log of important actions; prospective-student enquiries you enter (name, phone, email); notes and records you keep about members.</td><td>You and your team; Razorpay for payment status.</td></tr>
          <tr><td>Students (as members of a library)</td><td>Name, email, phone if the library records it, membership plan and dates, seat, fee amounts, payments recorded by the library (amount, method, receipt number, any reversal), attendance punch-in and punch-out times, join requests and messages, complaints or feedback you send the library.</td><td>You, and the library that records them. Libraries can add students before they have signed in (for example by import or invitation); such students are asked to accept the Terms when they activate the account.</td></tr>
          <tr><td>Students (study tools)</td><td>Study sessions and timers, goals, experience points and coins, study plans and tasks, exam selection and dates, test and quiz attempts, mistakes and revision schedules, flashcards and notes, doubts (your question text and an image of the question if you upload one), garden and reward activity, library leaderboard name if you opt in, friend links and study rooms, optional community profile (alias, age band, shared goal, mentorship choice; for minors, a guardian’s name and contact), success posts you choose to publish, notification preferences and, if you turn on phone notifications, your browser’s push address.</td><td>You, through the app.</td></tr>
          <tr><td>Device location</td><td>If your library requires a location check, your phone’s location is read at the moment you punch in or out and sent to our server to compare with the library’s location. <strong>We do not save the coordinates</strong>; we keep only the punch time and whether the check passed.</td><td>Your device, only when you tap punch in/out.</td></tr>
        </tbody>
      </table>
      <p>We do <strong>not</strong> receive or store card numbers, UPI PINs or bank details: those are entered on Razorpay’s own pages. We do not knowingly collect government ID numbers.</p>

      <h2 id="why">3. Why we use it</h2>
      <table>
        <thead><tr><th>Purpose</th><th>Data used</th><th>Basis</th></tr></thead>
        <tbody>
          <tr><td>Create and secure your account, sign you in, keep you signed in, protect against abuse (rate limits, two-step sign-in for owners and administrators)</td><td>Account, session and security data</td><td>Needed to provide the service; consent given when you accept the Terms. <Ph>counsel to confirm the lawful basis wording under the DPDP Act</Ph></td></tr>
          <tr><td>Run a library: admissions, seats, attendance, memberships, fee records, receipts, reminders, reports</td><td>Library member records</td><td>The library’s instructions and your relationship with the library</td></tr>
          <tr><td>Provide study tools, reminders and notifications you ask for</td><td>Study data, notification choices</td><td>Consent and provision of the service you requested</td></tr>
          <tr><td>Bill library owners, issue invoices, prevent and investigate payment problems, reconcile with the payment provider, keep tax records</td><td>Billing and payment references</td><td>Contract and legal obligations</td></tr>
          <tr><td>Support, security investigations, backups, reliability monitoring and fixing errors</td><td>Support messages, scrubbed logs, encrypted backups</td><td>Providing and protecting the service</td></tr>
          <tr><td>Product news and offers by email (only if you tick the separate optional box)</td><td>Email address, your choice and its timestamp</td><td>Your separate, optional consent, which you can withdraw at any time. We do not currently run marketing campaigns; if you opt in, your choice is recorded so it can be honoured when we do.</td></tr>
        </tbody>
      </table>
      <p>We do not sell personal data and we do not use students’ data for advertising.</p>

      <h2 id="share">4. Who we share it with</h2>
      <p>Within StudyQuest, access is limited by role. Between libraries, data is separated: a library team can only see members of its own library, and a student’s study data is not shared with a library unless you choose to share it (for example the leaderboard opt-in). The library you join can see the records described in section 2 for its own members.</p>
      <table>
        <thead><tr><th>Provider (service)</th><th>Why</th><th>Data</th></tr></thead>
        <tbody>
          <tr><td>MongoDB Atlas (database)</td><td>Stores the platform’s data</td><td>All platform data. Region: <Ph>database region and country</Ph></td></tr>
          <tr><td><Ph>application hosting provider</Ph></td><td>Runs the website and app</td><td>Data in transit and processed by the application. Region: <Ph>hosting region</Ph></td></tr>
          <tr><td>Razorpay (payments, library owners only)</td><td>Collects subscription payments on our behalf and tells us the result</td><td>Owner’s name, email and payment details entered on Razorpay’s pages (Razorpay handles card and UPI data under its own privacy policy and RBI rules); we receive payment id, amount, status and payment type.</td></tr>
          <tr><td><Ph>email delivery provider</Ph></td><td>Sends password-reset, verification, invoice and reminder emails</td><td>Recipient email address and message content</td></tr>
          <tr><td><Ph>WhatsApp/SMS message provider, only if enabled</Ph></td><td>Sends reminders where a library turns this on</td><td>Phone number and message text</td></tr>
          <tr><td>Browser push services (only if you enable phone notifications)</td><td>Deliver notifications to your device</td><td>Your push address and the notification text</td></tr>
          <tr><td><Ph>backup storage provider</Ph></td><td>Stores encrypted backups</td><td>Encrypted copies of platform data; the provider cannot read them</td></tr>
          <tr><td><Ph>monitoring/alerting provider</Ph></td><td>Tells us when something breaks</td><td>Technical events with personal data removed</td></tr>
        </tbody>
      </table>
      <p>The “doubt solver” uses a model running on our own infrastructure or a built-in fallback; at present no third-party AI service receives your questions or images. If that changes, this notice will change first.</p>
      <p>We may disclose data if required by law or a competent authority, or to protect rights and safety. Public library listings (if a library chooses to list itself) show the library’s name, city, description, facilities and hours, never student data. <Ph>Counsel to confirm any cross-border transfer statement once provider regions are known</Ph>.</p>

      <h2 id="cookies">5. Cookies, sessions and logs</h2>
      <ul>
        <li><strong>Session cookie</strong> (<code>sq-session</code>): essential, keeps you signed in for up to 7 days, HttpOnly, same-site, secure on HTTPS. Without it you cannot sign in.</li>
        <li><strong>Browser storage:</strong> small preferences on your device (for example theme and your library’s name for the loading screen). They stay on your device.</li>
        <li><strong>Offline support:</strong> the installed app may cache its own pages and the offline page; it does not cache your private data for offline use.</li>
        <li><strong>No advertising or analytics cookies.</strong> Because we use only essential cookies, we show no cookie banner. If we add anything else we will ask first. Razorpay’s checkout page, when you subscribe, sets its own cookies under its own policy.</li>
        <li><strong>Logs:</strong> our servers write technical logs (time, request id, route, errors, security events including network address). Passwords, tokens, cookies, database addresses, payment keys and similar secrets are removed before logs are written, and request bodies are not logged.</li>
      </ul>

      <h2 id="security">6. How we protect it</h2>
      <ul>
        <li>Passwords are stored as salted one-way hashes. Sessions are signed and can be revoked (changing your password signs you out everywhere).</li>
        <li>Library owners and platform administrators must use two-step sign-in (authenticator app); recovery codes are stored hashed and authenticator secrets encrypted.</li>
        <li>Every request is checked on the server for who you are and which library you belong to; one library’s data is not available to another.</li>
        <li>Rate limiting, content security policy, audit logs for important actions, and alerts on failures.</li>
        <li>Backups are encrypted before they leave our systems. <Ph>State whether production backups are live before publishing; as of this draft they are designed and tested but not yet enabled</Ph>.</li>
      </ul>
      <p>No system is perfectly secure. If a personal-data breach affects you we will tell you and the authorities as the law requires. <Ph>Breach-notification wording and timelines to be confirmed by counsel</Ph>.</p>

      <h2 id="retention">7. How long we keep it</h2>
      <table>
        <thead><tr><th>Data</th><th>Kept</th></tr></thead>
        <tbody>
          <tr><td>Account and study data</td><td>Until you delete your account (students) or the organization is closed (owners).</td></tr>
          <tr><td>After a student deletes their account</td><td>Study tools data, notes, doubts, community profile, notifications and similar personal data are erased. Library fee, membership and attendance records stay in the library’s books attached to an anonymous account (“Deleted user”) because the library needs them for its accounts.</td></tr>
          <tr><td>Library owner accounts and organization data</td><td>Closed on request after review. Invoices and payment records are kept as long as tax and accounting law requires: <Ph>retention period confirmed by a chartered accountant / counsel</Ph>.</td></tr>
          <tr><td>Consent records</td><td>Kept as evidence of what you agreed to and when, with no other personal details (<Ph>counsel to confirm period</Ph>).</td></tr>
          <tr><td>Sessions, password-reset links, rate-limit counters</td><td>Sessions up to 7 days; reset links expire within hours; counters expire automatically.</td></tr>
          <tr><td>Backups</td><td>Encrypted backups are kept for a limited period (planned: 35 days plus monthly copies for 12 months), so deleted data can remain in backups until they expire.</td></tr>
          <tr><td>Logs</td><td><Ph>log retention period, depends on the chosen log service</Ph></td></tr>
        </tbody>
      </table>

      <h2 id="rights">8. Your choices and rights</h2>
      <ul>
        <li><strong>Download your data:</strong> Account and privacy page → Download my data (a JSON file with your account, study data, memberships, payments and consent history).</li>
        <li><strong>Delete your account:</strong> students can do this themselves on the same page (password and, if enabled, a second-factor code required). Library team accounts: ask your organization owner, or owners can request organization deletion there; we review it and contact you.</li>
        <li><strong>Correct your data:</strong> edit your profile in the app; for records kept by a library (fees, attendance, membership), ask the library.</li>
        <li><strong>Marketing:</strong> switch the optional email choice on or off any time under Security &amp; privacy. Withdrawing does not affect your use of the service.</li>
        <li><strong>Notifications:</strong> turn phone notifications off in the app or your browser.</li>
        <li><strong>Other rights and complaints:</strong> you may have further rights under Indian law, including to obtain information, to correct and erase data, to grievance redressal and to nominate another person to exercise your rights. Write to the contact in section 10 and we will respond within <Ph>response time committed by the business, within the limit set by law</Ph>. You can also complain to the Data Protection Board of India once its processes apply to you.</li>
      </ul>

      <h2 id="children">9. Children and students under 18</h2>
      <p>Many library members are school or exam students and some are under 18. Today, StudyQuest does <strong>not</strong> verify age at sign-up and does not collect a guardian’s consent for general use. The optional community features ask for an age band; for minors they require a guardian’s name and contact and the library must approve the request before the minor’s profile is visible. We do not show advertising or build advertising profiles of any user.</p>
      <p>The DPDP Act and Rules contain specific duties for children’s data, including verifiable consent of a parent or guardian, with limited exemptions. <Ph>Counsel to confirm which duties apply to StudyQuest and to the libraries, when they take effect, and the sign-up and library-join changes needed (for example age gating and guardian consent) before the platform is offered to under-18s</Ph>. Parents and guardians who have concerns can use the contact in section 10.</p>

      <h2 id="grievance">10. Questions and grievances</h2>
      <p>Grievance Officer: <Ph>name</Ph>, <Ph>designation</Ph>, <Ph>email</Ph>, <Ph>phone</Ph>, <Ph>postal address</Ph>. Hours: <Ph>days/hours</Ph>. We acknowledge requests within <Ph>acknowledgement period</Ph> and aim to resolve them within <Ph>resolution period set by counsel</Ph>. For records a library keeps about you, you can also contact the library directly. If you also need our <Link href="/terms">Terms of Service</Link>, they are one click away.</p>

      <h2 id="changes-note">11. Changes to this notice</h2>
      <p>We will update this notice when our practices change, show the new version number above, and tell signed-in users in the app. Acceptance of the Terms (which include acknowledging this notice) is recorded with the version, so we can show you what applied when.</p>
    </LegalPage>
  );
}
