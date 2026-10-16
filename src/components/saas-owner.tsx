"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AlertTriangle, Building2, Check, CheckCircle2, CreditCard, Download, Gift, LifeBuoy } from "lucide-react";
import { fmtDate, getJson, inr, post, type Json } from "./prep-api";

const Empty = ({ title, text }: { title: string; text: string }) => <div className="mt-empty"><h2>{title}</h2><p>{text}</p></div>;
const Skeleton = () => <div className="mt-skeleton" aria-busy="true" />;
const Failed = ({ error, retry }: { error: unknown; retry: () => void }) => <div className="mt-empty"><AlertTriangle /><h2>Could not load</h2><p>{error instanceof Error ? error.message : "Check your connection."}</p><button className="button" onClick={retry}>Try again</button></div>;
const label = (v: string) => v.replace(/[-_]/g, " ");

function useAct(notify: (m: string) => void, keys: string[]) {
  const qc = useQueryClient();
  return async (url: string, action: string, data: unknown = {}, success?: string) => {
    try { const r = await post(url, action, data); for (const k of keys) await qc.invalidateQueries({ queryKey: [k] }); if (success || r.notice) notify(r.notice || success!); return r; }
    catch (e) { notify(e instanceof Error ? e.message : "Unable to update"); return null; }
  };
}

