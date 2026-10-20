"use client";

import { BrandLoader } from "@/components/brand-loader";
import Link from "next/link";
import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { BookOpen, CalendarDays, CheckCircle2, Layers, NotebookPen, Play, Target, Trophy, XCircle, Zap } from "lucide-react";
import { fmtDate, getJson, post, type Json } from "./prep-api";

const TABS = [["overview", "Overview"], ["tests", "Mock tests"], ["practice", "Daily practice"], ["analytics", "Analytics"], ["mistakes", "Mistakes"], ["flashcards", "Flashcards"], ["notes", "Notes"], ["journey", "Journey"]] as const;
type Tab = (typeof TABS)[number][0];

const Empty = ({ title, text, action }: { title: string; text: string; action?: ReactNode }) => <div className="mt-empty"><h2>{title}</h2><p>{text}</p>{action}</div>;
const Skeleton = () => <BrandLoader compact text="Loading…" />;
const Failed = ({ error, retry }: { error: unknown; retry: () => void }) => <div className="mt-empty"><h2>Could not load</h2><p>{error instanceof Error ? error.message : "Check your connection."}</p><button className="button" onClick={retry}>Try again</button></div>;

function useView(view: string, extra = "") {
  return useQuery<Json>({ queryKey: ["prep", view, extra], queryFn: () => getJson(`/api/prep?view=${view}${extra}`) });
}

export function ExamPrep({ notify, preview }: { notify: (m: string) => void; preview: boolean }) {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>("overview");
  const act = useCallback(async (action: string, data: unknown = {}, success?: string) => {
    try { const r = await post("/api/prep", action, data); await queryClient.invalidateQueries({ queryKey: ["prep"] }); if (success) notify(success); return r; }
    catch (e) { notify(e instanceof Error ? e.message : "Unable to update"); return null; }
  }, [notify, queryClient]);
  const start = useCallback(async (action: string, data: unknown = {}) => { const r = await act(action, data); if (r?.attemptId) window.location.assign(r.state === "submitted" ? `/app/prep/result/${r.attemptId}` : `/app/prep/test/${r.attemptId}`); }, [act]);
  if (preview) return <Empty title="Sign in to start preparing" text="Preview mode saves nothing, so tests and practice are disabled." />;
  return (
    <>
      <header className="p2-heading"><div><span className="eyebrow">Exam preparation</span><h1>Practise like it counts.</h1><p>Timed mock tests scored on the server, mistakes that turn into revision, and honest analytics. Ranks only appear in verified cohorts — never national ones.</p></div></header>
      <div className="mt-filter pr-tabs" role="tablist" aria-label="Exam prep sections">{TABS.map(([key, label]) => <button key={key} role="tab" aria-selected={tab === key} className={tab === key ? "active" : ""} onClick={() => setTab(key)}>{label}</button>)}</div>
      {tab === "overview" && <Overview go={setTab} start={start} />}
      {tab === "tests" && <Tests start={start} />}
      {tab === "practice" && <Practice start={start} />}
      {tab === "analytics" && <Analytics />}
      {tab === "mistakes" && <Mistakes act={act} />}
      {tab === "flashcards" && <Flashcards act={act} />}
      {tab === "notes" && <Notes act={act} />}
      {tab === "journey" && <Journey act={act} notify={notify} />}
    </>
  );
}

type Start = (action: string, data?: unknown) => Promise<void>;
type Act = (action: string, data?: unknown, success?: string) => Promise<Json | null>;

