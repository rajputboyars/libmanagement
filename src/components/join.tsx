"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, Clock3, LogIn, LogOut, MapPin, ShieldCheck, Users } from "lucide-react";
import { getJson, post, type Json } from "./prep-api";

const Skeleton = () => <div className="mt-skeleton" aria-busy="true" />;
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
function getPosition(): Promise<{ lat: number; lng: number; accuracy: number }> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) return reject(new Error("This device cannot share its location. Use a phone or browser with location support."));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }),
      (e) => reject(new Error(e.code === 1 ? "Location is blocked. Allow location for this site in your browser settings, then try again." : e.code === 3 ? "Could not get your location in time. Check GPS and try again." : "Could not read your location. Check GPS and try again.")),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
  });
}

// ───────────────────────── Student: 4-step "Get started" quest (shown on Join and Punch pages) ─────────────────────────
function JoinQuest({ requested, linked }: { requested: boolean; linked: boolean }) {
  const p = useQuery<Json>({ queryKey: ["punch", "me"], queryFn: () => getJson("/api/punch"), enabled: linked });
  const seat = !!p.data?.membershipActive, visited = !!p.data?.history?.length;
  const steps = [
    { label: "Enter your Library ID", done: requested || linked },
    { label: "Get verified", done: linked },
    { label: "Get your seat", done: seat },
    { label: "Punch in for the first time", done: visited },
  ];
  const doneCount = steps.filter((s) => s.done).length, next = steps.findIndex((s) => !s.done);
  return (
    <section className="weekly-card" aria-label="Getting started">
      <div className="section-label"><span>{doneCount === 4 ? "Quest complete" : "Getting started"}</span><span className="mt-pill">{doneCount * 25} XP</span></div>
      <div role="progressbar" aria-valuemin={0} aria-valuemax={4} aria-valuenow={doneCount} aria-label="Getting started progress" style={{ height: 8, borderRadius: 99, background: "var(--line, #e5e7eb)", overflow: "hidden" }}>
        <div style={{ width: `${doneCount * 25}%`, height: "100%", background: "var(--accent, #1f6f5c)", transition: "width .4s" }} />
      </div>
      <ol className="mt-list" style={{ listStyle: "none", padding: 0, margin: "12px 0 0" }}>
        {steps.map((s, i) => <li key={s.label} aria-current={i === next ? "step" : undefined} style={{ display: "flex", gap: 10, padding: "6px 0", opacity: s.done || i === next ? 1 : 0.55, fontWeight: i === next ? 600 : 400 }}>
          <span aria-hidden>{s.done ? "✅" : i === next ? "👉" : "⬜"}</span><span>{s.label}{s.done && <span className="sr-only"> (done)</span>}</span></li>)}
      </ol>
      {doneCount === 4 && <p className="pr-hint">🎉 You are all set. Keep your streak going: punch in each day you study.</p>}
    </section>
  );
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
      <header className="p2-heading"><div><span className="eyebrow">My library</span><h1>Join your library.</h1><p>Ask your library for its ID (like LIB-AB12CD) and type it below. That&apos;s it.</p></div></header>
      <JoinQuest requested={!!pending} linked={!!d.linked} />
      {d.linked ? (
        <section className="weekly-card"><div className="section-label"><span><ShieldCheck size={14} /> Verified</span></div><h2>{d.linked.name}</h2><p>{d.linked.city}{d.linked.code ? ` · ${d.linked.code}` : ""}</p><p className="pr-hint">Once your library allots a seat and activates your membership you can punch in and out from <strong>Punch in / out</strong>.</p></section>
      ) : pending ? (
        <section className="weekly-card" role="status"><div className="section-label"><span>Waiting for verification</span><span className="mt-pill">pending</span></div><h2>{pending.library?.name ?? "Your library"}</h2><p>Sent {new Date(pending.createdAt).toLocaleString("en-IN")}. You will get a notification when the owner decides.</p>
          <button className="button secondary" onClick={async () => { try { await post("/api/join", "cancel", { id: pending._id }); notify("Request cancelled."); await qc.invalidateQueries({ queryKey: ["join"] }); } catch (e) { notify(e instanceof Error ? e.message : "Unable to cancel"); } }}>Cancel request</button></section>
      ) : (
        <>
          <form className="mt-form" onSubmit={lookup}>
            <label className="wide">Library ID<input value={code} onChange={(e) => { setCode(e.target.value.toUpperCase()); setPreview(null); }} placeholder="LIB-AB12CD" required maxLength={20} autoCapitalize="characters" autoComplete="off" spellCheck={false} /></label>
            <button className="button" disabled={busy || code.length < 4}>Find library</button>
            {error && <p className="wide cm-note danger" role="alert">{error}</p>}
          </form>
          {preview && (
            <form className="mt-form" onSubmit={(e) => { e.preventDefault(); void send(String(new FormData(e.currentTarget).get("message") || "")); }}>
              <p className="wide"><Building2 size={16} /> <strong>{preview.library.name}</strong>{preview.library.city ? ` · ${preview.library.city}` : ""}</p>
              <label className="wide">Message for the owner (optional)<input name="message" maxLength={300} placeholder="Name, batch or exam you are preparing for" /></label>
              <button className="button" disabled={busy}>Send request to this library</button>
              <p className="wide pr-hint">Only the library owner sees your request. Your study data stays private.</p>
            </form>)}
        </>)}
      {(d.requests as Json[]).filter((r) => r.status === "rejected").slice(0, 1).map((r) => <p key={r._id} className="cm-note danger" role="status">Your last request to {r.library?.name ?? "the library"} was not approved{r.note ? `: ${r.note}` : "."}</p>)}
    </>
  );
}

