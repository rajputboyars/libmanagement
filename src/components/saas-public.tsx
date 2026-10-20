"use client";

import { BrandLoader } from "@/components/brand-loader";
import Link from "next/link";
import { useState, type FormEvent, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, Minus } from "lucide-react";
import { getJson, inr, send, type Json } from "./prep-api";

function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="discovery-public">
      <header><Link className="brand" href="/"><span className="brand-mark">✳</span>StudyQuest<span className="brand-dot">.</span></Link><nav><Link href="/features">Features</Link><Link href="/pricing">Pricing</Link><Link href="/demo">Book a demo</Link><Link href="/login">Sign in</Link></nav></header>
      <main>{children}</main>
    </div>
  );
}

const FAQ = [
  ["Do I need a card to start?", "No. You start with a free trial of the Pro plan and can stay on the Free plan afterwards without entering any payment details."],
  ["What happens to my data if I downgrade or stop paying?", "Nothing is deleted. Paid features lock, free plan limits apply, and you can export your students, memberships, payments and expenses as CSV at any time."],
  ["Is student money handled by StudyQuest?", "No. Fees your students pay your library are recorded in your workspace and never pass through StudyQuest billing. Subscription billing here is only between your organization and StudyQuest."],
  ["How does billing work?", "Subscriptions are billed through a payment gateway. A plan changes only after the gateway confirms the payment — never from a button click alone."],
  ["Can I run more than one branch?", "Yes, on the Business plan. Each branch keeps its own seats, shifts, prices and staff, with consolidated reporting for owners."],
  ["Is tax included?", "Prices are shown in rupees. Tax handling is configured by the platform and shown on invoices; check your own tax obligations."],
];

export function SaasPricing() {
  const [interval, setInterval] = useState<"monthly" | "annual">("monthly");
  const [faq, setFaq] = useState(0);
  const q = useQuery<Json>({ queryKey: ["saas-public"], queryFn: () => getJson("/api/saas-public") });
  return (
    <Shell>
      <section className="discovery-hero" style={{ textAlign: "center", justifyItems: "center" }}>
        <div><span className="eyebrow">Pricing</span><h1>Simple plans that grow with your library.</h1><p>Start with a free trial. Stay free as long as you like. Upgrade when you need fees, QR attendance or more branches.</p></div>
        <div className="mt-filter" role="group" aria-label="Billing interval">{(["monthly", "annual"] as const).map((i) => <button key={i} className={interval === i ? "active" : ""} aria-pressed={interval === i} onClick={() => setInterval(i)}>{i === "monthly" ? "Monthly" : "Annual"}</button>)}</div>
      </section>
      {q.isLoading ? <BrandLoader compact text="Loading…" /> : q.isError || !q.data ? <div className="mt-empty"><h2>Pricing unavailable</h2><p>Please try again shortly.</p><button className="button" onClick={() => q.refetch()}>Retry</button></div> : (
        <>
          <div className="sq-plans">{(q.data.plans as Json[]).map((p) => {
            const price = interval === "annual" ? p.annualPaise : p.monthlyPaise;
            return (
              <article className={`sq-plan ${p.key === "pro" ? "current" : ""}`} key={p.key}>
                <h2>{p.name}{p.key === "pro" && <span className="mt-pill">most popular</span>}</h2>
                <p className="sq-price">{price === 0 ? "Free" : <>{inr(price)}<small>/{interval === "annual" ? "yr" : "mo"}</small></>}</p>
                <p className="pr-hint">{p.description}{p.trialDays ? ` ${p.trialDays}-day free trial.` : ""}</p>
                <ul><li><Check size={14} />{p.limits.activeStudents.toLocaleString("en-IN")} active students</li><li><Check size={14} />{p.limits.branches} branch{p.limits.branches === 1 ? "" : "es"}</li>{(p.features as string[]).map((f) => <li key={f}><Check size={14} />{q.data.features[f] ?? f}</li>)}</ul>
                <Link className="button" href="/register">{price === 0 ? "Start free" : p.trialDays ? "Start free trial" : "Get started"}</Link>
              </article>);
          })}</div>
          <p className="pr-hint" style={{ textAlign: "center" }}>Prices in INR. {q.data.tax.mode === "none" ? "Taxes are not shown until configured." : `Tax at ${q.data.tax.rateBps / 100}% is shown on invoices.`} Student study mode is always free.</p>
          <h2>Compare plans</h2>
          <div className="sq-table" role="region" aria-label="Feature comparison" tabIndex={0}><table><thead><tr><th>Feature</th>{(q.data.plans as Json[]).map((p) => <th key={p.key}>{p.name}</th>)}</tr></thead>
            <tbody>
              <tr><td>Active students</td>{(q.data.plans as Json[]).map((p) => <td key={p.key}>{p.limits.activeStudents.toLocaleString("en-IN")}</td>)}</tr>
              <tr><td>Branches</td>{(q.data.plans as Json[]).map((p) => <td key={p.key}>{p.limits.branches}</td>)}</tr>
              {Object.entries(q.data.features as Record<string, string>).map(([k, v]) => <tr key={k}><td>{v}</td>{(q.data.plans as Json[]).map((p) => <td key={p.key}>{(p.features as string[]).includes(k) ? <Check size={16} aria-label="Included" /> : <Minus size={16} aria-label="Not included" />}</td>)}</tr>)}
            </tbody></table></div>
        </>)}
      <h2>Questions, answered</h2>
      <div className="mt-list">{FAQ.map(([question, answer], i) => <article className="mt-card" key={question}><button className="pr-acc" aria-expanded={faq === i} onClick={() => setFaq(faq === i ? -1 : i)}><strong>{question}</strong></button>{faq === i && <p className="mt-desc">{answer}</p>}</article>)}</div>
      <section className="weekly-card" style={{ textAlign: "center", marginTop: 24 }}><h2>Want a walkthrough first?</h2><p>Book a demo and we&apos;ll show you how libraries use StudyQuest.</p><div className="queue-actions" style={{ justifyContent: "center" }}><Link className="button" href="/demo">Book a demo</Link><Link className="button secondary" href="/register">Create your account</Link></div></section>
    </Shell>
  );
}

