"use client";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowUpRight, Bell, BookOpen, CalendarClock, CheckCircle2, ClipboardCheck, HelpCircle, LifeBuoy, LogIn, MapPin, Receipt, ShieldCheck, Users, Wrench } from "lucide-react";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import { navBlocked } from "@/components/access";
import { getJson, inr, type Json } from "@/components/prep-api";
import { isRunning, owed, type Figures } from "@/lib/fees";
import { clockLabel } from "@/lib/library-hours";
import { Field, TextInput } from "./form";
import { daysUntil, dur, shortDate } from "./format";
import { Badge, Btn, EmptyState, ErrorState, HeroCard, PageHead, Skeleton, StatCard } from "./primitives";

type Row = Json;
const F = (m: Row) => m as Figures;
const byId = (rows: Row[], id: unknown) => rows.find((r) => String(r._id) === String(id));
const shiftText = (a?: Row) => (a && a.shiftStart !== undefined && a.shiftEnd !== undefined ? `${clockLabel(Number(a.shiftStart))} – ${clockLabel(Number(a.shiftEnd))}` : null);

/** Everything a student can see about their own library membership, from the workspace payload (already scoped to them). */
function useMine(d: Json) {
  const memberships: Row[] = d.memberships ?? [];
  const assignments: Row[] = d.assignments ?? [];
  const seats: Row[] = d.seats ?? [];
  const plans: Row[] = d.plans ?? [];
  const payments: Row[] = d.payments ?? [];
  const running = memberships.filter((m) => isRunning(F(m))).sort((a, b) => +new Date(b.end) - +new Date(a.end));
  const current = running[0];
  const assignmentOf = (m?: Row) => (m ? assignments.find((a) => String(a.membershipId) === String(m._id) && +new Date(a.end) > Date.now()) : undefined);
  const seatOf = (m?: Row) => {
    const a = assignmentOf(m);
    return a ? ((byId(seats, a.seatId)?.label as string) ?? null) : null;
  };
  const planOf = (m: Row) => (byId(plans, m.planId)?.name as string) ?? "Membership";
  const dues = running.reduce((s, m) => s + owed(F(m)), 0);
  const lastPayment = payments.filter((p) => !p.reversedAt).sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt))[0];
  return { memberships, running, current, assignmentOf, seatOf, planOf, dues, lastPayment, payments };
}

const lifeBadge = (m: Row) => {
  if (m.status === "cancelled") return <Badge tone="bad">Cancelled</Badge>;
  if (m.status === "paused" && isRunning(F(m))) return <Badge tone="warn">Paused</Badge>;
  if (!isRunning(F(m))) return <Badge>Ended</Badge>;
  const left = daysUntil(m.end);
  return left <= 7 ? <Badge tone="warn">{left <= 1 ? "Ends today" : `Ends in ${left} days`}</Badge> : <Badge tone="ok">Active</Badge>;
};