// ───────────────────────── Student: punch in / out ─────────────────────────
export function StudentPunch({ notify }: { notify: (m: string) => void }) {
  const qc = useQueryClient();
  const now = useTicker();
  const [busy, setBusy] = useState(false);
  const q = useQuery<Json>({ queryKey: ["punch", "me"], queryFn: () => getJson("/api/punch"), refetchInterval: 60000 });
  if (q.isLoading) return <Skeleton />;
  if (q.isError || !q.data) return <Empty title="Could not load" text={q.error instanceof Error ? q.error.message : "Try again."} />;
  const d = q.data;
  if (!d.linked) return <Empty title="Join a library first" text="Enter your Library ID on the Join a library page. Punching in unlocks after the owner verifies you and allots a seat." />;
  const act = async (action: "in" | "out") => {
    setBusy(true);
    try { const r = await post("/api/punch", action, d.geo ? await getPosition() : {}); notify(action === "in" ? `Punched in at ${time(r.at)}. Happy studying!` : `Punched out. You studied ${dur(r.minutes ?? 0)} this visit.`); await qc.invalidateQueries({ queryKey: ["punch"] }); }
    catch (e) { notify(e instanceof Error ? e.message : "Unable to record"); } finally { setBusy(false); }
  };
  return (
    <>
      <header className="p2-heading"><div><span className="eyebrow">{d.library}</span><h1>Punch in when you arrive. Punch out when you leave.</h1><p>Your visits are saved to your history and to the library&apos;s attendance record at the same time.</p></div></header>
      <JoinQuest requested linked />
      <section className="weekly-card" aria-live="polite">
        <div className="section-label"><span><Clock3 size={14} /> {d.inside ? "You are inside" : "You are outside"}</span><span className={`mt-pill ${d.inside ? "" : "p-high"}`}>{d.inside ? "punched in" : "not punched in"}</span></div>
        {d.inside && <p className="sq-price">{since(d.since, now)}<small> since {time(d.since)}</small></p>}
        {!d.membershipActive && <p className="cm-note danger" role="alert">Your membership is not active yet. The library verifies your registration and allots your seat before you can punch in.</p>}
        {d.geo && <p className="cm-note"><MapPin size={14} /> You can punch in and out only within {d.geo.radiusM} m of the library. Your phone will ask for location when you tap. It is checked once and never saved.</p>}
        {d.policy === "qr" && !d.inside &&<p className="cm-note">This library verifies presence: scan the QR code at the desk to punch in. You can punch out here.</p>}
        <div className="queue-actions">
          {!d.inside && d.policy !== "qr" && <button className="button" style={{ minHeight: 56, fontSize: "1.1rem" }} disabled={busy || !d.membershipActive} onClick={() => act("in")}><LogIn size={18} /> Punch in</button>}
          {d.inside && <button className="button" style={{ minHeight: 56, fontSize: "1.1rem" }} disabled={busy} onClick={() => act("out")}><LogOut size={18} /> Punch out</button>}
        </div>
      </section>
      <div className="mt-stats"><div><small>Today</small><strong>{dur(d.today.minutes)}</strong></div><div><small>Last 7 days</small><strong>{dur(d.weekMinutes)}</strong></div><div><small>Visits today</small><strong>{d.today.sessions.length}</strong></div></div>
      <div className="section-label"><span>Recent visits</span></div>
      <div className="mt-list">{(d.history as Json[]).map((day) => (
        <article className="queue-card" key={day.day}><div><span><strong>{dateText(day.day)}</strong><small>{(day.sessions as Json[]).map((s) => `${time(s.inAt)}–${s.outAt ? time(s.outAt) : "now"}${s.auto ? " (no punch-out)" : ""}`).join(", ")}</small></span></div><span className="mt-pill">{dur(day.minutes)}</span></article>))}
        {!d.history.length && <Empty title="No visits yet" text="Your first punch-in will appear here." />}</div>
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
          {r.status === "pending" ? (
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
  const qc = useQueryClient();
  const now = useTicker();
  const [day, setDay] = useState(new Date().toISOString().slice(0, 10));
  const q = useQuery<Json>({ queryKey: ["punch", "live", day], queryFn: () => getJson(`/api/punch?day=${day}`), refetchInterval: 30000 });
  if (q.isLoading) return <Skeleton />;
  if (q.isError || !q.data) return <Empty title="Could not load" text={q.error instanceof Error ? q.error.message : "Try again."} />;
  const d = q.data;
  return (
    <>
      <header className="p2-heading"><div><span className="eyebrow">Attendance</span><h1>Who is in the library right now.</h1><p>Students punch in and out from their app. Every visit is recorded here and in the student&apos;s own history.</p></div></header>
      <div className="mt-stats"><div><small>Inside now</small><strong>{d.inside.length}</strong></div><div><small>Students on {dateText(d.day)}</small><strong>{d.totals.students}</strong></div><div><small>Total time</small><strong>{dur(d.totals.minutes)}</strong></div><div><small>Missed punch-outs</small><strong>{d.totals.autoClosed}</strong></div></div>
      <div className="section-label"><span>Inside now</span></div>
      <div className="mt-list">{(d.inside as Json[]).map((s) => (
        <article className="queue-card" key={s.userId}><div><Users /><span><strong>{s.name}{s.seat ? ` · Seat ${s.seat}` : ""}</strong><small>In since {time(s.since)} ({since(s.since, now)})</small></span></div>
          <button className="button secondary" onClick={async () => { if (!confirm(`Punch ${s.name} out now?`)) return; try { await post("/api/punch", "manual-out", { userId: s.userId }); notify(`${s.name} punched out.`); await qc.invalidateQueries({ queryKey: ["punch"] }); } catch (e) { notify(e instanceof Error ? e.message : "Unable to punch out"); } }}>Punch out</button></article>))}
        {!d.inside.length && <Empty title="Nobody is inside" text="Students appear here as soon as they punch in." />}</div>
      <div className="section-label"><span>Visit log</span><input className="pr-select" type="date" value={day} max={new Date().toISOString().slice(0, 10)} onChange={(e) => e.target.value && setDay(e.target.value)} aria-label="Day" /></div>
      <div className="sq-table" role="region" aria-label="Visit log" tabIndex={0}><table><thead><tr><th>Student</th><th>Seat</th><th>Visits</th><th>Total</th></tr></thead>
        <tbody>{(d.log as Json[]).map((r) => <tr key={r.userId}><td>{r.name}</td><td>{r.seat ?? "—"}</td><td>{(r.sessions as Json[]).map((s) => `${time(s.inAt)}–${s.outAt ? time(s.outAt) : "now"}${s.auto ? " ⚠ no punch-out" : ""}`).join(", ")}</td><td>{dur(r.minutes)}</td></tr>)}</tbody></table></div>
      {!d.log.length && <Empty title="No visits recorded" text="Nothing was recorded for this day." />}
      <p className="pr-hint"><ShieldCheck size={12} /> Visits left open for 16 hours are closed automatically and counted as zero time so they are never guessed.</p>
    </>
  );
}
