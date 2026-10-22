"use client";

import { BrandLoader } from "@/components/brand-loader";
import { useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AlertTriangle } from "lucide-react";
import { fmtDate, getJson, inr, post, type Json } from "./prep-api";

const TABS = [["overview", "Overview"], ["product", "Product"], ["orgs", "Organizations"], ["subscriptions", "Subscriptions"], ["plans", "Plans & pricing"], ["billing", "Billing"], ["support", "Support"], ["growth", "Growth"], ["audit", "Audit log"]] as const;
type Tab = (typeof TABS)[number][0];
const api = "/api/saas-admin";
const label = (v: string) => v.replace(/[-_]/g, " ");
const Skeleton = () => <BrandLoader compact text="Loading…" />;
const Empty = ({ title, text }: { title: string; text?: string }) => <div className="mt-empty"><h2>{title}</h2>{text && <p>{text}</p>}</div>;
const Failed = ({ error, retry }: { error: unknown; retry: () => void }) => <div className="mt-empty"><AlertTriangle /><h2>Could not load</h2><p>{error instanceof Error ? error.message : "Try again."}</p><button className="button" onClick={retry}>Try again</button></div>;
const pctText = (v: number | null) => (v === null || v === undefined ? "—" : `${v}%`);

export function SaasAdmin({ notify, initialTab = "overview" }: { notify: (m: string) => void; initialTab?: Tab }) {
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>(initialTab);
  const act = async (action: string, data: unknown, ok?: string, url = api) => {
    try { const r = await post(url, action, data); await qc.invalidateQueries({ queryKey: ["sa"] }); notify(ok ?? "Saved."); return r; } catch (e) { notify(e instanceof Error ? e.message : "Unable to update"); return null; }
  };
  return (
    <>
      <header className="p2-heading"><div><span className="eyebrow">Platform business</span><h1>Run StudyQuest as a business.</h1><p>Every figure is calculated from verified data. Test organizations and sandbox payments are excluded unless you include them. Every change here is audited.</p></div></header>
      <div className="mt-filter pr-tabs" role="tablist" aria-label="Business sections">{TABS.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? "active" : ""} onClick={() => setTab(k)}>{l}</button>)}</div>
      {tab === "overview" && <Overview act={act} />}
      {tab === "product" && <Product />}
      {tab === "orgs" && <Orgs act={act} />}
      {tab === "subscriptions" && <Subs />}
      {tab === "plans" && <Plans act={act} />}
      {tab === "billing" && <Billing act={act} />}
      {tab === "support" && <Support act={act} />}
      {tab === "growth" && <Growth act={act} />}
      {tab === "audit" && <Audit />}
    </>
  );
}
type Act = (action: string, data: unknown, ok?: string, url?: string) => Promise<Json | null>;
const reasonPrompt = (what: string) => { const r = prompt(`Reason for ${what} (recorded in the audit log)`); return r && r.trim().length >= 3 ? r.trim() : null; };

