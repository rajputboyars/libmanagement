"use client";
import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, ChevronLeft, ChevronRight, IndianRupee, Plus, Search, UserPlus, Users } from "lucide-react";
import { useState } from "react";
import { getJson, inr, type Json } from "@/components/prep-api";
import { isRunning, owed, type Figures } from "@/lib/fees";
import { DataTable, type Column } from "./data-table";
import { ResponsiveDialog } from "./dialog";
import { clock, initials, istDay, shortDate } from "./format";
import { Badge, Btn, EmptyState, ErrorState, PageHead, Skeleton, StatCard } from "./primitives";

type Row = Json;
const F = (m: Row) => m as Figures;
const PAGE_SIZE = 25;
// The workspace payload carries only the latest 100 memberships; below that we can show per-student status honestly.
const WORKSPACE_CAP = 100;

type Listing = { records: Row[]; total: number };
function useListing(resource: string, page: number, search: string, enabled: boolean) {
  // Same key and endpoint as the legacy table, so cache and invalidation behave as before.
  return useQuery<Listing>({
    queryKey: ["workspace", resource, page, search],
    enabled,
    queryFn: async () => {
      const res = await fetch(`/api/workspace?resource=${resource}&page=${page}&q=${encodeURIComponent(search)}`);
      if (!res.ok) throw new Error("Unable to load records");
      return res.json();
    },
  });
}