// ───────────────────────── Billing ─────────────────────────
export function OwnerBilling({ notify }: { notify: (m: string) => void }) {
  const act = useAct(notify, ["billing", "org"]);
  const [page, setPage] = useState(1);
  const [interval, setInterval] = useState<"monthly" | "annual">("monthly");
  const [coupon, setCoupon] = useState("");
  const [preview, setPreview] = useState<Json | null>(null);
  const [busy, setBusy] = useState("");
  const q = useQuery<Json>({ queryKey: ["billing", page], queryFn: () => getJson(`/api/billing?page=${page}`) });
  if (q.isLoading) return <Skeleton />;
  if (q.isError || !q.data) return <Failed error={q.error} retry={() => q.refetch()} />;
  const d = q.data, sub = d.subscription as Json | null, e = d.entitlements as Json;
  const readOnly = d.role !== "owner";
  const checkout = async (planKey: string) => {
    setBusy(planKey);
    const r = await act("/api/billing", "checkout", { planKey, interval, couponCode: coupon || undefined });
    if (r?.checkoutUrl) window.location.assign(r.checkoutUrl);
    setBusy("");
  };
  const checkCoupon = async (planKey: string) => { const r = await act("/api/billing", "coupon-check", { planKey, interval, couponCode: coupon }); if (r) setPreview({ ...r, planKey }); };
  const statusTone = sub?.status === "active" || sub?.status === "trialing" ? "" : "p-high";
  return (
    <>
      <header className="p2-heading"><div><span className="eyebrow">Subscription &amp; billing</span><h1>Your plan, your pace.</h1><p>Plans are billed to your organization — separate from student membership fees. Your data is never deleted when a plan ends.</p></div></header>
      {d.provider.sandbox && <div className="sq-banner warn" role="note"><AlertTriangle size={16} /><span><strong>{d.provider.configured ? "Gateway test mode" : "Local sandbox"}:</strong> no real payments are taken and sandbox invoices are excluded from business metrics.</span></div>}
      <section className="weekly-card">
        <div className="section-label"><span>Current plan</span><span className={`mt-pill ${statusTone}`}>{sub ? label(sub.status) : "none"}</span></div>
        <div className="mt-stats">
          <div><small>Plan</small><strong>{e.planName}</strong></div>
          <div><small>Students</small><strong>{d.usage.activeStudents} / {e.limits.activeStudents}</strong></div>
          <div><small>Branches</small><strong>{d.usage.branches} / {e.limits.branches}</strong></div>
          <div><small>{sub?.status === "trialing" ? "Trial ends" : sub?.cancelAtPeriodEnd ? "Ends" : "Renews / ends"}</small><strong>{(sub?.trialEnd && sub.status === "trialing") ? fmtDate(sub.trialEnd) : sub?.currentPeriodEnd ? fmtDate(sub.currentPeriodEnd) : "—"}</strong></div>
        </div>
        <p className="pr-hint">{e.reason}{sub?.couponCode ? ` · coupon ${sub.couponCode}` : ""}</p>
        <div className="pr-bar-track" role="progressbar" aria-label="Student usage" aria-valuemin={0} aria-valuemax={e.limits.activeStudents} aria-valuenow={d.usage.activeStudents}><i style={{ width: `${Math.min(100, (d.usage.activeStudents / e.limits.activeStudents) * 100)}%` }} /></div>
        {d.failedPayment && sub?.status === "past_due" && <p className="cm-note danger" role="alert">Your last payment failed ({d.failedPayment.failureReason || "declined"}). Choose your plan below to retry or use another payment method.</p>}
        {!readOnly && <div className="queue-actions">
          {sub?.source === "provider" && sub.status !== "canceled" && !sub.cancelAtPeriodEnd && <button className="button secondary" onClick={() => { if (confirm("Cancel at the end of the paid period?")) act("/api/billing", "cancel", {}, "Cancellation requested."); }}>Cancel subscription</button>}
          {sub?.source !== "free" && !(sub?.source === "provider" && ["active", "past_due"].includes(sub.status)) && <button className="button secondary" onClick={() => { if (confirm("Switch to the Free plan? You keep your data; paid features lock.")) act("/api/billing", "switch-free", {}, "Switched to Free."); }}>Switch to Free</button>}
        </div>}
      </section>

      <div className="mt-filter" role="group" aria-label="Billing interval">
        {(["monthly", "annual"] as const).map((i) => <button key={i} className={interval === i ? "active" : ""} aria-pressed={interval === i} onClick={() => setInterval(i)}>{i === "monthly" ? "Monthly" : "Annual (2 months free)"}</button>)}
        <input className="pr-select" placeholder="Coupon code" aria-label="Coupon code" value={coupon} onChange={(ev) => { setCoupon(ev.target.value.toUpperCase()); setPreview(null); }} maxLength={30} />
      </div>
      <div className="sq-plans">{(d.plans as Json[]).map((p) => {
        const price = interval === "annual" ? p.annualPaise : p.monthlyPaise;
        const current = sub?.planKey === p.key && ["active", "trialing", "past_due"].includes(sub?.status ?? "");
        const pv = preview?.planKey === p.key ? preview : null;
        return (
          <article className={`sq-plan ${current ? "current" : ""}`} key={p.key}>
            <h2>{p.name}{current && <span className="mt-pill">current</span>}</h2>
            <p className="sq-price">{price === 0 ? "Free" : <>{inr(pv ? pv.payablePaise : price)}<small>/{interval === "annual" ? "yr" : "mo"}</small></>}</p>
            {pv && <p className="pr-hint">Coupon saves {inr(pv.discountPaise)} on the first payment.</p>}
            <p className="pr-hint">{p.description}</p>
            <ul>{[`${p.limits.activeStudents.toLocaleString("en-IN")} active students`, `${p.limits.branches} branch${p.limits.branches === 1 ? "" : "es"}`, ...(p.features as string[]).map((f) => label(f))].map((f) => <li key={f}><Check size={14} />{f}</li>)}</ul>
            {!readOnly && (price === 0 ? <button className="button secondary" disabled={sub?.planKey === "free"} onClick={() => act("/api/billing", "switch-free", {}, "Switched to Free.")}>{sub?.planKey === "free" ? "Current plan" : "Choose Free"}</button>
              : <div className="queue-actions"><button className="button" disabled={busy === p.key || (current && sub?.source === "provider" && sub?.status === "active")} onClick={() => checkout(p.key)}><CreditCard size={14} /> {current && sub?.status === "past_due" ? "Retry payment" : current ? "Active" : sub?.planKey && sub.planKey !== "free" ? "Switch plan" : "Upgrade"}</button>{coupon && <button className="button secondary" onClick={() => checkCoupon(p.key)}>Apply code</button>}</div>)}
          </article>);
      })}</div>
      <p className="pr-hint">Prices in INR. {d.tax.mode === "none" ? "Tax is not configured; invoices show no tax line." : `Invoices include tax at ${d.tax.rateBps / 100}%.`} Upgrades and downgrades take effect only after the gateway confirms payment.</p>

      <div className="queue-columns">
        <section>
          <div className="section-label"><span>Invoices</span><strong>{d.invoiceTotal}</strong></div>
          {(d.invoices as Json[]).map((i) => (
            <article className="queue-card" key={i._id}><div><CreditCard /><span><strong>{i.number} · {inr(i.totalPaise)}</strong><small>{fmtDate(i.paidAt || i.createdAt)} · {i.lineItems?.[0]?.description}{i.taxPaise ? ` · tax ${inr(i.taxPaise)}` : ""}{i.discountPaise ? ` · discount ${inr(i.discountPaise)}` : ""}</small>{i.failureReason && <small className="cm-note danger">{i.failureReason}</small>}</span></div>
              <div className="mt-badges"><span className={`mt-pill ${i.status === "failed" ? "p-urgent" : ""}`}>{label(i.status)}</span>{i.mode !== "live" && <span className="mt-pill p-high">{i.mode}</span>}</div></article>))}
          {!d.invoices.length && <Empty title="No invoices yet" text="Invoices appear after a payment is confirmed by the gateway." />}
          <div className="mt-pager"><button className="button secondary" disabled={page === 1} onClick={() => setPage(page - 1)}>Previous</button><span>Page {page}</span><button className="button secondary" disabled={page * 10 >= d.invoiceTotal} onClick={() => setPage(page + 1)}>Next</button></div>
        </section>
        <section>
          <div className="section-label"><span>Subscription credit</span><strong>{inr(d.credits.balancePaise)}</strong></div>
          <p className="pr-hint">Credit comes from referrals and admin adjustments. It can prepay a plan when no gateway subscription is running. It is separate from student Study Coins and XP.</p>
          {!readOnly && d.credits.balancePaise > 0 && <form className="queue-actions" onSubmit={async (ev: FormEvent<HTMLFormElement>) => { ev.preventDefault(); const f = new FormData(ev.currentTarget); await act("/api/billing", "credit-prepay", { planKey: f.get("plan"), months: Number(f.get("months")) }, "Plan prepaid with credit."); }}>
            <select name="plan" aria-label="Plan" className="pr-select">{(d.plans as Json[]).filter((p) => p.monthlyPaise > 0).map((p) => <option key={p.key} value={p.key}>{p.name} · {inr(p.monthlyPaise)}/mo</option>)}</select>
            <input name="months" type="number" min={1} max={12} defaultValue={1} aria-label="Months" className="pr-select" /><button className="button secondary">Prepay</button></form>}
          {(d.credits.ledger as Json[]).map((c) => <article className="queue-card" key={c._id}><div><Gift /><span><strong>{c.amountPaise > 0 ? "+" : ""}{inr(c.amountPaise)}</strong><small>{label(c.reason)} · {c.note} · {fmtDate(c.createdAt)}</small></span></div></article>)}
          <div className="section-label"><span>Refer a library</span></div>
          <article className="queue-card"><div><Gift /><span><strong>Your code: {d.referral.code}</strong><small>{d.referral.enabled ? `Earn ${inr(d.referral.rewardPaise)} credit when a library you refer makes its first verified paid subscription payment. Self-referrals and shared-domain accounts do not qualify.` : "Referrals are currently paused."}</small></span></div>
            <button className="button secondary" onClick={() => { navigator.clipboard?.writeText(d.referral.code); notify("Code copied."); }}>Copy code</button></article>
          {(d.referral.items as Json[]).map((r) => <article className="queue-card" key={r._id}><div><span><strong>Referral {fmtDate(r.createdAt)}</strong><small>{label(r.status)}{r.rejectReason ? ` — ${r.rejectReason}` : ""}</small></span></div></article>)}
        </section>
      </div>
      <div className="section-label"><span><Download size={14} /> Export your data (always available)</span></div>
      <div className="queue-actions">{["students", "memberships", "payments", "expenses", "leads"].map((r) => <a key={r} className="button secondary" href={`/api/export?resource=${r}`}>{r} CSV</a>)}</div>
    </>
  );
}

