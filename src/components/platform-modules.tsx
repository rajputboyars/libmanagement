"use client";

import { useState } from "react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2 } from "lucide-react";
import { getJson, post, type Json } from "./prep-api";
import { DataTable, type Column } from "./v2/data-table";
import { ConfirmDialog, ResponsiveDialog } from "./v2/dialog";
import { ScopeTag } from "./v2/admin-screens";
import { Badge, Btn, EmptyState, ErrorState, PageHead, Skeleton, Toggle } from "./v2/primitives";

/** One row per module with an availability switch. On means libraries may use it; off means it is blocked. */
function ModuleSwitches({ modules, blocked, onChange, alsoBlocked }: { modules: Json[]; blocked: Set<string>; onChange: (next: Set<string>) => void; alsoBlocked?: string[] }) {
  return (
    <ul className="sq-v2-feed">
      {modules.map((m) => (
        <li key={m.key}>
          <span>
            <strong>{m.name}</strong>
            {alsoBlocked?.includes(m.key) && <> <Badge tone="bad">Also blocked platform-wide</Badge></>}
            {m.description && <><br /><small>{m.description}</small></>}
          </span>
          <Toggle on={!blocked.has(m.key)} label={`${m.name} available`} onChange={(on) => { const n = new Set(blocked); if (on) n.delete(m.key); else n.add(m.key); onChange(n); }} />
        </li>
      ))}
    </ul>
  );
}

