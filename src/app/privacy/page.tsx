import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Privacy Policy", description: "Privacy Policy for StudyQuest.", alternates: { canonical: "/privacy" } };

export default function Page() {
  return (
    <div className="discovery-public">
      <header><Link className="brand" href="/"><span className="brand-mark">✳</span>StudyQuest<span className="brand-dot">.</span></Link><nav><Link href="/privacy">Privacy</Link><Link href="/terms">Terms</Link></nav></header>
      <main>
        <article>
          <p className="cm-note danger" role="note"><strong>Placeholder — not legal advice.</strong> Replace this page with text reviewed by a qualified lawyer before launch, including obligations under India&apos;s Digital Personal Data Protection Act, 2023, payments and tax rules.</p>
          <h1>Privacy Policy</h1>
          <p>Last reviewed: <em>not yet reviewed</em>.</p>
          <h2>Who we are</h2><p>[Legal entity name, registered address and the contact for privacy questions — to be completed by the business.]</p>
          <h2>What this document must cover</h2>
          <ul>
            <li>Data collected from library owners, staff and students, and the purpose of each item.</li>
            <li>Children&apos;s data and guardian consent for members under 18.</li>
            <li>Retention periods, data export (Account &amp; privacy page) and account deletion.</li>
            <li>Payments handled by our gateway, invoices and tax records.</li>
            <li>Processors and sub-processors (hosting, email, payment gateway) and where data is stored.</li>
          </ul>
          <p>Questions in the meantime: use the <Link href="/demo">contact form</Link>.</p>
        </article>
      </main>
    </div>
  );
}
