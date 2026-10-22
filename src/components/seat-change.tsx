"use client";

import { useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Armchair } from "lucide-react";
import { getJson, post, type Json } from "./prep-api";
import { clockLabel } from "@/lib/library-hours";

type Row = Record<string, string | number | boolean>;
const shiftText = (s?: { name?: string; start?: number; end?: number } | null) =>
  !s || s.start === undefined || s.end === undefined
    ? "—"
    : `${s.name ? `${s.name} · ` : ""}${clockLabel(Number(s.start))}–${clockLabel(Number(s.end))}`;

/** Student: ask for another seat and/or shift, see the latest request and cancel it. */
export function StudentSeatChange({ seats, shifts, notify }: { seats: Row[]; shifts: Row[]; notify: (m: string) => void }) {
  const qc = useQueryClient();
  const q = useQuery<Json>({ queryKey: ["seat-change"], queryFn: () => getJson("/api/seat-change") });
  const [busy, setBusy] = useState(false);
  const latest = (q.data?.requests as Json[] | undefined)?.[0];
  const pending = latest?.status === "pending";
  const run = async (action: string, data: unknown, done: string) => {
    setBusy(true);
    try {
      await post("/api/seat-change", action, data);
      await qc.invalidateQueries({ queryKey: ["seat-change"] });
      notify(done);
    } catch (e) {
      notify(e instanceof Error ? e.message : "Could not send");
    } finally {
      setBusy(false);
    }
  };
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const seatId = String(f.get("seatId") || "") || undefined;
    const shiftId = String(f.get("shiftId") || "") || undefined;
    void run("request", { seatId, shiftId, note: f.get("note") || "" }, "Request sent to your library.");
  };
  return (
    <section className="card" style={{ marginTop: 20 }}>
      <div className="section-heading">
        <h2>Change seat or shift</h2>
        <Armchair size={20} />
      </div>
      {latest && (
        <div className={`seat-change-status ${String(latest.status)}`} role="status">
          <strong>
            {latest.status === "pending"
              ? "Waiting for your library"
              : latest.status === "approved"
                ? "Approved"
                : latest.status === "rejected"
                  ? "Not approved"
                  : "Cancelled"}
          </strong>
          <span>
            {latest.fromSeat ?? "—"} <ArrowRight size={13} /> {latest.toSeat ?? latest.fromSeat ?? "—"}
            {latest.toShift ? ` · ${shiftText(latest.toShift)}` : ""}
          </span>
          {latest.decisionNote && <small>{String(latest.decisionNote)}</small>}
          {pending && (
            <button className="text-link" disabled={busy} onClick={() => run("cancel", {}, "Request cancelled.")}>
              Cancel request
            </button>
          )}
        </div>
      )}
      {!pending && (
        <form className="seat-change-form" onSubmit={submit}>
          <label>
            New seat
            <select name="seatId" defaultValue="">
              <option value="">Keep my seat</option>
              {seats
                .filter((s) => s.operationalStatus !== "maintenance")
                .map((s) => (
                  <option key={String(s._id)} value={String(s._id)}>
                    {String(s.label)}
                    {s.floor ? ` · ${String(s.floor)}` : ""}
                  </option>
                ))}
            </select>
          </label>
          <label>
            New shift
            <select name="shiftId" defaultValue="">
              <option value="">Keep my shift</option>
              {shifts.map((s) => (
                <option key={String(s._id)} value={String(s._id)}>
                  {shiftText({ name: String(s.name), start: Number(s.start), end: Number(s.end) })}
                </option>
              ))}
            </select>
          </label>
          <label className="wide">
            Reason (optional)
            <input name="note" maxLength={300} placeholder="e.g. My college timing changed" />
          </label>
          <button className="button" disabled={busy}>
            Send request
          </button>
          <p className="muted wide">Your library checks that the seat is free in that shift, then approves it. Your plan and fees stay the same.</p>
        </form>
      )}
    </section>
  );
}

/** Owner/staff: pending seat and shift change requests with approve and reject. */
export function OwnerSeatChanges({ notify }: { notify: (m: string) => void }) {
  const qc = useQueryClient();
  const q = useQuery<Json>({ queryKey: ["seat-change"], queryFn: () => getJson("/api/seat-change") });
  const [busy, setBusy] = useState("");
  const rows = (q.data?.requests as Json[] | undefined) ?? [];
  if (!q.data?.team) return null;
  const act = async (action: "approve" | "reject", id: string) => {
    setBusy(id);
    try {
      await post("/api/seat-change", action, { id });
      await qc.invalidateQueries({ queryKey: ["seat-change"] });
      await qc.invalidateQueries({ queryKey: ["workspace"] });
      notify(action === "approve" ? "Seat change approved. The student has been told." : "Request rejected.");
    } catch (e) {
      notify(e instanceof Error ? e.message : "Could not save");
    } finally {
      setBusy("");
    }
  };
  return (
    <section className="card seat-change-owner">
      <div className="section-heading">
        <div>
          <h2>Seat & shift change requests</h2>
          <p className="muted">Approving moves the student from today; seat clashes are checked first.</p>
        </div>
        <strong className="pill">{rows.length} pending</strong>
      </div>
      {rows.length ? (
        rows.map((r) => (
          <div key={String(r._id)} className="seat-change-row">
            <div>
              <strong>{r.student?.name ?? "Student"}</strong>
              <small>{r.student?.email}</small>
            </div>
            <div className="seat-change-move">
              <span>
                {r.fromSeat ?? "—"} · {shiftText(r.fromShift)}
              </span>
              <ArrowRight size={14} />
              <span>
                {r.toSeat ?? r.fromSeat ?? "—"} · {r.toShift ? shiftText(r.toShift) : shiftText(r.fromShift)}
              </span>
            </div>
            {r.note && <p className="muted">“{String(r.note)}”</p>}
            <div className="queue-actions">
              <button className="button" disabled={!!busy} onClick={() => act("approve", String(r._id))}>
                Approve
              </button>
              <button className="button secondary" disabled={!!busy} onClick={() => act("reject", String(r._id))}>
                Reject
              </button>
            </div>
          </div>
        ))
      ) : (
        <p className="muted">No seat or shift change requests right now.</p>
      )}
    </section>
  );
}