/** Platform owner: which modules exist for everyone, or for one organization. Libraries then switch their own on or off inside this. */
export function PlatformModules({ notify }: { notify: (m: string) => void }) {
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<Json | null>(null);
  const [orgBlocked, setOrgBlocked] = useState<Set<string>>(new Set());
  const [globalDraft, setGlobalDraft] = useState<Set<string> | null>(null);
  const [confirmGlobal, setConfirmGlobal] = useState(false);
  const [confirmOrg, setConfirmOrg] = useState(false);
  const data = useQuery<Json>({ queryKey: ["platform", "modules", page, q], queryFn: () => getJson(`/api/platform-modules?page=${page}&q=${encodeURIComponent(q)}`), placeholderData: keepPreviousData });
  const save = async (action: string, body: unknown, done: string) => {
    try { await post("/api/platform-modules", action, body); notify(done); await qc.invalidateQueries({ queryKey: ["platform", "modules"] }); return true; }
    catch (e) { notify((e as Error).message); return false; }
  };
  if (data.isLoading) return <><PageHead eyebrow="Platform controls" title="Module availability" /><Skeleton lines={6} /></>;
  if (data.isError || !data.data) return <><PageHead eyebrow="Platform controls" title="Module availability" /><ErrorState title="Could not load modules" text={data.error instanceof Error ? data.error.message : undefined} onRetry={() => void data.refetch()} /></>;
  const d = data.data, modules = d.modules as Json[], pages = Math.max(1, Math.ceil(d.total / 25));
  const saved = new Set<string>(d.global as string[]);
  const draft = globalDraft ?? saved;
  const changed = [...draft].filter((k) => !saved.has(k)).length + [...saved].filter((k) => !draft.has(k)).length;
  const nameOf = (k: string) => modules.find((m) => m.key === k)?.name ?? k;
  const newlyBlocked = [...draft].filter((k) => !saved.has(k));
  const columns: Column<Json>[] = [
    { key: "name", header: "Organization", primary: true, render: (o) => <strong>{o.name}</strong> },
    { key: "state", header: "Restrictions", render: (o) => (o.blocked.length ? <Badge tone="warn">{o.blocked.length} module{o.blocked.length === 1 ? "" : "s"} unavailable</Badge> : <Badge tone="ok">Everything available</Badge>) },
    { key: "act", header: "", hideOnCard: false, render: (o) => <Btn kind="outline" onClick={(e) => { e.stopPropagation(); setEditing(o); setOrgBlocked(new Set(o.blocked as string[])); }}>Edit</Btn> },
  ];
  return (
    <>
      <PageHead eyebrow="Platform controls" title="Module availability" sub="Switch a module off to make it unavailable. Libraries can then only switch on the modules left available to them, and only if their plan includes it. Nothing is deleted when a module is blocked." />
      <section className="sq-v2-panel" data-scope="platform" aria-label="Unavailable for every library" style={{ marginBottom: 20 }}>
        <div className="sq-v2-panelhead"><h2 className="sq-v2-h2">Platform-wide availability</h2><ScopeTag scope="platform" /></div>
        <p className="sq-v2-muted">Applies to every library on the platform. Organization-specific restrictions below add to this.</p>
        <ModuleSwitches modules={modules} blocked={draft} onChange={setGlobalDraft} />
        <div className="sq-v2-btnrow" style={{ marginTop: 12 }}>
          <Btn disabled={!changed} onClick={() => setConfirmGlobal(true)}>Save for all libraries</Btn>
          {changed > 0 && <Btn kind="outline" onClick={() => setGlobalDraft(null)}>Discard changes</Btn>}
        </div>
      </section>

      <h2 className="sq-v2-h2">One organization</h2>
      <div className="sq-v2-toolbar"><label className="sq-v2-search"><input type="search" aria-label="Search organizations" placeholder="Search organizations" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} /></label></div>
      <DataTable caption="Organizations" columns={columns} rows={d.items as Json[]} rowKey={(o) => String(o._id)} onRowClick={(o) => { setEditing(o); setOrgBlocked(new Set(o.blocked as string[])); }}
        empty={<EmptyState icon={Building2} title={q ? "No matching organizations" : "No organizations yet"} />} />
      {pages > 1 && <div className="sq-v2-pager"><span>Page {page} of {pages}</span><div className="sq-v2-btnrow"><Btn kind="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Btn><Btn kind="outline" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</Btn></div></div>}

      <ConfirmDialog open={confirmGlobal} onClose={() => setConfirmGlobal(false)} danger={newlyBlocked.length > 0} title="Change availability for every library?" confirmLabel="Save for all libraries"
        message={<><p style={{ margin: "0 0 8px" }}><ScopeTag scope="platform" /></p><p style={{ margin: 0 }}>{newlyBlocked.length ? `${newlyBlocked.map(nameOf).join(", ")} will become unavailable for every library, and their menus and pages disappear for owners, staff and students. ` : ""}{changed - newlyBlocked.length > 0 ? "Some modules become available again. " : ""}No data is deleted.</p></>}
        onConfirm={async () => { if (await save("global-set", { blocked: [...draft] }, "Saved.")) { setConfirmGlobal(false); setGlobalDraft(null); } }} />

      <ResponsiveDialog open={!!editing} onClose={() => setEditing(null)} title={editing ? `Modules for ${editing.name}` : ""} size="lg"
        footer={<><Btn kind="outline" onClick={() => setEditing(null)}>Cancel</Btn><Btn onClick={() => setConfirmOrg(true)}>Save</Btn></>}>
        {editing && (
          <>
            <p style={{ margin: "0 0 10px" }}><ScopeTag scope="organization" name={editing.name} /></p>
            <p className="sq-v2-muted" style={{ marginBottom: 8 }}>Switch off any module this organization should not have. This is separate from what the organization chooses for itself under Modules.</p>
            <ModuleSwitches modules={modules} blocked={orgBlocked} onChange={setOrgBlocked} alsoBlocked={d.global as string[]} />
          </>
        )}
      </ResponsiveDialog>
      <ConfirmDialog open={confirmOrg && !!editing} onClose={() => setConfirmOrg(false)} title={editing ? `Save restrictions for ${editing.name}?` : ""} confirmLabel="Save restrictions"
        message={<p style={{ margin: 0 }}>{orgBlocked.size ? `${[...orgBlocked].map(nameOf).join(", ")} will be unavailable for ${editing?.name} only.` : `Every module is available again for ${editing?.name}, apart from platform-wide restrictions.`} Other organizations are not affected.</p>}
        onConfirm={async () => { if (editing && (await save("org-set", { organizationId: editing._id, blocked: [...orgBlocked] }, "Saved."))) { setConfirmOrg(false); setEditing(null); } }} />
    </>
  );
}

