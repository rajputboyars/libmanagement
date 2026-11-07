"use client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowUpRight, CalendarClock, ClipboardCheck, Plus, QrCode, Receipt, RefreshCw, Users } from "lucide-react";
import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import { getJson, inr, post, type Json } from "@/components/prep-api";
import { isRunning, owed, type Figures } from "@/lib/fees";
import { DataTable, type Column } from "./data-table";
import { ResponsiveDialog } from "./dialog";
import { clock, daysUntil, dur, initials, istDay, shortDate } from "./format";
import { Pager, SearchBox } from "./owner-lists";
import { Badge, Btn, Chips, EmptyState, ErrorState, PageHead, Skeleton, StatCard } from "./primitives";
import { PAGE_SIZE, useRecords } from "./use-records";

type Row = Json;
type Can = (permission: string) => boolean;
const F = (m: Row) => m as Figures;
const byId = (rows: Row[], id: unknown) => rows.find((r) => String(r._id) === String(id));

// ───────────────────────── Memberships ─────────────────────────
type Life = { key: string; label: string; tone: "ok" | "warn" | "bad" | "neutral" };
/** Display status only; the lifecycle rules stay on the server. */
export function lifeOf(m: Row): Life {
  if (m.status === "cancelled") return { key: "ended", label: "Cancelled", tone: "bad" };
  if (m.status === "paused" && isRunning(F(m))) return { key: "paused", label: "Paused", tone: "warn" };
  if (!isRunning(F(m))) return { key: "ended", label: "Ended", tone: "neutral" };
  const left = daysUntil(m.end);
  if (left <= 7) return { key: "soon", label: left <= 1 ? "Ends today" : `Ends in ${left} days`, tone: "warn" };
  return { key: "active", label: "Active", tone: "ok" };
}