function Overview({ act }: { act: Act }) {
  const [days, setDays] = useState(30);
  const [sandbox, setSandbox] = useState(false);
  const q = useQuery<Json>({ queryKey: ["sa", "overview", days, sandbox], queryFn: () => getJson(`${api}?view=overview&days=${days}${sandbox ? "&sandbox=1" : ""}`) });
  if (q.isLoading) return <Skeleton />;
  if (q.isError || !q.data) return <Failed error={q.error} retry={() => q.refetch()} />;
  const d = q.data, r = d.revenue, t = d.retention, g = d.growth, u = d.usage;
  const tile = (title: string, value: string, hint: string) => <div title={hint}><small>{title}</small><strong>{value}</strong><small className="sq-hint">{hint}</small></div>;
  return (
    <>
      <div className="mt-filter"><select className="pr-select" value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="Reporting period">{[7, 30, 90, 365].map((n) => <option key={n} value={n}>Last {n} days</option>)}</select>
        <label className="mt-check"><input type="checkbox" checked={sandbox} onChange={(e) => setSandbox(e.target.checked)} />Include sandbox data</label>
        <button className="button secondary" onClick={() => act("jobs-run", {}, "Background jobs ran.")}>Run background jobs</button></div>
      {sandbox && <p className="cm-note danger" role="status">Sandbox data is included. These numbers are not production revenue.</p>}
      <div className="mt-stats">
        {tile("MRR", inr(r.mrrPaise), `ARR ${inr(r.arrPaise)}`)}{tile("Paying organizations", String(r.activePayingOrganizations), `ARPA ${inr(r.arpaPaise)}`)}
        {tile("Collected", inr(r.collectedPaise), `Net ${inr(r.netCollectedPaise)} after ${inr(r.refundsPaise)} refunds`)}{tile("Outstanding", inr(r.outstandingPaise), `${r.outstandingInvoices} open/failed invoices`)}
        {tile("Failed payments", String(r.failedPayments), "In period")}{tile("Trial conversion", pctText(t.trialConversionPct), `${t.trialsConverted}/${t.trialsEnded} trials ended`)}
        {tile("Churn", pctText(t.churnPct), `${t.churned}/${t.payingAtStart} paying at start`)}{tile("Organizations", String(g.organizations), `${g.newOrganizations} new (prev ${g.previousNewOrganizations}) · ${g.branches} branches`)}
        {tile("Active students", String(u.activeStudents), `${u.seatsInUse}/${u.seats} seats in use (${pctText(u.seatUtilizationPct)})`)}{tile("Lead conversion", pctText(u.leadConversionPct), `${u.convertedLeads}/${u.leads} leads`)}
        {tile("Library engagement", pctText(u.engagementPct), `${u.engagedLibraries} active in 30 days`)}{tile("Suspended", String(g.suspended), `${d.excludedTestOrganizations} test orgs excluded`)}
      </div>
      <div className="weekly-card"><div className="section-label"><span>Collected revenue (net of refunds)</span><small>Last 6 months</small></div>
        <div style={{ height: 220 }}><ResponsiveContainer><AreaChart data={r.series.map((s: Json) => ({ month: s.month, value: s.collectedPaise / 100 }))}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="month" tick={{ fontSize: 11 }} /><YAxis tick={{ fontSize: 11 }} width={48} /><Tooltip formatter={(v) => `₹${Number(v).toLocaleString("en-IN")}`} /><Area dataKey="value" stroke="#20745b" fill="#20745b33" name="Collected" /></AreaChart></ResponsiveContainer></div>
        <div className="queue-actions">{(r.byPlan as Json[]).map((p) => <span className="mt-pill" key={p.plan}>{p.plan}: {p.count}</span>)}{!r.byPlan.length && <small>No paying organizations yet.</small>}</div></div>
      <details className="weekly-card"><summary>Metric definitions</summary><dl className="sq-defs">{Object.entries(d.definitions as Record<string, string>).map(([k, v]) => <div key={k}><dt>{label(k)}</dt><dd>{v}</dd></div>)}</dl><p className="pr-hint">Gross {inr(r.grossPaise)} · discounts {inr(r.discountsPaise)} · tax {inr(r.taxPaise)} (informational, from tax settings).</p></details>
    </>
  );
}

function Orgs({ act }: { act: Act }) {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState("");
  const q = useQuery<Json>({ queryKey: ["sa", "orgs", search, page], queryFn: () => getJson(`${api}?view=orgs&page=${page}&q=${encodeURIComponent(search)}`) });
  const detail = useQuery<Json>({ queryKey: ["sa", "org", open], queryFn: () => getJson(`${api}?view=org&id=${open}`), enabled: !!open });
  if (q.isLoading) return <Skeleton />;
  if (q.isError || !q.data) return <Failed error={q.error} retry={() => q.refetch()} />;
  const items: Json[] = q.data.items;
  return (
    <>
      <input className="pr-select" placeholder="Search organizations" aria-label="Search organizations" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
      <div className="sq-table" role="region" aria-label="Organizations" tabIndex={0}><table><thead><tr><th>Organization</th><th>Owner</th><th>Plan</th><th>Status</th><th>Branches</th><th>Students</th><th /></tr></thead>
        <tbody>{items.map((o) => <tr key={o._id}><td>{o.name}{o.isTest && <span className="mt-pill p-high">test</span>}</td><td>{o.owner?.email}</td><td>{o.subscription?.planKey ?? "—"}</td><td><span className={`mt-pill ${o.status === "suspended" ? "p-urgent" : ""}`}>{o.status === "suspended" ? "suspended" : o.subscription?.status ?? "—"}</span></td><td>{o.branches}</td><td>{o.students}</td><td><button className="button secondary" onClick={() => setOpen(open === o._id ? "" : o._id)}>{open === o._id ? "Close" : "Manage"}</button></td></tr>)}</tbody></table></div>
      {!items.length && <Empty title="No organizations found" />}
      <div className="mt-pager"><button className="button secondary" disabled={page === 1} onClick={() => setPage(page - 1)}>Previous</button><span>Page {page}</span><button className="button secondary" disabled={page * 20 >= q.data.total} onClick={() => setPage(page + 1)}>Next</button></div>
      {open && (detail.isLoading ? <Skeleton /> : detail.data ? <OrgDetail d={detail.data} act={act} /> : null)}
    </>
  );
}