function Overview({ go, start }: { go: (t: Tab) => void; start: Start }) {
  const q = useView("overview");
  if (q.isLoading) return <Skeleton />;
  if (q.isError || !q.data) return <Failed error={q.error} retry={() => q.refetch()} />;
  const d = q.data;
  if (!d.exam) return <Empty title="Choose your exam first" text="Pick an exam and date on the roadmap page, then your tests and practice appear here." action={<Link className="button" href="/app/roadmap">Open roadmap</Link>} />;
  return (
    <>
      <div className="mt-stats">
        <div><small>Exam</small><strong>{String(d.exam.examKey).toUpperCase()}</strong></div>
        <div><small>Flashcards due</small><strong>{d.flashcardsDue}</strong></div>
        <div><small>Open mistakes</small><strong>{d.openMistakes}</strong></div>
        <div><small>Prep XP today</small><strong>{d.xpToday} / 60</strong></div>
      </div>
      {d.active.length > 0 && <div className="cm-note"><strong>In progress:</strong> {d.active.map((a: Json) => <Link key={a._id} href={`/app/prep/test/${a._id}`} className="pr-resume">{a.title} — resume</Link>)}</div>}
      <div className="queue-columns">
        <section>
          <div className="section-label"><span>Today</span></div>
          <article className="queue-card"><div><Zap /><span><strong>Daily practice</strong><small>{d.daily?.state === "submitted" ? `Done: ${d.daily.result?.correct ?? 0} correct (+${d.daily.result?.xpGranted ?? 0} XP)` : d.daily ? "In progress" : "A fresh set built from your weak topics"}</small></span></div><button className="button" onClick={() => start("daily-start")}>{d.daily?.state === "submitted" ? "View result" : d.daily ? "Resume" : "Start"}</button></article>
          {d.flashcardsDue > 0 && <article className="queue-card"><div><Layers /><span><strong>{d.flashcardsDue} flashcards due</strong><small>Short recall keeps mistakes from returning</small></span></div><button className="button secondary" onClick={() => go("flashcards")}>Review</button></article>}
          <div className="section-label"><span>Recent results</span></div>
          {d.recent.map((r: Json) => <Link className="queue-card" key={r._id} href={`/app/prep/result/${r._id}`}><div><Trophy /><span><strong>{r.title}</strong><small>{fmtDate(r.submittedAt)} · {r.result?.score}/{r.result?.maxScore} ({Math.round(r.result?.percent ?? 0)}%)</small></span></div></Link>)}
          {!d.recent.length && <Empty title="No attempts yet" text="Your results will appear here." />}
        </section>
        <section>
          <div className="section-label"><span>Official dates</span></div>
          {d.dates.map((x: Json) => <article className="queue-card" key={x._id}><div><CalendarDays /><span><strong>{x.title}</strong><small>{fmtDate(x.date)} · <a href={x.sourceUrl} target="_blank" rel="noopener noreferrer">{x.sourceName}</a> · checked {fmtDate(x.lastVerifiedAt)}</small>{x.status === "needs-reverification" && <small className="cm-note danger">Not re-checked recently — confirm on the official site.</small>}</span></div></article>)}
          {!d.dates.length && <Empty title="No official dates published" text="Dates only appear here when an administrator adds them with a source. Add your own exam date on the roadmap." />}
        </section>
      </div>
    </>
  );
}

function Tests({ start }: { start: Start }) {
  const q = useView("overview");
  if (q.isLoading) return <Skeleton />;
  if (q.isError || !q.data) return <Failed error={q.error} retry={() => q.refetch()} />;
  const t: Json[] = q.data.templates;
  if (!t.length) return <Empty title="No published tests yet" text="Tests appear once an administrator publishes them for your exam." />;
  return <div className="library-results">{t.map((x) => (
    <article className="library-result" key={x._id}><div className="library-copy"><small>{x.kind} · {x.patternVersion || "pattern not versioned"}</small><h2>{x.title}</h2>
      <div className="library-facts"><span>{x.questions} questions</span><span>{x.durationMinutes} min</span><span>{x.sections} section{x.sections === 1 ? "" : "s"}</span></div>
      <p>{x.instructions || "The timer runs on the server. You can resume after a refresh until time ends."}</p>
      <button className="button" onClick={() => start("test-start", { templateId: x._id })}><Play size={14} /> Start or resume</button></div></article>))}</div>;
}

function Practice({ start }: { start: Start }) {
  const overview = useView("overview");
  const topics = useView("topics");
  const [topic, setTopic] = useState("");
  const d = overview.data;
  return (
    <div className="queue-columns">
      <section><div className="section-label"><span>Daily practice</span></div>
        <article className="queue-card"><div><Zap /><span><strong>10 questions · 20 minutes</strong><small>Weak topics first. XP is awarded once per day, capped at 60 prep XP daily.</small></span></div><button className="button" onClick={() => start("daily-start")}>{d?.daily?.state === "submitted" ? "View today's result" : d?.daily ? "Resume" : "Start today's set"}</button></article>
      </section>
      <section><div className="section-label"><span>Topic mini challenge</span></div>
        <article className="queue-card"><div><Target /><span><strong>5 questions · 6 minutes</strong><small>Beat your personal best. First completion per topic per day earns XP.</small></span></div>
          <form className="queue-actions" onSubmit={(e) => { e.preventDefault(); if (topic) start("mini-start", { topicId: topic }); }}>
            <select value={topic} onChange={(e) => setTopic(e.target.value)} aria-label="Topic" required><option value="">Choose a topic…</option>{(topics.data?.topics ?? []).map((x: Json) => <option key={x._id} value={x._id}>{x.title}</option>)}</select>
            <button className="button">Start</button></form></article>
      </section>
    </div>
  );
}