export function OwnerMemberships({ d, preview, canDo, onAdd }: { d: Json; preview: boolean; canDo: Can; onAdd: (action: string, preset?: string) => void }) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [local, setLocal] = useState(1);
  const [selected, setSelected] = useState<string | null>(null);
  const memberships: Row[] = useMemo(() => d.memberships ?? [], [d.memberships]);
  const rec = useRecords("memberships", memberships, preview, "");
  const students: Row[] = d.students ?? [];
  const plans: Row[] = d.plans ?? [];
  const seats: Row[] = d.seats ?? [];
  const assignments: Row[] = d.assignments ?? [];
  const nameOf = (id: unknown) => (byId(students, id)?.name as string) ?? "Student";
  const planOf = (m: Row) => (byId(plans, m.planId)?.name as string) ?? "Plan";
  const seatOf = (m: Row) => {
    const a = assignments.find((x) => String(x.membershipId) === String(m._id) && +new Date(x.end) > Date.now());
    return a ? ((byId(seats, a.seatId)?.label as string) ?? null) : null;
  };
  const all: Row[] = rec.complete ? memberships : (rec.query.data?.records ?? []);
  const rows = rec.complete
    ? all
        .filter((m) => filter === "all" || (filter === "ended" ? lifeOf(m).key === "ended" : filter === "active" ? ["active", "soon"].includes(lifeOf(m).key) : lifeOf(m).key === filter))
        .filter((m) => !search || `${nameOf(m.userId)} ${planOf(m)}`.toLowerCase().includes(search.toLowerCase()))
    : all;
  const pageRows = rec.complete ? rows.slice((local - 1) * PAGE_SIZE, local * PAGE_SIZE) : rows;
  const total = rec.complete ? rows.length : (rec.query.data?.total ?? 0);
  const count = (k: string) => memberships.filter((m) => (k === "active" ? ["active", "soon"].includes(lifeOf(m).key) : lifeOf(m).key === k)).length;
  const sel = selected ? byId(memberships, selected) : undefined;
  const canManage = canDo("memberships.update");
  const columns: Column<Row>[] = [
    { key: "student", header: "Student", primary: true, render: (m) => <span className="sq-v2-who"><span className="sq-v2-avatar" aria-hidden="true">{initials(nameOf(m.userId))}</span><span><strong>{nameOf(m.userId)}</strong><small>{planOf(m)}</small></span></span> },
    { key: "period", header: "Period", render: (m) => `${shortDate(m.start)} – ${shortDate(m.end)}` },
    { key: "seat", header: "Seat", render: (m) => seatOf(m) ?? "—" },
    { key: "paid", header: "Paid / total", render: (m) => <span className="sq-v2-num">{inr(m.paid ?? 0)} / {inr(m.amount - (m.discount ?? 0))}</span> },
    { key: "status", header: "Status", render: (m) => <Badge tone={lifeOf(m).tone}>{lifeOf(m).label}</Badge> },
  ];
  const actions = (
    <>
      {canDo("memberships.create") && <Btn onClick={() => onAdd("memberships")}><Plus size={17} /> Assign membership</Btn>}
      {canManage && <Btn kind="outline" onClick={() => onAdd("renew")}><RefreshCw size={16} /> Renew</Btn>}
      {canManage && <Btn kind="outline" onClick={() => onAdd("membership-status")}>Pause / resume / cancel</Btn>}
    </>
  );
  return (
    <>
      <PageHead title="Memberships" sub="Who is enrolled, until when, and what they have paid." actions={actions} />
      {rec.complete ? (
        <div className="sq-v2-toolbar">
          <Chips label="Membership status" value={filter} onChange={(v) => { setFilter(v); setLocal(1); }} items={[
            { id: "all", label: `All ${memberships.length}` }, { id: "active", label: `Active ${count("active")}` }, { id: "soon", label: `Ending soon ${count("soon")}` }, { id: "paused", label: `Paused ${count("paused")}` }, { id: "ended", label: `Ended ${count("ended")}` },
          ]} />
          <SearchBox value={search} onChange={(v) => { setSearch(v); setLocal(1); }} label="Search memberships" placeholder="Search student or plan" />
        </div>
      ) : (
        <p className="sq-v2-muted" style={{ marginBottom: 12 }}>Your library has more than {memberships.length} memberships, so they are listed newest first.</p>
      )}
      {!rec.complete && rec.query.isError ? (
        <ErrorState title="Could not load memberships" onRetry={() => void rec.query.refetch()} />
      ) : (
        <DataTable
          caption="Memberships"
          columns={columns}
          rows={pageRows}
          rowKey={(m) => String(m._id)}
          loading={!rec.complete && rec.query.isLoading}
          onRowClick={(m) => setSelected(String(m._id))}
          empty={<EmptyState icon={CalendarClock} title={search || filter !== "all" ? "No matching memberships" : "No memberships yet"} text={search || filter !== "all" ? "Try another filter or search." : "Assign a plan and seat to a student to start their membership."} action={canDo("memberships.create") && !search && filter === "all" ? <Btn onClick={() => onAdd("memberships")}><Plus size={17} /> Assign membership</Btn> : undefined} />}
        />
      )}
      <Pager page={rec.complete ? local : rec.page} total={total} loading={!rec.complete && rec.query.isFetching} onPage={rec.complete ? setLocal : rec.setPage} />
      {sel && <MembershipDialog m={sel} memberships={memberships} d={d} nameOf={nameOf} planOf={planOf} seat={seatOf(sel)} canManage={canManage} onAdd={(a) => { setSelected(null); onAdd(a, String(sel._id)); }} onClose={() => setSelected(null)} />}
    </>
  );
}

