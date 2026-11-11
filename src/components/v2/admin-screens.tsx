"use client";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Building2, ChevronRight, CreditCard, Globe2, Layers, ShieldAlert, Users } from "lucide-react";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { fmtDate, getJson, inr, type Json } from "@/components/prep-api";
import { DataTable, type Column } from "./data-table";
import { ResponsiveDialog } from "./dialog";
import { Field, TextArea, TextInput } from "./form";
import { initials } from "./format";
import { Badge, Btn, Chips, EmptyState, ErrorState, PageHead, Skeleton, StatCard } from "./primitives";

type Row = Json;
const API = "/api/saas-admin";
export type AdminAct = (action: string, data: unknown, ok?: string, url?: string) => Promise<Json | null>;
const label = (v: string) => v.replace(/[-_]/g, " ");
const pct = (v: number | null | undefined) => (v === null || v === undefined ? "—" : `${v}%`);

/** Makes the reach of an action obvious: the whole platform, or one organization. */
export function ScopeTag({ scope, name }: { scope: "platform" | "organization"; name?: string }) {
  return scope === "platform" ? (
    <Badge tone="warn"><Globe2 size={12} aria-hidden="true" />&nbsp;Affects every library</Badge>
  ) : (
    <Badge><Building2 size={12} aria-hidden="true" />&nbsp;{name ? `Only ${name}` : "One organization"}</Badge>
  );
}

export type ActionField = { name: string; label: string; type?: "text" | "number" | "date" | "textarea"; hint?: string; required?: boolean; placeholder?: string; min?: number; max?: number; step?: string };

/**
 * A confirmation dialog for a high-impact admin action: says what will happen, asks for the reason the
 * server requires (recorded in the audit log) and any inputs. It only collects values; the caller sends the request.
 */
export function ActionDialog({ open, onClose, title, scope, consequence, danger = false, fields = [], submitLabel, onSubmit }: {
  open: boolean;
  onClose: () => void;
  title: string;
  scope: { kind: "platform" | "organization"; name?: string };
  consequence: string;
  danger?: boolean;
  fields?: ActionField[];
  submitLabel: string;
  onSubmit: (values: Record<string, string>, reason: string) => Promise<void> | void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const reason = String(f.get("reason") ?? "").trim();
    if (reason.length < 3) return setError("Write a short reason (at least 3 characters). It is recorded in the audit log.");
    const values: Record<string, string> = {};
    for (const fld of fields) values[fld.name] = String(f.get(fld.name) ?? "");
    setError("");
    setBusy(true);
    try { await onSubmit(values, reason); } finally { setBusy(false); }
  }
  return (
    <ResponsiveDialog open={open} onClose={onClose} title={title} description={undefined}>
      <form onSubmit={submit} key={title}>
        <p><ScopeTag scope={scope.kind} name={scope.name} /></p>
        <p className="sq-v2-modnote" style={{ fontSize: 14, margin: "8px 0 14px", color: danger ? "var(--sq-danger)" : "var(--sq-ink)" }}>{danger && <AlertTriangle size={14} aria-hidden="true" />} {consequence}</p>
        {fields.map((fld) => (
          <Field key={fld.name} label={fld.label} hint={fld.hint}>
            {fld.type === "textarea" ? <TextArea name={fld.name} required={fld.required} placeholder={fld.placeholder} /> : <TextInput name={fld.name} type={fld.type ?? "text"} required={fld.required} placeholder={fld.placeholder} min={fld.min} max={fld.max} step={fld.step} />}
          </Field>
        ))}
        <Field label="Reason" hint="Recorded in the audit log." error={error || undefined}><TextInput name="reason" required minLength={3} maxLength={200} /></Field>
        <div className="sq-v2-btnrow" style={{ marginTop: 14 }}>
          <Btn type="submit" kind={danger ? "danger" : "primary"} disabled={busy}>{busy ? "Working…" : submitLabel}</Btn>
          <Btn kind="outline" onClick={onClose} disabled={busy}>Cancel</Btn>
        </div>
      </form>
    </ResponsiveDialog>
  );
}