// ───────────────────────── Dashboard ─────────────────────────
export function StudentDashboard({ d, access, study }: { d: Json; access: Json | undefined; study?: ReactNode }) {
  const mine = useMine(d);
  const linked = !!d.user?.libraryId;
  const punchOpen = linked && !navBlocked("/app/punch", access, "student");
  const punchQ = useQuery<Json>({ queryKey: ["punch", "me"], queryFn: () => getJson("/api/punch"), enabled: punchOpen, refetchInterval: 60000 });
  const p = punchQ.data && punchQ.data.linked ? punchQ.data : undefined;
  const first = String(d.user?.name ?? "").split(" ")[0] || "there";
  const m = mine.current;
  const seat = mine.seatOf(m);
  const shift = shiftText(mine.assignmentOf(m));
  const left = m ? daysUntil(m.end) : null;
  const notices: Row[] = (d.notifications ?? []).slice(0, 3);

  const next: { text: string; href: string; icon: typeof LogIn }[] = [];
  if (!linked) next.push({ text: "Join your library with its Library ID", href: "/app/join", icon: Users });
  else {
    if (!m) next.push({ text: "No running membership yet. Ask your library to start one.", href: "/app/membership", icon: BookOpen });
    if (mine.dues > 0) next.push({ text: `${inr(mine.dues)} is due. Pay your library by cash or UPI and it will show here.`, href: "/app/membership", icon: Receipt });
    if (m && left !== null && left <= 7) next.push({ text: `Your membership ends in ${Math.max(0, left)} day${left === 1 ? "" : "s"}. Ask your library to renew it.`, href: "/app/membership", icon: CalendarClock });
    if (punchOpen && p && !p.inside && p.membershipActive) next.push({ text: "Check in when you arrive.", href: "/app/punch", icon: LogIn });
  }
  if (!navBlocked("/app/focus", access, "student")) next.push({ text: "Start a focus session", href: "/app/focus", icon: ClipboardCheck });

  return (
    <>
      <PageHead eyebrow={d.library?.name ?? "Your study space"} title={`Hello, ${first}`} sub={linked ? "Your library at a glance." : "Connect to a library to see your membership, seat and attendance here."} />

      {punchOpen && (
        punchQ.isLoading ? <Skeleton lines={3} style={{ marginBottom: 16 }} /> : punchQ.isError ? (
          <div style={{ marginBottom: 16 }}><ErrorState title="Attendance unavailable" text="Your check-in status could not be loaded." onRetry={() => void punchQ.refetch()} /></div>
        ) : p ? (
          <div style={{ marginBottom: 16 }}>
            <HeroCard
              title={p.inside ? "You are checked in" : p.membershipActive ? "Ready to study?" : "Check-in is not available yet"}
              text={p.inside ? "Remember to check out when you leave." : p.membershipActive ? "Check in when you arrive at the library." : "Your library needs to start your membership and allot a seat first."}
              metrics={[{ label: "Studied today", value: dur(p.today.minutes) }, { label: "Last 7 days", value: dur(p.weekMinutes) }]}
              actions={p.membershipActive || p.inside ? <Btn kind="onhero" href="/app/punch">{p.inside ? "Check out" : "Check in"}</Btn> : <Btn kind="onhero" href="/app/membership">View membership</Btn>}
            />
          </div>
        ) : null
      )}

      {linked && (
        <div className="sq-v2-statgrid" aria-label="Your membership">
          <StatCard label="Membership" value={m ? <span style={{ fontSize: 20 }}>{mine.planOf(m)}</span> : "None"} sub={m ? `Valid until ${shortDate(m.end)}` : "No running membership"} href="/app/membership" />
          <StatCard label="Seat and shift" value={seat ? `Seat ${seat}` : "Not assigned"} sub={shift ?? "No shift yet"} href="/app/membership" />
          <StatCard label="Fees due" value={inr(mine.dues)} tone={mine.dues > 0 ? "down" : undefined} sub={mine.dues > 0 ? "Pay your library to clear it" : "You are paid up"} href="/app/membership" />
          <StatCard label="Last payment" value={mine.lastPayment ? inr(mine.lastPayment.amount) : "—"} sub={mine.lastPayment ? shortDate(mine.lastPayment.createdAt) : "No payments yet"} href="/app/membership" />
        </div>
      )}
      {!linked && (
        <div style={{ marginBottom: 16 }}>
          <EmptyState icon={Users} title="You are not connected to a library" text="Ask your library for its ID (like LIB-AB12CD) and enter it. Your study tools still work without one." action={<Btn href="/app/join">Join a library</Btn>} />
        </div>
      )}

      <div className="sq-v2-grid2">
        <section className="sq-v2-panel" aria-label="Next steps">
          <h2 className="sq-v2-h2">What to do next</h2>
          {next.length ? (
            <ul className="sq-v2-feed">
              {next.map((n) => {
                const Icon = n.icon;
                return (
                  <li key={n.text}><i><Icon size={16} /></i><Link href={n.href} className="sq-v2-rowlink"><span>{n.text}</span><ArrowUpRight size={15} /></Link></li>
                );
              })}
            </ul>
          ) : <p className="sq-v2-muted">You are all caught up.</p>}
        </section>
        <section className="sq-v2-panel" aria-label="Announcements">
          <div className="sq-v2-panelhead"><h2 className="sq-v2-h2">Announcements</h2><Link href="/app/notifications" className="sq-v2-more">All</Link></div>
          {notices.length ? (
            <ul className="sq-v2-feed">
              {notices.map((n) => <li key={String(n._id)}><i><Bell size={16} /></i><span><strong>{n.title}</strong><br /><small>{n.message}</small></span></li>)}
            </ul>
          ) : <p className="sq-v2-muted">Library announcements and updates will appear here.</p>}
        </section>
      </div>
      {study && <section className="sq-v2-study" aria-label="Your study">{study}</section>}
    </>
  );
}