// ───────────────────────── Branches ─────────────────────────
export function OwnerBranches({ notify }: { notify: (m: string) => void }) {
  const act = useAct(notify, ["org", "org-analytics", "billing"]);
  const [days, setDays] = useState(30);
  const [search, setSearch] = useState("");
  const q = useQuery<Json>({ queryKey: ["org"], queryFn: () => getJson("/api/org") });
  const an = useQuery<Json>({ queryKey: ["org-analytics", days], queryFn: () => getJson(`/api/org-analytics?days=${days}`), retry: false });
  const students = useQuery<Json>({ queryKey: ["students-search", search], queryFn: () => getJson(`/api/workspace?resource=students&q=${encodeURIComponent(search)}`), enabled: search.length >= 2 });
  if (q.isLoading) return <Skeleton />;
  if (q.isError || !q.data) return <Failed error={q.error} retry={() => q.refetch()} />;
  const d = q.data;
  const orgOwner = d.role === "org-owner";
  const total = an.data?.total;
  return (
    <>
      <header className="p2-heading"><div><span className="eyebrow">{d.organization.name}</span><h1>Every branch, one view.</h1><p>Each branch has its own seats, shifts, prices, staff and finances. Access is checked on the server for every request.</p></div></header>
      <div className="mt-stats"><div><small>Branches</small><strong>{d.usage.branches} / {d.entitlements.limits.branches}</strong></div><div><small>Active students</small><strong>{d.usage.activeStudents} / {d.entitlements.limits.activeStudents}</strong></div><div><small>Your role</small><strong>{label(d.role)}</strong></div><div><small>Plan</small><strong>{d.entitlements.planName}</strong></div></div>
      <section>
        <div className="section-label"><span>Branches</span></div>
        <div className="mt-list">{(d.branches as Json[]).map((b) => (
          <article className="queue-card" key={b._id}><div><Building2 /><span><strong>{b.branchName || b.name}</strong><small>{b._id === d.activeBranchId ? "Active branch" : label(b.role)}</small></span></div>
            <div className="queue-actions">{b._id !== d.activeBranchId && <button className="button" onClick={async () => { if (await act("/api/org", "switch-branch", { branchId: b._id })) window.location.reload(); }}>Switch to this branch</button>}
              {["org-owner", "branch-manager"].includes(b.role) && <form className="queue-actions" onSubmit={(ev) => { ev.preventDefault(); const f = new FormData(ev.currentTarget); act("/api/org", "branch-update", { branchId: b._id, branchName: f.get("name"), city: f.get("city") || "", address: "" }, "Branch updated."); }}><input name="name" className="pr-select" defaultValue={b.branchName} placeholder="Rename" aria-label="Branch name" minLength={2} required /><input name="city" className="pr-select" placeholder="City" aria-label="City" /><button className="button secondary">Save</button></form>}</div></article>))}</div>
        {orgOwner && <form className="mt-form" onSubmit={async (ev) => { ev.preventDefault(); const f = new FormData(ev.currentTarget); const form = ev.currentTarget; if (await act("/api/org", "branch-create", { branchName: f.get("name"), city: f.get("city") || "", address: f.get("address") || "" }, "Branch created.")) form.reset(); }}>
          <label>New branch name<input name="name" required minLength={2} maxLength={80} /></label><label>City<input name="city" maxLength={80} /></label><label className="wide">Address<input name="address" maxLength={200} /></label>
          <button className="button">Add branch</button>{!d.entitlements.features.includes("multi-branch") && <p className="wide cm-note">Additional branches need the Business plan. <Link href="/owner/billing">See plans</Link></p>}</form>}
      </section>

      <div className="section-label"><span>Branch performance</span>
        <select className="pr-select" value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="Period">{[7, 30, 90, 365].map((n) => <option key={n} value={n}>Last {n} days</option>)}</select></div>
      {an.isLoading ? <Skeleton /> : an.data?.error || !an.data ? <Empty title="Analytics unavailable" text={(an.error as Error)?.message || "Branch manager access is required."} /> : (
        <>
          {an.data.note && <p className="cm-note">{an.data.note} <Link href="/owner/billing">Upgrade</Link></p>}
          <div className="mt-stats"><div><small>Revenue</small><strong>{inr(total.revenuePaise)}</strong></div><div><small>Expenses</small><strong>{inr(total.expensesPaise)}</strong></div><div><small>Net</small><strong>{inr(total.netPaise)}</strong></div><div><small>Seat use</small><strong>{total.utilizationPct ?? "—"}{total.utilizationPct !== null ? "%" : ""}</strong></div></div>
          <div className="weekly-card" style={{ height: 260 }}><ResponsiveContainer><BarChart data={an.data.branches.map((b: Json) => ({ name: b.name, Revenue: b.revenuePaise / 100, Expenses: b.expensesPaise / 100 }))}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="name" tick={{ fontSize: 11 }} /><YAxis tick={{ fontSize: 11 }} width={48} /><Tooltip formatter={(v) => `₹${Number(v).toLocaleString("en-IN")}`} /><Legend /><Bar dataKey="Revenue" fill="#20745b" radius={[4, 4, 0, 0]} /><Bar dataKey="Expenses" fill="#d98a1f" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer></div>
          <div className="sq-table" role="region" aria-label="Branch comparison" tabIndex={0}><table><thead><tr><th>Branch</th><th>Students</th><th>Seat use</th><th>Revenue</th><th>Expenses</th><th>Net</th><th>Leads → won</th></tr></thead>
            <tbody>{(an.data.branches as Json[]).map((b) => <tr key={b.branchId}><td>{b.name}</td><td>{b.students}</td><td>{b.utilizationPct ?? "—"}{b.utilizationPct !== null ? "%" : ""}</td><td>{inr(b.revenuePaise)}</td><td>{inr(b.expensesPaise)}</td><td>{inr(b.netPaise)}</td><td>{b.converted}/{b.leads}</td></tr>)}</tbody></table></div>
        </>)}

      {orgOwner && (
        <>
          <div className="section-label"><span>Team</span></div>
          <form className="mt-form" onSubmit={async (ev) => { ev.preventDefault(); const f = new FormData(ev.currentTarget); const form = ev.currentTarget; if (await act("/api/org", "member-add", { email: f.get("email"), role: f.get("role"), branchIds: f.getAll("branches") }, "Team member added.")) form.reset(); }}>
            <label>Registered account email<input name="email" type="email" required /></label>
            <label>Role<select name="role"><option value="branch-manager">Branch manager (full branch operations)</option><option value="staff">Staff (attendance)</option></select></label>
            <fieldset className="wide"><legend>Branches</legend>{(d.branches as Json[]).map((b) => <label key={b._id} className="mt-check"><input type="checkbox" name="branches" value={b._id} />{b.branchName || b.name}</label>)}</fieldset><button className="button">Assign</button></form>
          <div className="mt-list">{(d.members as Json[]).map((m) => <article className="queue-card" key={m.userId}><div><span><strong>{m.user?.name ?? "Member"}</strong><small>{m.user?.email} · {label(m.role)}{m.role !== "org-owner" ? ` · ${m.branchIds.length} branch(es)` : " · all branches"}</small></span></div>{m.role !== "org-owner" && <button className="button secondary" onClick={() => { if (confirm("Remove this member from all branches?")) act("/api/org", "member-remove", { userId: m.userId }, "Member removed."); }}>Remove</button>}</article>)}</div>
        </>)}

      {(orgOwner || d.role === "branch-manager") && d.branches.length > 1 && (
        <>
          <div className="section-label"><span>Transfer a student</span></div>
          <p className="pr-hint">Students with an active membership must finish or cancel it first. Payments and memberships stay in the original branch; the transfer is recorded permanently.</p>
          <input className="pr-select" placeholder="Search students in this branch (2+ letters)" aria-label="Search students" value={search} onChange={(e) => setSearch(e.target.value)} />
          <div className="mt-list">{(students.data?.records as Json[] | undefined ?? []).map((s) => (
            <form className="queue-card" key={s._id} onSubmit={async (ev) => { ev.preventDefault(); const f = new FormData(ev.currentTarget); if (await act("/api/org", "student-transfer", { studentId: s._id, toBranchId: f.get("to"), note: f.get("note") || "" }, "Student transferred.")) setSearch(""); }}>
              <div><span><strong>{s.name}</strong><small>{s.email}</small></span></div>
              <div className="queue-actions"><select name="to" className="pr-select" aria-label="Destination branch" required><option value="">To branch…</option>{(d.branches as Json[]).filter((b) => b._id !== d.activeBranchId).map((b) => <option key={b._id} value={b._id}>{b.branchName || b.name}</option>)}</select><input name="note" className="pr-select" placeholder="Note" maxLength={300} /><button className="button">Transfer</button></div></form>))}</div>
        </>)}
    </>
  );
}