// ───────────────────────── Overview ─────────────────────────
export function AdminOverview({ onManage, preview, libraries }: { onManage: () => void; preview: boolean; libraries: Row[] }) {
  const q = useQuery<Json>({ queryKey: ["sa", "overview", 30, false], queryFn: () => getJson(`${API}?view=overview&days=30`), enabled: !preview });
  const orgs = useQuery<Json>({ queryKey: ["sa", "orgs", "", 1], queryFn: () => getJson(`${API}?view=orgs&page=1&q=`), enabled: !preview });
  const d = q.data;
  const alerts: { tone: "bad" | "warn"; text: string; href: string }[] = [];
  if (d) {
    if (d.revenue.failedPayments > 0) alerts.push({ tone: "bad", text: `${d.revenue.failedPayments} failed payment${d.revenue.failedPayments === 1 ? "" : "s"} in the last 30 days`, href: "/super-admin/business" });
    if (d.revenue.outstandingInvoices > 0) alerts.push({ tone: "warn", text: `${d.revenue.outstandingInvoices} open or failed invoice${d.revenue.outstandingInvoices === 1 ? "" : "s"} (${inr(d.revenue.outstandingPaise)} outstanding)`, href: "/super-admin/business" });
    if (d.growth.suspended > 0) alerts.push({ tone: "warn", text: `${d.growth.suspended} suspended organization${d.growth.suspended === 1 ? "" : "s"}`, href: "/super-admin/libraries" });
  }
  const shortcuts = [
    { href: "/super-admin/libraries", label: "Organizations", icon: Building2 },
    { href: "/super-admin/subscriptions", label: "Subscriptions", icon: CreditCard },
    { href: "/super-admin/plans", label: "Plans & pricing", icon: Layers },
    { href: "/super-admin/modules", label: "Module availability", icon: Globe2 },
    { href: "/super-admin/accounts", label: "Accounts", icon: Users },
  ];
  return (
    <>
      <PageHead eyebrow="Platform" title="Overview" sub={preview ? "Sign in with an administrator account to view data." : "Live figures across every organization. Test organizations and sandbox payments are excluded."} actions={!preview ? <Btn kind="outline" onClick={onManage}>Manage a library subscription</Btn> : undefined} />
      {!preview && (q.isLoading ? <Skeleton lines={4} /> : q.isError || !d ? <ErrorState title="Platform figures unavailable" text={q.error instanceof Error ? q.error.message : "Please try again."} onRetry={() => void q.refetch()} /> : (
        <>
          <div className="sq-v2-statgrid">
            <StatCard label="Organizations" value={d.growth.organizations} sub={`${d.growth.newOrganizations} new in 30 days · ${d.growth.branches} branches`} href="/super-admin/libraries" />
            <StatCard label="Active students" value={d.usage.activeStudents} sub={`${d.usage.seatsInUse}/${d.usage.seats} seats in use (${pct(d.usage.seatUtilizationPct)})`} />
            <StatCard label="Paying organizations" value={d.revenue.activePayingOrganizations} sub={`MRR ${inr(d.revenue.mrrPaise)}`} href="/super-admin/subscriptions" />
            <StatCard label="Collected (30 days)" value={inr(d.revenue.collectedPaise)} sub={`Net ${inr(d.revenue.netCollectedPaise)} after refunds`} href="/super-admin/business" />
          </div>
          <div className="sq-v2-grid2">
            <section className="sq-v2-panel" aria-label="Needs attention">
              <h2 className="sq-v2-h2">Needs attention</h2>
              {alerts.length ? (
                <ul className="sq-v2-feed">
                  {alerts.map((a) => <li key={a.text}><i><ShieldAlert size={16} /></i><Link href={a.href} className="sq-v2-rowlink"><span>{a.text}</span><ChevronRight size={15} /></Link><Badge tone={a.tone}>{a.tone === "bad" ? "Urgent" : "Review"}</Badge></li>)}
                </ul>
              ) : <p className="sq-v2-muted">Nothing needs attention right now.</p>}
            </section>
            <section className="sq-v2-panel" aria-label="Shortcuts">
              <h2 className="sq-v2-h2">Operations</h2>
              <ul className="sq-v2-feed">
                {shortcuts.map((s) => { const Icon = s.icon; return <li key={s.href}><i><Icon size={16} /></i><Link href={s.href} className="sq-v2-rowlink"><span>{s.label}</span><ChevronRight size={15} /></Link></li>; })}
              </ul>
            </section>
          </div>
          <section className="sq-v2-panel" style={{ marginTop: 14 }} aria-label="Newest organizations">
            <div className="sq-v2-panelhead"><h2 className="sq-v2-h2">Newest organizations</h2><Link href="/super-admin/libraries" className="sq-v2-more">All organizations <ChevronRight size={14} /></Link></div>
            {orgs.isLoading ? <Skeleton lines={3} /> : orgs.isError ? <ErrorState title="Organizations unavailable" onRetry={() => void orgs.refetch()} /> : (orgs.data?.items as Row[] | undefined)?.length ? (
              <ul className="sq-v2-feed">
                {(orgs.data!.items as Row[]).slice(0, 6).map((o) => (
                  <li key={o._id}><span className="sq-v2-avatar" aria-hidden="true">{initials(String(o.name))}</span><span><strong>{o.name}</strong><br /><small>{o.owner?.email} · {o.students} students · {o.branches} branch{o.branches === 1 ? "" : "es"}</small></span><Badge tone={o.status === "suspended" ? "bad" : "ok"}>{o.status === "suspended" ? "Suspended" : label(o.subscription?.status ?? "no plan")}</Badge></li>
                ))}
              </ul>
            ) : <EmptyState icon={Building2} title="No organizations yet" text="Registered libraries will appear here." />}
          </section>
        </>
      ))}
      {preview && (libraries.length ? null : <EmptyState icon={Building2} title="A fresh start" text="Registered libraries will appear here." />)}
    </>
  );
}