function Analytics() {
  const q = useView("analytics");
  if (q.isLoading) return <Skeleton />;
  if (q.isError || !q.data) return <Failed error={q.error} retry={() => q.refetch()} />;
  const { history, topics } = q.data;
  if (!history.length) return <Empty title="No results to analyse" text="Finish a test or daily set to see progress, strengths and weak topics." />;
  const chart = history.map((h: Json) => ({ date: fmtDate(h.date), percent: Math.round(h.percent), title: h.title }));
  return (
    <>
      <div className="weekly-card"><div className="section-label"><span>Score trend (last {history.length})</span><small>Percent of maximum marks</small></div>
        <div style={{ height: 220 }}><ResponsiveContainer><AreaChart data={chart}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="date" tick={{ fontSize: 11 }} /><YAxis domain={[0, 100]} tick={{ fontSize: 11 }} width={32} /><Tooltip /><Area type="monotone" dataKey="percent" stroke="#20745b" fill="#20745b33" name="Score %" /></AreaChart></ResponsiveContainer></div></div>
      <div className="section-label"><span>Topic strength</span><small>Needs 5+ answered questions to classify</small></div>
      <div className="mt-list">{topics.map((t: Json) => (
        <article className="queue-card" key={t.topicId}><div><span><strong>{t.title}</strong><small>{t.correct}/{t.attempted} correct{t.avgSeconds ? ` · ~${t.avgSeconds}s per question` : ""}</small></span><span className={`mt-pill pr-s-${t.strength}`}>{t.strength}</span></div>
          <div className="pr-bar-track"><i style={{ width: `${t.accuracy ?? 0}%` }} /></div></article>))}</div>
    </>
  );
}

function Mistakes({ act }: { act: Act }) {
  const [status, setStatus] = useState<"open" | "understood">("open");
  const [topic, setTopic] = useState("");
  const q = useView("mistakes", `&status=${status}${topic ? `&topicId=${topic}` : ""}`);
  const [feedback, setFeedback] = useState<Record<string, Json>>({});
  if (q.isLoading) return <Skeleton />;
  if (q.isError || !q.data) return <Failed error={q.error} retry={() => q.refetch()} />;
  async function answer(questionId: string, selectedIndex: number | null) { const r = await act("mistake-answer", { questionId, selectedIndex }); if (r) setFeedback((f) => ({ ...f, [questionId]: { ...r, selectedIndex } })); }
  return (
    <>
      <div className="mt-filter"><button className={status === "open" ? "active" : ""} onClick={() => setStatus("open")}>To review</button><button className={status === "understood" ? "active" : ""} onClick={() => setStatus("understood")}>Understood</button>
        <select aria-label="Topic filter" value={topic} onChange={(e) => setTopic(e.target.value)} className="pr-select"><option value="">All topics</option>{q.data.topics.map((t: Json) => <option key={t._id} value={t._id}>{t.title}</option>)}</select></div>
      <div className="mt-list">{q.data.entries.map((e: Json) => {
        const f = feedback[e.questionId]; const question = e.question;
        return (
          <article className="mt-card" key={e._id}>
            <div className="mt-card-head"><div><h3>{question?.prompt ?? "Question no longer available"}</h3><p>{e.topicTitle} · missed {e.wrongCount}× · last {fmtDate(e.lastWrongAt)}</p></div></div>
            {question && <div className="pr-options compact">{question.options.map((o: string, i: number) => <button key={i} disabled={!!f} className={f ? (i === f.correctIndex ? "right" : i === f.selectedIndex ? "wrong" : "") : ""} onClick={() => answer(e.questionId, i)}><kbd>{String.fromCharCode(65 + i)}</kbd><span>{o}</span></button>)}</div>}
            {f && <p className="cm-note" role="status">{f.revealedOnly ? "" : f.correct ? "Correct this time. " : "Not yet. "}{f.explanation}</p>}
            <form className="queue-actions" onSubmit={(ev: FormEvent<HTMLFormElement>) => { ev.preventDefault(); act("mistake-update", { id: e._id, note: new FormData(ev.currentTarget).get("note") }, "Note saved."); }}>
              <input name="note" defaultValue={e.note} maxLength={600} placeholder="My note on this mistake" aria-label="Note" /><button className="button secondary">Save note</button></form>
            <div className="queue-actions">
              {!f && <button className="button secondary" onClick={() => answer(e.questionId, null)}>Show explanation</button>}
              <button className="button secondary" onClick={() => act("flash-create", { questionId: e.questionId }, "Added to flashcards.")}>Make flashcard</button>
              <button className="button" onClick={() => act("mistake-update", { id: e._id, status: status === "open" ? "understood" : "open" }, status === "open" ? "Marked understood." : "Moved back to review.")}>{status === "open" ? <><CheckCircle2 size={14} /> Understood</> : "Review again"}</button>
            </div>
            {e.retries?.length > 0 && <small>Retries: {e.retries.slice(-5).map((r: Json) => (r.correct ? "✓" : "✗")).join(" ")}</small>}
          </article>);
      })}</div>
      {!q.data.entries.length && <Empty title={status === "open" ? "No mistakes to review" : "Nothing marked understood yet"} text="Incorrect answers from tests and practice are collected here automatically." />}
    </>
  );
}

