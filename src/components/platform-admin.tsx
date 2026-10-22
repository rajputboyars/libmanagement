"use client";

import { useState, type FormEvent } from "react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { BrandLoader } from "@/components/brand-loader";
import { getJson, inr, post, type Json } from "./prep-api";

const CELL_TEXT: Record<string, string> = { plan: "On · plan", added: "On · added", removed: "Off · removed", restricted: "Off · unpaid", off: "Off" };

function Pager({ page, total, size, set }: { page: number; total: number; size: number; set: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / size));
  return (
    <div className="pf-pager">
      <button className="button secondary" disabled={page <= 1} onClick={() => set(page - 1)}>Previous</button>
      <span>Page {page} of {pages} · {total} total</span>
      <button className="button secondary" disabled={page >= pages} onClick={() => set(page + 1)}>Next</button>
    </div>
  );
}

function Failed({ error }: { error: unknown }) {
  return <div className="mt-empty"><h2>Could not load</h2><p>{error instanceof Error ? error.message : "Try again."}</p></div>;
}

/** Library × feature table with on/off switches (overrides on top of the plan). */
export function PlatformFeatures({ notify }: { notify: (m: string) => void }) {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const [edit, setEdit] = useState<{ org: Json; feature: string } | null>(null);
  const data = useQuery<Json>({ queryKey: ["platform", "features", page, q], queryFn: () => getJson(`/api/platform?view=features&page=${page}&q=${encodeURIComponent(q)}`), placeholderData: keepPreviousData });
  const save = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!edit) return;
    const f = new FormData(e.currentTarget);
    const days = Number(f.get("days") || 0);
    try {
      await post("/api/platform", "feature-set", { organizationId: edit.org._id, feature: edit.feature, mode: f.get("mode"), reason: f.get("reason"), ...(days ? { days } : {}) });
      await qc.invalidateQueries({ queryKey: ["platform", "features"] });
      notify("Feature access updated.");
      setEdit(null);
    } catch (err) {
      notify(err instanceof Error ? err.message : "Could not save");
    }
  };
  const features = (data.data?.features ?? {}) as Record<string, string>;
  return (
    <div className="pr-page">
      <header className="p2-heading"><div><span className="eyebrow">Platform owner</span><h1>Feature access by library</h1><p>Each library gets features from its plan. Click a cell to switch one feature on or off for that library, with a reason and an optional end date.</p></div></header>
      <form className="pf-search" onSubmit={(e) => { e.preventDefault(); setPage(1); setQ(String(new FormData(e.currentTarget).get("q") ?? "")); }}>
        <Search size={16} aria-hidden="true" />
        <input name="q" defaultValue={q} placeholder="Search libraries by name" aria-label="Search libraries" />
        <button className="button secondary">Search</button>
      </form>
      <div className="pf-legend">
        {Object.entries(CELL_TEXT).map(([k, v]) => <span key={k} className={`pf-cell ${k}`}>{v}</span>)}
      </div>
      {data.isLoading ? <BrandLoader compact text="Loading libraries…" /> : data.isError ? <Failed error={data.error} /> : (
        <>
          <div className="pf-table-wrap">
            <table className="pf-table">
              <thead><tr><th>Library</th><th>Plan</th>{Object.entries(features).map(([k, v]) => <th key={k}>{v}</th>)}</tr></thead>
              <tbody>
                {(data.data?.items as Json[]).map((o) => (
                  <tr key={o._id}>
                    <td><strong>{o.name}</strong><small>{o.owner?.email ?? "—"} · {o.branches} branch{o.branches === 1 ? "" : "es"}</small>{o.override && <small className="pf-override">Override: {o.override.reason}{o.override.expiresAt ? ` · until ${new Date(o.override.expiresAt).toLocaleDateString("en-IN")}` : ""}</small>}</td>
                    <td><strong>{o.plan?.name ?? "No plan"}</strong><small className={o.restricted ? "pf-bad" : ""}>{o.plan?.status ?? "—"}{o.restricted ? ` · ${o.reason}` : ""}</small></td>
                    {Object.keys(features).map((f) => {
                      const c = o.cells[f] as { on: boolean; source: string };
                      return <td key={f}><button className={`pf-cell ${c.source}`} onClick={() => setEdit({ org: o, feature: f })} aria-label={`${features[f]} for ${o.name}: ${CELL_TEXT[c.source]}. Change`}>{CELL_TEXT[c.source]}</button></td>;
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager page={page} total={data.data?.total ?? 0} size={20} set={setPage} />
        </>
      )}
      {edit && (
        <div className="modal-backdrop" role="presentation" onClick={() => setEdit(null)}>
          <form className="modal pf-modal" role="dialog" aria-modal="true" aria-label="Change feature access" onSubmit={save} onClick={(e) => e.stopPropagation()}>
            <h2>{features[edit.feature]}</h2>
            <p className="muted">{edit.org.name} · now {CELL_TEXT[(edit.org.cells[edit.feature] as Json).source]}</p>
            <fieldset className="pf-modes">
              <legend>Access</legend>
              <label><input type="radio" name="mode" value="on" defaultChecked /> Turn on for this library</label>
              <label><input type="radio" name="mode" value="off" /> Turn off for this library</label>
              <label><input type="radio" name="mode" value="plan" /> Follow the plan again</label>
            </fieldset>
            <label>Reason (saved in the audit log)<input name="reason" required minLength={3} maxLength={200} placeholder="e.g. Paid extra for QR attendance" /></label>
            <label>Ends after (days, optional)<input name="days" type="number" min={1} max={3650} placeholder="Leave empty to keep" /></label>
            <p className="pr-hint">One end date covers all of this library&apos;s overrides.</p>
            <div className="queue-actions"><button className="button">Save</button><button type="button" className="button secondary" onClick={() => setEdit(null)}>Cancel</button></div>
          </form>
        </div>
      )}
    </div>
  );
}

/** Which student features are premium, and how many students each library has paid up. */
export function PlatformStudentRules({ notify }: { notify: (m: string) => void }) {
  const qc = useQueryClient();
  const data = useQuery<Json>({ queryKey: ["platform", "students"], queryFn: () => getJson("/api/platform?view=students") });
  const [busy, setBusy] = useState(false);
  if (data.isLoading) return <BrandLoader compact text="Loading student rules…" />;
  if (data.isError || !data.data) return <Failed error={data.error} />;
  const catalog = data.data.catalog as Record<string, { label: string; paths: string[] }>;
  const premium = new Set<string>(data.data.premium);
  const save = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setBusy(true);
    try {
      const f = new FormData(e.currentTarget);
      await post("/api/platform", "student-premium-save", { features: f.getAll("premium"), freeTrial: f.get("freeTrial") === "on" });
      await qc.invalidateQueries({ queryKey: ["platform", "students"] });
      notify("Student feature rules saved.");
    } catch (err) {
      notify(err instanceof Error ? err.message : "Could not save");
    } finally {
      setBusy(false);
    }
  };
  const libs = data.data.libraries as Json[];
  return (
    <div className="pr-page">
      <header className="p2-heading"><div><span className="eyebrow">Platform owner</span><h1>Student features</h1><p>Basic features are always on. Premium features work only for students whose library membership is active today and fully paid. Students with dues see a lock and a link to their fees.</p></div></header>
      <form className="card pf-rules" onSubmit={save}>
        <label className="pf-rule pf-trial">
          <input type="checkbox" name="freeTrial" defaultChecked={!!data.data.freeTrial} />
          <span><strong>Free trial: everything free</strong><small>While this is on, every student gets every feature, whatever is ticked below. Turn it off to start charging.</small></span>
        </label>
        <h2>Premium student features</h2>
        <div className="pf-rule-list">
          {Object.entries(catalog).map(([k, f]) => (
            <label key={k} className="pf-rule">
              <input type="checkbox" name="premium" value={k} defaultChecked={premium.has(k)} />
              <span><strong>{f.label}</strong><small>{f.paths.join(", ")}</small></span>
            </label>
          ))}
        </div>
        <p className="pr-hint">Always basic: home, focus timer, quests, progress, badges, punch in/out, My library, notifications, profile and account.</p>
        <button className="button" disabled={busy}>Save rules</button>
      </form>
      <section className="card" style={{ marginTop: 20 }}>
        <h2>Students by library</h2>
        <p className="muted">Who gets premium right now. “With dues” and “No membership” students only get basic features while any feature is premium.</p>
        <div className="pf-table-wrap">
          <table className="pf-table">
            <thead><tr><th>Library</th><th>Students</th><th>Paid up (premium)</th><th>With dues</th><th>No membership</th></tr></thead>
            <tbody>
              {libs.length ? libs.map((l) => (
                <tr key={l._id}><td><strong>{l.name}</strong></td><td>{l.students}</td><td>{l.paidUp}</td><td className={l.withDues ? "pf-bad" : ""}>{l.withDues}</td><td>{l.noMembership}</td></tr>
              )) : <tr><td colSpan={5}>No students yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

/** Every account with role, library, plan and payment status; suspend or reinstate. */
export function PlatformAccounts({ notify }: { notify: (m: string) => void }) {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const [role, setRole] = useState("");
  const [suspendedOnly, setSuspendedOnly] = useState(false);
  const [suspending, setSuspending] = useState<Json | null>(null);
  const data = useQuery<Json>({
    queryKey: ["platform", "accounts", page, q, role, suspendedOnly],
    queryFn: () => getJson(`/api/platform?view=accounts&page=${page}&q=${encodeURIComponent(q)}&role=${role}${suspendedOnly ? "&suspended=1" : ""}`),
    placeholderData: keepPreviousData,
  });
  const act = async (action: string, userId: string, reason = "") => {
    try {
      await post("/api/platform", action, { userId, reason });
      await qc.invalidateQueries({ queryKey: ["platform", "accounts"] });
      notify(action === "account-suspend" ? "Account suspended and signed out everywhere." : "Account reinstated.");
      setSuspending(null);
    } catch (err) {
      notify(err instanceof Error ? err.message : "Could not save");
    }
  };
  return (
    <div className="pr-page">
      <header className="p2-heading"><div><span className="eyebrow">Platform owner</span><h1>Accounts</h1><p>Owners, staff and students across all libraries, with their plan and payment status.</p></div></header>
      <form className="pf-search" onSubmit={(e) => { e.preventDefault(); setPage(1); setQ(String(new FormData(e.currentTarget).get("q") ?? "")); }}>
        <Search size={16} aria-hidden="true" />
        <input name="q" defaultValue={q} placeholder="Search name or email" aria-label="Search accounts" />
        <select value={role} onChange={(e) => { setPage(1); setRole(e.target.value); }} aria-label="Role">
          <option value="">All roles</option><option value="owner">Owners</option><option value="staff">Staff</option><option value="student">Students</option><option value="super-admin">Admins</option>
        </select>
        <label className="pf-check"><input type="checkbox" checked={suspendedOnly} onChange={(e) => { setPage(1); setSuspendedOnly(e.target.checked); }} /> Suspended only</label>
        <button className="button secondary">Search</button>
      </form>
      {data.isLoading ? <BrandLoader compact text="Loading accounts…" /> : data.isError ? <Failed error={data.error} /> : (
        <>
          <div className="pf-table-wrap">
            <table className="pf-table">
              <thead><tr><th>Account</th><th>Role</th><th>Library</th><th>Library plan</th><th>Payment</th><th>Status</th><th /></tr></thead>
              <tbody>
                {(data.data?.items as Json[]).map((u) => (
                  <tr key={u._id}>
                    <td><strong>{u.name}</strong><small>{u.email}</small></td>
                    <td className="pf-role">{u.role}</td>
                    <td>{u.library ?? "—"}</td>
                    <td>{u.plan ?? "—"}</td>
                    <td>{u.payment ? (u.payment.paidUp ? <span className="pf-good">Paid up</span> : u.payment.reason === "dues" ? <span className="pf-bad">Due {inr(u.payment.duePaise)}</span> : <span className="muted">No membership</span>) : "—"}</td>
                    <td>{u.suspendedAt ? <span className="pf-bad" title={u.suspendedReason}>Suspended</span> : <span className="pf-good">Active</span>}</td>
                    <td>{u.role !== "super-admin" && (u.suspendedAt ? <button className="text-link" onClick={() => act("account-reinstate", u._id)}>Reinstate</button> : <button className="text-link" onClick={() => setSuspending(u)}>Suspend</button>)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager page={page} total={data.data?.total ?? 0} size={25} set={setPage} />
        </>
      )}
      {suspending && (
        <div className="modal-backdrop" role="presentation" onClick={() => setSuspending(null)}>
          <form className="modal pf-modal" role="dialog" aria-modal="true" aria-label="Suspend account" onClick={(e) => e.stopPropagation()} onSubmit={(e) => { e.preventDefault(); void act("account-suspend", suspending._id, String(new FormData(e.currentTarget).get("reason") ?? "")); }}>
            <h2>Suspend {suspending.name}?</h2>
            <p className="muted">They will be signed out on every device and can&apos;t sign in until you reinstate the account. Their data is kept.</p>
            <label>Reason (saved in the audit log)<input name="reason" required minLength={3} maxLength={200} /></label>
            <div className="queue-actions"><button className="button">Suspend account</button><button type="button" className="button secondary" onClick={() => setSuspending(null)}>Cancel</button></div>
          </form>
        </div>
      )}
    </div>
  );
}
