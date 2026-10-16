"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Bookmark, ChevronLeft, ChevronRight, Clock3, Flag, ListChecks, Sparkles, WifiOff } from "lucide-react";
import { fmtClock, getJson, pct, post, type Json } from "./prep-api";

type Q = { _id: string; prompt: string; options: string[]; section?: string; marks?: number; negative?: number };
type Answers = Record<string, { selectedIndex: number | null; flagged: boolean }>;

export function TestRunner({ id }: { id: string }) {
  const q = useQuery<Json>({ queryKey: ["prep-attempt", id], queryFn: () => getJson(`/api/prep?view=attempt&id=${id}`), refetchOnWindowFocus: false, staleTime: Infinity, retry: 1 });
  if (q.isLoading) return <div className="pr-runner"><div className="mt-skeleton" aria-busy="true" /></div>;
  if (q.isError || !q.data) return <div className="pr-runner pr-center"><AlertTriangle /><h1>Test could not load</h1><p>{q.error instanceof Error ? q.error.message : "Check your connection."}</p><button className="button" onClick={() => q.refetch()}>Try again</button><Link href="/app/prep">Back to Exam prep</Link></div>;
  if (q.data.finished) return <Finished id={id} />;
  return <Runner data={q.data} id={id} />;
}

function Finished({ id }: { id: string }) {
  useEffect(() => { window.location.replace(`/app/prep/result/${id}`); }, [id]);
  return <div className="pr-runner pr-center"><h1>Time is up</h1><p>Your answers were submitted automatically. Opening your result…</p></div>;
}