// ───────────────────────── Organizations ─────────────────────────
export function AdminOrganizations({ act }: { act: AdminAct }) {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState("");
  const q = useQuery<Json>({ queryKey: ["sa", "orgs", search, page], queryFn: () => getJson(`${API}?view=orgs&page=${page}&q=${encodeURIComponent(search)}`) });
  const items: Row[] = q.data?.items ?? [];
  const columns: Column<Row>[] = [
    { key: "name", header: "Organization", primary: true, render: (o) => <span className="sq-v2-who"><span className="sq-v2-avatar" aria-hidden="true">{initials(String(o.name))}</span><span><strong>{o.name}</strong>{o.isTest && <> <Badge tone="warn">Test</Badge></>}<small>{o.owner?.email}</small></span></span> },
    { key: "plan", header: "Plan", render: (o) => o.subscription?.planKey ?? "—" },
    { key: "status", header: "Status", render: (o) => <Badge tone={o.status === "suspended" ? "bad" : "ok"}>{o.status === "suspended" ? "Suspended" : label(o.subscription?.status ?? "—")}</Badge> },
    { key: "branches", header: "Branches", render: (o) => o.branches },
    { key: "students", header: "Students", render: (o) => o.students },
  ];
  return (
    <>
      <div className="sq-v2-toolbar">
        <label className="sq-v2-search"><input type="search" aria-label="Search organizations" placeholder="Search organizations" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} /></label>
        {q.data && <span className="sq-v2-count">{q.data.total} organization{q.data.total === 1 ? "" : "s"}</span>}
      </div>
      {q.isError ? <ErrorState title="Could not load organizations" text={q.error instanceof Error ? q.error.message : undefined} onRetry={() => void q.refetch()} /> : (
        <DataTable caption="Organizations" columns={columns} rows={items} rowKey={(o) => String(o._id)} loading={q.isLoading} onRowClick={(o) => setOpen(String(o._id))}
          empty={<EmptyState icon={Building2} title={search ? "No matching organizations" : "No organizations yet"} text={search ? "Try another name." : "Registered libraries will appear here."} />} />
      )}
      {q.data && q.data.total > 20 && (
        <div className="sq-v2-pager"><span>Page {page}</span><div className="sq-v2-btnrow"><Btn kind="outline" disabled={page === 1} onClick={() => setPage(page - 1)}>Previous</Btn><Btn kind="outline" disabled={page * 20 >= q.data.total} onClick={() => setPage(page + 1)}>Next</Btn></div></div>
      )}
      {open && <OrgDialog id={open} act={act} onClose={() => setOpen("")} />}
    </>
  );
}

