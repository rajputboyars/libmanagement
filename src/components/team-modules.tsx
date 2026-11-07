"use client";

import { useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Lock, Plus, ShieldCheck, UserPlus } from "lucide-react";
import Link from "next/link";
import { MODULES, isModuleKey } from "@/lib/modules";
import { getJson, post, type Json } from "./prep-api";
import { DataTable, type Column } from "./v2/data-table";
import { ResponsiveDialog } from "./v2/dialog";
import { Field, SelectInput, TextInput } from "./v2/form";
import { initials } from "./v2/format";
import { Badge, Btn, EmptyState, ErrorState, PageHead, Skeleton, StatCard, Toggle } from "./v2/primitives";

const useManage = () => useQuery<Json>({ queryKey: ["workspace", "access", "manage"], queryFn: () => getJson("/api/access?view=manage") });
const modName = (k: unknown) => (typeof k === "string" && isModuleKey(k) ? MODULES[k].name : String(k));

function useSave(notify: (m: string) => void) {
  const qc = useQueryClient();
  return async (action: string, data: unknown, done: string) => {
    try { await post("/api/access", action, data); notify(done); await qc.invalidateQueries({ queryKey: ["workspace"] }); return true; }
    catch (e) { notify((e as Error).message); return false; }
  };
}

/** Why a module is not simply on, in plain words. The three "not available" reasons are deliberately different. */
const WHY: Record<string, { tone: "warn" | "bad" | "neutral"; label: string }> = {
  library: { tone: "neutral", label: "Turned off by you" },
  plan: { tone: "warn", label: "Not in your plan" },
  platform: { tone: "bad", label: "Restricted by the platform" },
  dependency: { tone: "warn", label: "Needs another module" },
};

/** Owner: switch library modules on or off. Turning one off hides it and blocks its pages; nothing is deleted. */
export function OwnerModules({ notify }: { notify: (m: string) => void }) {
  const q = useManage();
  const save = useSave(notify);
  const [confirm, setConfirm] = useState<{ m: Json } | null>(null);
  if (q.isLoading) return <><PageHead title="Modules" /><Skeleton lines={6} /></>;
  if (q.isError || !q.data) return <><PageHead title="Modules" /><ErrorState title="Could not load modules" text={q.error instanceof Error ? q.error.message : "Try again."} onRetry={() => void q.refetch()} /></>;
  const registry = q.data.registry as Json[], disabled = new Set<string>(q.data.disabled);
  const count = (r: string) => registry.filter((m) => m.state.reason === r).length;
  const toggle = (m: Json, on: boolean) => {
    if (!on && m.dependents.length) { setConfirm({ m }); return; }
    void save("module-set", { module: m.key, enabled: on }, `${m.name} ${on ? "turned on" : "turned off"}.`);
  };
  return (
    <>
      <PageHead title="Modules" sub="Turn parts of the app off when your library does not use them. Their menus and pages disappear for you, your staff and your students. Nothing is deleted: turn a module back on and everything is there again." />
      <div className="sq-v2-statgrid">
        <StatCard label="On" value={count("on")} sub="Working now" />
        <StatCard label="Turned off by you" value={count("library")} sub="You can turn these on" />
        <StatCard label="Not in your plan" value={count("plan")} sub="Upgrade to unlock" />
        <StatCard label="Restricted by the platform" value={count("platform")} sub="Not available to your library" />
      </div>
      <ul className="sq-v2-modlist">
        {registry.map((m) => {
          const reason = m.state.reason as string;
          const mine = !disabled.has(m.key);
          const locked = reason === "plan" || reason === "platform";
          const why = WHY[reason];
          const needs = (m.requires as string[]) ?? [];
          return (
            <li key={m.key} className="sq-v2-panel sq-v2-mod" data-reason={reason}>
              <div className="sq-v2-modbody">
                <div className="sq-v2-modtitle">
                  <h2 className="sq-v2-cardtitle">{m.name}</h2>
                  {reason === "on" ? <Badge tone="ok">On</Badge> : why && <Badge tone={why.tone}>{why.label}</Badge>}
                  {locked && <Lock size={14} aria-hidden="true" />}
                </div>
                <p className="sq-v2-muted">{m.description}</p>
                {reason === "dependency" && <p className="sq-v2-modnote">Needs {modName(m.state.needs)} to be on first.</p>}
                {reason === "plan" && <p className="sq-v2-modnote">Included in a higher plan. <Link href="/owner/billing" className="sq-v2-more">Upgrade in Billing</Link></p>}
                {reason === "platform" && <p className="sq-v2-modnote">StudyQuest has not enabled this for your library. Contact support if you need it.</p>}
                {(needs.length > 0 || m.dependents.length > 0) && (
                  <p className="sq-v2-modnote">
                    {needs.length > 0 && <>Depends on: {needs.map(modName).join(", ")}. </>}
                    {m.dependents.length > 0 && <>Also used by: {(m.dependents as string[]).map(modName).join(", ")}.</>}
                  </p>
                )}
              </div>
              <Toggle on={mine && reason !== "plan" && reason !== "platform"} label={`${m.name} on or off`} disabled={locked} onChange={(on) => toggle(m, on)} />
            </li>
          );
        })}
      </ul>
      <ResponsiveDialog open={!!confirm} onClose={() => setConfirm(null)} title={confirm ? `Turn off ${confirm.m.name}?` : ""} size="sm"
        footer={<><Btn kind="outline" onClick={() => setConfirm(null)}>Cancel</Btn><Btn kind="danger" onClick={() => { const m = confirm!.m; setConfirm(null); void save("module-set", { module: m.key, enabled: false }, `${m.name} turned off.`); }}>Turn off</Btn></>}>
        {confirm && <p className="sq-v2-muted">This also stops: {(confirm.m.dependents as string[]).map(modName).join(", ")}. Their data is kept, and you can turn them back on later.</p>}
      </ResponsiveDialog>
    </>
  );
}