function OrgDetail({ d, act }: { d: Json; act: Act }) {
  const org = d.org, sub = d.subscription as Json | null;
  const id = org._id;
  const run = (action: string, extra: Json, why: string, ok: string) => { const reason = reasonPrompt(why); if (reason) act(action, { organizationId: id, reason, ...extra }, ok); };
  return (
    <section className="weekly-card">
      <div className="section-label"><span>{org.name}</span><span className={`mt-pill ${org.status === "suspended" ? "p-urgent" : ""}`}>{org.status}</span></div>
      <p className="pr-hint">Plan {sub?.planKey ?? "—"} · {sub ? `${sub.status} (${sub.source}${sub.mode !== "none" ? `, ${sub.mode}` : ""})` : "no subscription"}{sub?.trialEnd ? ` · trial ends ${fmtDate(sub.trialEnd)}` : ""}{sub?.currentPeriodEnd ? ` · period ends ${fmtDate(sub.currentPeriodEnd)}` : ""} · {d.branches.length} branch(es) · {d.openTickets} open ticket(s)</p>
      {sub?.overrides && <p className="cm-note">Override active: {JSON.stringify(sub.overrides.features ?? {})} {sub.overrides.limits ? JSON.stringify(sub.overrides.limits) : ""} — {sub.overrides.reason}</p>}
      <div className="queue-actions">
        {org.status === "active" ? <button className="button secondary" onClick={() => run("org-suspend", {}, "suspending", "Organization suspended.")}>Suspend</button> : <button className="button" onClick={() => run("org-reinstate", {}, "reinstating", "Organization reinstated.")}>Reinstate</button>}
        <button className="button secondary" onClick={() => { const n = Number(prompt("Extend trial by how many days? (1-90)")); if (n >= 1) run("trial-extend", { days: Math.floor(n) }, "extending the trial", "Trial extended."); }}>Extend trial</button>
        <button className="button secondary" onClick={() => { const key = prompt("Grant which plan? (free, starter, pro, business, …)"); const until = prompt("Until (YYYY-MM-DD)"); if (key && until && !isNaN(+new Date(until))) run("grant-plan", { planKey: key, until: new Date(until).toISOString() }, "granting a plan", "Plan granted."); }}>Grant plan</button>
        <button className="button secondary" onClick={() => { const add = prompt("Features to add (comma separated, e.g. qr-attendance,multi-branch)") ?? ""; const lim = Number(prompt("Active student limit override (blank to keep)") || 0) || undefined; const days = Number(prompt("Override lasts how many days? (blank = until cleared)") || 0); run("sub-override", { add: add.split(",").map((s) => s.trim()).filter(Boolean), activeStudents: lim, ...(days ? { expiresAt: new Date(Date.now() + days * 86400000).toISOString() } : {}) }, "overriding entitlements", "Override saved."); }}>Override entitlements</button>
        {sub?.overrides && <button className="button secondary" onClick={() => run("sub-override", { clear: true }, "clearing the override", "Override cleared.")}>Clear override</button>}
        <button className="button secondary" onClick={() => run("org-test", { isTest: !org.isTest }, "changing the test flag", "Flag updated.")}>{org.isTest ? "Unmark test" : "Mark as test"}</button>
        <button className="button secondary" onClick={() => { const n = Number(prompt("Credit adjustment in rupees (negative to deduct)")); if (n) run("credit-adjust", { amountPaise: Math.round(n * 100) }, "adjusting credit", "Credit adjusted."); }}>Adjust credit</button>
      </div>
      <div className="queue-columns">
        <section><div className="section-label"><span>Invoices</span></div>{(d.invoices as Json[]).map((i) => <article className="queue-card" key={i._id}><div><span><strong>{i.number} · {inr(i.totalPaise)}</strong><small>{i.mode} · {fmtDate(i.createdAt)}</small></span></div><span className="mt-pill">{label(i.status)}</span></article>)}{!d.invoices.length && <Empty title="No invoices" />}</section>
        <section><div className="section-label"><span>Recent audit trail</span></div><ol className="mt-history">{(d.audits as Json[]).slice(0, 10).map((a) => <li key={a._id}><strong>{a.action}</strong><span>{new Date(a.createdAt).toLocaleString("en-IN")}</span>{a.details?.reason && <em>{a.details.reason}</em>}</li>)}</ol></section>
      </div>
    </section>
  );
}