function MembershipDialog({ m, memberships, d, nameOf, planOf, seat, canManage, onAdd, onClose }: { m: Row; memberships: Row[]; d: Json; nameOf: (id: unknown) => string; planOf: (m: Row) => string; seat: string | null; canManage: boolean; onAdd: (action: string) => void; onClose: () => void }) {
  const life = lifeOf(m);
  const history = memberships.filter((x) => String(x.userId) === String(m.userId)).sort((a, b) => +new Date(b.start) - +new Date(a.start));
  const payments: Row[] = (d.payments ?? []).filter((p: Row) => String(p.membershipId) === String(m._id)).slice(0, 5);
  const due = isRunning(F(m)) ? owed(F(m)) : 0;
  return (
    <ResponsiveDialog open onClose={onClose} title={nameOf(m.userId)} description={`${planOf(m)} · ${shortDate(m.start)} – ${shortDate(m.end)}`} size="lg"
      footer={canManage ? <>
        {["active", "expired"].includes(m.status) && <Btn kind="outline" onClick={() => onAdd("renew")}><RefreshCw size={16} /> Renew</Btn>}
        <Btn onClick={() => onAdd("membership-status")}>Pause / resume / cancel</Btn>
      </> : undefined}>
      <div className="sq-v2-statgrid" style={{ marginBottom: 14 }}>
        <StatCard label="Status" value={<Badge tone={life.tone}>{life.label}</Badge>} sub={seat ? `Seat ${seat}` : "No seat"} />
        <StatCard label="Paid" value={inr(m.paid ?? 0)} sub={`of ${inr(m.amount - (m.discount ?? 0))}${m.discount ? ` (discount ${inr(m.discount)})` : ""}`} />
        <StatCard label="Due" value={inr(due)} tone={due > 0 ? "down" : undefined} />
      </div>
      <h3 className="sq-v2-h3">Membership history</h3>
      <ul className="sq-v2-feed">
        {history.map((h) => (
          <li key={h._id}>
            <span><strong>{planOf(h)}</strong>{String(h._id) === String(m._id) ? " · this one" : ""}<br /><small>{shortDate(h.start)} – {shortDate(h.end)}</small></span>
            <Badge tone={lifeOf(h).tone}>{lifeOf(h).label}</Badge>
          </li>
        ))}
      </ul>
      {payments.length > 0 && (
        <>
          <h3 className="sq-v2-h3">Payments on this membership</h3>
          <ul className="sq-v2-feed">
            {payments.map((p) => (
              <li key={p._id}>
                <span><strong>{inr(p.amount)}</strong> · {String(p.method).toUpperCase()}<br /><small>{shortDate(p.createdAt)}{p.reversedAt ? " · reversed" : ""}</small></span>
                <a className="sq-v2-more" href={`/api/receipts/${p._id}`} target="_blank" rel="noreferrer">{p.receipt} <ArrowUpRight size={13} /></a>
              </li>
            ))}
          </ul>
        </>
      )}
    </ResponsiveDialog>
  );
}

// ───────────────────────── Plans ─────────────────────────
export function OwnerPlans({ d, preview, canDo, onAdd }: { d: Json; preview: boolean; canDo: Can; onAdd: (action: string) => void }) {
  const rec = useRecords("plans", d.plans ?? [], preview, "");
  const plans: Row[] = rec.complete ? (d.plans ?? []) : (rec.query.data?.records ?? []);
  const memberships: Row[] = d.memberships ?? [];
  const known = memberships.length < 100; // plan usage counts are exact only when every membership is loaded
  const add = canDo("memberships.create") ? <Btn onClick={() => onAdd("plans")}><Plus size={17} /> Add plan</Btn> : undefined;
  return (
    <>
      <PageHead title="Plans" sub="The memberships you sell. A plan sets the price and how long a membership lasts." actions={add} />
      {!rec.complete && rec.query.isError ? <ErrorState title="Could not load plans" onRetry={() => void rec.query.refetch()} /> : !rec.complete && rec.query.isLoading ? <Skeleton lines={4} /> : plans.length ? (
        <div className="sq-v2-plangrid">
          {plans.map((p) => {
            const using = memberships.filter((m) => String(m.planId) === String(p._id) && isRunning(F(m))).length;
            return (
              <article className="sq-v2-panel" key={String(p._id)}>
                <h2 className="sq-v2-h2">{p.name}</h2>
                <p className="sq-v2-bigprice">{inr(p.amount)}</p>
                <p className="sq-v2-muted">{p.days} day{p.days === 1 ? "" : "s"}{known ? ` · ${using} running now` : ""}</p>
              </article>
            );
          })}
        </div>
      ) : (
        <EmptyState icon={Receipt} title="No plans yet" text="Create a plan, for example Monthly for 30 days, before assigning memberships." action={add} />
      )}
    </>
  );
}