function Flashcards({ act }: { act: Act }) {
  const q = useView("flashcards");
  const [flipFor, setFlipFor] = useState("");
  const [adding, setAdding] = useState(false);
  const d = q.data;
  const card: Json | undefined = d?.cards[0];
  const flip = !!card && flipFor === String(card._id);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if ((e.target as HTMLElement).tagName === "INPUT" || (e.target as HTMLElement).tagName === "TEXTAREA" || !card) return; if (e.key === " ") { e.preventDefault(); setFlipFor((cur) => (cur === String(card._id) ? "" : String(card._id))); } else if (flip && /^[1-5]$/.test(e.key)) act("flash-review", { id: card._id, confidence: Number(e.key) }); };
    window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey);
  }, [card, flip, act]);
  if (q.isLoading) return <Skeleton />;
  if (q.isError || !d) return <Failed error={q.error} retry={() => q.refetch()} />;
  return (
    <>
      <div className="mt-stats"><div><small>Due now</small><strong>{d.due}</strong></div><div><small>Total cards</small><strong>{d.total}</strong></div><div><small>Overdue 3+ days</small><strong>{d.overdue}</strong></div></div>
      {d.reminder && <p className="cm-note" role="status">🔔 {d.reminder}</p>}
      <div className="queue-actions">
        {d.overdue > 0 && <button className="button secondary" onClick={() => act("flash-catchup", {}, "Missed reviews were spread over the coming days.")}>Reschedule missed cards</button>}
        {d.due > 0 && <button className="button secondary" onClick={() => act("flash-plan-sync", {}, "Added to today's study plan.")}>Add to today&apos;s plan</button>}
        <button className="button secondary" onClick={() => setAdding(!adding)}>{adding ? "Close" : "New card"}</button>
      </div>
      {adding && <form className="mt-form" onSubmit={async (e) => { e.preventDefault(); const f = new FormData(e.currentTarget); if (await act("flash-create", { front: f.get("front"), back: f.get("back") }, "Card added.")) { setAdding(false); } }}><label className="wide">Front<input name="front" required maxLength={400} /></label><label className="wide">Back<textarea name="back" required maxLength={800} /></label><button className="button">Save card</button></form>}
      {card ? (
        <div className="pr-flash">
          <button className={`pr-flip ${flip ? "on" : ""}`} onClick={() => setFlipFor(flip ? "" : String(card._id))} aria-label={flip ? "Showing answer. Press to show question" : "Showing question. Press to reveal answer"}>
            <span>{flip ? "Answer" : "Question"}</span><p>{flip ? card.back : card.front}</p><small>Space to flip</small></button>
          {flip ? <div className="pr-rate" role="group" aria-label="How well did you recall it?">{[["1", "Forgot"], ["2", "Hard"], ["3", "Okay"], ["4", "Good"], ["5", "Easy"]].map(([n, l]) => <button key={n} className="button secondary" onClick={() => act("flash-review", { id: card._id, confidence: Number(n) })}>{n} · {l}</button>)}</div> : <p className="pr-hint">Try to recall first, then flip.</p>}
          <button className="mt-toggle" onClick={() => act("flash-delete", { id: card._id }, "Card deleted.")}>Delete this card</button>
        </div>
      ) : <Empty title={d.total ? "All caught up" : "No flashcards yet"} text={d.total ? "Nothing is due. Come back tomorrow." : "Create cards from your mistakes or add your own."} />}
    </>
  );
}

