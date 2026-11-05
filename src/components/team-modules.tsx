"use client";

import { useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BrandLoader } from "@/components/brand-loader";
import { MODULES, isModuleKey } from "@/lib/modules";
import { getJson, post, type Json } from "./prep-api";

const useManage = () => useQuery<Json>({ queryKey: ["workspace", "access", "manage"], queryFn: () => getJson("/api/access?view=manage") });
const needName = (k: unknown) => (typeof k === "string" && isModuleKey(k) ? MODULES[k].name : "");
const STATE_TEXT: Record<string, string> = { on: "On", library: "Turned off by you", plan: "Not in your plan", platform: "Not available", dependency: "Needs another module" };

function useSave(notify: (m: string) => void) {
  const qc = useQueryClient();
  return async (action: string, data: unknown, done: string) => {
    try { await post("/api/access", action, data); notify(done); await qc.invalidateQueries({ queryKey: ["workspace"] }); }
    catch (e) { notify((e as Error).message); }
  };
}

/** Owner: switch library modules on or off. Turning one off hides it and blocks its pages; nothing is deleted. */
export function OwnerModules({ notify }: { notify: (m: string) => void }) {
  const q = useManage();
  const save = useSave(notify);
  if (q.isLoading) return <BrandLoader compact text="Loading modules…" />;
  if (q.isError || !q.data) return <section className="card"><h2>Could not load modules</h2><p>{q.error instanceof Error ? q.error.message : "Try again."}</p><button className="button secondary" onClick={() => q.refetch()}>Try again</button></section>;
  const registry = q.data.registry as Json[], disabled = new Set<string>(q.data.disabled);
  return (
    <>
      <p className="pr-hint">Turn parts of the app off when your library does not use them. Their menus and pages disappear for you, your staff and your students. Nothing is deleted: turn a module back on and everything is there again.</p>
      <div className="mt-list">
        {registry.map((m) => {
          const mine = !disabled.has(m.key), locked = ["plan", "platform"].includes(m.state.reason);
          return (
            <article className="queue-card" key={m.key}>
              <div>
                <span>
                  <strong>{m.name}</strong>
                  <small>{m.description}</small>
                  {m.state.reason !== "on" && <small>{STATE_TEXT[m.state.reason]}{m.state.reason === "dependency" && needName(m.state.needs) ? `: ${needName(m.state.needs)}` : ""}{m.state.reason === "plan" ? ". Upgrade from Billing to use it." : ""}</small>}
                </span>
              </div>
              <label className="switch-row" style={{ display: "flex", gap: 8, alignItems: "center", whiteSpace: "nowrap" }}>
                <input type="checkbox" role="switch" style={{ width: 20, height: 20, minHeight: 0 }} aria-label={`${m.name} on or off`} checked={mine} disabled={locked}
                  onChange={(e) => {
                    const on = e.target.checked;
                    if (!on && m.dependents.length && !confirm(`Turning off ${m.name} also stops: ${m.dependents.map((d: string) => (MODULES as Record<string, { name: string }>)[d].name).join(", ")}. Their data is kept. Continue?`)) return;
                    void save("module-set", { module: m.key, enabled: on }, `${m.name} ${on ? "turned on" : "turned off"}.`);
                  }} />
                {mine ? "On" : "Off"}
              </label>
            </article>
          );
        })}
      </div>
    </>
  );
}