// ───────────────────────── Expenses ─────────────────────────
export function OwnerExpenses({ d, preview, canDo, onAdd }: { d: Json; preview: boolean; canDo: Can; onAdd: (action: string) => void }) {
  const [search, setSearch] = useState("");
  const [range, setRange] = useState("all");
  const [category, setCategory] = useState("all");
  const [local, setLocal] = useState(1);
  const expenses: Row[] = useMemo(() => d.expenses ?? [], [d.expenses]);
  const rec = useRecords("expenses", expenses, preview, search);
  const at = (e: Row) => +new Date(e.date || e.createdAt);
  const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
  const inRange = (e: Row) => range === "all" || (range === "month" ? at(e) >= +monthStart : at(e) >= +new Date() - 30 * 86400000);
  const categories = [...new Set(expenses.map((e) => String(e.category || "Other")))];
  const rows = rec.complete
    ? expenses.filter(inRange).filter((e) => category === "all" || String(e.category || "Other") === category).filter((e) => !search || `${e.title} ${e.category}`.toLowerCase().includes(search.toLowerCase()))
    : (rec.query.data?.records ?? []);
  const sum = (list: Row[]) => list.reduce((a, e) => a + Number(e.amount || 0), 0);
  const pageRows = rec.complete ? rows.slice((local - 1) * PAGE_SIZE, local * PAGE_SIZE) : rows;
  const total = rec.complete ? rows.length : (rec.query.data?.total ?? 0);
  const filtered = rec.complete && (range !== "all" || category !== "all" || !!search);
  const columns: Column<Row>[] = [
    { key: "title", header: "Description", primary: true, render: (e) => <strong>{e.title || "Expense"}</strong> },
    { key: "category", header: "Category", render: (e) => <Badge>{e.category || "Other"}</Badge> },
    { key: "date", header: "Date", render: (e) => shortDate(e.date || e.createdAt) },
    { key: "amount", header: "Amount", render: (e) => <strong className="sq-v2-num">{inr(e.amount)}</strong> },
  ];
  const add = canDo("expenses.create") ? <Btn onClick={() => onAdd("expenses")}><Plus size={17} /> Add expense</Btn> : undefined;
  return (
    <>
      <PageHead title="Expenses" sub="Everything the library spends, by category and date." actions={add} />
      <div className="sq-v2-statgrid">
        <StatCard label="All-time spend" value={inr(d.summary?.expenses ?? 0)} sub="Every recorded expense" />
        {rec.complete && <StatCard label="This month" value={inr(sum(expenses.filter((e) => at(e) >= +monthStart)))} sub={`${expenses.filter((e) => at(e) >= +monthStart).length === 1 ? "1 expense" : `${expenses.filter((e) => at(e) >= +monthStart).length} expenses`}`} />}
        {rec.complete && filtered && <StatCard label="Matching filters" value={inr(sum(rows))} sub={`${rows.length} expense${rows.length === 1 ? "" : "s"}`} />}
      </div>
      {rec.complete ? (
        <>
          <div className="sq-v2-toolbar">
            <Chips label="Date range" value={range} onChange={(v) => { setRange(v); setLocal(1); }} items={[{ id: "all", label: "All time" }, { id: "month", label: "This month" }, { id: "30", label: "Last 30 days" }]} />
            {categories.length > 1 && <Chips label="Category" value={category} onChange={(v) => { setCategory(v); setLocal(1); }} items={[{ id: "all", label: "All categories" }, ...categories.map((c) => ({ id: c, label: c }))]} />}
          </div>
          <div className="sq-v2-toolbar"><SearchBox value={search} onChange={(v) => { setSearch(v); setLocal(1); }} label="Search expenses" placeholder="Search description" /></div>
        </>
      ) : (
        <div className="sq-v2-toolbar"><SearchBox value={search} onChange={(v) => { setSearch(v); rec.setPage(1); }} label="Search expenses" placeholder="Search description" /><span className="sq-v2-count">Newest first. Date and category filters apply to libraries with fewer than {WORKSPACE_NOTE} expenses.</span></div>
      )}
      {!rec.complete && rec.query.isError ? (
        <ErrorState title="Could not load expenses" onRetry={() => void rec.query.refetch()} />
      ) : (
        <DataTable caption="Expenses" columns={columns} rows={pageRows} rowKey={(e) => String(e._id)} loading={!rec.complete && rec.query.isLoading}
          empty={<EmptyState icon={Receipt} title={filtered || search ? "No matching expenses" : "No expenses yet"} text={filtered || search ? "Try another range or category." : "Record rent, utilities and maintenance to see where the money goes."} action={!filtered && !search ? add : undefined} />} />
      )}
      <Pager page={rec.complete ? local : rec.page} total={total} loading={!rec.complete && rec.query.isFetching} onPage={rec.complete ? setLocal : rec.setPage} />
    </>
  );
}
const WORKSPACE_NOTE = 100;