function Subs() {
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const q = useQuery<Json>({ queryKey: ["sa", "subs", status, page], queryFn: () => getJson(`${api}?view=subscriptions&page=${page}${status ? `&status=${status}` : ""}`) });
  return (
    <>
      <div className="mt-filter">{["", "trialing", "active", "past_due", "canceled", "expired"].map((s) => <button key={s} className={status === s ? "active" : ""} onClick={() => { setStatus(s); setPage(1); }}>{s ? label(s) : "All"}</button>)}</div>
      {q.isLoading ? <Skeleton /> : q.isError || !q.data ? <Failed error={q.error} retry={() => q.refetch()} /> : (
        <>
          <div className="sq-table" role="region" aria-label="Subscriptions" tabIndex={0}><table><thead><tr><th>Organization</th><th>Plan</th><th>Interval</th><th>Status</th><th>Source</th><th>Trial ends</th><th>Period ends</th></tr></thead>
            <tbody>{(q.data.items as Json[]).map((s) => <tr key={s._id}><td>{s.org?.name}{s.org?.isTest && <span className="mt-pill p-high">test</span>}</td><td>{s.planKey} v{s.planVersion}</td><td>{s.interval}</td><td><span className={`mt-pill ${s.status === "past_due" ? "p-urgent" : ""}`}>{label(s.status)}</span></td><td>{s.source}{s.mode !== "none" ? ` · ${s.mode}` : ""}</td><td>{s.trialEnd ? fmtDate(s.trialEnd) : "—"}</td><td>{s.currentPeriodEnd ? fmtDate(s.currentPeriodEnd) : "—"}</td></tr>)}</tbody></table></div>
          {!q.data.items.length && <Empty title="No subscriptions in this state" />}
          <div className="mt-pager"><button className="button secondary" disabled={page === 1} onClick={() => setPage(page - 1)}>Previous</button><span>Page {page}</span><button className="button secondary" disabled={page * 20 >= q.data.total} onClick={() => setPage(page + 1)}>Next</button></div>
        </>)}
    </>
  );
}