function Notes({ act }: { act: Act }) {
  const [search, setSearch] = useState("");
  const [bm, setBm] = useState(false);
  const [editing, setEditing] = useState<Json | null>(null);
  const [debounced, setDebounced] = useState("");
  useEffect(() => { const t = setTimeout(() => setDebounced(search), 300); return () => clearTimeout(t); }, [search]);
  const q = useView("notes", `&q=${encodeURIComponent(debounced)}${bm ? "&bookmarked=1" : ""}`);
  const topics = useView("topics");
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); const f = new FormData(e.currentTarget);
    const ok = await act("note-save", { id: editing?._id, title: f.get("title"), body: f.get("body"), topicId: f.get("topicId") || undefined, tags: String(f.get("tags") || "").split(",").map((t) => t.trim()).filter(Boolean) }, "Note saved.");
    if (ok) setEditing(null);
  }
  return (
    <>
      <div className="mt-filter"><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search notes" aria-label="Search notes" className="pr-select" /><button className={bm ? "active" : ""} aria-pressed={bm} onClick={() => setBm(!bm)}>Bookmarked</button><button className="button" onClick={() => setEditing({})}><NotebookPen size={14} /> New note</button></div>
      <p className="pr-hint">Notes are private to you.</p>
      {editing && (
        <form className="mt-form" onSubmit={save} key={editing._id ?? "new"}>
          <label>Title<input name="title" required maxLength={120} defaultValue={editing.title} /></label>
          <label>Topic<select name="topicId" defaultValue={editing.topicId ?? ""}><option value="">No topic</option>{(topics.data?.topics ?? []).map((t: Json) => <option key={t._id} value={t._id}>{t.title}</option>)}</select></label>
          <label className="wide">Note<textarea name="body" maxLength={6000} defaultValue={editing.body} rows={6} /></label>
          <label className="wide">Tags (comma separated)<input name="tags" defaultValue={(editing.tags ?? []).join(", ")} /></label>
          <div className="queue-actions"><button className="button">Save</button><button type="button" className="button secondary" onClick={() => setEditing(null)}>Cancel</button></div>
        </form>)}
      {q.isLoading ? <Skeleton /> : q.isError || !q.data ? <Failed error={q.error} retry={() => q.refetch()} /> : (
        <div className="mt-list">{q.data.notes.map((n: Json) => (
          <article className="mt-card" key={n._id}>
            <div className="mt-card-head"><div><h3>{n.title}</h3><p>{n.topicTitle ?? "General"} · {fmtDate(n.updatedAt)}{n.tags?.length ? ` · ${n.tags.map((t: string) => `#${t}`).join(" ")}` : ""}</p></div></div>
            <p className="mt-desc" style={{ whiteSpace: "pre-wrap" }}>{n.body}</p>
            <div className="queue-actions"><button className="button secondary" aria-pressed={n.bookmarked} onClick={() => act("note-bookmark", { id: n._id, bookmarked: !n.bookmarked })}>{n.bookmarked ? "★ Bookmarked" : "☆ Bookmark"}</button><button className="button secondary" onClick={() => setEditing(n)}>Edit</button><button className="button secondary" onClick={() => { if (confirm("Delete this note?")) act("note-delete", { id: n._id }, "Note deleted."); }}><XCircle size={14} /> Delete</button></div>
          </article>))}
          {!q.data.notes.length && <Empty title="No notes found" text={debounced || bm ? "Try a different search." : "Capture formulas, shortcuts and ideas by topic."} />}</div>)}
    </>
  );
}

