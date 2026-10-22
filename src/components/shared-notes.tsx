"use client";

import Link from "next/link";
import { useState } from "react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { BrandLoader } from "@/components/brand-loader";
import { fmtDate, getJson, post, type Json } from "./prep-api";

function useSharedNotes(q: string) {
  return useQuery<Json>({ queryKey: ["shared-notes", q], queryFn: () => getJson(`/api/shared-notes?q=${encodeURIComponent(q)}`), placeholderData: keepPreviousData });
}

function NoteCard({ n, children }: { n: Json; children?: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const long = String(n.body).length > 320;
  return (
    <article className={`mt-card shared-note${n.hidden ? " hidden-note" : ""}`}>
      <div className="mt-card-head">
        <div>
          <h3>{n.title}</h3>
          <p>
            {n.mine ? "You" : n.author} · {n.sharedAt ? fmtDate(n.sharedAt) : ""}
            {n.tags?.length ? ` · ${n.tags.map((t: string) => `#${t}`).join(" ")}` : ""}
          </p>
        </div>
        {n.hidden && <span className="pill">Hidden</span>}
      </div>
      <p className="mt-desc" style={{ whiteSpace: "pre-wrap" }}>{open || !long ? n.body : `${String(n.body).slice(0, 320)}…`}</p>
      {long && <button className="text-link" onClick={() => setOpen(!open)}>{open ? "Show less" : "Read more"}</button>}
      {n.hidden && n.hiddenReason && <p className="cm-note">Hidden by the library: {n.hiddenReason}</p>}
      {children}
    </article>
  );
}

/** Students: notes classmates shared with the library. */
export function LibraryNotes() {
  const [q, setQ] = useState("");
  const data = useSharedNotes(q);
  return (
    <div className="pr-page">
      <header className="p2-heading">
        <div>
          <span className="eyebrow">Library notes</span>
          <h1>Notes shared by your classmates.</h1>
          <p>Read notes other students in your library chose to share. To share your own, open Exam prep → Notes and press “Share with library”.</p>
        </div>
      </header>
      <form className="pf-search" onSubmit={(e) => { e.preventDefault(); setQ(String(new FormData(e.currentTarget).get("q") ?? "")); }}>
        <Search size={16} aria-hidden="true" />
        <input name="q" defaultValue={q} placeholder="Search by title, text or #tag" aria-label="Search notes" />
        <button className="button secondary">Search</button>
      </form>
      {data.isLoading ? <BrandLoader compact text="Loading notes…" /> : data.isError || !data.data ? (
        <div className="mt-empty"><h2>Could not load notes</h2><p>{data.error instanceof Error ? data.error.message : "Try again."}</p></div>
      ) : (data.data.notes as Json[]).length ? (
        <div className="mt-list">{(data.data.notes as Json[]).map((n) => <NoteCard key={n._id} n={n} />)}</div>
      ) : (
        <div className="mt-empty"><h2>No shared notes yet</h2><p>Be the first: share a note from <Link href="/app/prep">Exam prep</Link>.</p></div>
      )}
    </div>
  );
}

/** Library team: every shared note with hide / restore. */
export function OwnerSharedNotes({ notify }: { notify: (m: string) => void }) {
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const data = useSharedNotes(q);
  if (data.data && !data.data.team) return null;
  const act = async (action: "hide" | "restore", id: string) => {
    let reason = "";
    if (action === "hide") {
      const input = document.getElementById(`hide-${id}`) as HTMLInputElement | null;
      reason = input?.value.trim() ?? "";
      if (reason.length < 3) return notify("Write a short reason the student will see.");
    }
    try {
      await post("/api/shared-notes", action, { id, reason });
      await qc.invalidateQueries({ queryKey: ["shared-notes"] });
      notify(action === "hide" ? "Note hidden. The student has been told why." : "Note visible again.");
    } catch (e) {
      notify(e instanceof Error ? e.message : "Could not save");
    }
  };
  return (
    <section className="card" style={{ marginTop: 20 }}>
      <div className="section-heading">
        <div>
          <h2>Shared notes</h2>
          <p className="muted">Notes students shared with the whole library. Hide anything off-topic or unsafe.</p>
        </div>
      </div>
      <form className="pf-search" onSubmit={(e) => { e.preventDefault(); setQ(String(new FormData(e.currentTarget).get("q") ?? "")); }}>
        <input name="q" defaultValue={q} placeholder="Search notes" aria-label="Search shared notes" />
        <button className="button secondary">Search</button>
      </form>
      {data.isLoading ? <BrandLoader compact text="Loading notes…" /> : (data.data?.notes as Json[] | undefined)?.length ? (
        <div className="mt-list">
          {(data.data!.notes as Json[]).map((n) => (
            <NoteCard key={n._id} n={n}>
              <div className="queue-actions">
                {n.hidden ? (
                  <button className="button secondary" onClick={() => act("restore", n._id)}>Show again</button>
                ) : (
                  <>
                    <input id={`hide-${n._id}`} className="pr-select" maxLength={200} placeholder="Reason for hiding" aria-label="Reason for hiding" />
                    <button className="button secondary" onClick={() => act("hide", n._id)}>Hide</button>
                  </>
                )}
              </div>
            </NoteCard>
          ))}
        </div>
      ) : (
        <p className="muted">No shared notes yet.</p>
      )}
    </section>
  );
}