type Pending = "suspend" | "reinstate" | "trial" | "grant" | "override" | "clear" | "test" | "credit" | null;

function OrgDialog({ id, act, onClose }: { id: string; act: AdminAct; onClose: () => void }) {
  const q = useQuery<Json>({ queryKey: ["sa", "org", id], queryFn: () => getJson(`${API}?view=org&id=${id}`) });
  const [pending, setPending] = useState<Pending>(null);
  const d = q.data;
  const org = d?.org, sub = d?.subscription as Json | null | undefined;
  const send = async (action: string, extra: Json, reason: string, ok: string) => {
    const r = await act(action, { organizationId: id, reason, ...extra }, ok);
    if (r) { setPending(null); await q.refetch(); }
  };
  const scope = { kind: "organization" as const, name: org?.name };
  return (
    <>
      <ResponsiveDialog open onClose={onClose} title={org?.name ?? "Organization"} description={org ? `Plan ${sub?.planKey ?? "—"} · ${sub ? label(sub.status) : "no subscription"}` : undefined} size="lg">
        {q.isLoading ? <Skeleton lines={5} /> : q.isError || !d ? <ErrorState title="Could not load this organization" onRetry={() => void q.refetch()} /> : (
          <>
            <div className="sq-v2-btnrow" style={{ marginBottom: 12 }}>
              <ScopeTag scope="organization" name={org.name} />
              <Badge tone={org.status === "suspended" ? "bad" : "ok"}>{org.status === "suspended" ? "Suspended" : "Active"}</Badge>
              {org.isTest && <Badge tone="warn">Test organization</Badge>}
            </div>
            <ul className="sq-v2-feed">
              <li><span>Subscription</span><strong>{sub ? `${label(sub.status)} (${sub.source}${sub.mode !== "none" ? `, ${sub.mode}` : ""})` : "None"}</strong></li>
              {sub?.trialEnd && <li><span>Trial ends</span><strong>{fmtDate(sub.trialEnd)}</strong></li>}
              {sub?.currentPeriodEnd && <li><span>Period ends</span><strong>{fmtDate(sub.currentPeriodEnd)}</strong></li>}
              <li><span>Branches</span><strong>{d.branches.length}</strong></li>
              <li><span>Open tickets</span><strong>{d.openTickets}</strong></li>
            </ul>
            {sub?.overrides && <p className="sq-v2-modnote"><strong>Override active:</strong> {JSON.stringify(sub.overrides.features ?? {})} {sub.overrides.limits ? JSON.stringify(sub.overrides.limits) : ""} · {sub.overrides.reason}</p>}
            <h3 className="sq-v2-h3">Actions for this organization</h3>
            <div className="sq-v2-btnrow">
              {org.status === "active" ? <Btn kind="danger" onClick={() => setPending("suspend")}>Suspend</Btn> : <Btn onClick={() => setPending("reinstate")}>Reinstate</Btn>}
              <Btn kind="outline" onClick={() => setPending("trial")}>Extend trial</Btn>
              <Btn kind="outline" onClick={() => setPending("grant")}>Grant plan</Btn>
              <Btn kind="outline" onClick={() => setPending("override")}>Override entitlements</Btn>
              {sub?.overrides && <Btn kind="outline" onClick={() => setPending("clear")}>Clear override</Btn>}
              <Btn kind="outline" onClick={() => setPending("test")}>{org.isTest ? "Unmark test" : "Mark as test"}</Btn>
              <Btn kind="outline" onClick={() => setPending("credit")}>Adjust credit</Btn>
            </div>
            <h3 className="sq-v2-h3">Invoices</h3>
            {(d.invoices as Row[]).length ? <ul className="sq-v2-feed">{(d.invoices as Row[]).map((i) => <li key={i._id}><span><strong>{i.number} · {inr(i.totalPaise)}</strong><br /><small>{i.mode} · {fmtDate(i.createdAt)}</small></span><Badge tone={i.status === "failed" ? "bad" : "neutral"}>{label(i.status)}</Badge></li>)}</ul> : <p className="sq-v2-muted">No invoices.</p>}
            <h3 className="sq-v2-h3">Recent audit trail</h3>
            {(d.audits as Row[]).length ? <ul className="sq-v2-feed">{(d.audits as Row[]).slice(0, 10).map((a) => <li key={a._id}><span><strong>{a.action}</strong>{a.details?.reason && <><br /><small>{a.details.reason}</small></>}</span><time>{new Date(a.createdAt).toLocaleString("en-IN")}</time></li>)}</ul> : <p className="sq-v2-muted">No audit entries yet.</p>}
          </>
        )}
      </ResponsiveDialog>
      {org && (
        <>
          <ActionDialog open={pending === "suspend"} onClose={() => setPending(null)} title={`Suspend ${org.name}?`} scope={scope} danger submitLabel="Suspend organization"
            consequence="While suspended the organization cannot make changes (reading and exporting its data stays available). The organization is notified with your reason."
            onSubmit={(_v, reason) => send("org-suspend", {}, reason, "Organization suspended.")} />
          <ActionDialog open={pending === "reinstate"} onClose={() => setPending(null)} title={`Reinstate ${org.name}?`} scope={scope} submitLabel="Reinstate organization"
            consequence="The organization can make changes again and is notified." onSubmit={(_v, reason) => send("org-reinstate", {}, reason, "Organization reinstated.")} />
          <ActionDialog open={pending === "trial"} onClose={() => setPending(null)} title="Extend trial" scope={scope} submitLabel="Extend trial"
            consequence="Adds days to this organization's trial period."
            fields={[{ name: "days", label: "Extra days", type: "number", required: true, min: 1, max: 90, hint: "1 to 90" }]}
            onSubmit={(v, reason) => send("trial-extend", { days: Math.floor(Number(v.days)) }, reason, "Trial extended.")} />
          <ActionDialog open={pending === "grant"} onClose={() => setPending(null)} title="Grant a plan" scope={scope} submitLabel="Grant plan"
            consequence="Gives this organization the chosen plan's features until the date you set."
            fields={[{ name: "planKey", label: "Plan key", required: true, placeholder: "starter", hint: "For example free, starter, pro or business." }, { name: "until", label: "Until", type: "date", required: true }]}
            onSubmit={(v, reason) => send("grant-plan", { planKey: v.planKey, until: new Date(v.until).toISOString() }, reason, "Plan granted.")} />
          <ActionDialog open={pending === "override"} onClose={() => setPending(null)} title="Override entitlements" scope={scope} submitLabel="Save override"
            consequence="Adds features or raises the student limit for this organization only, on top of its plan."
            fields={[{ name: "add", label: "Features to add", placeholder: "qr-attendance, multi-branch", hint: "Comma separated." }, { name: "limit", label: "Active student limit", type: "number", min: 1, hint: "Leave blank to keep the plan's limit." }, { name: "days", label: "Lasts (days)", type: "number", min: 1, hint: "Leave blank to keep it until cleared." }]}
            onSubmit={(v, reason) => send("sub-override", { add: v.add.split(",").map((s) => s.trim()).filter(Boolean), activeStudents: Number(v.limit) || undefined, ...(Number(v.days) ? { expiresAt: new Date(Date.now() + Number(v.days) * 86400000).toISOString() } : {}) }, reason, "Override saved.")} />
          <ActionDialog open={pending === "clear"} onClose={() => setPending(null)} title="Clear override?" scope={scope} submitLabel="Clear override"
            consequence="Removes the extra features and limits. The organization goes back to exactly what its plan includes."
            onSubmit={(_v, reason) => send("sub-override", { clear: true }, reason, "Override cleared.")} />
          <ActionDialog open={pending === "test"} onClose={() => setPending(null)} title={org.isTest ? "Unmark as test?" : "Mark as test?"} scope={scope} submitLabel={org.isTest ? "Unmark test" : "Mark as test"}
            consequence={org.isTest ? "The organization counts in platform figures again." : "The organization is excluded from platform revenue and growth figures."}
            onSubmit={(_v, reason) => send("org-test", { isTest: !org.isTest }, reason, "Flag updated.")} />
          <ActionDialog open={pending === "credit"} onClose={() => setPending(null)} title="Adjust credit" scope={scope} submitLabel="Adjust credit"
            consequence="Changes this organization's subscription credit balance. Use a negative number to deduct."
            fields={[{ name: "rupees", label: "Amount (₹)", type: "number", required: true, step: "0.01", hint: "Negative to deduct." }]}
            onSubmit={(v, reason) => { const n = Number(v.rupees); if (!n) return; return send("credit-adjust", { amountPaise: Math.round(n * 100) }, reason, "Credit adjusted."); }} />
        </>
      )}
    </>
  );
}