function Plans({ act }: { act: Act }) {
  const q = useQuery<Json>({ queryKey: ["sa", "plans"], queryFn: () => getJson(`${api}?view=plans`) });
  const [editing, setEditing] = useState<Json | null>(null);
  if (q.isLoading) return <Skeleton />;
  if (q.isError || !q.data) return <Failed error={q.error} retry={() => q.refetch()} />;
  const plans: Json[] = q.data.plans, features = q.data.features as Record<string, string>, s = q.data.settings as Json;
  const current = plans.filter((p) => p.current);
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); const f = new FormData(e.currentTarget);
    const rupees = (k: string) => Math.round(Number(f.get(k)) * 100);
    const reason = String(f.get("reason") || "");
    const r = await act("plan-save", { key: f.get("key"), name: f.get("name"), description: f.get("description") || "", monthlyPaise: rupees("monthly"), annualPaise: rupees("annual"), trialDays: Number(f.get("trial")), activeStudents: Number(f.get("students")), branches: Number(f.get("branches")), features: f.getAll("features"), isPublic: f.get("public") === "on", sortOrder: Number(f.get("sort")), providerPlanIds: { razorpay: { monthly: String(f.get("rzm") || "") || undefined, annual: String(f.get("rza") || "") || undefined } }, reason }, "New plan version saved.");
    if (r) setEditing(null);
  }
  return (
    <>
      <p className="pr-hint">Saving creates a new version. Existing subscribers keep the terms they bought; new checkouts use the latest version. Prices and entitlements live in the database — nothing is hardcoded in screens.</p>
      <div className="sq-plans">{current.map((p) => (
        <article className="sq-plan" key={p.key}><h2>{p.name} <span className="mt-pill">v{p.version}</span></h2><p className="sq-price">{inr(p.monthlyPaise)}<small>/mo</small></p><p className="pr-hint">{inr(p.annualPaise)}/yr · {p.limits.activeStudents} students · {p.limits.branches} branch(es) · trial {p.trialDays}d{!p.isPublic ? " · hidden" : ""}</p>
          <ul>{(p.features as string[]).map((f) => <li key={f}>{features[f] ?? f}</li>)}</ul><button className="button secondary" onClick={() => setEditing(p)}>Edit</button></article>))}
        <article className="sq-plan"><h2>New plan</h2><p className="pr-hint">Create a custom plan key (for example enterprise).</p><button className="button" onClick={() => setEditing({ key: "", name: "", monthlyPaise: 0, annualPaise: 0, trialDays: 0, limits: { activeStudents: 25, branches: 1 }, features: ["basic"], isPublic: true, sortOrder: 5, providerPlanIds: {} })}>Create plan</button></article></div>
      {editing && (
        <form className="mt-form" onSubmit={save} key={`${editing.key}-${editing.version ?? 0}`}>
          <label>Key<input name="key" defaultValue={editing.key} required pattern="[a-z][a-z0-9-]{1,29}" readOnly={!!editing.version} /></label><label>Name<input name="name" defaultValue={editing.name} required /></label>
          <label className="wide">Description<input name="description" defaultValue={editing.description} maxLength={300} /></label>
          <label>Monthly price (₹)<input name="monthly" type="number" min={0} step="1" defaultValue={editing.monthlyPaise / 100} required /></label><label>Annual price (₹)<input name="annual" type="number" min={0} step="1" defaultValue={editing.annualPaise / 100} required /></label>
          <label>Trial days<input name="trial" type="number" min={0} max={90} defaultValue={editing.trialDays} /></label><label>Active student limit<input name="students" type="number" min={1} defaultValue={editing.limits.activeStudents} required /></label>
          <label>Branch limit<input name="branches" type="number" min={1} defaultValue={editing.limits.branches} required /></label><label>Sort order<input name="sort" type="number" min={0} max={100} defaultValue={editing.sortOrder} /></label>
          <fieldset className="wide"><legend>Entitlements</legend>{Object.entries(features).map(([k, v]) => <label key={k} className="mt-check"><input type="checkbox" name="features" value={k} defaultChecked={(editing.features as string[]).includes(k)} />{v}</label>)}</fieldset>
          <label>Razorpay monthly plan id<input name="rzm" defaultValue={editing.providerPlanIds?.razorpay?.monthly} /></label><label>Razorpay annual plan id<input name="rza" defaultValue={editing.providerPlanIds?.razorpay?.annual} /></label>
          <label className="mt-check"><input type="checkbox" name="public" defaultChecked={editing.isPublic} />Show on the public pricing page</label><label className="wide">Reason for change (audited)<input name="reason" required minLength={3} maxLength={300} /></label>
          <div className="queue-actions"><button className="button">Save new version</button><button type="button" className="button secondary" onClick={() => setEditing(null)}>Cancel</button></div></form>)}
      <div className="section-label"><span>Tax, grace and referral settings</span></div>
      <form className="mt-form" onSubmit={async (e) => { e.preventDefault(); const f = new FormData(e.currentTarget); await act("settings-save", { taxMode: f.get("taxMode"), taxRateBps: Math.round(Number(f.get("rate")) * 100), gstin: f.get("gstin") || "", legalName: f.get("legal") || "", graceDays: Number(f.get("grace")), referralEnabled: f.get("ref") === "on", referralRewardPaise: Math.round(Number(f.get("reward")) * 100), referralMonthlyCap: Number(f.get("cap")), invoicePrefix: f.get("prefix"), reason: f.get("reason") }, "Settings saved."); }}>
        <p className="wide cm-note">Tax is never assumed. Leave tax off until you have confirmed your GST and invoicing obligations with a tax professional.</p>
        <label>Tax on invoices<select name="taxMode" defaultValue={s.taxMode}><option value="none">None</option><option value="inclusive">Included in price</option><option value="exclusive">Added on top</option></select></label><label>Tax rate (%)<input name="rate" type="number" step="0.01" min={0} max={100} defaultValue={s.taxRateBps / 100} /></label>
        <label>GSTIN<input name="gstin" defaultValue={s.gstin} maxLength={20} /></label><label>Legal name<input name="legal" defaultValue={s.legalName} maxLength={120} /></label>
        <label>Grace period (days)<input name="grace" type="number" min={0} max={60} defaultValue={s.graceDays} /></label><label>Invoice prefix<input name="prefix" defaultValue={s.invoicePrefix} maxLength={8} required /></label>
        <label>Referral reward (₹ credit)<input name="reward" type="number" min={0} defaultValue={s.referralRewardPaise / 100} /></label><label>Rewards per referrer per month<input name="cap" type="number" min={0} defaultValue={s.referralMonthlyCap} /></label>
        <label className="mt-check"><input type="checkbox" name="ref" defaultChecked={s.referralEnabled} />Referral program enabled</label><label className="wide">Reason (audited)<input name="reason" required minLength={3} /></label><button className="button">Save settings</button></form>
      <details className="weekly-card"><summary>Version history ({plans.length})</summary><div className="sq-table"><table><thead><tr><th>Plan</th><th>Version</th><th>Monthly</th><th>Students</th><th>Current</th></tr></thead><tbody>{plans.map((p) => <tr key={p._id}><td>{p.key}</td><td>v{p.version}</td><td>{inr(p.monthlyPaise)}</td><td>{p.limits.activeStudents}</td><td>{p.current ? "yes" : ""}</td></tr>)}</tbody></table></div></details>
    </>
  );
}