/** Owner: roles (with ready-made ones) and who has which role. */
export function OwnerTeam({ notify }: { notify: (m: string) => void }) {
  const q = useManage();
  const save = useSave(notify);
  const [editing, setEditing] = useState<Json | "new" | null>(null);
  if (q.isLoading) return <BrandLoader compact text="Loading team…" />;
  if (q.isError || !q.data) return <section className="card"><h2>Could not load roles</h2><p>{q.error instanceof Error ? q.error.message : "Try again."}</p><button className="button secondary" onClick={() => q.refetch()}>Try again</button></section>;
  const roles = q.data.roles as Json[], staff = q.data.staff as Json[], catalog = q.data.catalog as Json[];
  const groups = new Map<string, Json[]>();
  for (const p of catalog) groups.set(p.module ?? "general", [...(groups.get(p.module ?? "general") ?? []), p]);
  const submitRole = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    void save("role-save", { id: editing !== "new" ? editing?._id : undefined, name: f.get("name"), description: f.get("description") ?? "", permissions: f.getAll("permission") }, "Role saved.").then(() => setEditing(null));
  };
  const assign = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    void save("staff-assign", { email: f.get("email"), roleId: f.get("roleId") }, "Staff role saved.");
    e.currentTarget.reset();
  };
  return (
    <>
      <p className="pr-hint">Give each person only what they need. You, the owner, always have full access. Billing, roles and modules stay with you.</p>
      <div className="section-label"><span>Roles</span><button className="button secondary" onClick={() => setEditing("new")}>New role</button></div>
      <div className="mt-list">
        {roles.map((r) => (
          <article className="queue-card" key={r._id}>
            <div><span><strong>{r.name}{r.preset ? " · ready-made" : ""}</strong><small>{r.description}</small><small>{r.permissions.length} permissions · {staff.filter((s) => s.roleId === r._id).length} people</small></span></div>
            <div className="queue-actions">
              <button className="button secondary" onClick={() => setEditing(r)}>Edit</button>
              {!r.preset && <button className="button secondary" onClick={() => { if (confirm(`Delete the ${r.name} role?`)) void save("role-delete", { id: r._id }, "Role deleted."); }}>Delete</button>}
            </div>
          </article>
        ))}
      </div>
      {editing && (
        <form className="mt-form" key={editing === "new" ? "new" : editing._id} onSubmit={submitRole} aria-label="Role editor">
          <label>Role name<input name="name" required minLength={2} maxLength={40} defaultValue={editing === "new" ? "" : editing.name} /></label>
          <label>What this role is for<input name="description" maxLength={200} defaultValue={editing === "new" ? "" : editing.description} /></label>
          {[...groups.entries()].map(([mod, items]) => (
            <fieldset className="wide" key={mod}>
              <legend>{mod === "general" ? "General" : isModuleKey(mod) ? MODULES[mod].name : mod}</legend>
              {items.map((p) => (
                <label key={p.key} style={{ display: "flex", gap: 8, alignItems: "center", fontWeight: 400 }}>
                  <input type="checkbox" name="permission" value={p.key} style={{ width: "auto", minHeight: 0 }} defaultChecked={editing !== "new" && editing.permissions.includes(p.key)} />
                  {p.label}{p.sensitive ? " ⚠" : ""}
                </label>
              ))}
            </fieldset>
          ))}
          <div className="queue-actions wide"><button className="button">Save role</button><button type="button" className="button secondary" onClick={() => setEditing(null)}>Cancel</button></div>
        </form>
      )}
      <div className="section-label"><span>Staff</span></div>
      <form className="mt-form" onSubmit={assign} aria-label="Give someone a role">
        <label>Registered email (must already be in your library)<input name="email" type="email" required /></label>
        <label>Role<select name="roleId" required defaultValue="">
          <option value="" disabled>Choose a role</option>
          {roles.map((r) => <option key={r._id} value={r._id}>{r.name}</option>)}
        </select></label>
        <button className="button">Give role</button>
      </form>
      <div className="sq-table" role="region" aria-label="Staff" tabIndex={0}>
        <table>
          <thead><tr><th>Name</th><th>Role</th><th /></tr></thead>
          <tbody>
            {staff.map((s) => (
              <tr key={s.userId}>
                <td><strong>{s.name}</strong><br /><small>{s.email}</small></td>
                <td>{s.roleName}</td>
                <td><button className="button secondary" onClick={() => { if (confirm(`Remove staff access for ${s.name}? They stay in the library as a student.`)) void save("staff-assign", { email: s.email, roleId: null }, "Staff access removed."); }}>Remove</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!staff.length && <p className="pr-hint">No staff yet.</p>}
    </>
  );
}