// ───────────────────────── Attendance & presence ─────────────────────────
/** Day board: who is inside, the day's visit log, search and date choice. Uses the same /api/punch view as before. */
export function AttendanceBoard({ mode, canDo, notify, onCheckIn, qrRefreshMs }: { mode: "attendance" | "presence"; canDo: Can; notify: (m: string) => void; onCheckIn?: () => void; qrRefreshMs?: number }) {
  const qc = useQueryClient();
  const today = istDay();
  const [day, setDay] = useState(today);
  const [search, setSearch] = useState("");
  const [picked, setPicked] = useState<string | null>(null);
  const [qrTick, setQrTick] = useState(0);
  useEffect(() => {
    if (mode !== "attendance" || !qrRefreshMs) return;
    const t = setInterval(() => setQrTick((n) => n + 1), qrRefreshMs);
    return () => clearInterval(t);
  }, [mode, qrRefreshMs]);
  const q = useQuery<Json>({ queryKey: ["punch", "live", day], queryFn: () => getJson(`/api/punch?day=${day}`), refetchInterval: 30000 });
  const d = q.data;
  const yesterday = istDay(+new Date() - 86400000);
  const log: Row[] = (d?.log ?? []).filter((r: Row) => !search || String(r.name).toLowerCase().includes(search.toLowerCase()));
  const sel = picked ? (d?.log as Row[] | undefined)?.find((r) => String(r.userId) === picked) : undefined;
  const time = (v: string | Date) => clock(v);
  const sessionsText = (r: Row) => (r.sessions as Row[]).map((s) => `${time(s.inAt)}–${s.outAt ? time(s.outAt) : "now"}`).join(", ");
  const punchOut = async (s: Row) => {
    if (!confirm(`Punch ${s.name} out now?`)) return;
    try { await post("/api/punch", "manual-out", { userId: s.userId }); notify(`${s.name} punched out.`); await qc.invalidateQueries({ queryKey: ["punch"] }); } catch (e) { notify(e instanceof Error ? e.message : "Unable to punch out"); }
  };
  const columns: Column<Row>[] = [
    { key: "name", header: "Student", primary: true, render: (r) => <span className="sq-v2-who"><span className="sq-v2-avatar" aria-hidden="true">{initials(String(r.name))}</span><strong>{r.name}</strong></span> },
    { key: "seat", header: "Seat", render: (r) => r.seat ?? "—" },
    { key: "visits", header: "Visits", render: (r) => <>{sessionsText(r)}{(r.sessions as Row[]).some((s) => s.auto) && <> <Badge tone="warn">No punch-out</Badge></>}</> },
    { key: "total", header: "Time", render: (r) => <span className="sq-v2-num">{dur(r.minutes)}</span> },
  ];
  return (
    <>
      <PageHead
        eyebrow={mode === "presence" ? "Live presence" : "Attendance"}
        title={mode === "presence" ? "Who is inside right now" : "Attendance"}
        sub="Students punch in and out from their app or by scanning the desk code. Every visit is recorded here."
        actions={mode === "attendance" && onCheckIn && canDo("attendance.mark") ? <Btn onClick={onCheckIn}><ClipboardCheck size={17} /> Check in student</Btn> : undefined}
      />
      {mode === "attendance" && canDo("attendance.qr") && (
        <section className="sq-v2-panel sq-v2-qr" aria-label="Desk check-in code">
          <Image src={`/api/attendance-qr?t=${qrTick}`} width={140} height={140} alt="Scan to check in to this library" unoptimized />
          <div>
            <h2 className="sq-v2-h2"><QrCode size={18} aria-hidden="true" /> Desk check-in code</h2>
            <p className="sq-v2-muted">Students scan this code to confirm they are here. It changes every minute, so keep this screen open at the desk.</p>
          </div>
        </section>
      )}
      {q.isLoading ? <Skeleton lines={5} /> : q.isError || !d ? (
        <ErrorState title="Could not load attendance" text={q.error instanceof Error ? q.error.message : "Please try again."} onRetry={() => void q.refetch()} />
      ) : (
        <>
          <div className="sq-v2-statgrid">
            <StatCard label="Inside now" value={d.inside.length} sub="Right now" tone={d.inside.length ? "up" : undefined} />
            <StatCard label={day === today ? "Visited today" : "Visited that day"} value={d.totals.students} sub="Students with a visit" />
            <StatCard label="Total time" value={dur(d.totals.minutes)} sub="Across all visits" />
            <StatCard label="Missed punch-outs" value={d.totals.autoClosed} sub="Closed automatically, counted as zero" tone={d.totals.autoClosed ? "down" : undefined} />
          </div>
          <section className="sq-v2-panel" aria-label="Inside now" style={{ marginBottom: 16 }}>
            <h2 className="sq-v2-h2">Inside now <Badge tone={d.inside.length ? "ok" : "neutral"}>{d.inside.length}</Badge></h2>
            {d.inside.length ? (
              <ul className="sq-v2-feed">
                {(d.inside as Row[]).map((s) => (
                  <li key={s.userId}>
                    <span className="sq-v2-avatar" aria-hidden="true">{initials(String(s.name))}</span>
                    <span><strong>{s.name}</strong>{s.seat ? ` · Seat ${s.seat}` : ""}<br /><small>In since {time(s.since)}</small></span>
                    {canDo("attendance.mark") && <Btn kind="outline" onClick={() => void punchOut(s)}>Punch out</Btn>}
                  </li>
                ))}
              </ul>
            ) : <EmptyState icon={Users} title="Nobody is inside" text="Students appear here as soon as they punch in." />}
          </section>
          <h2 className="sq-v2-h2">Visit log</h2>
          <div className="sq-v2-toolbar">
            <Chips label="Day" value={day === today ? "today" : day === yesterday ? "yesterday" : "other"} onChange={(v) => v === "today" ? setDay(today) : v === "yesterday" ? setDay(yesterday) : undefined} items={[{ id: "today", label: "Today" }, { id: "yesterday", label: "Yesterday" }, ...(day !== today && day !== yesterday ? [{ id: "other", label: shortDate(`${day}T00:00:00+05:30`) }] : [])]} />
            <input className="sq-v2-input" style={{ width: "auto", minHeight: 40 }} type="date" value={day} max={today} aria-label="Pick a day" onChange={(e) => e.target.value && setDay(e.target.value)} />
            <SearchBox value={search} onChange={setSearch} label="Search the visit log" placeholder="Search student" />
          </div>
          <DataTable caption="Visit log" columns={columns} rows={log} rowKey={(r) => String(r.userId)} onRowClick={(r) => setPicked(String(r.userId))}
            empty={<EmptyState icon={CalendarClock} title={search ? "No matching students" : "No visits recorded"} text={search ? "Try another name." : "Nothing was recorded for this day."} />} />
          <p className="sq-v2-muted" style={{ marginTop: 12 }}><AlertTriangle size={13} aria-hidden="true" /> Visits left open for 16 hours are closed automatically and counted as zero time, so they are never guessed.</p>
        </>
      )}
      {sel && (
        <ResponsiveDialog open onClose={() => setPicked(null)} title={String(sel.name)} description={`${shortDate(`${day}T00:00:00+05:30`)}${sel.seat ? ` · Seat ${sel.seat}` : ""}`}>
          <div className="sq-v2-statgrid" style={{ marginBottom: 12 }}><StatCard label="Total time" value={dur(sel.minutes)} /><StatCard label="Visits" value={(sel.sessions as Row[]).length} /></div>
          <ul className="sq-v2-feed">
            {(sel.sessions as Row[]).map((s, i) => (
              <li key={i}><span><strong>{time(s.inAt)} – {s.outAt ? time(s.outAt) : "still inside"}</strong><br /><small>{s.method === "qr" ? "Desk QR" : s.method === "manual" ? "Marked by staff" : "App"}</small></span>{s.auto && <Badge tone="warn">No punch-out</Badge>}</li>
            ))}
          </ul>
        </ResponsiveDialog>
      )}
    </>
  );
}