/** Owner: roles (with ready-made ones) and who has which role. */
export function OwnerTeam({ notify }: { notify: (m: string) => void }) {
  const q = useManage();
  const save = useSave(notify);
  const [editing, setEditing] = useState<Json | "new" | null>(null);
  const [assigning, setAssigning] = useState(false);
  const [perms, setPerms] = useState<Set<string>>(new Set());
  const [removing, setRemoving] = useState<Json | null>(null);
  const [deleting, setDeleting] = useState<Json | null>(null);
  if (q.isLoading) return <><PageHead title="Team & roles" /><Skeleton lines={6} /></>;
  if (q.isError || !q.data) return <><PageHead title="Team & roles" /><ErrorState title="Could not load roles" text={q.error instanceof Error ? q.error.message : "Try again."} onRetry={() => void q.refetch()} /></>;
  const roles = q.data.roles as Json[], staff = q.data.staff as Json[], catalog = q.data.catalog as Json[];
  const groups = new Map<string, Json[]>();
  for (const p of catalog) groups.set(p.module ?? "general", [...(groups.get(p.module ?? "general") ?? []), p]);
  const open = (r: Json | "new") => { setPerms(new Set(r === "new" ? [] : (r.permissions as string[]))); setEditing(r); };
  const submitRole = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    void save("role-save", { id: editing !== "new" ? editing?._id : undefined, name: f.get("name"), description: f.get("description") ?? "", permissions: [...perms] }, "Role saved.").then((ok) => ok && setEditing(null));
  };
  const assign = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    void save("staff-assign", { email: f.get("email"), roleId: f.get("roleId") }, "Staff role saved.").then((ok) => ok && setAssigning(false));
  };
  const setGroup = (items: Json[], on: boolean) => setPerms((cur) => { const n = new Set(cur); for (const p of items) { if (on) n.add(p.key); else n.delete(p.key); } return n; });
  const columns: Column<Json>[] = [
    { key: "name", header: "Person", primary: true, render: (s) => <span className="sq-v2-who"><span className="sq-v2-avatar" aria-hidden="true">{initials(String(s.name))}</span><span><strong>{s.name}</strong><small>{s.email}</small></span></span> },
    { key: "role", header: "Role", render: (s) => <Badge tone="ok">{s.roleName}</Badge> },
    { key: "act", header: "", hideOnCard: false, render: (s) => <Btn kind="outline" onClick={() => setRemoving(s)}>Remove access</Btn> },
  ];
  return (
    <>
      <PageHead title="Team & roles" sub="Give each person only what they need. You, the owner, always have full access. Billing, roles and modules stay with you."
        actions={<><Btn onClick={() => setAssigning(true)}><UserPlus size={17} /> Give someone a role</Btn><Btn kind="outline" onClick={() => open("new")}><Plus size={16} /> New role</Btn></>} />
      <h2 className="sq-v2-h2">Roles</h2>
      <div className="sq-v2-plangrid">
        {roles.map((r) => (
          <article className="sq-v2-panel" key={r._id}>
            <div className="sq-v2-modtitle"><h3 className="sq-v2-cardtitle">{r.name}</h3>{r.preset && <Badge>Ready-made</Badge>}</div>
            <p className="sq-v2-muted">{r.description || "No description."}</p>
            <p className="sq-v2-muted"><ShieldCheck size={13} aria-hidden="true" /> {r.permissions.length} permissions · {staff.filter((s) => s.roleId === r._id).length} people</p>
            <div className="sq-v2-btnrow" style={{ marginTop: 10 }}>
              <Btn kind="outline" onClick={() => open(r)}>Edit</Btn>
              {!r.preset && <Btn kind="outline" onClick={() => setDeleting(r)}>Delete</Btn>}
            </div>
          </article>
        ))}
      </div>
      <h2 className="sq-v2-h2" style={{ marginTop: 22 }}>Staff</h2>
      <DataTable caption="Staff" columns={columns} rows={staff} rowKey={(s) => String(s.userId)}
        empty={<EmptyState icon={UserPlus} title="No staff yet" text="Give a registered library member a role so they can help run the desk." action={<Btn onClick={() => setAssigning(true)}>Give someone a role</Btn>} />} />

      <ResponsiveDialog open={!!editing} onClose={() => setEditing(null)} title={editing === "new" ? "New role" : "Edit role"} size="lg">
        {editing && (
          <form onSubmit={submitRole} aria-label="Role editor" key={editing === "new" ? "new" : editing._id}>
            <Field label="Role name"><TextInput name="name" required minLength={2} maxLength={40} defaultValue={editing === "new" ? "" : editing.name} /></Field>
            <Field label="What this role is for" hint="Optional. Helps you remember why it exists."><TextInput name="description" maxLength={200} defaultValue={editing === "new" ? "" : editing.description} /></Field>
            <h3 className="sq-v2-h3">What they can do · {perms.size} selected</h3>
            {[...groups.entries()].map(([mod, items]) => {
              const on = items.filter((p) => perms.has(p.key)).length;
              return (
                <details className="sq-v2-permgroup" key={mod} open={on > 0}>
                  <summary><strong>{mod === "general" ? "General" : modName(mod)}</strong><span>{on} of {items.length}</span></summary>
                  <div className="sq-v2-btnrow" style={{ margin: "6px 0" }}>
                    <Btn kind="outline" onClick={() => setGroup(items, true)}>Select all</Btn><Btn kind="outline" onClick={() => setGroup(items, false)}>Clear</Btn>
                  </div>
                  {items.map((p) => (
                    <label key={p.key} className="sq-v2-check">
                      <input type="checkbox" checked={perms.has(p.key)} onChange={(e) => setGroup([p], e.target.checked)} />
                      <span>{p.label}{p.sensitive && <Badge tone="warn">Sensitive</Badge>}</span>
                    </label>
                  ))}
                </details>
              );
            })}
            <div className="sq-v2-btnrow" style={{ marginTop: 16 }}><Btn type="submit">Save role</Btn><Btn kind="outline" onClick={() => setEditing(null)}>Cancel</Btn></div>
          </form>
        )}
      </ResponsiveDialog>

      <ResponsiveDialog open={assigning} onClose={() => setAssigning(false)} title="Give someone a role" description="They must already be a member of your library.">
        <form onSubmit={assign} aria-label="Give someone a role">
          <Field label="Registered email"><TextInput name="email" type="email" required /></Field>
          <Field label="Role"><SelectInput name="roleId" required defaultValue=""><option value="" disabled>Choose a role</option>{roles.map((r) => <option key={r._id} value={r._id}>{r.name}</option>)}</SelectInput></Field>
          <Btn type="submit">Give role</Btn>
        </form>
      </ResponsiveDialog>

      <ResponsiveDialog open={!!removing} onClose={() => setRemoving(null)} title={removing ? `Remove staff access for ${removing.name}?` : ""} size="sm"
        footer={<><Btn kind="outline" onClick={() => setRemoving(null)}>Cancel</Btn><Btn kind="danger" onClick={() => { const s = removing!; setRemoving(null); void save("staff-assign", { email: s.email, roleId: null }, "Staff access removed."); }}>Remove access</Btn></>}>
        <p className="sq-v2-muted">They stay in the library as a student.</p>
      </ResponsiveDialog>
      <ResponsiveDialog open={!!deleting} onClose={() => setDeleting(null)} title={deleting ? `Delete the ${deleting.name} role?` : ""} size="sm"
        footer={<><Btn kind="outline" onClick={() => setDeleting(null)}>Cancel</Btn><Btn kind="danger" onClick={() => { const r = deleting!; setDeleting(null); void save("role-delete", { id: r._id }, "Role deleted."); }}>Delete role</Btn></>}>
        <p className="sq-v2-muted">This cannot be undone.</p>
      </ResponsiveDialog>
    </>
  );
}
