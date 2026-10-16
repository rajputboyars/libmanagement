"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fmtDate, getJson, inr, post, type Json } from "./prep-api";

const SAMPLE = "name,email,phone,seat,shift,plan,start_date,paid_rupees,discount_rupees\nAsha Rao,asha@example.com,9876543210,A1,Morning,Monthly,2026-10-01,1200,0\n";

/** Guided import of a paper register: validate → review → commit → reconcile → invite. Nothing is written until the owner confirms. */
export function PilotImport({ notify }: { notify: (m: string) => void }) {
  const qc = useQueryClient();
  const [csv, setCsv] = useState("");
  const [name, setName] = useState("");
  const [report, setReport] = useState<Json | null>(null);
  const [busy, setBusy] = useState("");
  const [reviewed, setReviewed] = useState(false);
  const [expectedPaid, setExpectedPaid] = useState("");
  const [expectedDue, setExpectedDue] = useState("");
  const health = useQuery<Json>({ queryKey: ["pilot-health"], queryFn: () => getJson("/api/pilot-import") });
  const expected = () => ({ ...(expectedPaid !== "" ? { paidRupees: Number(expectedPaid) } : {}), ...(expectedDue !== "" ? { dueRupees: Number(expectedDue) } : {}) });
  async function call(action: "validate" | "commit" | "invite") {
    setBusy(action);
    try {
      const r = await post("/api/pilot-import", action, { csv, expected: expected(), reviewed });
      if (action === "validate") setReport(r);
      if (action === "commit") { notify(`Imported ${r.created.students} students and ${r.created.memberships} memberships.`); setReport(null); setCsv(""); setReviewed(false); await qc.invalidateQueries({ queryKey: ["pilot-health"] }); }
      if (action === "invite") notify(r.note || `Invitations: ${r.sent} sent, ${r.skipped} already sent today, ${r.failed} failed.`);
    } catch (e) {
      notify(e instanceof Error ? e.message : "Unable to complete");
    } finally { setBusy(""); }
  }
  const h = health.data;
  return (
    <>
      <header className="p2-heading"><div><span className="eyebrow">Pilot onboarding</span><h1>Bring your paper register in safely.</h1><p>Upload a CSV, review every problem before anything is saved, then reconcile totals. Keep your paper register running in parallel until the numbers match for two weeks.</p></div></header>
      <section className="weekly-card">
        <div className="section-label"><span>1 · Upload</span></div>
        <p className="pr-hint">Columns: <code>name, email, phone, seat, shift, plan, start_date (YYYY-MM-DD), paid_rupees, discount_rupees</code>. Seats, shifts and plans must already exist in this branch (use Setup guide). Email is needed so each student can activate their account.</p>
        <div className="queue-actions">
          <label className="mt-check"><input type="file" aria-label="Choose register CSV file" accept=".csv,text/csv" onChange={async (e) => { const f = e.target.files?.[0]; if (f) { setName(f.name); setCsv(await f.text()); setReport(null); setReviewed(false); } }} /></label>
          <a className="button secondary" download="pilot-template.csv" href={`data:text/csv;charset=utf-8,${encodeURIComponent(SAMPLE)}`}>Download template</a>
        </div>
        <div className="mt-form" style={{ marginTop: 12 }}>
          <label>Expected total paid (₹, optional)<input inputMode="decimal" value={expectedPaid} onChange={(e) => setExpectedPaid(e.target.value)} /></label>
          <label>Expected total outstanding (₹, optional)<input inputMode="decimal" value={expectedDue} onChange={(e) => setExpectedDue(e.target.value)} /></label>
          <p className="wide pr-hint">Enter the totals from your paper register. The import is blocked if the file does not add up to them.</p>
        </div>
        <button className="button" disabled={!csv || busy !== ""} onClick={() => call("validate")}>{busy === "validate" ? "Checking…" : `Validate ${name || "file"}`}</button>
      </section>
      {report && (
        <section className="weekly-card">
          <div className="section-label"><span>2 · Review</span><span className={`mt-pill ${report.canCommit ? "" : "p-urgent"}`}>{report.canCommit ? "ready to import" : "needs fixes"}</span></div>
          <div className="mt-stats"><div><small>Students</small><strong>{report.totals.students}</strong></div><div><small>Fees</small><strong>{inr(report.totals.pricePaise - report.totals.discountPaise)}</strong></div><div><small>Paid</small><strong>{inr(report.totals.paidPaise)}</strong></div><div><small>Outstanding</small><strong>{inr(report.totals.duePaise)}</strong></div></div>
          {report.alreadyImported && <p className="cm-note danger">This exact file was already imported.</p>}
          {report.controlTotalMismatches.map((m: string) => <p className="cm-note danger" key={m}>{m}</p>)}
          {report.issueCount > 0 && <><p className="cm-note danger">{report.issueCount} problem(s). Fix the file and validate again — the whole file is imported together or not at all.</p><ul>{(report.issues as Json[]).map((i, n) => <li key={n}>Line {i.line}: {i.error}</li>)}</ul></>}
          {report.preview.length > 0 && <div className="sq-table" role="region" aria-label="Preview" tabIndex={0}><table><thead><tr><th>Line</th><th>Student</th><th>Seat</th><th>Start</th><th>Due</th></tr></thead><tbody>{(report.preview as Json[]).map((r) => <tr key={r.line}><td>{r.line}</td><td>{r.name}</td><td>{r.seat}</td><td>{fmtDate(r.start)}</td><td>{inr(r.duePaise)}</td></tr>)}</tbody></table></div>}
          <label className="mt-check"><input type="checkbox" checked={reviewed} onChange={(e) => setReviewed(e.target.checked)} />I reviewed this report and the totals match my register</label>
          <button className="button" disabled={!report.canCommit || !reviewed || busy !== ""} onClick={() => call("commit")}>{busy === "commit" ? "Importing…" : "3 · Import now"}</button>
        </section>)}
      <section className="weekly-card">
        <div className="section-label"><span>4 · Reconcile &amp; invite</span><button className="button secondary" onClick={() => health.refetch()}>Re-check</button></div>
        {health.isLoading ? <div className="mt-skeleton" /> : h ? (
          <>
            <div className="mt-stats"><div><small>Students</small><strong>{h.students}</strong></div><div><small>Memberships</small><strong>{h.memberships}</strong></div><div><small>Outstanding</small><strong>{inr(h.duePaise)}</strong></div><div><small>Seat overlaps</small><strong>{h.overlaps}</strong></div></div>
            {h.ok ? <p className="cm-note" role="status">All checks pass: every student has a membership, payments match, no seat overlaps.</p> : <ul className="cm-note danger">{(h.problems as string[]).map((p) => <li key={p}>{p}</li>)}</ul>}
          </>) : <p className="pr-hint">Could not load reconciliation.</p>}
        <p className="pr-hint">Invitations email each imported student a link to choose a password. If email is not configured, students can open &ldquo;Forgot password&rdquo; with their email.</p>
        <button className="button secondary" disabled={busy !== ""} onClick={() => call("invite")}>Send invitations</button>
      </section>
    </>
  );
}
