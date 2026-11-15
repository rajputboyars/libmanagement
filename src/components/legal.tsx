import Link from "next/link";
import type { ReactNode } from "react";
import { LEGAL_CHANGELOG, LEGAL_REVIEW_STATUS, LEGAL_VERSIONS, type LegalKind } from "@/lib/legal";

/** A fact only the business can supply. Rendered highlighted so nothing placeholder-like is mistaken for final text. Listed in docs/LEGAL_COMPLIANCE.md. */
export function Ph({ children }: { children: ReactNode }) {
  return <span className="legal-ph" data-placeholder="true">[{children}]</span>;
}

export function LegalPage({ kind, title, intro, toc, children }: { kind: LegalKind; title: string; intro: string; toc: [string, string][]; children: ReactNode }) {
  const version = LEGAL_VERSIONS[kind];
  return (
    <div className="discovery-public">
      <header>
        <Link className="brand" href="/"><span className="brand-mark">✳</span>StudyQuest<span className="brand-dot">.</span></Link>
        <nav aria-label="Legal"><Link href="/privacy">Privacy</Link><Link href="/terms">Terms</Link></nav>
      </header>
      <main>
        <article className="legal-doc">
          {LEGAL_REVIEW_STATUS === "draft" && (
            <p className="cm-note danger" role="note"><strong>Draft pending legal review.</strong> This text was written from how the platform actually works. It has <strong>not</strong> been reviewed or approved by a lawyer or chartered accountant, and highlighted items in <span className="legal-ph">[brackets]</span> are details the business must supply before publication.</p>
          )}
          <h1>{title}</h1>
          <p className="legal-meta">Version <strong data-legal-version={kind}>{version}</strong> · Effective date: <Ph>effective date, set when this text is approved and published</Ph> · <a href="#changes">Version history</a></p>
          <p>{intro}</p>
          <nav aria-label="Contents"><ol className="legal-toc">{toc.map(([id, label]) => <li key={id}><a href={`#${id}`}>{label}</a></li>)}</ol></nav>
          {children}
          <h2 id="changes">Version history</h2>
          <ul>{LEGAL_CHANGELOG.filter((c) => c.kind === kind || c.kind === "both").map((c) => <li key={c.version}><strong>{c.version}</strong>: {c.note}</li>)}</ul>
          <p>When we change this document in a way that matters, we publish a new version here, tell signed-in users in the app, and ask them to accept the new version of the Terms where acceptance is required. Older versions are available on request.</p>
        </article>
      </main>
    </div>
  );
}