export function DemoPage() {
  const [state, setState] = useState<"idle" | "sending" | "done" | "error">("idle");
  const [message, setMessage] = useState("");
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); const f = new FormData(e.currentTarget);
    setState("sending"); setMessage("");
    try {
      const r = await send("/api/leads", "POST", { kind: "demo", name: f.get("name"), email: f.get("email"), phone: f.get("phone") || "", libraryName: f.get("library") || "", message: f.get("message") || "", consentContact: f.get("consent") === "on", website: f.get("website") || "" });
      setMessage(r.message || "Thank you."); setState("done");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to send"); setState("error"); }
  }
  return (
    <Shell>
      <section className="discovery-hero"><div><span className="eyebrow">Book a demo</span><h1>See StudyQuest running a real library.</h1><p>Tell us about your library and we&apos;ll reach out to schedule a short walkthrough. We only contact you if you agree below.</p></div></section>
      {state === "done" ? <div className="weekly-card" role="status"><h2>Request received</h2><p>{message} We&apos;ll be in touch using the details you gave.</p><Link className="button" href="/pricing">Back to pricing</Link></div> : (
        <form className="mt-form" onSubmit={submit}>
          <label>Your name<input name="name" required minLength={2} maxLength={80} autoComplete="name" /></label><label>Work email<input name="email" type="email" required autoComplete="email" /></label>
          <label>Phone (optional)<input name="phone" inputMode="tel" maxLength={20} autoComplete="tel" /></label><label>Library name<input name="library" maxLength={100} /></label>
          <label className="wide">Anything we should know?<textarea name="message" maxLength={500} /></label>
          <input name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" style={{ position: "absolute", left: "-9999px", width: 1, height: 1 }} />
          <label className="mt-check wide"><input type="checkbox" name="consent" required />I agree that StudyQuest may contact me about this demo request.</label>
          {state === "error" && <p className="wide cm-note danger" role="alert">{message}</p>}
          <button className="button" disabled={state === "sending"}>{state === "sending" ? "Sending…" : "Request a demo"}</button>
        </form>)}
    </Shell>
  );
}

/** Local sandbox checkout. Results are delivered as signed events through the real webhook path; no money moves. */
export function SandboxCheckout({ id }: { id: string }) {
  const [state, setState] = useState<"idle" | "busy" | "done" | "failed">("idle");
  const [message, setMessage] = useState("");
  async function run(outcome: "success" | "failure") {
    setState("busy");
    try { const r = await send("/api/billing", "PUT", { checkoutId: id, outcome }); setMessage(r.notice); setState(outcome === "success" ? "done" : "failed"); }
    catch (e) { setMessage(e instanceof Error ? e.message : "Unable to complete"); setState("failed"); }
  }
  return (
    <Shell>
      <section className="weekly-card" style={{ maxWidth: 560, margin: "24px auto" }}>
        <span className="eyebrow">Sandbox checkout</span><h1>Test your billing flow</h1>
        <p className="cm-note danger" role="note">This is a local sandbox. No real payment is taken and the result is excluded from business metrics.</p>
        {state === "done" || state === "failed" ? <><p role="status">{message}</p><Link className="button" href="/owner/billing">Back to billing</Link></> : (
          <div className="queue-actions"><button className="button" disabled={state === "busy"} onClick={() => run("success")}>Simulate successful payment</button><button className="button secondary" disabled={state === "busy"} onClick={() => run("failure")}>Simulate failed payment</button><Link className="button secondary" href="/owner/billing">Cancel</Link></div>)}
      </section>
    </Shell>
  );
}
