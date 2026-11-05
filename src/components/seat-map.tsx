"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Armchair, Wrench } from "lucide-react";
import { BrandLoader } from "@/components/brand-loader";
import { getJson, inr, type Json } from "./prep-api";

const STATES: [string, string][] = [
  ["available", "Available"],
  ["booked", "Booked for another shift"],
  ["assigned", "Assigned, not in yet"],
  ["occupied", "Student inside"],
  ["maintenance", "Under repair"],
];
const hhmm = (m?: number) => (m === undefined ? "" : `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`);
const day = (v: string | Date) => new Date(v).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

/** Live seat layout for the owner: which seats are free, held, or have a student inside right now. */
export function SeatMap({ onAllocate }: { onAllocate: (seatId: string) => void }) {
  const q = useQuery<Json>({ queryKey: ["workspace", "seat-map"], queryFn: () => getJson("/api/seat-map"), refetchInterval: 30000 });
  const [floor, setFloor] = useState("All floors");
  const [selected, setSelected] = useState("");
  const detail = useRef<HTMLDivElement>(null);
  useEffect(() => { if (selected) detail.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }); }, [selected]);
  if (q.isLoading) return <BrandLoader compact text="Loading seats…" />;
  if (q.isError || !q.data) return <section className="card"><h2>Could not load the seat map</h2><p>{q.error instanceof Error ? q.error.message : "Try again."}</p><button className="button secondary" onClick={() => q.refetch()}>Try again</button></section>;
  const seats = q.data.seats as Json[], s = q.data.summary as Json;
  const floors = [...new Set(seats.map((x) => String(x.floor)))];
  const visible = seats.filter((x) => floor === "All floors" || x.floor === floor);
  const seat = seats.find((x) => x._id === selected);
  return (
    <section className="card seat-panel">
      <div className="section-heading">
        <div><h2>Seat map</h2><p>{s.total} seats · updates every 30 seconds · select a seat for details.</p></div>
        <select aria-label="Floor" value={floor} onChange={(e) => setFloor(e.target.value)}>
          <option>All floors</option>
          {floors.map((f) => <option key={f}>{f}</option>)}
        </select>
      </div>
      <div className="sm-stats">
        {STATES.map(([k, label]) => <div key={k}><small><i className={`dot sm-${k}`} /> {label}</small><strong>{s[k]}</strong></div>)}
      </div>
      <div className="seat-grid sm-grid">
        {visible.map((x) => (
          <button key={x._id} className={`seat sm-${x.state}${selected === x._id ? " sm-selected" : ""}`} onClick={() => setSelected(x._id)} aria-pressed={selected === x._id}
            aria-label={`Seat ${x.label}: ${STATES.find(([k]) => k === x.state)?.[1]}${x.holders[0] ? `, ${x.holders.map((h: Json) => h.name).join(", ")}` : ""}`}>
            {x.state === "maintenance" ? <Wrench size={22} /> : <Armchair size={22} />}
            <span>{x.label}</span>
          </button>
        ))}
      </div>
      {!seats.length && <p className="pr-hint">No seats yet. Use “Add seat” to create your first one.</p>}
      {seat && (
        <div className="sm-detail" ref={detail} role="region" aria-label={`Seat ${seat.label} details`}>
          <div className="section-label"><span>Seat {seat.label} · {seat.floor}</span><span className={`sm-badge sm-${seat.state}`}>{STATES.find(([k]) => k === seat.state)?.[1]}</span></div>
          {seat.holders.map((h: Json) => (
            <article className="queue-card" key={h.assignmentId}>
              <div>
                <span>
                  <strong>{h.name}</strong>
                  <small>{h.email}</small>
                  <small>{h.shiftStart !== undefined ? `Shift ${hhmm(h.shiftStart)}–${hhmm(h.shiftEnd)}${h.onShift ? " (now)" : ""} · ` : ""}{day(h.from)} to {day(h.until)}</small>
                  <small>{h.inside ? "Inside the library now" : "Not punched in"}{h.membership ? ` · Membership ${h.membership.status}${h.membership.status === "paused" ? " (seat held)" : ""}` : ""}</small>
                  {h.membership && h.membership.due !== undefined && <small>{h.membership.due > 0 ? `Pending ${inr(h.membership.due)} of ${inr(h.membership.amount - h.membership.discount)}` : "Fees paid"}</small>}
                </span>
              </div>
            </article>
          ))}
          {!seat.holders.length && seat.state !== "maintenance" && <p className="pr-hint">Nobody holds this seat today.</p>}
          {seat.state === "maintenance" && <p className="pr-hint">This seat is under repair and cannot be allocated.</p>}
          {seat.state !== "maintenance" && <button className="button" onClick={() => onAllocate(seat._id)}>{seat.holders.length ? "Allocate another shift" : "Allocate this seat"}</button>}
        </div>
      )}
    </section>
  );
}