// ───────────────────────── Subscriptions ─────────────────────────
export function AdminSubscriptions() {
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const q = useQuery<Json>({ queryKey: ["sa", "subs", status, page], queryFn: () => getJson(`${API}?view=subscriptions&page=${page}${status ? `&status=${status}` : ""}`) });
  const columns: Column<Row>[] = [
    { key: "org", header: "Organization", primary: true, render: (s) => <span><strong>{s.org?.name}</strong>{s.org?.isTest && <> <Badge tone="warn">Test</Badge></>}</span> },
    { key: "plan", header: "Plan", render: (s) => `${s.planKey} v${s.planVersion}` },
    { key: "interval", header: "Interval", render: (s) => s.interval },
    { key: "status", header: "Status", render: (s) => <Badge tone={s.status === "past_due" ? "bad" : s.status === "active" ? "ok" : "neutral"}>{label(s.status)}</Badge> },
    { key: "source", header: "Source", render: (s) => `${s.source}${s.mode !== "none" ? ` · ${s.mode}` : ""}` },
    { key: "trial", header: "Trial ends", render: (s) => (s.trialEnd ? fmtDate(s.trialEnd) : "—") },
    { key: "period", header: "Period ends", render: (s) => (s.currentPeriodEnd ? fmtDate(s.currentPeriodEnd) : "—") },
  ];
  const items: { id: string; label: string }[] = ["", "trialing", "active", "past_due", "canceled", "expired"].map((s) => ({ id: s, label: s ? label(s) : "All" }));
  return (
    <>
      <div className="sq-v2-toolbar"><Chips label="Subscription status" value={status} onChange={(v) => { setStatus(v); setPage(1); }} items={items} /></div>
      {q.isError ? <ErrorState title="Could not load subscriptions" text={q.error instanceof Error ? q.error.message : undefined} onRetry={() => void q.refetch()} /> : (
        <DataTable caption="Subscriptions" columns={columns} rows={(q.data?.items as Row[] | undefined) ?? []} rowKey={(s) => String(s._id)} loading={q.isLoading}
          empty={<EmptyState icon={CreditCard} title="No subscriptions in this state" />} />
      )}
      {q.data && q.data.total > 20 && (
        <div className="sq-v2-pager"><span>Page {page}</span><div className="sq-v2-btnrow"><Btn kind="outline" disabled={page === 1} onClick={() => setPage(page - 1)}>Previous</Btn><Btn kind="outline" disabled={page * 20 >= q.data.total} onClick={() => setPage(page + 1)}>Next</Btn></div></div>
      )}
    </>
  );
}

