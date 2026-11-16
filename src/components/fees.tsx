"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import { BellRing } from "lucide-react";
import { BrandLoader } from "@/components/brand-loader";
import { fmtDate, getJson, inr, post, type Json } from "./prep-api";
import { DataTable } from "./v2/data-table";
import { Badge, Chips, EmptyState } from "./v2/primitives";

/** Student-wise fees: who owes what, payment history, recording a payment, reversing a wrong one, and reminders. */
export function OwnerFees({ canReverse, canRecord, notify }: { canReverse: boolean; canRecord: boolean; notify: (message: string) => void }) {
  const qc = useQueryClient();
  const [filter, setFilter] = useState("pending");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  // A student can be opened directly with /owner/fees?student=<id> (used by the student summary); a click overrides it.
  const wanted = useSearchParams().get("student") ?? "";
  const [chosen, setOpen] = useState<string | null>(null);
  const open = chosen ?? wanted;
  const list = useQuery<Json>({
    queryKey: ["workspace", "fees", filter, search, page],
    queryFn: () => getJson(`/api/fees?filter=${filter}&page=${page}&q=${encodeURIComponent(search)}`),
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ["workspace"] });
  const run = async (work: () => Promise<string>) => {
    try { notify(await work()); await refresh(); } catch (e) { notify((e as Error).message); }
  };
  const d = list.data;
  const pages = d ? Math.max(1, Math.ceil(d.total / d.pageSize)) : 1;
  return (
    <>
      {d && <div className="mt-stats">
        <div><small>Total pending</small><strong>{inr(d.totals.pending)}</strong></div>
        <div><small>Students with dues</small><strong>{d.totals.owing}</strong></div>
        <div><small>Paid so far (open memberships)</small><strong>{inr(d.totals.paid)}</strong></div>
        <div><small>Unsettled on ended memberships</small><strong>{inr(d.totals.closedBalance)}</strong></div>
      </div>}
      <div className="lifecycle-toolbar">
        <input className="pr-select sq-v2-input" style={{ maxWidth: 320 }} type="search" placeholder="Search name or email" value={search} aria-label="Search students" onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
<Chips label="Show" value={filter} onChange={(v) => { setFilter(v); setPage(1); }} items={[{ id: "pending", label: "With pending fees" }, { id: "clear", label: "Fully paid" }, { id: "all", label: "Everyone" }]} />
        {canRecord && <button className="button secondary" disabled={!d || !d.totals.owing} onClick={() => run(async () => {
          if (!confirm(`Send a fee reminder to ${d!.totals.owing} student${d!.totals.owing === 1 ? "" : "s"} with pending fees? Each student gets at most one a day.`)) return "Reminders not sent.";
          const r = await post("/api/fees", "remind", {});
          return `Reminders sent: ${r.sent}${r.skipped ? ` (${r.skipped} already reminded today)` : ""}.`;
        })}><BellRing size={16} /> Remind everyone with dues</button>}
      </div>
      {list.isLoading && <BrandLoader compact text="Loading fees…" />}
      {list.isError && !d && <div className="cm-note danger" role="alert">Could not load fees: {list.error instanceof Error ? list.error.message : "Try again."} <button className="button secondary" onClick={() => list.refetch()}>Try again</button></div>}
      {d && <>
      <DataTable
        caption="Student fees"
        rows={d.students as Json[]}
        rowKey={(s) => s.userId}
        onRowClick={(s) => setOpen(open === s.userId ? "" : s.userId)}
        columns={[
          { key: "name", header: "Student", primary: true, render: (s) => <span><strong>{s.name}</strong><br /><small>{s.email}</small></span> },
          { key: "pending", header: "Pending", render: (s) => <>{s.pending > 0 ? <Badge tone="warn">{inr(s.pending)}</Badge> : <Badge tone="ok">Paid</Badge>}{s.closedBalance > 0 && <><br /><small>+ {inr(s.closedBalance)} on ended memberships</small></>}</> },
          { key: "paid", header: "Paid", render: (s) => inr(s.paid) },
          { key: "valid", header: "Valid until", render: (s) => (s.validUntil ? fmtDate(s.validUntil) : "—") },
          { key: "last", header: "Last payment", render: (s) => (s.lastPaymentAt ? fmtDate(s.lastPaymentAt) : "—") },
          { key: "open", header: "", hideOnCard: true, render: (s) => <span className="sq-v2-more">{open === s.userId ? "Close" : "Details"}</span> },
        ]}
        empty={<EmptyState icon={BellRing} title={filter === "pending" ? "Nobody has pending fees" : "No students match"} text={filter === "pending" ? "Every running membership is paid up." : "Try another filter or search."} />}
      />
      {pages > 1 && <div className="lifecycle-toolbar"><button className="button secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button><span>Page {page} of {pages}</span><button className="button secondary" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</button></div>}
      </>}
      {open && <StudentFees key={open} userId={open} canReverse={canReverse} canRecord={canRecord} run={run} />}
      <p className="pr-hint">Pending counts only memberships that are still running. Cancelled memberships are not billed; ended ones with a balance are listed separately.</p>
    </>
  );
}

function StudentFees({ userId, canReverse, canRecord, run }: { userId: string; canReverse: boolean; canRecord: boolean; run: (work: () => Promise<string>) => Promise<void> }) {
  const q = useQuery<Json>({ queryKey: ["workspace", "fees", "student", userId], queryFn: () => getJson(`/api/fees?student=${userId}`) });
  const top = useRef<HTMLElement>(null);
  useEffect(() => { top.current?.scrollIntoView({ block: "start", behavior: "smooth" }); }, [q.isSuccess]);
  if (q.isLoading) return <BrandLoader compact text="Loading…" />;
  if (q.isError || !q.data) return <p className="cm-note danger">{q.error instanceof Error ? q.error.message : "Could not load this student."}</p>;
  const d = q.data, owing = (d.memberships as Json[]).filter((m) => m.running && m.amount - (m.discount ?? 0) - (m.paid ?? 0) > 0);
  const record = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    const rupees = Number(f.get("amount"));
    if (!(rupees > 0)) return;
    void run(async () => {
      await post("/api/workspace", "payments", { membershipId: f.get("membershipId"), amount: Math.round(rupees * 100), method: f.get("method"), key: crypto.randomUUID() });
      form.reset(); // never leave the old amount behind, so it cannot be recorded twice by accident
      return "Payment recorded.";
    });
  };
  return (
    <section className="card" ref={top} aria-label={`Fees for ${d.student.name}`}>
      <div className="section-label"><span>{d.student.name}</span><span>Pending {inr(d.totals.pending)} · Paid {inr(d.totals.paid)}</span></div>
      {canRecord && owing.length > 0 && (
        <form className="mt-form" onSubmit={record}>
          <label>Membership<select name="membershipId">{owing.map((m) => <option key={m._id} value={m._id}>{m.plan ?? "Membership"} · ends {fmtDate(m.end)} · due {inr(m.amount - (m.discount ?? 0) - (m.paid ?? 0))}</option>)}</select></label>
          <label>Amount received (₹)<input name="amount" type="number" min="1" step="1" required /></label>
          <label>Method<select name="method"><option value="cash">Cash</option><option value="upi">UPI</option></select></label>
          <button className="button">Record payment</button>
        </form>
      )}
      <div className="section-label"><span>Memberships</span></div>
      <div className="sq-table" role="region" aria-label="Memberships" tabIndex={0}><table>
        <thead><tr><th>Plan</th><th>Period</th><th>Status</th><th>Fee</th><th>Discount</th><th>Paid</th><th>Balance</th></tr></thead>
        <tbody>{(d.memberships as Json[]).map((m) => <tr key={m._id}><td>{m.plan ?? "—"}</td><td>{fmtDate(m.start)} – {fmtDate(m.end)}</td><td>{m.status}</td><td>{inr(m.amount)}</td><td>{inr(m.discount ?? 0)}</td><td>{inr(m.paid ?? 0)}</td><td>{m.status === "cancelled" ? "—" : inr(Math.max(0, m.amount - (m.discount ?? 0) - (m.paid ?? 0)))}</td></tr>)}</tbody>
      </table></div>
      <div className="section-label"><span>Payment history</span></div>
      <div className="sq-table" role="region" aria-label="Payment history" tabIndex={0}><table>
        <thead><tr><th>Date</th><th>Amount</th><th>Method</th><th>Receipt</th><th>Status</th>{canReverse && <th />}</tr></thead>
        <tbody>{(d.payments as Json[]).map((p) => (
          <tr key={p._id} style={p.reversedAt ? { opacity: 0.6 } : undefined}>
            <td>{fmtDate(p.createdAt)}</td><td>{inr(p.amount)}</td><td>{p.method}</td>
            <td><a href={`/api/receipts/${p._id}`} target="_blank" rel="noreferrer">{p.receipt}</a></td>
            <td>{p.reversedAt ? `Reversed ${fmtDate(p.reversedAt)}: ${p.reversalReason ?? ""}` : "Received"}</td>
            {canReverse && <td>{!p.reversedAt && <button className="button secondary" onClick={() => {
              const reason = prompt("Why is this payment being reversed? (it stays on record)");
              if (!reason || reason.trim().length < 3) return;
              void run(async () => { await post("/api/workspace", "payment-reverse", { paymentId: p._id, reason: reason.trim() }); return "Payment reversed. Record the correct payment if needed."; });
            }}>Reverse</button>}</td>}
          </tr>))}</tbody>
      </table></div>
      {!d.payments.length && <p className="pr-hint">No payments recorded yet.</p>}
    </section>
  );
}
