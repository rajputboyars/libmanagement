"use client";

import { AttendanceBoard } from "./v2/owner-ops";
import { BrandLoader } from "@/components/brand-loader";
import { useEffect, useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, Clock3, LogIn, LogOut, MapPin, Users } from "lucide-react";
import { getJson, post, type Json } from "./prep-api";
import Link from "next/link";
import { Field, TextInput } from "./v2/form";
import { Badge, Btn, Chips, EmptyState, ErrorState, PageHead, Skeleton as V2Skeleton, StatCard } from "./v2/primitives";

const Skeleton = () => <BrandLoader compact text="Loading…" />;
const Empty = ({ title, text }: { title: string; text?: string }) => <div className="mt-empty"><h2>{title}</h2>{text && <p>{text}</p>}</div>;
const time = (v: string | Date) => new Date(v).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
const dateText = (v: string) => new Date(`${v}T00:00:00`).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
const dur = (minutes: number) => (minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${minutes}m`);
const since = (from: string | Date, now: number) => dur(Math.max(0, Math.floor((now - new Date(from).getTime()) / 60000)));

function useTicker() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(t); }, []);
  return now;
}

/** Current phone location. Rejects with a plain-language message the user can act on. */
export function getPosition(): Promise<{ lat: number; lng: number; accuracy: number }> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) return reject(new Error("This device cannot share its location. Use a phone or browser with location support."));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }),
      (e) => reject(new Error(e.code === 1 ? "Location is blocked. Allow location for this site in your browser settings, then try again." : e.code === 3 ? "Could not get your location in time. Check GPS and try again." : "Could not read your location. Check GPS and try again.")),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
  });
}

// ───────────────────────── Student: join a library with its Library ID ─────────────────────────
export function StudentJoin({ notify }: { notify: (m: string) => void }) {
  const qc = useQueryClient();
  const [code, setCode] = useState("");
  const [preview, setPreview] = useState<Json | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const q = useQuery<Json>({ queryKey: ["join", "me"], queryFn: () => getJson("/api/join") });
  if (q.isLoading) return <Skeleton />;
  if (q.isError || !q.data) return <Empty title="Could not load" text={q.error instanceof Error ? q.error.message : "Try again."} />;
  const d = q.data, pending = (d.requests as Json[]).find((r) => r.status === "pending");
  async function answer(action: "invite-accept" | "invite-decline") {
    try { await post("/api/join", action, { id: pending!._id }); notify(action === "invite-accept" ? "You joined the library." : "Invite declined."); await qc.invalidateQueries({ queryKey: ["join"] }); await qc.invalidateQueries({ queryKey: ["workspace"] }); }
    catch (e) { notify(e instanceof Error ? e.message : "Unable to update"); }
  }
  async function lookup(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setError(""); setPreview(null); setBusy(true);
    try { const r = await getJson(`/api/join?code=${encodeURIComponent(code)}`); setPreview(r); } catch (err) { setError(err instanceof Error ? err.message : "Lookup failed"); } finally { setBusy(false); }
  }
  async function send(message: string) {
    setBusy(true);
    try { await post("/api/join", "request", { code: preview!.code, message }); notify("Request sent. The library will verify you."); setPreview(null); setCode(""); await qc.invalidateQueries({ queryKey: ["join"] }); }
    catch (err) { notify(err instanceof Error ? err.message : "Unable to send"); } finally { setBusy(false); }
  }
  return (
    <>
      <PageHead eyebrow="My library" title="Join your library" sub="Ask your library for its ID (like LIB-AB12CD) and type it below. That's it." />
      {d.linked ? (
        <section className="sq-v2-panel">
          <h2 className="sq-v2-h2">{d.linked.name} <Badge tone="ok">Verified</Badge></h2>
          <p className="sq-v2-muted">{d.linked.city}{d.linked.code ? ` · ${d.linked.code}` : ""}</p>
          <p className="sq-v2-muted">Once your library allots a seat and activates your membership, you can check in from the <Link href="/app/punch" className="sq-v2-more">Check in</Link> page.</p>
        </section>
      ) : pending?.invitedBy ? (
        <section className="sq-v2-panel" role="status">
          <h2 className="sq-v2-h2">{pending.library?.name ?? "A library"} invited you <Badge tone="warn">New</Badge></h2>
          <p className="sq-v2-muted">Accepting connects you to this library. The owner will then manage your seat, attendance and fees.</p>
          <div className="sq-v2-btnrow" style={{ marginTop: 12 }}><Btn onClick={() => void answer("invite-accept")}>Accept</Btn><Btn kind="outline" onClick={() => void answer("invite-decline")}>Decline</Btn></div>
        </section>
      ) : pending ? (
        <section className="sq-v2-panel" role="status">
          <h2 className="sq-v2-h2">{pending.library?.name ?? "Your library"} <Badge tone="warn">Waiting for verification</Badge></h2>
          <p className="sq-v2-muted">Sent {new Date(pending.createdAt).toLocaleString("en-IN")}. You will get a notification when the owner decides.</p>
          <Btn kind="outline" onClick={async () => { try { await post("/api/join", "cancel", { id: pending._id }); notify("Request cancelled."); await qc.invalidateQueries({ queryKey: ["join"] }); } catch (e) { notify(e instanceof Error ? e.message : "Unable to cancel"); } }}>Cancel request</Btn>
        </section>
      ) : (
        <>
          <form className="sq-v2-panel" onSubmit={lookup} style={{ marginBottom: 14, maxWidth: 560 }}>
            <Field label="Library ID" error={error || undefined}><TextInput value={code} onChange={(e) => { setCode(e.target.value.toUpperCase()); setPreview(null); }} placeholder="LIB-AB12CD" required maxLength={20} autoCapitalize="characters" autoComplete="off" spellCheck={false} /></Field>
            <Btn type="submit" disabled={busy || code.length < 4}>Find library</Btn>
          </form>
          {preview && (
            <form className="sq-v2-panel" style={{ maxWidth: 560 }} onSubmit={(e) => { e.preventDefault(); void send(String(new FormData(e.currentTarget).get("message") || "")); }}>
              <h2 className="sq-v2-h2"><Building2 size={18} aria-hidden="true" /> {preview.library.name}{preview.library.city ? ` · ${preview.library.city}` : ""}</h2>
              <Field label="Message for the owner (optional)" hint="Only the library owner sees your request. Your study data stays private."><TextInput name="message" maxLength={300} placeholder="Name, batch or exam you are preparing for" /></Field>
              <p className="pr-hint">If the library accepts you, it records your membership, seat, fees and attendance for its own accounts, and its team can see them. Your private study data is not shared. See the <a href="/privacy" target="_blank" rel="noopener">Privacy Notice</a> and <a href="/terms#students" target="_blank" rel="noopener">Terms</a>.</p>
              <Btn type="submit" disabled={busy}>Send request to this library</Btn>
            </form>
          )}
        </>
      )}
      {(d.requests as Json[]).filter((r) => r.status === "rejected").slice(0, 1).map((r) => <p key={r._id} className="sq-v2-modnote" role="status" style={{ color: "var(--sq-danger)", fontWeight: 600 }}>Your last request to {r.library?.name ?? "the library"} was not approved{r.note ? `: ${r.note}` : "."}</p>)}
    </>
  );
}

// ───────────────────────── Student: punch in / out ─────────────────────────
export function StudentPunch({ notify }: { notify: (m: string) => void }) {
  const qc = useQueryClient();
  const now = useTicker();
  const [busy, setBusy] = useState(false);
  const [range, setRange] = useState("7");
  const q = useQuery<Json>({ queryKey: ["punch", "me"], queryFn: () => getJson("/api/punch"), refetchInterval: 60000 });
  if (q.isLoading) return <><PageHead title="Check in" /><V2Skeleton lines={4} /></>;
  if (q.isError || !q.data) return <><PageHead title="Check in" /><ErrorState text={q.error instanceof Error ? q.error.message : "Please try again."} onRetry={() => void q.refetch()} /></>;
  const d = q.data;
  if (!d.linked) return <><PageHead title="Check in" /><EmptyState icon={Users} title="Join a library first" text="Enter your Library ID on the Join a library page. Check-in opens after the owner verifies you and allots a seat." action={<Btn href="/app/join">Join a library</Btn>} /></>;
  const act = async (action: "in" | "out") => {
    setBusy(true);
    try { const r = await post("/api/punch", action, d.geo ? await getPosition() : {}); notify(action === "in" ? `Checked in at ${time(r.at)}. Happy studying!` : `Checked out. You studied ${dur(r.minutes ?? 0)} this visit.`); await qc.invalidateQueries({ queryKey: ["punch"] }); }
    catch (e) { notify(e instanceof Error ? e.message : "Unable to record"); } finally { setBusy(false); }
  };
  const history = (d.history as Json[]).filter((day) => range === "14" || +new Date(`${day.day}T00:00:00`) >= now - 7 * 86400000);
  return (
    <>
      <PageHead eyebrow={d.library} title="Check in" sub="Check in when you arrive and out when you leave. Your visits are saved to your history and to the library record." />
      <section className="sq-v2-panel" aria-live="polite" style={{ marginBottom: 14 }}>
        <div className="sq-v2-panelhead"><h2 className="sq-v2-h2"><Clock3 size={18} aria-hidden="true" /> {d.inside ? "You are inside" : "You are outside"}</h2><Badge tone={d.inside ? "ok" : "neutral"}>{d.inside ? "Checked in" : "Not checked in"}</Badge></div>
        {d.inside && <p className="sq-v2-bigprice">{since(d.since, now)}<small style={{ fontSize: 14, fontFamily: "var(--sq-font-ui)" }}> since {time(d.since)}</small></p>}
        {!d.membershipActive && <p className="sq-v2-modnote" role="alert" style={{ color: "var(--sq-danger)", fontWeight: 600 }}>Your membership is not active yet. Your library verifies your registration and allots a seat before you can check in.</p>}
        {d.geo && <p className="sq-v2-modnote"><MapPin size={13} aria-hidden="true" /> You can check in and out only within {d.geo.radiusM} m of the library. Your phone will ask for your location when you tap. It is checked once and never saved.</p>}
        {d.policy === "qr" && !d.inside && <p className="sq-v2-modnote">This library verifies presence: scan the QR code at the desk to check in. You can check out here.</p>}
        <div className="sq-v2-btnrow" style={{ marginTop: 12 }}>
          {!d.inside && d.policy !== "qr" && <Btn className="sq-v2-bigbtn" disabled={busy || !d.membershipActive} onClick={() => void act("in")}><LogIn size={18} /> {busy ? "Checking in…" : "Check in"}</Btn>}
          {d.inside && <Btn className="sq-v2-bigbtn" disabled={busy} onClick={() => void act("out")}><LogOut size={18} /> {busy ? "Checking out…" : "Check out"}</Btn>}
        </div>
      </section>
      <div className="sq-v2-statgrid">
        <StatCard label="Today" value={dur(d.today.minutes)} sub={`${d.today.sessions.length} visit${d.today.sessions.length === 1 ? "" : "s"}`} />
        <StatCard label="Last 7 days" value={dur(d.weekMinutes)} sub="Total time studied" />
      </div>
      <div className="sq-v2-toolbar"><h2 className="sq-v2-h2" style={{ margin: 0 }}>Recent visits</h2><Chips label="Date range" value={range} onChange={setRange} items={[{ id: "7", label: "Last 7 days" }, { id: "14", label: "Last 14 days" }]} /></div>
      {history.length ? (
        <ul className="sq-v2-panel sq-v2-feed" style={{ listStyle: "none" }}>
          {history.map((day) => (
            <li key={day.day}>
              <span><strong>{dateText(day.day)}</strong><br /><small>{(day.sessions as Json[]).map((s) => `${time(s.inAt)}–${s.outAt ? time(s.outAt) : "now"}${s.auto ? " (no check-out)" : ""}`).join(", ")}</small></span>
              <Badge>{dur(day.minutes)}</Badge>
            </li>
          ))}
        </ul>
      ) : <EmptyState icon={Clock3} title="No visits yet" text={range === "7" && (d.history as Json[]).length ? "No visits in the last 7 days. Try the last 14 days." : "Your first check-in will appear here."} />}
    </>
  );
}

// ───────────────────────── Owner: Library ID, join requests, seat allotment ─────────────────────────
export function OwnerJoinRequests({ notify }: { notify: (m: string) => void }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState("");
  const [showAll, setShowAll] = useState(false);
  const q = useQuery<Json>({ queryKey: ["join", "owner", showAll], queryFn: () => getJson(`/api/join?view=requests${showAll ? "&status=all" : ""}`) });
  const ws = useQuery<Json>({ queryKey: ["workspace"], queryFn: () => getJson("/api/workspace") });
  if (q.isLoading) return <Skeleton />;
  if (q.isError || !q.data) return <Empty title="Could not load" text={q.error instanceof Error ? q.error.message : "Try again."} />;
  const d = q.data, w = ws.data ?? {};
  const refresh = async () => { await qc.invalidateQueries({ queryKey: ["join"] }); await qc.invalidateQueries({ queryKey: ["workspace"] }); await qc.invalidateQueries({ queryKey: ["punch"] }); };
  async function approve(r: Json, allot?: { planId: string; seatId: string; shiftId: string; start: string }) {
    try { await post("/api/join", "approve", { id: r._id }); }
    catch (e) { return notify(e instanceof Error ? e.message : "Unable to approve"); }
    if (!allot) { notify(`${r.student?.name} verified. Allot a seat from Memberships when ready.`); return refresh(); }
    const shift = (w.shifts as Json[] | undefined)?.find((s) => s._id === allot.shiftId);
    try {
      await post("/api/workspace", "memberships", { userId: r.userId, planId: allot.planId, seatId: allot.seatId, start: new Date(`${allot.start}T00:00:00`).toISOString(), shiftStart: shift?.start, shiftEnd: shift?.end, discount: 0 });
      notify(`${r.student?.name} verified and seat allotted.`);
    } catch (e) { notify(`${r.student?.name} was verified, but the seat could not be allotted: ${e instanceof Error ? e.message : "error"}. Allot it from Memberships.`); }
    setOpen(""); await refresh();
  }
  async function reject(r: Json) { const note = prompt("Reason (shown to the student, optional)") ?? ""; try { await post("/api/join", "reject", { id: r._id, note }); notify("Request rejected."); await refresh(); } catch (e) { notify(e instanceof Error ? e.message : "Unable to reject"); } }
  return (
    <>
      <header className="p2-heading"><div><span className="eyebrow">Admissions</span><h1>Verify students who join with your Library ID.</h1><p>Share the ID with your students. They register, enter it, and appear here for you to verify. Approve, allot a seat, and they can start punching in.</p></div></header>
      <section className="weekly-card">
        <div className="section-label"><span>Your Library ID</span><button className="button secondary" onClick={() => { navigator.clipboard?.writeText(d.code); notify("Library ID copied."); }}>Copy</button></div>
        <p className="sq-price" aria-label={`Library ID ${d.code}`}>{d.code}</p>
        <p className="pr-hint">Students enter this in the app under <em>Join a library</em>, or while registering.</p>
        <label className="mt-check"><input type="checkbox" checked={d.library.punchPolicy === "qr"} onChange={async (e) => { try { await post("/api/join", "set-policy", { punchPolicy: e.target.checked ? "qr" : "app" }); notify(e.target.checked ? "Students must now scan the desk QR to punch in." : "Students can punch in from the app."); await refresh(); } catch (err) { notify(err instanceof Error ? err.message : "Unable to change"); } }} />Require scanning the desk QR to punch in (proof of presence; Pro plan)</label>
      </section>
      <section className="weekly-card">
        <div className="section-label"><span><MapPin size={14} /> Library location</span><span className={`mt-pill ${d.library.location ? "" : "p-high"}`}>{d.library.location ? `${d.library.radiusM} m limit on` : "not set"}</span></div>
        <p>{d.library.location ? `Students can punch in and out only within ${d.library.radiusM} m of this point (${d.library.location.lat.toFixed(5)}, ${d.library.location.lng.toFixed(5)}). Outside it they see "out of geolocation".` : `Set your location so students can only punch in and out within ${d.library.radiusM} m of the library. Until you set it, anyone with an active membership can punch from anywhere.`}</p>
        <p className="pr-hint">Stand inside your library, with GPS on, and tap the button. Do this on a phone for the best accuracy.</p>
        <button className="button secondary" onClick={async () => { try { const p = await getPosition(); if (p.accuracy > 100) throw new Error("Your location is not accurate enough yet. Turn on GPS or move near a window, then try again."); await post("/api/join", "set-location", { lat: p.lat, lng: p.lng }); notify("Library location saved."); await refresh(); } catch (err) { notify(err instanceof Error ? err.message : "Unable to save location"); } }}><MapPin size={16} /> {d.library.location ? "Update to my current location" : "Use my current location"}</button>
      </section>
      <div className="mt-filter"><button className={!showAll ? "active" : ""} onClick={() => setShowAll(false)}>Waiting ({!showAll ? d.requests.length : "…"})</button><button className={showAll ? "active" : ""} onClick={() => setShowAll(true)}>All requests</button></div>
      <div className="mt-list">{(d.requests as Json[]).map((r) => (
        <article className="queue-card" key={r._id}>
          <div><Users /><span><strong>{r.student?.name ?? "Student"}</strong><small>{r.student?.email} · {new Date(r.createdAt).toLocaleString("en-IN")}</small>{r.message && <small>“{r.message}”</small>}{r.note && <small>Note: {r.note}</small>}</span></div>
          {r.status === "pending" && r.invitedBy ? (
            <div className="queue-actions"><span className="mt-pill">Invite sent · waiting for student</span><button className="button secondary" onClick={async () => { try { await post("/api/join", "reject", { id: r._id }); notify("Invite withdrawn."); await refresh(); } catch (e) { notify(e instanceof Error ? e.message : "Unable to withdraw"); } }}>Withdraw invite</button></div>
          ) : r.status === "pending" ? (
            <>
              <div className="queue-actions"><button className="button" onClick={() => setOpen(open === r._id ? "" : r._id)}>Approve &amp; allot seat</button><button className="button secondary" onClick={() => approve(r)}>Approve only</button><button className="button secondary" onClick={() => reject(r)}>Reject</button></div>
              {open === r._id && (
                <form className="mt-form" onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); void approve(r, { planId: String(f.get("plan")), seatId: String(f.get("seat")), shiftId: String(f.get("shift")), start: String(f.get("start")) }); }}>
                  <label>Fee plan<select name="plan" required>{(w.plans as Json[] | undefined ?? []).map((p) => <option key={p._id} value={p._id}>{p.name} · ₹{(p.amount / 100).toLocaleString("en-IN")} / {p.days}d</option>)}</select></label>
                  <label>Shift<select name="shift" required>{(w.shifts as Json[] | undefined ?? []).map((s) => <option key={s._id} value={s._id}>{s.name}</option>)}</select></label>
                  <label>Seat<select name="seat" required>{(w.seats as Json[] | undefined ?? []).map((s) => <option key={s._id} value={s._id}>{s.label}{s.operationalStatus === "maintenance" ? " (out of service)" : ""}</option>)}</select></label>
                  <label>Start date<input name="start" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} /></label>
                  <p className="wide pr-hint">Seat conflicts and out-of-service seats are checked by the server. Record the first payment from Payments.</p>
                  <button className="button">Verify and allot</button>
                </form>)}
            </>
          ) : <span className={`mt-pill ${r.status === "approved" ? "" : "p-high"}`}>{r.status}</span>}
        </article>))}
        {!d.requests.length && <Empty title="No requests waiting" text="When a student enters your Library ID, they appear here." />}</div>
    </>
  );
}

// ───────────────────────── Owner: live presence ─────────────────────────
export function OwnerPresence({ notify }: { notify: (m: string) => void }) {
  // Same /api/punch view as before, presented by the shared attendance board. Punch-out stays a staff action the server checks.
  const access = useQuery<Json>({ queryKey: ["workspace", "access"], queryFn: () => getJson("/api/access"), staleTime: 20000 });
  const canDo = (p: string) => !access.data || access.data.kind === "owner" || ((access.data.permissions as string[]) ?? []).includes(p);
  return <AttendanceBoard mode="presence" canDo={canDo} notify={notify} />;
}