// ───────────────────────── CRM ─────────────────────────
export function OwnerCrm({ notify }: { notify: (m: string) => void }) {
  const act = useAct(notify, ["crm"]);
  const [stage, setStage] = useState("new");
  const [adding, setAdding] = useState(false);
  const [open, setOpen] = useState("");
  const q = useQuery<Json>({ queryKey: ["crm"], queryFn: () => getJson("/api/crm"), retry: false });
  if (q.isLoading) return <Skeleton />;
  if (q.isError || !q.data) return <div className="mt-empty"><AlertTriangle /><h2>Admissions CRM</h2><p>{q.error instanceof Error ? q.error.message : "Unavailable"}</p><Link className="button" href="/owner/billing">See plans</Link></div>;
  const d = q.data, leads: Json[] = d.leads;
  const NEXT: Record<string, string[]> = { new: ["contacted", "visit-scheduled", "lost"], contacted: ["visit-scheduled", "converted", "lost"], "visit-scheduled": ["contacted", "converted", "lost"], converted: [], lost: ["new", "contacted"] };
  const move = async (l: Json, to: string) => {
    const payload: Json = { id: l._id, stage: to };
    if (to === "visit-scheduled") { const v = prompt("Visit date and time (YYYY-MM-DD HH:MM)"); if (!v) return; const dt = new Date(v.replace(" ", "T")); if (isNaN(+dt)) return notify("Enter a valid date and time"); payload.visitAt = dt.toISOString(); }
    if (to === "lost") { const r = prompt("Reason for losing this lead"); if (!r) return; payload.lostReason = r; }
    act("/api/crm", "lead-move", payload, `Moved to ${label(to)}.`);
  };
  const shown = leads.filter((l) => l.stage === stage);
  return (
    <>
      <header className="p2-heading"><div><span className="eyebrow">Admissions</span><h1>Turn enquiries into students.</h1><p>Leads from your public library page land here. Contact details are only used when the enquirer consented.</p></div><button className="button" onClick={() => setAdding(!adding)}>{adding ? "Close" : "Add lead"}</button></header>
      <div className="mt-stats"><div><small>Leads ({d.stats.windowDays}d)</small><strong>{d.stats.total}</strong></div><div><small>Converted</small><strong>{d.stats.converted}</strong></div><div><small>Conversion</small><strong>{d.stats.conversionPct ?? "—"}{d.stats.conversionPct !== null ? "%" : ""}</strong></div><div><small>Overdue tasks</small><strong>{d.overdue}</strong></div></div>
      {adding && <form className="mt-form" onSubmit={async (ev) => { ev.preventDefault(); const f = new FormData(ev.currentTarget); const form = ev.currentTarget; if (await act("/api/crm", "lead-create", { name: f.get("name"), phone: f.get("phone") || "", email: f.get("email") || "", message: f.get("message") || "", source: f.get("source"), consentContact: f.get("consent") === "on" }, "Lead added.")) { form.reset(); setAdding(false); } }}>
        <label>Name<input name="name" required minLength={2} /></label><label>Phone<input name="phone" inputMode="tel" /></label><label>Email<input name="email" type="email" /></label>
        <label>Source<select name="source">{["walk-in", "referral", "social", "campaign", "other"].map((s) => <option key={s}>{s}</option>)}</select></label><label className="wide">Notes<input name="message" maxLength={500} /></label>
        <label className="mt-check wide"><input type="checkbox" name="consent" />They agreed to be contacted about admission</label><button className="button">Save lead</button></form>}
      <div className="mt-filter" role="tablist" aria-label="Pipeline stages">{(d.stages as string[]).map((s) => <button key={s} role="tab" aria-selected={stage === s} className={stage === s ? "active" : ""} onClick={() => setStage(s)}>{label(s)} ({leads.filter((l) => l.stage === s).length})</button>)}</div>
      <div className="sq-pipeline">{(d.stages as string[]).map((s) => (
        <section key={s} className={`sq-col ${s === stage ? "show" : ""}`} aria-label={label(s)}><h2>{label(s)} <span>{leads.filter((l) => l.stage === s).length}</span></h2>
          {leads.filter((l) => l.stage === s).map((l) => (
            <article className="queue-card" key={l._id}><div><span><strong>{l.name}</strong><small>{l.phone && l.consentContact ? <a href={`tel:${l.phone}`}>{l.phone}</a> : l.phone ? `${l.phone} · no consent to call` : l.email || "No contact"} · {l.source}{l.enquiryCount > 1 ? ` · ${l.enquiryCount} enquiries` : ""}</small>{l.message && <small>“{l.message}”</small>}{l.visitAt && <small>Visit {new Date(l.visitAt).toLocaleString("en-IN")}</small>}{l.lostReason && <small>Lost: {l.lostReason}</small>}</span></div>
              <div className="queue-actions">{(NEXT[l.stage] ?? []).map((to) => <button key={to} className={to === "converted" ? "button" : "button secondary"} onClick={() => move(l, to)}>{label(to)}</button>)}</div>
              <div className="queue-actions"><select className="pr-select" aria-label="Assigned to" value={l.assignedTo ?? ""} onChange={(ev) => act("/api/crm", "lead-assign", { id: l._id, userId: ev.target.value }, "Assigned.")}>{(d.staff as Json[]).map((u) => <option key={u._id} value={u._id}>{u.name}</option>)}</select>
                <button className="button secondary" onClick={() => setOpen(open === l._id ? "" : l._id)}>{open === l._id ? "Hide" : "Follow-up"}</button></div>
              {open === l._id && <form className="queue-actions" onSubmit={async (ev) => { ev.preventDefault(); const f = new FormData(ev.currentTarget); const dt = new Date(String(f.get("due"))); if (await act("/api/crm", "task-create", { leadId: l._id, dueAt: dt.toISOString(), note: f.get("note") || "" }, "Follow-up scheduled.")) setOpen(""); }}><input name="due" type="datetime-local" required className="pr-select" aria-label="Due" /><input name="note" className="pr-select" placeholder="Call back…" maxLength={200} /><button className="button secondary">Add task</button></form>}
              {(l.history as Json[]).length > 1 && open === l._id && <ol className="mt-history">{(l.history as Json[]).slice(-5).map((h, i) => <li key={i}><strong>{label(h.stage)}</strong><span>{new Date(h.at).toLocaleString("en-IN")}</span>{h.note && <em>{h.note}</em>}</li>)}</ol>}
            </article>))}
          {!shown.length && s === stage && <Empty title="Nothing here" text="Leads in this stage will appear here." />}
        </section>))}</div>
      <div className="queue-columns">
        <section><div className="section-label"><span>Follow-ups due</span><strong>{d.tasks.length}</strong></div>{(d.tasks as Json[]).map((t) => <article className="queue-card" key={t._id}><div><span><strong>{t.note || "Follow up"}</strong><small className={new Date(t.dueAt) < new Date() ? "cm-note danger" : ""}>{new Date(t.dueAt).toLocaleString("en-IN")}{new Date(t.dueAt) < new Date() ? " · overdue" : ""} · {leads.find((l) => l._id === t.leadId)?.name}</small></span></div><button className="button secondary" onClick={() => act("/api/crm", "task-done", { id: t._id }, "Done.")}><CheckCircle2 size={14} /> Done</button></article>)}{!d.tasks.length && <Empty title="No open follow-ups" text="Schedule one from a lead." />}</section>
        <section><div className="section-label"><span>Conversion by source</span></div>{(d.stats.bySource as Json[]).map((s) => <article className="queue-card" key={s.source}><div><span><strong>{s.source}</strong><small>{s.converted}/{s.total} converted</small></span></div><span className="mt-pill">{s.conversionPct ?? 0}%</span></article>)}{!d.stats.bySource.length && <Empty title="No data yet" text="Attribution appears once leads arrive." />}</section>
      </div>
    </>
  );
}