// ───────────────────────── My library: membership, fees, seat and shift ─────────────────────────
export function StudentMembership({ d, preview, onConcern, slots }: { d: Json; preview: boolean; onConcern: () => void; slots?: { timings?: ReactNode; seatChange?: ReactNode } }) {
  const mine = useMine(d);
  const linked = !!d.user?.libraryId;
  const ended = mine.memberships.filter((m) => !isRunning(F(m))).sort((a, b) => +new Date(b.end) - +new Date(a.end));
  return (
    <>
      <PageHead title="My library" sub="Your membership, seat, fees and receipts in one place." actions={linked ? <Btn kind="outline" onClick={onConcern}><LifeBuoy size={16} /> Raise a concern</Btn> : undefined} />
      {!mine.memberships.length ? (
        <EmptyState icon={BookOpen} title={linked ? "No membership yet" : "Your next favourite study spot"} text={linked ? "Your library will start your membership and allot a seat. You will see it here." : "Already a library member? Ask the owner to connect your registered email, or join with a Library ID."} action={!linked && !preview ? <Btn href="/app/join">Join a library</Btn> : undefined} />
      ) : (
        <>
          {mine.running.length === 0 && <div style={{ marginBottom: 14 }}><EmptyState icon={BookOpen} title="No running membership" text="Your earlier memberships are listed below. Ask your library to renew." /></div>}
          <div className="sq-v2-plangrid" style={{ marginBottom: 16 }}>
            {mine.running.map((m) => {
              const total = m.amount - (m.discount ?? 0), paid = m.paid ?? 0, due = owed(F(m));
              const a = mine.assignmentOf(m), seat = mine.seatOf(m), shift = shiftText(a);
              return (
                <article className="sq-v2-panel" key={String(m._id)}>
                  <div className="sq-v2-modtitle"><h2 className="sq-v2-cardtitle" style={{ fontSize: 18 }}>{mine.planOf(m)}</h2>{lifeBadge(m)}</div>
                  <p className="sq-v2-muted">{shortDate(m.start)} – {shortDate(m.end)}</p>
                  <ul className="sq-v2-feed">
                    <li><span>Seat</span><strong>{seat ? `Seat ${seat}` : "Not assigned yet"}</strong></li>
                    <li><span>Shift</span><strong>{shift ?? "Not set"}</strong></li>
                    <li><span>Plan fee</span><strong className="sq-v2-num">{inr(total)}{m.discount ? ` (discount ${inr(m.discount)})` : ""}</strong></li>
                    <li><span>Paid</span><strong className="sq-v2-num">{inr(paid)}</strong></li>
                    <li><span>Balance due</span><strong className="sq-v2-num" style={due > 0 ? { color: "var(--sq-danger)" } : undefined}>{inr(due)}</strong></li>
                  </ul>
                  <i className="sq-v2-meter" role="img" aria-label={`${total ? Math.round((paid / total) * 100) : 0} percent paid`}><b style={{ width: `${total ? Math.min(100, (paid / total) * 100) : 0}%` }} /></i>
                  {due > 0 && <p className="sq-v2-modnote">To pay, give cash or UPI to your library. They record it and it appears here with a receipt.</p>}
                  <p className="sq-v2-modnote">To renew or change this membership, ask your library.</p>
                </article>
              );
            })}
          </div>
        </>
      )}

      {mine.payments.length > 0 && (
        <section className="sq-v2-panel" style={{ marginBottom: 16 }} aria-label="Payment history">
          <h2 className="sq-v2-h2">Payments and receipts</h2>
          <ul className="sq-v2-feed">
            {mine.payments.map((p) => (
              <li key={String(p._id)}>
                <i><Receipt size={16} /></i>
                <span><strong>{inr(p.amount)}</strong> · {String(p.method).toUpperCase()}<br /><small>{shortDate(p.createdAt)}</small></span>
                {p.reversedAt ? <Badge tone="bad">Reversed</Badge> : <Badge tone="ok">Received</Badge>}
                <a className="sq-v2-more" href={`/api/receipts/${p._id}`} target="_blank" rel="noreferrer">{p.receipt} <ArrowUpRight size={13} /></a>
              </li>
            ))}
          </ul>
        </section>
      )}
      {ended.length > 0 && (
        <section className="sq-v2-panel" style={{ marginBottom: 16 }} aria-label="Membership history">
          <h2 className="sq-v2-h2">Membership history</h2>
          <ul className="sq-v2-feed">
            {ended.map((m) => <li key={String(m._id)}><span><strong>{mine.planOf(m)}</strong><br /><small>{shortDate(m.start)} – {shortDate(m.end)}</small></span>{lifeBadge(m)}</li>)}
          </ul>
        </section>
      )}
      {slots?.timings}
      {slots?.seatChange}
    </>
  );
}

