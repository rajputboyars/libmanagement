"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { AlertTriangle, CheckCircle2, ChevronDown, Wrench } from "lucide-react";
import { ISSUE_CATEGORIES, ISSUE_PRIORITIES, canTransition, isActiveIssue, type IssueStatus } from "@/lib/maintenance";

type Event = { at: string; status: string; note: string };
type Issue = { _id: string; title: string; description?: string; category: string; priority: string; status: IssueStatus; seatId?: string; seatOffline: boolean; costPaise?: number; assigneeId?: string; createdAt: string; events: Event[] };
type Data = {
  issues: Issue[];
  seats: { _id: string; label: string; operationalStatus: string }[];
  assignees: { _id: string; name: string }[];
  page: number;
  summary: { byStatus: Record<string, number>; repairCostPaise: number; seatsOffline: number } | null;
};
const inr = (paise: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(paise / 100);
const label = (value: string) => value.replace("-", " ");

export function Maintenance({ owner, notify }: { owner: boolean; notify: (message: string) => void }) {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState("active");
  const [page, setPage] = useState(1);
  const { data, isLoading, isError } = useQuery<Data>({
    queryKey: ["maintenance", filter, page],
    queryFn: async () => {
      const response = await fetch(`/api/maintenance?status=${filter}&page=${page}`);
      if (!response.ok) throw new Error("Maintenance could not load");
      return response.json();
    },
  });
  async function act(action: string, value: unknown, success: string) {
    try {
      const response = await fetch("/api/maintenance", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, data: value }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      await queryClient.invalidateQueries({ queryKey: ["maintenance"] });
      const warn = result.affectedAssignments ? ` ${result.affectedAssignments} existing assignment(s) are unchanged; reassign them yourself.` : "";
      notify(success + warn);
      return true;
    } catch (error) {
      notify(error instanceof Error ? error.message : "Unable to update");
      return false;
    }
  }
  if (isLoading) return <div className="mt-skeleton" aria-busy="true" />;
  if (isError || !data) return <div className="mt-empty"><AlertTriangle /><h2>Maintenance could not load</h2><p>Check the connection and refresh.</p></div>;
  return (
    <>
      <header className="p2-heading">
        <div>
          <span className="eyebrow">{owner ? "Facility operations" : "Help us fix it"}</span>
          <h1>{owner ? "Keep every seat ready." : "Report a problem with the library."}</h1>
          <p>{owner ? "Seats taken offline cannot be newly allocated or offered. Existing assignments are never removed automatically." : "Your report goes to the library team. You will get a notification when its status changes."}</p>
        </div>
      </header>
      {owner && data.summary && (
        <div className="mt-stats">
          <div><small>Open</small><strong>{(data.summary.byStatus.open || 0) + (data.summary.byStatus.assigned || 0) + (data.summary.byStatus["in-progress"] || 0)}</strong></div>
          <div><small>Seats offline</small><strong>{data.summary.seatsOffline}</strong></div>
          <div><small>Resolved</small><strong>{data.summary.byStatus.resolved || 0}</strong></div>
          <div><small>Repair spend</small><strong>{inr(data.summary.repairCostPaise)}</strong></div>
        </div>
      )}
      <ReportForm data={data} owner={owner} act={act} />
      <div className="mt-filter" role="tablist" aria-label="Filter issues">
        {["active", "resolved", "cancelled"].map((item) => (
          <button key={item} role="tab" aria-selected={filter === item} className={filter === item ? "active" : ""} onClick={() => { setFilter(item); setPage(1); }}>{item === "active" ? "Active" : label(item)}</button>
        ))}
      </div>
      <section className="mt-list" aria-live="polite">
        {data.issues.map((issue) => <IssueCard key={issue._id} issue={issue} data={data} owner={owner} act={act} />)}
        {!data.issues.length && <div className="mt-empty"><CheckCircle2 /><h2>Nothing here</h2><p>{filter === "active" ? "No active issues right now." : "No issues with this status."}</p></div>}
      </section>
      <div className="mt-pager">
        <button className="button secondary" disabled={page === 1} onClick={() => setPage(page - 1)}>Previous</button>
        <span>Page {page}</span>
        <button className="button secondary" disabled={data.issues.length < 20} onClick={() => setPage(page + 1)}>Next</button>
      </div>
    </>
  );
}

function ReportForm({ data, owner, act }: { data: Data; owner: boolean; act: (a: string, v: unknown, s: string) => Promise<boolean> }) {
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const payload: Record<string, unknown> = { category: form.get("category"), title: form.get("title"), description: form.get("description"), seatId: form.get("seatId") || undefined };
    if (owner) { payload.priority = form.get("priority"); payload.seatOffline = form.get("seatOffline") === "on"; }
    if (await act("issue-report", payload, "Issue recorded.")) formElement.reset();
  }
  return (
    <form className="mt-form" onSubmit={submit}>
      <label>Title<input name="title" required minLength={3} maxLength={120} placeholder="Desk lamp not working" /></label>
      <label>Category<select name="category">{ISSUE_CATEGORIES.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
      <label>Seat (optional)<select name="seatId"><option value="">Not seat-specific</option>{data.seats.map((seat) => <option key={seat._id} value={seat._id}>{seat.label}{seat.operationalStatus === "maintenance" ? " · offline" : ""}</option>)}</select></label>
      {owner && <label>Priority<select name="priority" defaultValue="medium">{ISSUE_PRIORITIES.map((item) => <option key={item}>{item}</option>)}</select></label>}
      <label className="wide">Details<textarea name="description" maxLength={800} /></label>
      {owner && <label className="mt-check"><input type="checkbox" name="seatOffline" />Take the selected seat offline</label>}
      <button className="button"><Wrench /> Submit report</button>
    </form>
  );
}

function IssueCard({ issue, data, owner, act }: { issue: Issue; data: Data; owner: boolean; act: (a: string, v: unknown, s: string) => Promise<boolean> }) {
  const [open, setOpen] = useState(false);
  const seat = data.seats.find((item) => item._id === issue.seatId);
  const next = (["assigned", "in-progress", "resolved", "cancelled"] as IssueStatus[]).filter((status) => canTransition(issue.status, status));
  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const cost = String(form.get("cost") || "");
    const payload: Record<string, unknown> = { id: issue._id, priority: form.get("priority"), note: form.get("note") };
    const assignee = String(form.get("assigneeId") || "");
    payload.assigneeId = assignee || null;
    if (cost !== "") payload.costPaise = Math.round(Number(cost) * 100);
    if (issue.seatId && isActiveIssue(issue.status)) payload.seatOffline = form.get("seatOffline") === "on";
    act("issue-update", payload, "Issue updated.");
  }
  return (
    <article className={`mt-card priority-${issue.priority}`}>
      <div className="mt-card-head">
        <div>
          <h3>{issue.title}</h3>
          <p>{issue.category}{seat ? ` · Seat ${seat.label}` : ""} · {new Date(issue.createdAt).toLocaleDateString("en-IN")}</p>
        </div>
        <div className="mt-badges"><span className={`mt-pill p-${issue.priority}`}>{issue.priority}</span><span className="mt-pill">{label(issue.status)}</span>{issue.seatOffline && isActiveIssue(issue.status) && <span className="mt-pill offline">seat offline</span>}</div>
      </div>
      {issue.description && <p className="mt-desc">{issue.description}</p>}
      {owner && next.length > 0 && (
        <div className="mt-actions">
          {next.map((status) => <button key={status} className={status === "resolved" ? "button" : "button secondary"} onClick={() => act("issue-update", { id: issue._id, status }, `Marked ${label(status)}.`)}>{status === "resolved" ? "Resolve" : status === "cancelled" ? "Cancel" : `Mark ${label(status)}`}</button>)}
        </div>
      )}
      {issue.status === "resolved" && owner && <div className="mt-actions"><button className="button secondary" onClick={() => act("issue-update", { id: issue._id, status: "in-progress", note: "Reopened" }, "Issue reopened.")}>Reopen</button></div>}
      <button className="mt-toggle" aria-expanded={open} onClick={() => setOpen(!open)}><ChevronDown />{owner ? "Manage & history" : "History"}</button>
      {open && (
        <div className="mt-detail">
          {owner && (
            <form onSubmit={save}>
              <label>Priority<select name="priority" defaultValue={issue.priority}>{ISSUE_PRIORITIES.map((item) => <option key={item}>{item}</option>)}</select></label>
              <label>Assignee<select name="assigneeId" defaultValue={issue.assigneeId || ""}><option value="">Unassigned</option>{data.assignees.map((person) => <option key={person._id} value={person._id}>{person.name}</option>)}</select></label>
              <label>Repair cost (₹)<input name="cost" type="number" min={0} step="0.01" defaultValue={issue.costPaise ? issue.costPaise / 100 : ""} /></label>
              <label className="wide">Note<input name="note" maxLength={400} /></label>
              {issue.seatId && isActiveIssue(issue.status) && <label className="mt-check"><input type="checkbox" name="seatOffline" defaultChecked={issue.seatOffline} />Seat offline while open</label>}
              <button className="button secondary">Save changes</button>
            </form>
          )}
          <ol className="mt-history">{issue.events.map((event, index) => <li key={index}><strong>{label(event.status)}</strong><span>{new Date(event.at).toLocaleString("en-IN")}</span>{event.note && <em>{event.note}</em>}</li>)}</ol>
          {owner && issue.costPaise ? <p className="mt-cost">Recorded cost: {inr(issue.costPaise)}</p> : null}
        </div>
      )}
    </article>
  );
}
