"use client";

import { BrandLoader } from "@/components/brand-loader";
import { useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getJson, fmtDate, post, type Json } from "./prep-api";

const TABS = [["questions", "Questions"], ["import", "Bulk import"], ["templates", "Test templates"], ["dates", "Official dates"], ["catalog", "Syllabus versions"]] as const;
type Tab = (typeof TABS)[number][0];
const NEXT: Record<string, [string, string][]> = {
  draft: [["in-review", "Send to review"], ["archived", "Archive"]], "in-review": [["published", "Publish"], ["draft", "Back to draft"], ["archived", "Archive"]],
  published: [["in-review", "Unpublish for edit"], ["archived", "Archive"]], archived: [["draft", "Restore"]],
};
const api = "/api/prep-admin";

export function PrepAdmin({ notify }: { notify: (m: string) => void }) {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>("questions");
  const [examKey, setExamKey] = useState("ssc");
  const catalog = useQuery<Json>({ queryKey: ["padmin", "catalog"], queryFn: () => getJson(`${api}?view=catalog`) });
  const topics = useQuery<Json>({ queryKey: ["padmin", "topics", examKey], queryFn: () => getJson(`/api/phase2?exam=${examKey}`).catch(() => ({})) });
  const act = async (action: string, data: unknown, ok?: string) => {
    try { const r = await post(api, action, data); await queryClient.invalidateQueries({ queryKey: ["padmin"] }); notify(r.note || ok || "Saved."); return r; } catch (e) { notify(e instanceof Error ? e.message : "Unable to update"); return null; }
  };
  const exams: Json[] = catalog.data?.items ?? [];
  const nodes: Json[] = topics.data?.nodes ?? topics.data?.syllabus ?? [];
  const topicList = nodes.filter((n) => n.type === "topic" && n.examKey === examKey);
  return (
    <>
      <header className="p2-heading"><div><span className="eyebrow">Question bank &amp; tests</span><h1>Publish only what has been reviewed.</h1><p>Drafts and AI-generated items are never visible to students. Publishing needs a source and copyright status. Edited published questions return to review.</p></div>
        <label className="pr-exam">Exam<select value={examKey} onChange={(e) => setExamKey(e.target.value)}>{(exams.length ? exams : [{ key: "ssc", title: "SSC" }]).map((x) => <option key={x.key} value={x.key}>{x.title}</option>)}</select></label></header>
      <div className="mt-filter" role="tablist">{TABS.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? "active" : ""} onClick={() => setTab(k)}>{l}</button>)}</div>
      {tab === "questions" && <Questions examKey={examKey} topics={topicList} act={act} />}
      {tab === "import" && <Import examKey={examKey} topics={topicList} act={act} />}
      {tab === "templates" && <Templates examKey={examKey} act={act} />}
      {tab === "dates" && <Dates examKey={examKey} act={act} />}
      {tab === "catalog" && <CatalogMeta exams={exams} act={act} />}
    </>
  );
}
type Act = (action: string, data: unknown, ok?: string) => Promise<Json | null>;

