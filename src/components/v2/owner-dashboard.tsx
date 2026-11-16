"use client";
import { useQuery } from "@tanstack/react-query";
import { Armchair, Bell, ChevronRight, ClipboardCheck, IndianRupee, Plus, Receipt, UserPlus, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { navBlocked } from "@/components/access";
import { getJson, inr, type Json } from "@/components/prep-api";
import { isRunning, owed, type Figures } from "@/lib/fees";
import { clock, greeting, istDay } from "./format";
import { Btn, EmptyState, ErrorState, PageHead, QuickAction, Skeleton, StatCard } from "./primitives";

type Row = Json;
const F = (m: Row) => m as Figures;
const SEAT_STATES: [string, string][] = [
  ["occupied", "Inside now"],
  ["assigned", "Assigned"],
  ["booked", "Booked later"],
  ["available", "Free"],
  ["maintenance", "Under repair"],
];
// The workspace payload carries only the latest 100 payments / attendance rows.
const WORKSPACE_CAP = 100;

export type DashboardProps = {
  d: Json;
  preview: boolean;
  role: string | undefined;
  access: Json | undefined;
  canDo: (permission: string) => boolean;
  onAdd: (action: string) => void;
};

/** Owner/staff home. Every figure comes from the workspace payload or /api/seat-map; nothing is estimated. */
export function OwnerDashboard({ d, preview, role, access, canDo, onAdd }: DashboardProps) {
  const open = (href: string) => !navBlocked(href, access, role);
  const seatsOpen = open("/owner/seats") && canDo("seats.view");
  const feesOpen = open("/owner/payments") && canDo("fees.view");
  const studentsOpen = canDo("students.view");
  // Dues and membership counts come from memberships: only trust them when this person may read them.
  const membershipsOpen = open("/owner/memberships") && canDo("memberships.view");
  const attendanceOpen = open("/owner/attendance") && canDo("attendance.view");
  const seatsQ = useQuery<Json>({ queryKey: ["workspace", "seat-map"], queryFn: () => getJson("/api/seat-map"), enabled: !preview && seatsOpen, refetchInterval: 30000 });

  const today = istDay();
  const payments: Row[] = d.payments ?? [];
  const attendance: Row[] = d.attendance ?? [];
  const memberships: Row[] = d.memberships ?? [];
  const students: Row[] = d.students ?? [];
  const summary: Record<string, number> = d.summary ?? {};
  const paidToday = payments.filter((p) => !p.reversedAt && istDay(p.createdAt) === today);
  const collected = paidToday.reduce((a, p) => a + Number(p.amount || 0), 0);
  const paymentsCapped = payments.length >= WORKSPACE_CAP && istDay(payments[payments.length - 1]?.createdAt) === today;
  const checkinsToday = attendance.filter((a) => a.day === today).length;
  const membershipsComplete = membershipsOpen && memberships.length < WORKSPACE_CAP;
  const running = memberships.filter((m) => isRunning(F(m)));
  const owing = new Set(running.filter((m) => owed(F(m)) > 0).map((m) => String(m.userId))).size;
  const withPlan = new Set(running.map((m) => String(m.userId))).size;

  const seat = seatsQ.data?.summary as Json | undefined;
  const occupiedPct = seat && seat.total ? (seat.occupied / seat.total) * 100 : 0;

  const quick: { label: string; icon: LucideIcon; run: () => void }[] = [
    canDo("students.create") && { label: "Add student", icon: UserPlus, run: () => onAdd("students") },
    canDo("fees.create") && open("/owner/payments") && { label: "Record payment", icon: IndianRupee, run: () => onAdd("payments") },
    canDo("attendance.mark") && open("/owner/attendance") && { label: "Check in student", icon: ClipboardCheck, run: () => onAdd("attendance") },
    canDo("memberships.create") && open("/owner/memberships") && { label: "Assign a seat", icon: Armchair, run: () => onAdd("memberships") },
    canDo("expenses.create") && open("/owner/expenses") && { label: "Add expense", icon: Receipt, run: () => onAdd("expenses") },
  ].filter(Boolean) as { label: string; icon: LucideIcon; run: () => void }[];

  // Latest real events: confirmed payments and check-ins, newest first.
  const nameOf = (id: unknown) => students.find((s) => String(s._id) === String(id))?.name as string | undefined;
  const activity = [
    ...(feesOpen ? payments.slice(0, 8).map((p) => ({ id: "p" + p._id, at: +new Date(p.createdAt), icon: IndianRupee, text: `${p.reversedAt ? "Reversed: " : ""}${inr(p.amount)} ${p.method} from ${nameOf(p.userId) ?? "a student"}` })) : []),
    ...(attendanceOpen && attendance.length ? attendance.slice(0, 8).map((a) => ({ id: "a" + a._id, at: +new Date(a.checkIn || a.createdAt), icon: ClipboardCheck, text: `${nameOf(a.userId) ?? "A student"} checked in` })) : []),
  ]
    .sort((x, y) => y.at - x.at)
    .slice(0, 6);

  const setup = [
    { text: "Set up your seat map", href: "/owner/seats", done: (summary.seats ?? 0) > 0 },
    { text: "Configure your shifts", href: "/owner/shifts", done: (d.shifts ?? []).length > 0 },
    { text: "Create a membership plan", href: "/owner/plans", done: (d.plans ?? []).length > 0 },
    { text: "Connect registered students", href: "/owner/students", done: (summary.students ?? 0) > 0 },
  ].filter((s) => !s.done && open(s.href));

  const libraryName = d.library?.name as string | undefined;
  const hasCards = feesOpen || studentsOpen || seatsOpen;

  return (
    <>
      <PageHead
        eyebrow={libraryName ?? "Your library"}
        title={greeting()}
        sub={libraryName ? `Here is how ${libraryName} is doing today.` : "Here is how your library is doing today."}
      />

      {hasCards && (
        <div className="sq-v2-statgrid" aria-label="Today's summary">
          {feesOpen && (
            <StatCard
              label="Today's collection"
              value={inr(collected)}
              sub={paymentsCapped ? "From the latest 100 payments" : `${paidToday.length} payment${paidToday.length === 1 ? "" : "s"} today`}
              href="/owner/payments"
            />
          )}
          {feesOpen && membershipsOpen && (
            <StatCard
              label="Pending dues"
              value={inr(summary.due ?? 0)}
              sub={membershipsComplete ? `${owing} student${owing === 1 ? " owes" : "s owe"} fees` : "Running memberships only"}
              tone={(summary.due ?? 0) > 0 ? "down" : undefined}
              href="/owner/fees"
            />
          )}
          {studentsOpen && (
            <StatCard
              label="Active students"
              value={summary.students ?? 0}
              sub={membershipsComplete ? `${withPlan} with a running membership` : "Registered with your library"}
              href="/owner/students"
            />
          )}
          {seatsOpen && !preview && (
            <>
              {seatsQ.isLoading && <div className="sq-v2-stat"><Skeleton lines={3} /></div>}
              {seatsQ.isError && <div className="sq-v2-stat"><span>Seat occupancy</span><small>Could not load seats.</small><Btn kind="outline" onClick={() => void seatsQ.refetch()}>Try again</Btn></div>}
              {seat && (
                <StatCard
                  label="Seat occupancy"
                  value={`${seat.occupied} / ${seat.total}`}
                  progress={occupiedPct}
                  sub={`${Math.round(occupiedPct)}% inside now · ${seat.available} free`}
                  href="/owner/seats"
                />
              )}
            </>
          )}
        </div>
      )}

      {quick.length > 0 && (
        <section aria-label="Quick actions" style={{ marginBottom: 20 }}>
          <h2 className="sq-v2-h2">Quick actions</h2>
          <div className="sq-v2-qa-grid">
            {quick.map((q, i) => (
              <QuickAction key={q.label} icon={q.icon} label={q.label} onClick={q.run} main={i === 0} />
            ))}
          </div>
        </section>
      )}

      <div className="sq-v2-grid2">
        {(seatsOpen || attendanceOpen) && (
          <section className="sq-v2-panel" aria-label="Today at the desk">
            <div className="sq-v2-panelhead">
              <h2 className="sq-v2-h2">Today at the desk</h2>
              {seatsOpen && <Link href="/owner/seats" className="sq-v2-more">Seat map <ChevronRight size={14} /></Link>}
            </div>
            {attendanceOpen && (
              <p className="sq-v2-big">
                <strong>{checkinsToday}</strong> check-in{checkinsToday === 1 ? "" : "s"} today
                {attendance.length >= WORKSPACE_CAP && istDay(attendance[attendance.length - 1]?.createdAt) === today ? " (latest 100 shown)" : ""}
              </p>
            )}
            {seatsOpen && !preview && seatsQ.isLoading && <Skeleton lines={2} />}
            {seatsOpen && !preview && seatsQ.isError && <ErrorState title="Seat map unavailable" text="Occupancy could not be loaded." onRetry={() => void seatsQ.refetch()} />}
            {seat && seat.total > 0 && (
              <>
                <div className="sq-v2-seatbar" role="img" aria-label={SEAT_STATES.map(([k, l]) => `${l} ${seat[k]}`).join(", ")}>
                  {SEAT_STATES.map(([k]) => (seat[k] ? <span key={k} data-s={k} style={{ flex: seat[k] }} /> : null))}
                </div>
                <ul className="sq-v2-legend">
                  {SEAT_STATES.map(([k, l]) => (
                    <li key={k}><i data-s={k} /> {l} <strong>{seat[k]}</strong></li>
                  ))}
                </ul>
              </>
            )}
            {seat && seat.total === 0 && <EmptyState icon={Armchair} title="No seats yet" text="Add your seats to see live occupancy here." action={canDo("seats.create") ? <Btn onClick={() => onAdd("seats")}>Add seat</Btn> : undefined} />}
          </section>
        )}

        {(feesOpen || attendanceOpen) && (
          <section className="sq-v2-panel" aria-label="Recent activity">
            <div className="sq-v2-panelhead">
              <h2 className="sq-v2-h2">Recent activity</h2>
              {feesOpen && <Link href="/owner/payments" className="sq-v2-more">All payments <ChevronRight size={14} /></Link>}
            </div>
            {activity.length ? (
              <ul className="sq-v2-feed">
                {activity.map((a) => {
                  const Icon = a.icon;
                  return (
                    <li key={a.id}>
                      <i><Icon size={16} /></i>
                      <span>{a.text}</span>
                      <time dateTime={new Date(a.at).toISOString()}>{istDay(a.at) === today ? clock(a.at) : istDay(a.at)}</time>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <EmptyState icon={Bell} title="Nothing yet" text="Payments and check-ins will show up here as they happen." />
            )}
          </section>
        )}

        {feesOpen && (
          <section className="sq-v2-panel" aria-label="Money so far">
            <div className="sq-v2-panelhead">
              <h2 className="sq-v2-h2">Money so far</h2>
              {open("/owner/reports") && <Link href="/owner/reports" className="sq-v2-more">Reports <ChevronRight size={14} /></Link>}
            </div>
            <ul className="sq-v2-feed">
              <li><span>Confirmed revenue</span><strong className="sq-v2-num">{inr(summary.revenue ?? 0)}</strong></li>
              {canDo("expenses.view") && open("/owner/expenses") && (
                <>
                  <li><span>Expenses</span><strong className="sq-v2-num">{inr(summary.expenses ?? 0)}</strong></li>
                  <li><span>Net profit</span><strong className="sq-v2-num">{inr((summary.revenue ?? 0) - (summary.expenses ?? 0))}</strong></li>
                </>
              )}
            </ul>
          </section>
        )}

        {setup.length > 0 && (
          <section className="sq-v2-panel" aria-label="Set up your library">
            <h2 className="sq-v2-h2">Set up your library</h2>
            <ul className="sq-v2-feed">
              {setup.map((s) => (
                <li key={s.href}><Link href={s.href} className="sq-v2-rowlink"><span>{s.text}</span><ChevronRight size={16} /></Link></li>
              ))}
            </ul>
          </section>
        )}

        <section className="sq-v2-panel" aria-label="Announcements">
          <div className="sq-v2-panelhead">
            <h2 className="sq-v2-h2">Announcements</h2>
            {canDo("notifications.create") && <Btn kind="outline" onClick={() => onAdd("notifications")}><Plus size={16} /> New</Btn>}
          </div>
          {(d.notifications ?? []).length ? (
            <ul className="sq-v2-feed">
              {(d.notifications as Row[]).slice(0, 4).map((n) => (
                <li key={String(n._id)}><i><Bell size={16} /></i><span><strong>{n.title}</strong><br /><small>{n.message}</small></span></li>
              ))}
            </ul>
          ) : (
            <p className="sq-v2-muted">No announcements yet. Create one to share an update in the app.</p>
          )}
        </section>
      </div>
    </>
  );
}