function SearchBox({ value, onChange, label, placeholder }: { value: string; onChange: (v: string) => void; label: string; placeholder: string }) {
  return (
    <label className="sq-v2-search">
      <Search size={17} aria-hidden="true" />
      <input type="search" aria-label={label} placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

function Pager({ page, total, loading, onPage }: { page: number; total: number; loading: boolean; onPage: (p: number) => void }) {
  if (total <= PAGE_SIZE) return null;
  const from = (page - 1) * PAGE_SIZE + 1;
  return (
    <div className="sq-v2-pager">
      <span>{loading ? "Loading…" : `${from}–${Math.min(page * PAGE_SIZE, total)} of ${total}`}</span>
      <div className="sq-v2-btnrow">
        <Btn kind="outline" disabled={page === 1 || loading} onClick={() => onPage(page - 1)} aria-label="Previous page"><ChevronLeft size={16} /></Btn>
        <Btn kind="outline" disabled={loading || page * PAGE_SIZE >= total} onClick={() => onPage(page + 1)} aria-label="Next page"><ChevronRight size={16} /></Btn>
      </div>
    </div>
  );
}

function StudentProfile({ student, canViewFees, onClose }: { student: Row; canViewFees: boolean; onClose: () => void }) {
  const id = String(student._id);
  const q = useQuery<Json>({ queryKey: ["workspace", "fees", "student", id], queryFn: () => getJson(`/api/fees?student=${id}`), enabled: canViewFees });
  const f = q.data;
  return (
    <ResponsiveDialog open onClose={onClose} title={String(student.name || "Student")} description={String(student.email || "")} size="lg"
      footer={canViewFees ? <Btn href={`/owner/fees?student=${id}`}>Open fees <ArrowUpRight size={16} /></Btn> : undefined}>
      {!canViewFees && <p className="sq-v2-muted">Your role does not include fee details. Ask the owner if you need them.</p>}
      {canViewFees && q.isLoading && <Skeleton lines={4} />}
      {canViewFees && q.isError && <ErrorState title="Could not load this student" text={q.error instanceof Error ? q.error.message : "Try again."} onRetry={() => void q.refetch()} />}
      {f && (
        <>
          <div className="sq-v2-statgrid" style={{ marginBottom: 16 }}>
            <StatCard label="Pending" value={inr(f.totals.pending)} tone={f.totals.pending > 0 ? "down" : undefined} />
            <StatCard label="Paid so far" value={inr(f.totals.paid)} />
          </div>
          <h3 className="sq-v2-h3">Memberships</h3>
          {(f.memberships as Row[]).length ? (
            <ul className="sq-v2-feed">
              {(f.memberships as Row[]).map((m) => (
                <li key={m._id}>
                  <span><strong>{m.plan ?? "Membership"}</strong><br /><small>{shortDate(m.start)} – {shortDate(m.end)}</small></span>
                  <Badge tone={m.running ? "ok" : m.status === "cancelled" ? "bad" : "neutral"}>{m.running ? "Running" : m.status}</Badge>
                  <span className="sq-v2-num">{owed(F(m)) > 0 && isRunning(F(m)) ? inr(owed(F(m))) + " due" : "Settled"}</span>
                </li>
              ))}
            </ul>
          ) : <p className="sq-v2-muted">No memberships yet.</p>}
          <h3 className="sq-v2-h3">Recent payments</h3>
          {(f.payments as Row[]).length ? (
            <ul className="sq-v2-feed">
              {(f.payments as Row[]).slice(0, 5).map((p) => (
                <li key={p._id}>
                  <span><strong>{inr(p.amount)}</strong> · {p.method}<br /><small>{shortDate(p.createdAt)}{p.reversedAt ? " · reversed" : ""}</small></span>
                  <a href={`/api/receipts/${p._id}`} target="_blank" rel="noreferrer" className="sq-v2-more">{p.receipt} <ArrowUpRight size={13} /></a>
                </li>
              ))}
            </ul>
          ) : <p className="sq-v2-muted">No payments recorded yet.</p>}
        </>
      )}
    </ResponsiveDialog>
  );
}

export function OwnerStudents({ d, preview, canDo, onAdd, showMemberships }: { d: Json; preview: boolean; canDo: (p: string) => boolean; onAdd: (a: string) => void; /** The viewer may read memberships (module on and permission held); otherwise status/seat are not shown. */ showMemberships: boolean }) {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Row | null>(null);
  const q = useListing("students", page, search, !preview);
  const memberships: Row[] = d.memberships ?? [];
  const complete = showMemberships && memberships.length < WORKSPACE_CAP;
  const assignments: Row[] = d.assignments ?? [];
  const seats: Row[] = d.seats ?? [];
  const statusOf = (id: unknown): { tone: "ok" | "warn" | "neutral"; label: string; seat?: string } => {
    const mine = memberships.filter((m) => String(m.userId) === String(id));
    const run = mine.find((m) => isRunning(F(m)));
    const seatId = assignments.find((a) => String(a.userId) === String(id) && +new Date(a.end) > Date.now())?.seatId;
    const seat = seats.find((s) => String(s._id) === String(seatId))?.label as string | undefined;
    if (run) return { tone: owed(F(run)) > 0 ? "warn" : "ok", label: owed(F(run)) > 0 ? "Dues pending" : "Active", seat };
    return { tone: "neutral", label: mine.length ? "Ended" : "No membership" };
  };
  const rows = q.data ? q.data.records : [];
  const total = q.data?.total ?? 0;
  const columns: Column<Row>[] = [
    { key: "name", header: "Student", primary: true, render: (s) => <span className="sq-v2-who"><span className="sq-v2-avatar" aria-hidden="true">{initials(String(s.name))}</span><span><strong>{s.name}</strong><small>{s.email}</small></span></span> },
    ...(complete ? [
      { key: "status", header: "Membership", render: (s: Row) => { const st = statusOf(s._id); return <Badge tone={st.tone}>{st.label}</Badge>; } },
      { key: "seat", header: "Seat", render: (s: Row) => statusOf(s._id).seat ?? "—" },
    ] : []),
    { key: "joined", header: "Joined", render: (s) => (s.createdAt ? shortDate(s.createdAt) : "—") },
  ];
  const add = canDo("students.create") ? <Btn onClick={() => onAdd("students")}><Plus size={17} /> Add student</Btn> : undefined;
  return (
    <>
      <PageHead title="Students" sub="Everyone registered with your library. Select a student for their summary." actions={add} />
      <div className="sq-v2-toolbar">
        <SearchBox value={search} onChange={(v) => { setSearch(v); setPage(1); }} label="Search students" placeholder="Search by name or email" />
        {!q.isLoading && !q.isError && <span className="sq-v2-count">{total} student{total === 1 ? "" : "s"}</span>}
      </div>
      {q.isError ? (
        <ErrorState title="Could not load students" text="Please check the connection and try again." onRetry={() => void q.refetch()} />
      ) : (
        <DataTable
          caption="Students"
          columns={columns}
          rows={rows}
          rowKey={(s) => String(s._id)}
          loading={q.isLoading}
          onRowClick={setSelected}
          renderCard={(s) => {
            const st = statusOf(s._id);
            return (
              <div className="sq-v2-who">
                <span className="sq-v2-avatar" aria-hidden="true">{initials(String(s.name))}</span>
                <span style={{ flex: 1, minWidth: 0 }}><strong>{s.name}</strong><small>{s.email}</small></span>
                {complete && <Badge tone={st.tone}>{st.label}</Badge>}
              </div>
            );
          }}
          empty={
            <EmptyState icon={Users} title={search ? "No matching students" : "Your students start here"}
              text={search ? "Try a different name or email." : "Connect students using the email they registered with. Their account stays theirs."}
              action={!search ? add && <Btn onClick={() => onAdd("students")}><UserPlus size={17} /> Add student</Btn> : undefined} />
          }
        />
      )}
      <Pager page={page} total={total} loading={q.isFetching} onPage={setPage} />
      {selected && <StudentProfile student={selected} canViewFees={canDo("fees.view")} onClose={() => setSelected(null)} />}
    </>
  );
}

export function OwnerPayments({ d, preview, canDo, onAdd }: { d: Json; preview: boolean; canDo: (p: string) => boolean; onAdd: (a: string) => void }) {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const q = useListing("payments", page, search, !preview);
  const students: Row[] = d.students ?? [];
  const nameOf = (id: unknown) => (students.find((s) => String(s._id) === String(id))?.name as string | undefined) ?? "—";
  const latest: Row[] = d.payments ?? [];
  const today = istDay();
  const todays = latest.filter((p) => !p.reversedAt && istDay(p.createdAt) === today);
  const rows = q.data ? q.data.records : [];
  const total = q.data?.total ?? 0;
  const status = (p: Row) => (p.reversedAt ? <Badge tone="bad">Reversed</Badge> : <Badge tone="ok">Received</Badge>);
  const columns: Column<Row>[] = [
    { key: "receipt", header: "Receipt", primary: true, render: (p) => <a className="sq-v2-more" href={`/api/receipts/${p._id}`} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>{p.receipt || "Receipt"} <ArrowUpRight size={13} /></a> },
    { key: "student", header: "Student", render: (p) => nameOf(p.userId) },
    { key: "amount", header: "Amount", render: (p) => <strong className="sq-v2-num">{inr(p.amount)}</strong> },
    { key: "method", header: "Method", render: (p) => String(p.method).toUpperCase() },
    { key: "at", header: "Recorded", render: (p) => `${shortDate(p.createdAt)}, ${clock(p.createdAt)}` },
    { key: "status", header: "Status", render: status },
  ];
  const add = canDo("fees.create") ? <Btn onClick={() => onAdd("payments")}><IndianRupee size={17} /> Record payment</Btn> : undefined;
  return (
    <>
      <PageHead title="Payments" sub="Every confirmed payment, with its receipt. Wrong entries are reversed, never deleted." actions={add} />
      <div className="sq-v2-statgrid" style={{ marginBottom: 16 }}>
        <StatCard label="Today's collection" value={inr(todays.reduce((a, p) => a + Number(p.amount || 0), 0))} sub={`${todays.length} payment${todays.length === 1 ? "" : "s"} today`} />
        <StatCard label="Confirmed so far" value={inr(d.summary?.revenue ?? 0)} sub="Excludes reversed payments" />
      </div>
      <div className="sq-v2-toolbar">
        <SearchBox value={search} onChange={(v) => { setSearch(v); setPage(1); }} label="Search payments" placeholder="Search by receipt number" />
        {!q.isLoading && !q.isError && <span className="sq-v2-count">{total} payment{total === 1 ? "" : "s"}</span>}
      </div>
      {q.isError ? (
        <ErrorState title="Could not load payments" onRetry={() => void q.refetch()} />
      ) : (
        <DataTable
          caption="Payments"
          columns={columns}
          rows={rows}
          rowKey={(p) => String(p._id)}
          loading={q.isLoading}
          renderCard={(p) => (
            <>
              <div className="sq-v2-cardrow"><strong>{nameOf(p.userId)}</strong><strong className="sq-v2-num">{inr(p.amount)}</strong></div>
              <div className="sq-v2-cardrow"><span>{shortDate(p.createdAt)} · {String(p.method).toUpperCase()}</span>{status(p)}</div>
              <div className="sq-v2-cardrow"><a className="sq-v2-more" href={`/api/receipts/${p._id}`} target="_blank" rel="noreferrer">{p.receipt || "Receipt"} <ArrowUpRight size={13} /></a></div>
            </>
          )}
          empty={<EmptyState icon={IndianRupee} title={search ? "No matching payments" : "No payments yet"} text={search ? "Try another receipt number." : "Confirmed payments will appear here with their receipts."} action={!search ? add : undefined} />}
        />
      )}
      <Pager page={page} total={total} loading={q.isFetching} onPage={setPage} />
      <p className="sq-v2-muted" style={{ marginTop: 12 }}>Payment search matches the receipt number.</p>
    </>
  );
}