function Questions({ examKey, topics, act }: { examKey: string; topics: Json[]; act: Act }) {
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [edit, setEdit] = useState<Json | null>(null);
  const q = useQuery<Json>({ queryKey: ["padmin", "questions", examKey, status, page], queryFn: () => getJson(`${api}?view=questions&examKey=${examKey}&page=${page}${status ? `&status=${status}` : ""}`) });
  const gen = async () => { const topicId = (document.getElementById("ai-topic") as HTMLSelectElement | null)?.value; if (!topicId) return; const r = await act("ai-generate", { examKey, topicId, count: 3 }); if (r && r.available === false) alert(r.message); };
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); const f = new FormData(e.currentTarget);
    const options = String(f.get("options")).split("\n").map((x) => x.trim()).filter(Boolean);
    const year = Number(f.get("year")) || undefined;
    const ok = await act("question-save", { id: edit?._id, examKey, topicId: f.get("topicId") || undefined, prompt: f.get("prompt"), options, correctIndex: Number(f.get("correct")), explanation: f.get("explanation"), difficulty: f.get("difficulty"), source: { name: f.get("sname") || "", url: f.get("surl") || "", year, license: f.get("license"), notes: f.get("snotes") || "" }, currentAffairsDate: f.get("cadate") || null }, "Question saved as draft.");
    if (ok) setEdit(null);
  }
  const counts = q.data?.counts ?? {};
  return (
    <>
      <div className="mt-stats">{["draft", "in-review", "published", "archived"].map((s) => <div key={s}><small>{s}</small><strong>{counts[s] ?? 0}</strong></div>)}</div>
      <div className="mt-filter"><select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className="pr-select" aria-label="Status filter"><option value="">All statuses</option>{["draft", "in-review", "published", "archived"].map((s) => <option key={s}>{s}</option>)}</select>
        <button className="button" onClick={() => setEdit({})}>New question</button>
        {q.data?.aiAvailable && <><select id="ai-topic" className="pr-select" aria-label="AI topic"><option value="">AI draft topic…</option>{topics.map((t) => <option key={t._id} value={t._id}>{t.title}</option>)}</select><button className="button secondary" onClick={gen}>Draft 3 with AI</button></>}</div>
      {edit && (
        <form className="mt-form" onSubmit={save} key={edit._id ?? "new"}>
          <label className="wide">Question<textarea name="prompt" required minLength={10} maxLength={1000} defaultValue={edit.prompt} /></label>
          <label className="wide">Options (one per line, 2–6)<textarea name="options" required rows={4} defaultValue={(edit.options ?? []).join("\n")} /></label>
          <label>Correct option number (0 = first)<input name="correct" type="number" min={0} max={5} required defaultValue={edit.correctIndex ?? 0} /></label>
          <label>Difficulty<select name="difficulty" defaultValue={edit.difficulty ?? "medium"}><option>easy</option><option>medium</option><option>hard</option></select></label>
          <label>Topic<select name="topicId" defaultValue={edit.topicId ?? ""}><option value="">None</option>{topics.map((t) => <option key={t._id} value={t._id}>{t.title}</option>)}</select></label>
          <label className="wide">Explanation<textarea name="explanation" required maxLength={1500} defaultValue={edit.explanation} /></label>
          <label>Source name<input name="sname" maxLength={120} defaultValue={edit.source?.name} /></label>
          <label>Source URL<input name="surl" type="url" defaultValue={edit.source?.url} /></label>
          <label>Year<input name="year" type="number" min={1950} max={2100} defaultValue={edit.source?.year} /></label>
          <label>Copyright status<select name="license" defaultValue={edit.source?.license ?? "original"}>{["original", "licensed", "public-domain", "ai-generated", "unknown"].map((l) => <option key={l}>{l}</option>)}</select></label>
          <label className="wide">Source notes<input name="snotes" maxLength={300} defaultValue={edit.source?.notes} /></label>
          <label>Current affairs date (optional)<input name="cadate" type="date" defaultValue={edit.currentAffairsDate} /></label>
          <p className="pr-hint wide">Previous year paper: fill Source name (e.g. SSC CGL Tier 1) and Year, then students see it under Previous year papers. Current affairs: set the date and the question joins that day&apos;s current-affairs quiz for every exam.</p>
          <div className="queue-actions"><button className="button">Save</button><button type="button" className="button secondary" onClick={() => setEdit(null)}>Cancel</button></div>
        </form>)}
      {q.isLoading ? <BrandLoader compact text="Loading…" /> : <div className="mt-list">{(q.data?.items ?? []).map((x: Json) => (
        <article className="mt-card" key={x._id}>
          <div className="mt-card-head"><div><h3>{x.prompt}</h3><p>{(x.options as string[]).map((o, i) => `${i === x.correctIndex ? "✓ " : ""}${o}`).join(" · ")}</p></div><div className="mt-badges"><span className="mt-pill">{x.status ?? "published"}</span>{x.aiGenerated && <span className="mt-pill p-high">AI draft</span>}<span className="mt-pill">{x.source?.license ?? "—"}</span></div></div>
          <p className="mt-desc">{x.explanation}</p><p className="mt-desc">Source: {x.source?.name || "not set"}{x.source?.year ? ` (${x.source.year})` : ""}</p>
          <div className="queue-actions">{(NEXT[x.status ?? "published"] ?? []).map(([s, l]) => <button key={s} className={s === "published" ? "button" : "button secondary"} onClick={() => act("question-status", { id: x._id, status: s }, `Moved to ${s}.`)}>{l}</button>)}<button className="button secondary" onClick={() => setEdit(x)}>Edit</button></div>
        </article>))}{!(q.data?.items ?? []).length && <div className="mt-empty"><h2>No questions</h2><p>Create one or import a file.</p></div>}</div>}
      <div className="mt-pager"><button className="button secondary" disabled={page === 1} onClick={() => setPage(page - 1)}>Previous</button><span>Page {page}</span><button className="button secondary" disabled={(q.data?.items ?? []).length < 20} onClick={() => setPage(page + 1)}>Next</button></div>
    </>
  );
}