// ───────────────────────── Support ─────────────────────────
export function OwnerSupport({ notify }: { notify: (m: string) => void }) {
  const act = useAct(notify, ["support"]);
  const [openId, setOpenId] = useState("");
  const [composing, setComposing] = useState(false);
  const q = useQuery<Json>({ queryKey: ["support", "list"], queryFn: () => getJson("/api/support") });
  const t = useQuery<Json>({ queryKey: ["support", "ticket", openId], queryFn: () => getJson(`/api/support?id=${openId}`), enabled: !!openId });
  if (q.isLoading) return <Skeleton />;
  if (q.isError || !q.data) return <Failed error={q.error} retry={() => q.refetch()} />;
  return (
    <>
      <header className="p2-heading"><div><span className="eyebrow">Help &amp; support</span><h1>We&apos;re here to help.</h1><p>Create a ticket and follow every reply and status change. Replies also appear in your notifications.</p></div><button className="button" onClick={() => setComposing(!composing)}><LifeBuoy size={14} /> {composing ? "Close" : "New ticket"}</button></header>
      {composing && <form className="mt-form" onSubmit={async (ev) => { ev.preventDefault(); const f = new FormData(ev.currentTarget); const r = await act("/api/support", "create", { subject: f.get("subject"), category: f.get("category"), priority: f.get("priority"), body: f.get("body") }, "Ticket created."); if (r) { setComposing(false); setOpenId(r.ticket._id); } }}>
        <label className="wide">Subject<input name="subject" required minLength={5} maxLength={120} /></label>
        <label>Category<select name="category">{["billing", "technical", "account", "feature", "other"].map((c) => <option key={c}>{c}</option>)}</select></label><label>Priority<select name="priority" defaultValue="normal">{["low", "normal", "high"].map((c) => <option key={c}>{c}</option>)}</select></label>
        <label className="wide">How can we help?<textarea name="body" required minLength={10} maxLength={2000} /></label><button className="button">Send</button></form>}
      <div className="queue-columns">
        <section>{(q.data.items as Json[]).map((i) => <button key={i._id} className="queue-card sq-ticket" onClick={() => setOpenId(i._id)} aria-pressed={openId === i._id}><div><span><strong>{i.subject}</strong><small>{label(i.category)} · {fmtDate(i.updatedAt)}</small></span></div><span className="mt-pill">{i.status}</span></button>)}{!q.data.items.length && <Empty title="No tickets" text="Create one if you need help." />}</section>
        <section>{openId && (t.isLoading ? <Skeleton /> : t.data?.ticket ? (
          <div className="weekly-card"><div className="section-label"><span>{t.data.ticket.subject}</span><span className="mt-pill">{t.data.ticket.status}</span></div>
            {(t.data.ticket.messages as Json[]).map((m, i) => <div key={i} className={`sq-msg ${m.role}`}><small>{m.role === "admin" ? "StudyQuest support" : "You"} · {new Date(m.at).toLocaleString("en-IN")}</small><p>{m.body}</p></div>)}
            {t.data.ticket.status !== "closed" && <form className="queue-actions" onSubmit={async (ev) => { ev.preventDefault(); const f = new FormData(ev.currentTarget); const form = ev.currentTarget; if (await act("/api/support", "reply", { id: openId, body: f.get("body") }, "Reply sent.")) form.reset(); }}><input name="body" className="pr-select" required minLength={2} maxLength={2000} placeholder="Write a reply" aria-label="Reply" /><button className="button">Reply</button><button type="button" className="button secondary" onClick={() => act("/api/support", "close", { id: openId }, "Ticket closed.")}>Close ticket</button></form>}
            <ol className="mt-history">{(t.data.ticket.history as Json[]).map((h, i) => <li key={i}><strong>{h.status}</strong><span>{new Date(h.at).toLocaleString("en-IN")}</span></li>)}</ol></div>) : <Empty title="Ticket not found" text="" />)}</section>
      </div>
    </>
  );
}