function Journey({ act, notify }: { act: Act; notify: (m: string) => void }) {
  const q = useView("journey");
  const [open, setOpen] = useState<string>("");
  if (q.isLoading) return <Skeleton />;
  if (q.isError || !q.data) return <Failed error={q.error} retry={() => q.refetch()} />;
  const d = q.data;
  if (!d.exam) return <Empty title="Choose your exam first" text="Your syllabus journey starts once you pick an exam." action={<Link className="button" href="/app/roadmap">Open roadmap</Link>} />;
  const toggleTopic = async (topicId: string, completed: boolean) => {
    try { await post("/api/phase2", "topic-progress", { topicId, status: completed ? "completed" : "not-started" }); } catch (e) { notify(e instanceof Error ? e.message : "Unable to update topic"); }
    q.refetch();
  };
  return (
    <>
      <div className="mt-stats"><div><small>Syllabus complete</small><strong>{d.overall}%</strong></div><div><small>Days to your exam date</small><strong>{d.daysToExam ?? "—"}</strong></div><div><small>Checkpoints reached</small><strong>{d.checkpoints.length}/4</strong></div></div>
      <div className="queue-columns">
        <section><div className="section-label"><span>Syllabus roadmap</span></div>
          {d.subjects.map((s: Json) => (
            <article className="queue-card" key={s._id}>
              <button className="pr-acc" aria-expanded={open === s._id} onClick={() => setOpen(open === s._id ? "" : s._id)}><BookOpen size={16} /><strong>{s.title}</strong><span>{s.percent}% · {s.done}/{s.total}</span></button>
              <div className="pr-bar-track"><i style={{ width: `${s.percent}%` }} /></div>
              {open === s._id && s.children.map((c: Json) => (
                <div key={c._id} className="pr-chapter"><strong>{c.title}</strong> <small>{c.percent}%</small>
                  {c.children.map((t: Json) => <label key={t._id} className="mt-check"><input type="checkbox" checked={t.status === "completed"} onChange={(e) => toggleTopic(t._id, e.target.checked)} />{t.title}{t.mockBest ? <small> · best mock {t.mockBest}%</small> : null}</label>)}</div>))}
            </article>))}
          {!d.subjects.length && <Empty title="No syllabus yet" text="An administrator has not added topics for this exam." />}
        </section>
        <section><div className="section-label"><span>My goals</span></div>
          <form className="queue-actions" onSubmit={async (e) => { e.preventDefault(); const f = new FormData(e.currentTarget); const date = String(f.get("date") || ""); const form = e.currentTarget; if (await act("goal-save", { title: f.get("title"), targetDate: date ? new Date(date).toISOString() : undefined }, "Goal added.")) form.reset(); }}>
            <input name="title" required minLength={2} maxLength={120} placeholder="Finish Algebra by 30 Nov" aria-label="Goal" /><input name="date" type="date" aria-label="Target date" /><button className="button">Add</button></form>
          {d.goals.map((g: Json) => <article className="queue-card" key={g._id}><label className="mt-check"><input type="checkbox" checked={g.done} onChange={(e) => act("goal-toggle", { id: g._id, done: e.target.checked })} /><span style={{ textDecoration: g.done ? "line-through" : "none" }}>{g.title}{g.targetDate ? ` · ${fmtDate(g.targetDate)}` : ""}</span></label><button className="mt-toggle" onClick={() => act("goal-delete", { id: g._id })}>Remove</button></article>)}
          <div className="section-label"><span>Official exam dates</span></div>
          {d.officialDates.map((x: Json) => <article className="queue-card" key={x._id}><div><CalendarDays /><span><strong>{x.title}</strong><small>{fmtDate(x.date)}{x.upcoming ? "" : " (past)"} · <a href={x.sourceUrl} target="_blank" rel="noopener noreferrer">{x.sourceName}</a> · verified {fmtDate(x.lastVerifiedAt)}</small>{x.status === "needs-reverification" && <small className="cm-note danger">Re-check on the official site.</small>}</span></div></article>)}
          {!d.officialDates.length && <Empty title="No sourced dates" text="Official dates are shown only when added with a source link and verification time." />}
        </section>
      </div>
    </>
  );
}