function Billing({ act }: { act: Act }) {
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const q = useQuery<Json>({ queryKey: ["sa", "billing", status, page], queryFn: () => getJson(`${api}?view=billing&page=${page}${status ? `&status=${status}` : ""}`) });
  if (q.isLoading) return <Skeleton />;
  if (q.isError || !q.data) return <Failed error={q.error} retry={() => q.refetch()} />;
  const d = q.data;
  return (
    <>
      <div className="mt-filter">{["", "paid", "failed", "open", "refunded", "partially_refunded"].map((s) => <button key={s} className={status === s ? "active" : ""} onClick={() => { setStatus(s); setPage(1); }}>{s ? label(s) : "All invoices"}</button>)}</div>
      <div className="sq-table" role="region" aria-label="Invoices" tabIndex={0}><table><thead><tr><th>Invoice</th><th>Organization</th><th>Total</th><th>Tax</th><th>Refunded</th><th>Status</th><th>Mode</th><th>Date</th></tr></thead>
        <tbody>{(d.invoices as Json[]).map((i) => <tr key={i._id}><td>{i.number}</td><td>{i.orgName}</td><td>{inr(i.totalPaise)}</td><td>{inr(i.taxPaise)}</td><td>{inr(i.refundedPaise)}</td><td><span className={`mt-pill ${i.status === "failed" ? "p-urgent" : ""}`}>{label(i.status)}</span></td><td>{i.mode}</td><td>{fmtDate(i.createdAt)}</td></tr>)}</tbody></table></div>
      <div className="mt-pager"><button className="button secondary" disabled={page === 1} onClick={() => setPage(page - 1)}>Previous</button><span>Page {page}</span><button className="button secondary" disabled={page * 20 >= d.total} onClick={() => setPage(page + 1)}>Next</button></div>
      <div className="queue-columns">
        <section><div className="section-label"><span>Failed payments</span><strong>{d.failedPayments.length}</strong></div>{(d.failedPayments as Json[]).map((p) => <article className="queue-card" key={p._id}><div><span><strong>{p.orgName} · {inr(p.amountPaise)}</strong><small>{p.failureReason || "Declined"} · {fmtDate(p.createdAt)} · {p.mode}</small></span></div></article>)}{!d.failedPayments.length && <Empty title="No failed payments" />}</section>
        <section><div className="section-label"><span>Webhook events</span><strong>{d.eventsFailed} failed</strong></div>{(d.events as Json[]).map((e) => <article className="queue-card" key={e._id}><div><span><strong>{e.type}</strong><small>{e.mode} · {e.status} · {e.attempts} attempt(s) · {new Date(e.createdAt).toLocaleString("en-IN")}{e.error ? ` · ${e.error}` : ""}</small></span></div>{e.status === "failed" && <button className="button secondary" onClick={() => act("event-retry", { id: e._id }, "Event reprocessed.")}>Retry</button>}</article>)}{!d.events.length && <Empty title="No events yet" />}</section>
      </div>
    </>
  );
}