function Runner({ data, id }: { data: Json; id: string }) {
  const questions: Q[] = data.questions;
  const [answers, setAnswers] = useState<Answers>(data.answers);
  const [index, setIndex] = useState(0);
  const [nav, setNav] = useState(false);
  const [saveState, setSaveState] = useState<"saved" | "saving" | "offline">("saved");
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [remaining, setRemaining] = useState<number>(data.remainingMs);
  const syncedAt = useRef(0);
  const base = useRef<number>(data.remainingMs);
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  const dirty = useRef<Set<string>>(new Set());
  const submitted = useRef(false);
  const q = questions[index];

  const submit = useCallback(async () => {
    if (submitted.current) return;
    submitted.current = true; setBusy(true); setError("");
    try {
      await chain.current.catch(() => null);
      const payload = Object.entries(answers).map(([questionId, a]) => ({ questionId, selectedIndex: a.selectedIndex }));
      await post("/api/prep", "test-submit", { attemptId: id, answers: payload });
      window.location.replace(`/app/prep/result/${id}`);
    } catch (e) { submitted.current = false; setBusy(false); setError(e instanceof Error ? e.message : "Submission failed. Your answers are safe; try again."); }
  }, [answers, id]);

  useEffect(() => { syncedAt.current = performance.now(); }, []);
  // Server-derived countdown; local clock only interpolates between server syncs.
  useEffect(() => {
    const t = setInterval(() => { const left = base.current - (performance.now() - syncedAt.current); setRemaining(left); if (left <= 0) submit(); }, 500);
    return () => clearInterval(t);
  }, [submit]);

  const save = useCallback((questionId: string, patch: { selectedIndex?: number | null; flagged?: boolean }, viewing?: string) => {
    setSaveState("saving"); dirty.current.add(questionId);
    chain.current = chain.current.then(async () => {
      try {
        const r = await post("/api/prep", "answer-save", { attemptId: id, questionId, ...patch, viewing: viewing ?? questionId });
        if (r.finished) { window.location.replace(`/app/prep/result/${id}`); return; }
        base.current = r.remainingMs; syncedAt.current = performance.now(); dirty.current.delete(questionId); setSaveState(dirty.current.size ? "saving" : "saved");
      } catch { setSaveState("offline"); }
    });
  }, [id]);

  const retry = useCallback(() => { for (const qid of [...dirty.current]) { const a = answers[qid]; if (a) save(qid, { selectedIndex: a.selectedIndex, flagged: a.flagged }); } }, [answers, save]);
  useEffect(() => { window.addEventListener("online", retry); return () => window.removeEventListener("online", retry); }, [retry]);
  useEffect(() => { const onHide = () => { if (document.visibilityState === "visible") retry(); }; document.addEventListener("visibilitychange", onHide); return () => document.removeEventListener("visibilitychange", onHide); }, [retry]);
  useEffect(() => { const warn = (e: BeforeUnloadEvent) => { if (!submitted.current) e.preventDefault(); }; window.addEventListener("beforeunload", warn); return () => window.removeEventListener("beforeunload", warn); }, []);

  const choose = useCallback((optionIndex: number | null) => {
    if (!q) return;
    const current = answers[q._id] ?? { selectedIndex: null, flagged: false };
    const next = { ...current, selectedIndex: optionIndex };
    setAnswers((a) => ({ ...a, [q._id]: next })); save(q._id, { selectedIndex: optionIndex });
  }, [answers, q, save]);
  const flag = useCallback(() => {
    if (!q) return;
    const current = answers[q._id] ?? { selectedIndex: null, flagged: false };
    setAnswers((a) => ({ ...a, [q._id]: { ...current, flagged: !current.flagged } })); save(q._id, { flagged: !current.flagged });
  }, [answers, q, save]);
  const go = useCallback((i: number) => { const n = Math.min(Math.max(i, 0), questions.length - 1); setIndex(n); setNav(false); if (questions[n]) save(questions[index]?._id ?? questions[n]._id, {}, questions[n]._id); }, [index, questions, save]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (confirm || tag === "TEXTAREA" || tag === "INPUT" || e.ctrlKey || e.metaKey) return;
      const k = e.key.toLowerCase();
      if (k === "arrowright" || k === "n") go(index + 1);
      else if (k === "arrowleft" || k === "p") go(index - 1);
      else if (k === "f") flag();
      else if (k === "c") choose(null);
      else if (/^[1-6]$/.test(k) && q && Number(k) <= q.options.length) choose(Number(k) - 1);
      else if (/^[a-f]$/.test(k) && q && k.charCodeAt(0) - 97 < q.options.length) choose(k.charCodeAt(0) - 97);
    };
    window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey);
  }, [choose, flag, go, index, q, confirm]);

  const stats = useMemo(() => ({ answered: questions.filter((x) => answers[x._id]?.selectedIndex !== null && answers[x._id]?.selectedIndex !== undefined).length, flagged: questions.filter((x) => answers[x._id]?.flagged).length }), [answers, questions]);
  const low = remaining < 60000;
  if (!q) return <div className="pr-runner pr-center"><h1>No questions</h1><Link href="/app/prep">Back</Link></div>;
  const current = answers[q._id];
  const navigator = (
    <nav className="pr-nav" aria-label="Question navigator">
      {[...new Set(questions.map((x) => x.section))].map((section) => (
        <div key={section}><strong>{section}</strong>
          <div className="pr-grid">{questions.map((x, i) => x.section === section && (
            <button key={x._id} onClick={() => go(i)} aria-label={`Question ${i + 1}${answers[x._id]?.selectedIndex != null ? ", answered" : ""}${answers[x._id]?.flagged ? ", flagged" : ""}`} aria-current={i === index} className={`${i === index ? "cur" : ""} ${answers[x._id]?.selectedIndex != null ? "ans" : ""} ${answers[x._id]?.flagged ? "flag" : ""}`}>{i + 1}</button>
          ))}</div></div>
      ))}
      <p className="pr-legend"><span className="ans" /> Answered <span className="flag" /> Flagged <span /> Not visited/unanswered</p>
    </nav>
  );
  return (
    <div className="pr-runner" role="main">
      <header className="pr-bar">
        <div><strong>{data.title}</strong><small>Question {index + 1} of {questions.length} · {stats.answered} answered · {stats.flagged} flagged</small></div>
        <div className={`pr-timer ${low ? "low" : ""}`} role="timer" aria-live={low ? "assertive" : "off"}><Clock3 size={16} />{fmtClock(remaining)}</div>
        <button className="pr-navbtn" onClick={() => setNav(!nav)} aria-expanded={nav}><ListChecks size={18} /> Questions</button>
        <button className="button" onClick={() => setConfirm(true)} disabled={busy}>Submit</button>
      </header>
      <div className="pr-body">
        <section className="pr-q" aria-labelledby="qtext">
          <p className="pr-meta">{q.section} · +{q.marks}{q.negative ? ` / −${q.negative}` : ""}<span className={`pr-save ${saveState}`}>{saveState === "offline" ? <><WifiOff size={14} /> Not saved — retrying</> : saveState === "saving" ? "Saving…" : "Saved"}</span></p>
          <h1 id="qtext">{q.prompt}</h1>
          <div role="radiogroup" aria-labelledby="qtext" className="pr-options">
            {q.options.map((o, i) => (
              <button key={i} role="radio" aria-checked={current?.selectedIndex === i} className={current?.selectedIndex === i ? "sel" : ""} onClick={() => choose(current?.selectedIndex === i ? null : i)}><kbd>{String.fromCharCode(65 + i)}</kbd><span>{o}</span></button>
            ))}
          </div>
          <div className="pr-actions">
            <button className="button secondary" onClick={() => go(index - 1)} disabled={index === 0}><ChevronLeft size={16} /> Previous</button>
            <button className={`button secondary ${current?.flagged ? "on" : ""}`} onClick={flag} aria-pressed={!!current?.flagged}><Flag size={16} /> {current?.flagged ? "Unflag" : "Flag for review"}</button>
            <button className="button secondary" onClick={() => choose(null)} disabled={current?.selectedIndex == null}>Clear</button>
            <button className="button" onClick={() => go(index + 1)} disabled={index === questions.length - 1}>Next <ChevronRight size={16} /></button>
          </div>
          <p className="pr-hint">Keys: A–F or 1–6 choose · ←/→ move · F flag · C clear</p>
        </section>
        <aside className={`pr-side ${nav ? "open" : ""}`}>{navigator}</aside>
      </div>
      {error && <div className="pr-toast" role="alert">{error}</div>}
      {confirm && (
        <div className="library-modal" role="alertdialog" aria-modal="true" aria-label="Submit test"><div>
          <h2>Submit this test?</h2>
          <p>{stats.answered} of {questions.length} answered{stats.flagged ? `, ${stats.flagged} flagged` : ""}. {questions.length - stats.answered} unanswered question(s) score zero. You cannot change answers after submitting.</p>
          <div className="queue-actions"><button className="button" onClick={submit} disabled={busy} autoFocus>{busy ? "Submitting…" : "Submit now"}</button><button className="button secondary" onClick={() => setConfirm(false)}>Keep working</button></div>
        </div></div>
      )}
    </div>
  );
}