function Import({ examKey, topics, act }: { examKey: string; topics: Json[]; act: Act }) {
  const [report, setReport] = useState<Json | null>(null);
  const [rows, setRows] = useState<unknown[]>([]);
  const [err, setErr] = useState("");
  function load(file?: File) {
    setReport(null); setErr("");
    file?.text().then((text) => { try { const parsed = JSON.parse(text); const list = Array.isArray(parsed) ? parsed : parsed.questions; if (!Array.isArray(list)) throw new Error("Expected a JSON array or { questions: [] }"); setRows(list); } catch (e) { setRows([]); setErr(e instanceof Error ? e.message : "Invalid JSON"); } });
  }
  async function run(dryRun: boolean, form: HTMLFormElement) {
    const f = new FormData(form);
    const r = await act("question-import", { examKey, topicId: f.get("topicId") || undefined, rows, dryRun, source: { name: f.get("sname"), url: f.get("surl") || "", year: Number(f.get("year")) || undefined, license: f.get("license"), notes: "" } }, dryRun ? "Validation finished." : "Imported as drafts.");
    if (r) setReport(r);
  }
  return (
    <>
      <form className="mt-form" onSubmit={(e) => { e.preventDefault(); run(true, e.currentTarget); }}>
        <p className="wide cm-note">File format: JSON array of {`{ prompt, options[], correctIndex, explanation, difficulty? }`}. Up to 200 rows. Imports are always created as drafts; validate first.</p>
        <label className="wide">JSON file<input type="file" accept="application/json,.json" onChange={(e) => load(e.target.files?.[0])} /></label>
        {err && <p className="wide cm-note danger">{err}</p>}
        <label>Source name (required)<input name="sname" required maxLength={120} /></label>
        <label>Source URL<input name="surl" type="url" /></label>
        <label>Year<input name="year" type="number" min={1950} max={2100} /></label>
        <label>Copyright status<select name="license" defaultValue="original">{["original", "licensed", "public-domain"].map((l) => <option key={l}>{l}</option>)}</select></label>
        <label>Topic (optional)<select name="topicId"><option value="">None</option>{topics.map((t) => <option key={t._id} value={t._id}>{t.title}</option>)}</select></label>
        <div className="queue-actions"><button className="button secondary" disabled={!rows.length}>Validate {rows.length ? `${rows.length} rows` : ""}</button>
          <button type="button" className="button" disabled={!rows.length || !report?.dryRun || !report.summary?.ok} onClick={(e) => run(false, e.currentTarget.form!)}>Import {report?.summary?.ok ?? 0} valid as drafts</button></div>
      </form>
      {report && <div className="weekly-card"><strong>{report.dryRun ? "Validation" : `Imported ${report.created}`}: {report.summary.ok} ok · {report.summary.duplicate} duplicate · {report.summary.invalid} invalid</strong>
        <ul className="pr-report">{report.report.filter((r: Json) => r.status !== "ok").slice(0, 100).map((r: Json) => <li key={r.row}>Row {r.row}: {r.status} — {r.error}</li>)}</ul></div>}
    </>
  );
}

