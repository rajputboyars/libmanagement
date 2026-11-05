"use client";

import { useState, type FormEvent } from "react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { BrandLoader } from "@/components/brand-loader";
import { getJson, post, type Json } from "./prep-api";

/** Platform owner: which modules exist for everyone, or for one organization. Libraries then switch their own on or off inside this. */
export function PlatformModules({ notify }: { notify: (m: string) => void }) {
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState("");
  const data = useQuery<Json>({ queryKey: ["platform", "modules", page, q], queryFn: () => getJson(`/api/platform-modules?page=${page}&q=${encodeURIComponent(q)}`), placeholderData: keepPreviousData });
  const save = async (action: string, body: unknown, done: string) => {
    try { await post("/api/platform-modules", action, body); notify(done); await qc.invalidateQueries({ queryKey: ["platform", "modules"] }); }
    catch (e) { notify((e as Error).message); }
  };
  if (data.isLoading) return <BrandLoader compact text="Loading modules…" />;
  if (data.isError || !data.data) return <section className="card"><h2>Could not load modules</h2><p>{data.error instanceof Error ? data.error.message : "Try again."}</p></section>;
  const d = data.data, modules = d.modules as Json[], pages = Math.max(1, Math.ceil(d.total / 25));
  const checks = (blocked: string[], name: string) => modules.map((m) => (
    <label key={m.key} style={{ display: "flex", gap: 8, alignItems: "center", fontWeight: 400 }}>
      <input type="checkbox" name={name} value={m.key} defaultChecked={blocked.includes(m.key)} style={{ width: "auto", minHeight: 0 }} />{m.name}
    </label>
  ));
  const submit = (action: string, extra: Json) => (e: FormEvent<HTMLFormElement>) => { e.preventDefault(); void save(action, { ...extra, blocked: new FormData(e.currentTarget).getAll("blocked") }, "Saved."); };
  return (
    <>
      <header className="p2-heading"><div><span className="eyebrow">Platform owner</span><h1>Module availability</h1><p>Tick a module to make it unavailable. Libraries can then only switch on the modules left available to them, and only if their plan includes them. Nothing is deleted when a module is blocked.</p></div></header>
      <form className="mt-form" onSubmit={submit("global-set", {})} aria-label="Unavailable for every library" key={`g-${(d.global as string[]).join()}`}>
        <fieldset className="wide"><legend>Unavailable for every library</legend>{checks(d.global, "blocked")}</fieldset>
        <button className="button">Save for all libraries</button>
      </form>
      <div className="section-label"><span>One organization</span><input className="pr-select" type="search" placeholder="Search organizations" value={q} aria-label="Search organizations" onChange={(e) => { setQ(e.target.value); setPage(1); }} /></div>
      <div className="mt-list">
        {(d.items as Json[]).map((o) => (
          <article className="queue-card" key={o._id}>
            <div><span><strong>{o.name}</strong><small>{o.blocked.length ? `${o.blocked.length} module${o.blocked.length === 1 ? "" : "s"} unavailable` : "Everything available"}</small></span></div>
            <button className="button secondary" onClick={() => setOpen(open === o._id ? "" : o._id)}>{open === o._id ? "Close" : "Edit"}</button>
            {open === o._id && (
              <form className="mt-form wide" onSubmit={submit("org-set", { organizationId: o._id })} aria-label={`Modules for ${o.name}`} style={{ flexBasis: "100%" }}>
                <fieldset className="wide"><legend>Unavailable for {o.name}</legend>{checks(o.blocked, "blocked")}</fieldset>
                <button className="button">Save</button>
              </form>
            )}
          </article>
        ))}
      </div>
      {pages > 1 && <div className="lifecycle-toolbar"><button className="button secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button><span>Page {page} of {pages}</span><button className="button secondary" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</button></div>}
    </>
  );
}