export function TestResult({ id }: { id: string }) {
  const q = useQuery<Json>({ queryKey: ["prep-result", id], queryFn: () => getJson(`/api/prep?view=result&id=${id}`), retry: 1 });
  const [filter, setFilter] = useState<"all" | "incorrect" | "unattempted" | "flagged">("all");
  const [notice, setNotice] = useState("");
  const [ai, setAi] = useState<Record<string, string>>({});
  if (q.isLoading) return <div className="pr-page"><div className="mt-skeleton" aria-busy="true" /></div>;
  if (q.isError || !q.data) return <div className="pr-page pr-center"><AlertTriangle /><h1>Result unavailable</h1><p>{q.error instanceof Error ? q.error.message : "Try again."}</p><Link href="/app/prep">Back to Exam prep</Link></div>;
  const d = q.data, s = d.summary;
  const rows: Json[] = d.review.filter((r: Json) => filter === "all" || (filter === "flagged" ? r.flagged : r.status === filter));
  async function card(questionId: string) { try { await post("/api/prep", "flash-create", { questionId }); setNotice("Added to your flashcards."); } catch (e) { setNotice(e instanceof Error ? e.message : "Unable to add"); } }
  async function simplify(questionId: string) { try { const r = await post("/api/prep", "ai-simplify", { questionId }); setAi((a) => ({ ...a, [questionId]: r.label + (r.text ? `\n${r.text}` : "") })); } catch (e) { setAi((a) => ({ ...a, [questionId]: e instanceof Error ? e.message : "Unavailable" })); } }
  return (
    <div className="pr-page">
      <header className="p2-heading"><div><span className="eyebrow">{d.autoSubmitted ? "Auto-submitted at time limit" : "Result"}</span><h1>{d.title}</h1><p>Scored on the server from your saved answers. {d.kind === "daily" || d.kind === "mini" ? "Practice sets are not ranked." : ""}</p></div><Link className="button secondary" href="/app/prep">Back to Exam prep</Link></header>
      <div className="mt-stats">
        <div><small>Score</small><strong>{s.score} / {s.maxScore}</strong></div>
        <div><small>Accuracy (attempted)</small><strong>{pct(s.accuracy)}</strong></div>
        <div><small>Correct · Wrong · Skipped</small><strong>{s.correct} · {s.incorrect} · {s.unattempted}</strong></div>
        <div><small>XP earned</small><strong>+{s.xpGranted}</strong></div>
      </div>
      {s.personalBest && <p className="cm-note">🏅 New personal best — previous best was {Math.round(s.previousBest)}%.</p>}
      <div className="cm-note">{d.standing?.comparable ? <>Position <strong>{d.standing.rank} of {d.standing.total}</strong> — {d.standing.note}</> : d.standing?.needed ? <>Relative rank unlocks when {d.standing.needed} students in your library have taken this test ({d.standing.have} so far). No national rank is shown.</> : "No relative rank for this attempt."}</div>
      <div className="queue-columns">
        <section><div className="section-label"><span>Sections</span></div>
          {s.sections.map((x: Json) => <article className="queue-card" key={x.key}><div><span><strong>{x.key}</strong><small>{x.correct} correct · {x.incorrect} wrong · {x.unattempted} skipped · {x.score} marks</small></span></div><div className="pr-bar-track"><i style={{ width: `${x.total ? (x.correct / x.total) * 100 : 0}%` }} /></div></article>)}
        </section>
        <section><div className="section-label"><span>Topics</span></div>
          {s.topics.map((x: Json) => <article className="queue-card" key={x.key}><div><span><strong>{x.title}</strong><small>{x.correct}/{x.total} correct{s.timeTracked && x.correct + x.incorrect ? ` · avg ${Math.round(x.timeMs / (x.correct + x.incorrect) / 1000)}s per answered question` : ""}</small></span></div><div className="pr-bar-track"><i style={{ width: `${x.total ? (x.correct / x.total) * 100 : 0}%` }} /></div></article>)}
        </section>
      </div>
      <div className="mt-filter" role="tablist" aria-label="Review filter">{(["all", "incorrect", "unattempted", "flagged"] as const).map((f) => <button key={f} role="tab" aria-selected={filter === f} className={filter === f ? "active" : ""} onClick={() => setFilter(f)}>{f}</button>)}</div>
      {notice && <p className="cm-note" role="status">{notice}</p>}
      <div className="mt-list">{rows.map((r) => (
        <article className={`mt-card pr-r-${r.status}`} key={r.questionId}>
          <div className="mt-card-head"><h3>{r.prompt}</h3><div className="mt-badges"><span className="mt-pill">{r.status}</span><span className="mt-pill">{r.delta > 0 ? "+" : ""}{r.delta}</span>{r.flagged && <span className="mt-pill p-high">flagged</span>}</div></div>
          <ol className="pr-review-options" type="A">{r.options.map((o: string, i: number) => <li key={i} className={`${i === r.correctIndex ? "right" : ""} ${i === r.selectedIndex && i !== r.correctIndex ? "wrong" : ""}`}>{o}{i === r.correctIndex ? " ✓ correct" : ""}{i === r.selectedIndex ? " — your answer" : ""}</li>)}</ol>
          <p className="mt-desc"><strong>Explanation:</strong> {r.explanation}</p>
          {ai[r.questionId] && <p className="cm-note" style={{ whiteSpace: "pre-line" }}><Sparkles size={14} /> {ai[r.questionId]}</p>}
          <div className="queue-actions">{r.status === "incorrect" && <button className="button secondary" onClick={() => card(r.questionId)}><Bookmark size={14} /> Make flashcard</button>}<button className="button secondary" onClick={() => simplify(r.questionId)}><Sparkles size={14} /> Explain simply (AI)</button></div>
        </article>))}
        {!rows.length && <div className="mt-empty"><h2>Nothing in this view</h2></div>}
      </div>
    </div>
  );
}