function Support({ act }: { act: Act }) {
  const [status, setStatus] = useState("open");
  const [open, setOpen] = useState("");
  const q = useQuery<Json>({ queryKey: ["sa", "tickets", status], queryFn: () => getJson(`/api/support?status=${status}`) });
  const t = useQuery<Json>({ queryKey: ["sa", "ticket", open], queryFn: () => getJson(`/api/support?id=${open}`), enabled: !!open });
  return (
    <>
      <div className="mt-filter">{["open", "pending", "resolved", "closed"].map((s) => <button key={s} className={status === s ? "active" : ""} onClick={() => { setStatus(s); setOpen(""); }}>{s}</button>)}</div>
      <div className="queue-columns">
        <section>{q.isLoading ? <Skeleton /> : (q.data?.items as Json[] | undefined ?? []).map((i) => <button className="queue-card sq-ticket" key={i._id} onClick={() => setOpen(i._id)} aria-pressed={open === i._id}><div><span><strong>{i.subject}</strong><small>{i.orgName} · {label(i.category)} · {i.priority} · {fmtDate(i.updatedAt)}</small></span></div></button>)}{!q.isLoading && !(q.data?.items ?? []).length && <Empty title="Inbox clear" text={`No ${status} tickets.`} />}</section>
        <section>{open && t.data?.ticket && (
          <div className="weekly-card"><div className="section-label"><span>{t.data.ticket.subject}</span><span className="mt-pill">{t.data.ticket.status}</span></div>
            {(t.data.ticket.messages as Json[]).map((m, i) => <div key={i} className={`sq-msg ${m.role}`}><small>{m.role === "admin" ? "You" : "Owner"} · {new Date(m.at).toLocaleString("en-IN")}</small><p>{m.body}</p></div>)}
            <form className="queue-actions" onSubmit={async (e) => { e.preventDefault(); const f = new FormData(e.currentTarget); const form = e.currentTarget; if (await act("reply", { id: open, body: f.get("body"), status: f.get("status") || undefined }, "Reply sent.", "/api/support")) form.reset(); }}>
              <input name="body" className="pr-select" required minLength={2} maxLength={2000} placeholder="Reply to the owner" aria-label="Reply" /><select name="status" className="pr-select" aria-label="Set status" defaultValue="pending"><option value="pending">Pending</option><option value="resolved">Resolved</option><option value="open">Open</option></select><button className="button">Send</button></form>
            <ol className="mt-history">{(t.data.ticket.history as Json[]).map((h, i) => <li key={i}><strong>{h.status}</strong><span>{new Date(h.at).toLocaleString("en-IN")}</span></li>)}</ol></div>)}</section>
      </div>
    </>
  );
}

function Growth({ act }: { act: Act }) {
  const q = useQuery<Json>({ queryKey: ["sa", "growth"], queryFn: () => getJson(`${api}?view=growth`) });
  if (q.isLoading) return <Skeleton />;
  if (q.isError || !q.data) return <Failed error={q.error} retry={() => q.refetch()} />;
  const d = q.data;
  return (
    <>
      <div className="section-label"><span>Coupons &amp; campaigns</span></div>
      <form className="mt-form" onSubmit={async (e) => { e.preventDefault(); const f = new FormData(e.currentTarget); const form = e.currentTarget; const type = String(f.get("type")); const v = Number(f.get("value")); const to = String(f.get("to") || ""); if (await act("coupon-save", { code: f.get("code"), name: f.get("name"), campaign: f.get("campaign") || "", type, value: type === "fixed" ? Math.round(v * 100) : v, maxRedemptions: Number(f.get("max")), validTo: to ? new Date(`${to}T23:59:59`).toISOString() : undefined, plans: String(f.get("plans") || "").split(",").map((s) => s.trim()).filter(Boolean), providerOfferId: f.get("offer") || "" }, "Coupon saved.")) form.reset(); }}>
        <label>Code<input name="code" required pattern="[A-Za-z0-9-]{3,30}" /></label><label>Name<input name="name" required /></label><label>Campaign<input name="campaign" /></label>
        <label>Type<select name="type"><option value="percent">Percent off</option><option value="fixed">Fixed ₹ off</option></select></label><label>Value (% or ₹)<input name="value" type="number" min={1} required /></label><label>Max redemptions<input name="max" type="number" min={1} defaultValue={100} required /></label>
        <label>Expires<input name="to" type="date" /></label><label>Plans (blank = all)<input name="plans" placeholder="pro,business" /></label><label>Razorpay offer id (live billing)<input name="offer" /></label><button className="button">Save coupon</button></form>
      <div className="sq-table" role="region" aria-label="Coupons" tabIndex={0}><table><thead><tr><th>Code</th><th>Campaign</th><th>Discount</th><th>Used</th><th>Expires</th><th>Active</th></tr></thead><tbody>{(d.coupons as Json[]).map((c) => <tr key={c._id}><td>{c.code}</td><td>{c.campaign || "—"}</td><td>{c.type === "percent" ? `${c.value}%` : inr(c.value)}</td><td>{c.redemptions}/{c.maxRedemptions}</td><td>{c.validTo ? fmtDate(c.validTo) : "—"}</td><td>{c.active ? "yes" : "no"}</td></tr>)}</tbody></table></div>
      <div className="queue-columns">
        <section><div className="section-label"><span>Referrals</span></div>{(d.referrals as Json[]).map((r) => <article className="queue-card" key={r._id}><div><span><strong>{r.referrerName} → {r.referredName}</strong><small>{label(r.status)}{r.rejectReason ? ` — ${r.rejectReason}` : ""} · {fmtDate(r.createdAt)}</small></span></div></article>)}{!d.referrals.length && <Empty title="No referrals yet" />}</section>
        <section><div className="section-label"><span>Demo requests</span></div>{(d.platformLeads as Json[]).map((l) => <article className="queue-card" key={l._id}><div><span><strong>{l.name} · {l.libraryName || "—"}</strong><small>{l.consentContact ? `${l.email}${l.phone ? ` · ${l.phone}` : ""}` : "No contact consent"} · {fmtDate(l.createdAt)}</small></span></div><select className="pr-select" aria-label="Status" value={l.status} onChange={(e) => act("platform-lead-status", { id: l._id, status: e.target.value }, "Updated.")}>{["new", "contacted", "scheduled", "closed"].map((s) => <option key={s}>{s}</option>)}</select></article>)}{!d.platformLeads.length && <Empty title="No demo requests" />}
          <div className="section-label"><span>Library admission leads by stage</span></div><div className="queue-actions">{Object.entries(d.leadStages as Record<string, number>).map(([k, v]) => <span key={k} className="mt-pill">{label(k)}: {v}</span>)}</div></section>
      </div>
    </>
  );
}

