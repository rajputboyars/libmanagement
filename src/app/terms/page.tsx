import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Terms of Service", description: "Terms of Service for StudyQuest.", alternates: { canonical: "/terms" } };

export default function Page() {
  return (
    <div className="discovery-public">
      <header><Link className="brand" href="/"><span className="brand-mark">✳</span>StudyQuest<span className="brand-dot">.</span></Link><nav><Link href="/privacy">Privacy</Link><Link href="/terms">Terms</Link></nav></header>
      <main>
        <article>
          <p className="cm-note danger" role="note"><strong>Placeholder — not legal advice.</strong> Replace this page with terms reviewed by a qualified lawyer before launch.</p>
          <h1>Terms of Service</h1>
          <p>Last reviewed: <em>not yet reviewed</em>.</p>
          <h2>What this document must cover</h2>
          <ul>
            <li>Subscription plans, billing, renewals, cancellation and refunds.</li>
            <li>The separation between StudyQuest subscription fees and fees students pay their library.</li>
            <li>Acceptable use, community conduct and moderation.</li>
            <li>Service availability, data export on plan expiry, and liability limits.</li>
            <li>Governing law and dispute resolution.</li>
          </ul>
          <p>Questions in the meantime: use the <Link href="/demo">contact form</Link>.</p>
        </article>
      </main>
    </div>
  );
}