// ───────────────────────── Onboarding wizard ─────────────────────────
const STEP_LABELS: Record<string, string> = { organization: "Organization", verify: "Verify contact", branch: "Branch", shifts: "Shifts", seats: "Seats", fees: "Fee plans", students: "Students", plan: "Plan" };
const OPTIONAL = ["verify", "shifts", "seats", "fees", "students"];

export function Onboarding({ notify }: { notify: (m: string) => void }) {
  const qc = useQueryClient();
  const router = useRouter();
  const q = useQuery<Json>({ queryKey: ["onboarding"], queryFn: () => getJson("/api/onboarding") });
  const [step, setStep] = useState("");
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState<Json | null>(null);
  const [csv, setCsv] = useState("");
  const [preview, setPreview] = useState<Json | null>(null);
  const [plans, setPlans] = useState<Json[]>([]);
  if (q.isLoading) return <div className="pr-page"><Skeleton /></div>;
  if (q.isError || !q.data) return <div className="pr-page"><Failed error={q.error} retry={() => q.refetch()} /></div>;
  const d = q.data, steps: string[] = d.steps;
  const current = step || (d.completed.length ? steps[Math.min(steps.indexOf(d.lastStep), steps.length - 1)] : steps[0]);
  const idx = steps.indexOf(current);
  const run = async (action: string, data: unknown = {}, next?: string, success?: string) => {
    setBusy(true);
    try { const r = await post("/api/onboarding", action, data); await qc.invalidateQueries({ queryKey: ["onboarding"] }); setOut(r.record ?? null); if (success) notify(success); if (next) setStep(next); return r; }
    catch (e) { notify(e instanceof Error ? e.message : "Unable to save"); return null; } finally { setBusy(false); }
  };
  const nextOf = (s: string) => steps[Math.min(steps.indexOf(s) + 1, steps.length - 1)];
  const loadPlans = async () => { if (!plans.length) setPlans((await getJson("/api/saas-public")).plans); };
  if (current === "plan") void loadPlans();
  const form = (fn: (f: FormData) => Promise<unknown>) => async (e: FormEvent<HTMLFormElement>) => { e.preventDefault(); await fn(new FormData(e.currentTarget)); };
  const body: ReactNode = (() => {
    switch (current) {
      case "organization": return <form className="mt-form" onSubmit={form((f) => run("organization", { name: f.get("name") }, "verify", "Organization saved."))}><label className="wide">Organization name<input name="name" required minLength={2} maxLength={100} defaultValue={d.organization?.name} /></label><button className="button" disabled={busy}>Continue</button></form>;
      case "verify": return (
        <div className="mt-form"><p className="wide">Verify your email so we can send billing notices and recover your account.</p>
          <div className="wide queue-actions"><button className="button secondary" disabled={busy} onClick={async () => { const r = await run("verify-send", { channel: "email" }); if (r?.record?.notice) notify(r.record.notice); }}>Send code to {d.email}</button></div>
          {out?.sandboxCode && <p className="wide cm-note" role="status">Local sandbox code: <strong>{out.sandboxCode}</strong> (no delivery provider configured).</p>}
          <form className="wide queue-actions" onSubmit={form((f) => run("verify-check", { channel: "email", code: f.get("code") }, "branch", "Email verified."))}><input name="code" inputMode="numeric" pattern="\d{6}" maxLength={6} className="pr-select" placeholder="6-digit code" aria-label="Verification code" required /><button className="button" disabled={busy}>Verify</button></form>
          {d.verified.includes("email") && <p className="wide cm-note">Email verified ✓</p>}</div>);
      case "branch": return <form className="mt-form" onSubmit={form((f) => run("branch", { branchName: f.get("name"), city: f.get("city"), address: f.get("address") || "" }, "shifts", "Branch saved."))}><label>Branch name<input name="name" required minLength={2} defaultValue={d.library?.branchName} placeholder="Main" /></label><label>City<input name="city" required minLength={2} defaultValue={d.library?.city} /></label><label className="wide">Address<input name="address" defaultValue={d.library?.address} maxLength={200} /></label><button className="button" disabled={busy}>Continue</button></form>;
      case "shifts": return <form className="mt-form" onSubmit={form((f) => { const t = (v: FormDataEntryValue | null) => { const [h, m] = String(v).split(":").map(Number); return h * 60 + m; }; return run("shifts", { items: [{ name: f.get("n1"), start: t(f.get("s1")), end: t(f.get("e1")) }, ...(f.get("n2") ? [{ name: f.get("n2"), start: t(f.get("s2")), end: t(f.get("e2")) }] : [])] }, "seats", "Shifts saved."); })}>
        <label>Shift 1<input name="n1" defaultValue="Morning" required /></label><label>Starts<input name="s1" type="time" defaultValue="06:00" required /></label><label>Ends<input name="e1" type="time" defaultValue="12:00" required /></label>
        <label>Shift 2 (optional)<input name="n2" defaultValue="Evening" /></label><label>Starts<input name="s2" type="time" defaultValue="16:00" /></label><label>Ends<input name="e2" type="time" defaultValue="22:00" /></label><p className="wide pr-hint">Existing shifts with the same name are updated, so retrying is safe.</p><button className="button" disabled={busy}>Save shifts</button></form>;
      case "seats": return <form className="mt-form" onSubmit={form((f) => run("seats", { floor: f.get("floor"), prefix: f.get("prefix"), count: Number(f.get("count")) }, "fees", "Seats ready."))}><label>Floor<input name="floor" defaultValue="Ground floor" required /></label><label>Label prefix<input name="prefix" defaultValue="A" maxLength={4} required /></label><label>How many seats<input name="count" type="number" min={1} max={300} defaultValue={30} required /></label>{out && "created" in out && <p className="wide cm-note">{out.created} created, {out.existing} already existed.</p>}<button className="button" disabled={busy}>Generate seats</button></form>;
      case "fees": return <form className="mt-form" onSubmit={form((f) => run("fees", { items: [{ name: f.get("name"), rupees: Number(f.get("rupees")), days: Number(f.get("days")) }] }, "students", "Fee plan saved."))}><label>Plan name<input name="name" defaultValue="Monthly" required /></label><label>Fee (₹)<input name="rupees" type="number" min={0} step="1" defaultValue={1200} required /></label><label>Valid for (days)<input name="days" type="number" min={1} max={366} defaultValue={30} required /></label><button className="button" disabled={busy}>Save fee plan</button></form>;
      case "students": return (
        <div className="mt-form"><p className="wide">Upload a CSV with <code>name,email,phone</code> columns. Students link to your branch when they register with that email. Limit: {d.studentLimit} on your plan.</p>
          <label className="wide">CSV file<input type="file" accept=".csv,text/csv" onChange={async (e) => { const t = await e.target.files?.[0]?.text(); if (t) { setCsv(t); setPreview(null); } }} /></label>
          {csv && <div className="wide queue-actions"><button className="button secondary" disabled={busy} onClick={async () => { const r = await run("students-preview", { csv }); if (r) setPreview(r.record); }}>Check file</button><button className="button" disabled={busy || !preview?.newRows} onClick={() => run("students-import", { csv }, "plan", "Students imported.")}>Import {preview?.newRows ?? 0} new</button></div>}
          {preview && <div className="wide cm-note" role="status">{preview.rows} valid rows · {preview.newRows} new · {preview.alreadyPending} already added · {preview.matchesRegistered} already registered{preview.errors.length ? <ul>{preview.errors.slice(0, 5).map((er: Json) => <li key={er.line}>Line {er.line}: {er.error}</li>)}</ul> : null}</div>}
          {out && "imported" in out && <p className="wide cm-note">Imported {out.imported}; linked {out.linkedNow} registered students.</p>}</div>);
      case "plan": return (
        <div className="sq-plans">{plans.map((p) => (
          <article className="sq-plan" key={p.key}><h3>{p.name}</h3><p className="sq-price">{p.monthlyPaise === 0 ? "Free" : <>{inr(p.monthlyPaise)}<small>/mo</small></>}</p><p className="pr-hint">{p.description}{p.trialDays ? ` ${p.trialDays}-day trial included when you register.` : ""}</p>
            <button className={p.monthlyPaise ? "button secondary" : "button"} disabled={busy} onClick={async () => { await run("plan", { planKey: p.key }); if (p.monthlyPaise === 0) { const r = await post("/api/billing", "switch-free").catch(() => null); if (r) notify("Free plan selected. No payment needed."); } else router.push("/owner/billing"); }}>{p.monthlyPaise ? "Choose in billing" : "Stay on Free"}</button></article>))}
          <p className="wide pr-hint">Your Pro trial keeps running until you choose. You can finish setup now and decide later.</p></div>);
      default: return null;
    }
  })();
  const finish = async () => { const r = await run("complete", {}, undefined, "Setup complete."); if (r) { router.push("/owner"); router.refresh(); } };
  return (
    <div className="pr-page">
      <header className="p2-heading"><div><span className="eyebrow">Library setup</span><h1>Let&apos;s get your library ready.</h1><p>Progress is saved after every step, so you can leave and come back. Free plan needs no payment details.</p></div></header>
      <ol className="sq-steps" aria-label="Setup progress">{steps.map((s, i) => <li key={s}><button className={`${s === current ? "cur" : ""} ${d.completed.includes(s) ? "done" : ""}`} aria-current={s === current ? "step" : undefined} onClick={() => setStep(s)}><span>{d.completed.includes(s) ? <Check size={14} /> : i + 1}</span>{STEP_LABELS[s]}</button></li>)}</ol>
      <div className="weekly-card">{body}
        <div className="queue-actions">
          {idx > 0 && <button className="button secondary" onClick={() => setStep(steps[idx - 1])}>Back</button>}
          {OPTIONAL.includes(current) && <button className="button secondary" disabled={busy} onClick={() => run("skip", { step: current }, nextOf(current))}>Skip for now</button>}
          {idx === steps.length - 1 && <button className="button" disabled={busy || !d.completed.includes("organization") || !d.completed.includes("branch")} onClick={finish}>Enter dashboard</button>}
        </div>
        {idx === steps.length - 1 && (!d.completed.includes("organization") || !d.completed.includes("branch")) && <p className="cm-note">Complete the Organization and Branch steps to finish.</p>}
      </div>
      <div className="mt-stats"><div><small>Shifts</small><strong>{d.counts.shifts}</strong></div><div><small>Seats</small><strong>{d.counts.seats}</strong></div><div><small>Fee plans</small><strong>{d.counts.fees}</strong></div><div><small>Students</small><strong>{d.counts.students}</strong></div></div>
    </div>
  );
}