// ───────────────────────── Notifications ─────────────────────────
export function StudentNotifications({ d }: { d: Json }) {
  const items: Row[] = d.notifications ?? [];
  return (
    <>
      <PageHead title="Notifications" sub="Library announcements and updates about you." />
      {items.length ? (
        <ul className="sq-v2-panel sq-v2-feed" style={{ listStyle: "none" }}>
          {items.map((n) => (
            <li key={String(n._id)}>
              <i><Bell size={16} /></i>
              <span><strong>{n.title}</strong>{n.read === false && <> <Badge tone="ok">New</Badge></>}<br /><small>{n.message}</small></span>
              {n.createdAt && <time dateTime={new Date(n.createdAt).toISOString()}>{shortDate(n.createdAt)}</time>}
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState icon={Bell} title="A quiet moment" text="Library announcements and personal updates will appear here." />
      )}
    </>
  );
}

// ───────────────────────── Profile and support ─────────────────────────
export type ProfileForm = { exam: string; setExam: (v: string) => void; goal: number; setGoal: (v: number) => void; anonymous: boolean; setAnonymous: (v: boolean) => void; onSave: () => void; onRest: () => void };
export function StudentProfile({ d, form, push, onConcern, access }: { d: Json; form: ProfileForm; push?: ReactNode; onConcern: () => void; access: Json | undefined }) {
  const linked = !!d.user?.libraryId;
  return (
    <>
      <PageHead title="Profile" sub="Your details, study preferences and where to get help." />
      <div className="sq-v2-grid2">
        <section className="sq-v2-panel" aria-label="Account">
          <h2 className="sq-v2-h2">Account</h2>
          <ul className="sq-v2-feed">
            <li><span>Name</span><strong>{String(d.user?.name ?? "—")}</strong></li>
            <li><span>Email</span><strong>{String(d.user?.email ?? "—")}</strong></li>
            <li><span>Library</span><strong>{d.library?.name ?? "Not connected"}</strong></li>
          </ul>
          <div className="sq-v2-btnrow" style={{ marginTop: 10 }}>
            <Btn kind="outline" href="/app/security"><ShieldCheck size={16} /> Account & privacy</Btn>
            {!linked && <Btn kind="outline" href="/app/join"><Users size={16} /> Join a library</Btn>}
          </div>
        </section>
        <section className="sq-v2-panel" aria-label="Study preferences">
          <h2 className="sq-v2-h2">Study preferences</h2>
          <Field label="Exam or preparation category"><TextInput value={form.exam} onChange={(e) => form.setExam(e.target.value)} /></Field>
          <Field label="Daily focus goal (minutes)"><TextInput type="number" min={25} max={480} value={form.goal} onChange={(e) => form.setGoal(+e.target.value)} /></Field>
          <label className="sq-v2-check"><input type="checkbox" checked={form.anonymous} onChange={(e) => form.setAnonymous(e.target.checked)} /><span>Keep my profile private on leaderboards</span></label>
          <div className="sq-v2-btnrow" style={{ marginTop: 12 }}>
            <Btn onClick={form.onSave}>Save preferences</Btn>
            <Btn kind="outline" onClick={form.onRest}>Take a rest day</Btn>
          </div>
        </section>
        <section className="sq-v2-panel" aria-label="Help and support">
          <h2 className="sq-v2-h2">Help and support</h2>
          <ul className="sq-v2-feed">
            {linked && <li><i><LifeBuoy size={16} /></i><button type="button" className="sq-v2-rowlink sq-v2-plainbtn" onClick={onConcern}><span>Raise a concern with your library</span><ArrowUpRight size={15} /></button></li>}
            {!navBlocked("/app/maintenance", access, "student") && <li><i><Wrench size={16} /></i><Link href="/app/maintenance" className="sq-v2-rowlink"><span>Report a problem with the library</span><ArrowUpRight size={15} /></Link></li>}
            <li><i><HelpCircle size={16} /></i><Link href="/guide?for=student" className="sq-v2-rowlink"><span>Help and video guide</span><ArrowUpRight size={15} /></Link></li>
          </ul>
        </section>
        {push}
      </div>
    </>
  );
}

// ───────────────────────── QR check-in confirmation ─────────────────────────
export function StudentCheckIn({ onConfirm }: { onConfirm: () => Promise<void> }) {
  const [state, setState] = useState<{ kind: "idle" | "busy" | "done" | "error"; message?: string }>({ kind: "idle" });
  async function go() {
    setState({ kind: "busy" });
    try { await onConfirm(); setState({ kind: "done" }); } catch (e) { setState({ kind: "error", message: e instanceof Error ? e.message : "Check-in failed" }); }
  }
  return (
    <>
      <PageHead title="Check in" sub="Confirm that you are at the library. The desk code is time-limited and works once." />
      <section className="sq-v2-panel" style={{ maxWidth: 560 }} aria-live="polite">
        {state.kind === "done" ? (
          <>
            <h2 className="sq-v2-h2"><CheckCircle2 size={20} aria-hidden="true" /> You are checked in</h2>
            <p className="sq-v2-muted">Have a good study session. Check out from the Check in page when you leave.</p>
            <div className="sq-v2-btnrow" style={{ marginTop: 12 }}><Btn href="/app/punch">See my attendance</Btn><Btn kind="outline" href="/app">Back to home</Btn></div>
          </>
        ) : (
          <>
            <h2 className="sq-v2-h2"><MapPin size={20} aria-hidden="true" /> Confirm my check-in</h2>
            <p className="sq-v2-muted">If your library uses a location limit, your phone will ask to share your location once. It is checked and never saved.</p>
            {state.kind === "error" && <p className="sq-v2-modnote" role="alert" style={{ color: "var(--sq-danger)", fontWeight: 600 }}><AlertTriangle size={14} aria-hidden="true" /> {state.message}</p>}
            <div className="sq-v2-btnrow" style={{ marginTop: 12 }}><Btn disabled={state.kind === "busy"} onClick={() => void go()}>{state.kind === "busy" ? "Checking in…" : state.kind === "error" ? "Try again" : "Confirm my check-in"}</Btn></div>
          </>
        )}
      </section>
    </>
  );
}