function Templates({ examKey, act }: { examKey: string; act: Act }) {
  const q = useQuery<Json>({ queryKey: ["padmin", "templates", examKey], queryFn: () => getJson(`${api}?view=templates&examKey=${examKey}`) });
  const [sections, setSections] = useState([{ name: "Section 1", count: 10, marks: 1, negative: 0.25 }]);
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); const f = new FormData(e.currentTarget);
    await act("template-save", { examKey, title: f.get("title"), kind: f.get("kind"), durationMinutes: Number(f.get("duration")), patternVersion: f.get("pv") || "", instructions: f.get("instr") || "", sections }, "Template saved as draft.");
  }
  const upd = (i: number, k: string, v: string) => setSections((s) => s.map((x, j) => (j === i ? { ...x, [k]: k === "name" ? v : Number(v) } : x)));
  return (
    <>
      <form className="mt-form" onSubmit={save}>
        <label>Title<input name="title" required minLength={3} maxLength={100} /></label>
        <label>Type<select name="kind"><option value="full">Full-length</option><option value="sectional">Sectional</option><option value="topic">Topic-wise</option></select></label>
        <label>Duration (minutes)<input name="duration" type="number" min={3} max={360} required defaultValue={60} /></label>
        <label>Pattern version<input name="pv" maxLength={40} placeholder="e.g. 2026 Tier-I" /></label>
        <label className="wide">Instructions<input name="instr" maxLength={800} /></label>
        {sections.map((s, i) => <fieldset className="wide pr-section" key={i}><legend>Section {i + 1}</legend>
          <label>Name<input value={s.name} onChange={(e) => upd(i, "name", e.target.value)} required /></label>
          <label>Questions<input type="number" min={1} max={200} value={s.count} onChange={(e) => upd(i, "count", e.target.value)} /></label>
          <label>Marks each<input type="number" step="0.25" min={0.25} value={s.marks} onChange={(e) => upd(i, "marks", e.target.value)} /></label>
          <label>Negative marks<input type="number" step="0.25" min={0} value={s.negative} onChange={(e) => upd(i, "negative", e.target.value)} /></label>
          {sections.length > 1 && <button type="button" className="mt-toggle" onClick={() => setSections(sections.filter((_, j) => j !== i))}>Remove</button>}</fieldset>)}
        <div className="queue-actions"><button type="button" className="button secondary" onClick={() => setSections([...sections, { name: `Section ${sections.length + 1}`, count: 10, marks: 1, negative: 0.25 }])}>Add section</button><button className="button">Save template</button></div>
      </form>
      <div className="mt-list">{(q.data?.items ?? []).map((t: Json) => (
        <article className="mt-card" key={t._id}><div className="mt-card-head"><div><h3>{t.title}</h3><p>{t.kind} · {t.durationMinutes} min · {t.sections.map((s: Json) => `${s.name} ${s.count}q (+${s.marks}/−${s.negative})`).join(", ")}</p></div><span className="mt-pill">{t.status}</span></div>
          <div className="queue-actions">{t.status !== "published" && <button className="button" onClick={() => act("template-status", { id: t._id, status: "published" }, "Published.")}>Publish</button>}{t.status === "published" && <button className="button secondary" onClick={() => act("template-status", { id: t._id, status: "draft" }, "Unpublished.")}>Unpublish</button>}{t.status !== "archived" && <button className="button secondary" onClick={() => act("template-status", { id: t._id, status: "archived" }, "Archived.")}>Archive</button>}</div></article>))}</div>
    </>
  );
}

function Dates({ examKey, act }: { examKey: string; act: Act }) {
  const q = useQuery<Json>({ queryKey: ["padmin", "dates", examKey], queryFn: () => getJson(`${api}?view=dates&examKey=${examKey}`) });
  return (
    <>
      <form className="mt-form" onSubmit={async (e) => { e.preventDefault(); const f = new FormData(e.currentTarget); const form = e.currentTarget; const ok = await act("date-save", { examKey, title: f.get("title"), date: new Date(String(f.get("date"))).toISOString(), sourceName: f.get("sname"), sourceUrl: f.get("surl"), lastVerifiedAt: new Date(String(f.get("verified"))).toISOString() }, "Date saved."); if (ok) form.reset(); }}>
        <p className="wide cm-note">Only enter dates you have confirmed from an official notice. The source link and verification date are required and shown to students.</p>
        <label>Event<input name="title" required maxLength={120} placeholder="Tier-I examination" /></label>
        <label>Date<input name="date" type="date" required /></label>
        <label>Source name<input name="sname" required maxLength={120} /></label>
        <label>Official source URL<input name="surl" type="url" required /></label>
        <label>Last verified on<input name="verified" type="date" required max={new Date().toISOString().slice(0, 10)} /></label>
        <button className="button">Add date</button>
      </form>
      <div className="mt-list">{(q.data?.items ?? []).map((d: Json) => <article className="queue-card" key={d._id}><div><span><strong>{d.title}</strong><small>{fmtDate(d.date)} · <a href={d.sourceUrl} target="_blank" rel="noopener noreferrer">{d.sourceName}</a> · verified {fmtDate(d.lastVerifiedAt)}</small></span></div><button className="button secondary" onClick={() => act("date-delete", { id: d._id }, "Removed.")}>Remove</button></article>)}</div>
    </>
  );
}

function CatalogMeta({ exams, act }: { exams: Json[]; act: Act }) {
  return (
    <div className="mt-list">{exams.map((x) => (
      <form className="mt-form" key={x.key} onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); const v = String(f.get("verified") || ""); act("catalog-meta", { key: x.key, syllabusVersion: f.get("version") || "", syllabusSource: f.get("source") || "", syllabusVerifiedAt: v ? new Date(v).toISOString() : undefined }, "Syllabus version saved."); }}>
        <strong className="wide">{x.title}</strong>
        <label>Syllabus version<input name="version" maxLength={40} defaultValue={x.syllabusVersion} /></label>
        <label>Source<input name="source" maxLength={300} defaultValue={x.syllabusSource} /></label>
        <label>Verified on<input name="verified" type="date" defaultValue={x.syllabusVerifiedAt ? String(x.syllabusVerifiedAt).slice(0, 10) : ""} /></label>
        <button className="button secondary">Save</button></form>))}</div>
  );
}