function Audit() {
  const [page, setPage] = useState(1);
  const q = useQuery<Json>({ queryKey: ["sa", "audit", page], queryFn: () => getJson(`${api}?view=audit&page=${page}`) });
  if (q.isLoading) return <Skeleton />;
  if (q.isError || !q.data) return <Failed error={q.error} retry={() => q.refetch()} />;
  return (
    <>
      <div className="sq-table" role="region" aria-label="Audit log" tabIndex={0}><table><thead><tr><th>When</th><th>Action</th><th>Actor</th><th>Details</th></tr></thead><tbody>{(q.data.items as Json[]).map((a) => <tr key={a._id}><td>{new Date(a.createdAt).toLocaleString("en-IN")}</td><td>{a.action}</td><td>{a.actorRole}</td><td className="sq-wrap">{a.details ? JSON.stringify(a.details).slice(0, 140) : ""}</td></tr>)}</tbody></table></div>
      <div className="mt-pager"><button className="button secondary" disabled={page === 1} onClick={() => setPage(page - 1)}>Previous</button><span>Page {page}</span><button className="button secondary" disabled={page * 30 >= q.data.total} onClick={() => setPage(page + 1)}>Next</button></div>
    </>
  );
}

function Product() {
  const q = useQuery<Json>({ queryKey: ["sa", "product"], queryFn: () => getJson(`${api}?view=product`) });
  if (q.isLoading) return <Skeleton />;
  if (q.isError || !q.data) return <Failed error={q.error} retry={() => q.refetch()} />;
  const d = q.data;
  const tile = (title: string, value: string, hint: string) => <div><small>{title}</small><strong>{value}</strong><small className="sq-hint">{hint}</small></div>;
  return (
    <>
      <div className="mt-stats">
        {tile("New libraries (30d)", String(d.registrations.last30), `${d.registrations.last7} in 7d · ${d.registrations.total} total`)}
        {tile("Onboarding completion", pctText(d.onboarding.completionPct), `${d.onboarding.completed}/${d.onboarding.eligible} libraries`)}
        {tile("Active libraries (30d)", String(d.libraries.active30), `Retention ${pctText(d.libraries.retention30to60Pct)} of ${d.libraries.activeBase}`)}
        {tile("Weekly active students", String(d.students.weeklyActive), "Study, XP or practice activity")}
        {tile("Student activation", pctText(d.students.activationPct), `${d.students.activated}/${d.students.newCohort} studied within 7 days`)}
        {tile("Goal bonuses (30d)", String(d.students.goalBonusesAwarded30d), "XP awards for daily goals")}
        {tile("Support tickets (30d)", String(d.support.tickets30d), "All organizations")}
      </div>
      <div className="section-label"><span>Feature adoption (libraries using it)</span></div>
      <div className="queue-actions">{Object.entries(d.featureAdoption as Record<string, number>).map(([k, v]) => <span key={k} className="mt-pill">{label(k.replace(/([A-Z])/g, " $1").toLowerCase())}: {v}</span>)}</div>
      <p className="pr-hint">{d.note}</p>
    </>
  );
}
