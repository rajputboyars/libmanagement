"use client";

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { BellRing, BrainCircuit, CalendarClock, Check, ChevronRight, Clock3, RefreshCw, Sparkles, Target, TrendingUp } from "lucide-react";

type TopicSignal = { id: string; title: string; subject: string; accuracy: number | null; recentAccuracy: number | null; repeatedMistakes: number; mastery: number; overdue: boolean; priority: number; reason: string };
type Recommendation = { topicId: string; title: string; reason: string; action: string; minutes: number; priority: number };
type Trend = { week: string; accuracy: number | null; questions: number; revisions: number };
type Revision = { _id: string; topicId: string; title: string; intervalIndex: number; nextDueAt: string; lastReviewedAt?: string; snoozeCount: number; due: boolean; historyCount: number };
type LearningData = {
  serverNow: string;
  examKey: string;
  intelligence: {
    metrics: { accuracy: number | null; answeredQuestions: number; weakTopicCount: number; dueNow: number; reviewedThisWeek: number };
    topics: TopicSignal[];
    weakTopics: TopicSignal[];
    recommendations: Recommendation[];
    trends: Trend[];
  };
  revisions: Revision[];
  reminders: Array<{ revisionId: string; title: string; message: string }>;
  latestSnapshot?: { week: string; generatedAt: string };
  weekly?: { summary: { observations: string[]; goals: { id: string; label: string; target: number; unit: string }[]; basis: string }; narrative: string; aiAvailable: boolean };
};

const demo: LearningData = {
  serverNow: "2026-10-16T12:00:00.000Z",
  examKey: "upsc",
  intelligence: {
    metrics: { accuracy: 68, answeredQuestions: 84, weakTopicCount: 3, dueNow: 2, reviewedThisWeek: 5 },
    topics: [
      { id: "t1", title: "Fundamental Rights", subject: "General Studies", accuracy: 52, recentAccuracy: 45, repeatedMistakes: 3, mastery: 58, overdue: true, priority: 86, reason: "3 recent quizzes contained mistakes" },
      { id: "t2", title: "Parliament", subject: "General Studies", accuracy: 64, recentAccuracy: 60, repeatedMistakes: 2, mastery: 66, overdue: false, priority: 63, reason: "2 recent quizzes contained mistakes" },
      { id: "t3", title: "Biodiversity", subject: "Environment", accuracy: 76, recentAccuracy: 76, repeatedMistakes: 1, mastery: 72, overdue: true, priority: 57, reason: "Revision is due" },
    ],
    weakTopics: [],
    recommendations: [
      { topicId: "t1", title: "Start with Fundamental Rights", reason: "3 recent quizzes contained mistakes", action: "Complete a focused revision", minutes: 20, priority: 86 },
      { topicId: "t2", title: "Reinforce Parliament", reason: "64% verified quiz accuracy", action: "Take a short topic quiz", minutes: 30, priority: 63 },
      { topicId: "t3", title: "Reinforce Biodiversity", reason: "Revision is due", action: "Complete a focused revision", minutes: 20, priority: 57 },
    ],
    trends: [
      { week: "08-31", accuracy: 55, questions: 14, revisions: 1 }, { week: "09-07", accuracy: 59, questions: 18, revisions: 2 },
      { week: "09-14", accuracy: 62, questions: 10, revisions: 3 }, { week: "09-21", accuracy: 61, questions: 16, revisions: 2 },
      { week: "09-28", accuracy: 66, questions: 8, revisions: 4 }, { week: "10-05", accuracy: 70, questions: 12, revisions: 4 },
      { week: "10-12", accuracy: 68, questions: 6, revisions: 5 }, { week: "10-19", accuracy: null, questions: 0, revisions: 0 },
    ],
  },
  revisions: [
    { _id: "r1", topicId: "t1", title: "Fundamental Rights", intervalIndex: 2, nextDueAt: "2026-10-16T08:00:00.000Z", snoozeCount: 0, due: true, historyCount: 2 },
    { _id: "r2", topicId: "t3", title: "Biodiversity", intervalIndex: 1, nextDueAt: "2026-10-16T11:00:00.000Z", snoozeCount: 1, due: true, historyCount: 1 },
    { _id: "r3", topicId: "t2", title: "Parliament", intervalIndex: 3, nextDueAt: "2026-10-20T09:00:00.000Z", snoozeCount: 0, due: false, historyCount: 3 },
  ],
  reminders: [
    { revisionId: "r1", title: "Fundamental Rights is ready to review", message: "A short recall session now will strengthen the next interval." },
    { revisionId: "r2", title: "Biodiversity is ready to review", message: "A short recall session now will strengthen the next interval." },
  ],
};

export function LearningIntelligence({ path, preview, notify }: { path: string; preview: boolean; notify: (message: string) => void }) {
  const queryClient = useQueryClient();
  const { data = demo, isLoading } = useQuery<LearningData>({
    queryKey: ["learning-intelligence"],
    queryFn: async () => { const response = await fetch("/api/learning"); if (!response.ok) throw new Error("Learning intelligence could not load"); return response.json(); },
    enabled: !preview,
    initialData: preview ? demo : undefined,
  });
  async function act(action: string, value: unknown = {}, message: string) {
    if (preview) return notify("Preview mode keeps sample learning data unchanged.");
    try {
      const response = await fetch("/api/learning", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, data: value }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Unable to save");
      await queryClient.invalidateQueries({ queryKey: ["learning-intelligence"] });
      notify(message);
    } catch (error) { notify(error instanceof Error ? error.message : "Unable to save"); }
  }
  if (isLoading) return <div className="learning-skeleton" aria-label="Loading learning intelligence" />;
  return path === "/app/revisions" ? <RevisionCenter data={data} act={act} /> : <IntelligenceDashboard data={data} act={act} />;
}

function IntelligenceDashboard({ data, act }: { data: LearningData; act: (action: string, value: unknown, message: string) => Promise<void> }) {
  const metrics = data.intelligence.metrics;
  return <>
    <header className="learning-heading"><div><span className="eyebrow">Learning intelligence</span><h1>See the signal behind your study time.</h1><p>Recommendations use verified quiz results, topic history and completed revisions. They never predict exam outcomes.</p></div><button className="button" onClick={() => act("insight-save", {}, "This week’s verified insight was saved.")}><Sparkles size={16} /> Save weekly insight</button></header>
    {data.weekly && <WeeklyCard weekly={data.weekly} />}
    <section className="learning-metrics" aria-label="Learning summary">
      <Metric icon={<Target />} label="Verified accuracy" value={metrics.accuracy === null ? "—" : `${metrics.accuracy}%`} note={`${metrics.answeredQuestions} scored answers`} />
      <Metric icon={<BrainCircuit />} label="Priority topics" value={String(metrics.weakTopicCount)} note="Evidence score 55+" />
      <Metric icon={<CalendarClock />} label="Due revisions" value={String(metrics.dueNow)} note="Ready for recall" />
      <Metric icon={<Check />} label="Reviewed this week" value={String(metrics.reviewedThisWeek)} note="Completed intervals" />
    </section>
    <section className="learning-grid">
      <article className="learning-panel trend-panel"><div className="panel-head"><div><span className="eyebrow">8-week trend</span><h2>Accuracy and revision rhythm</h2></div><TrendingUp /></div><div className="chart-wrap" aria-label="Weekly quiz accuracy trend"><ResponsiveContainer width="100%" height="100%"><AreaChart data={data.intelligence.trends}><defs><linearGradient id="accuracyFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#2e8661" stopOpacity={0.34} /><stop offset="100%" stopColor="#2e8661" stopOpacity={0.02} /></linearGradient></defs><CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#dbe4d9" /><XAxis dataKey="week" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} /><YAxis domain={[0, 100]} tick={{ fontSize: 10 }} axisLine={false} tickLine={false} /><Tooltip contentStyle={{ borderRadius: 12, border: "1px solid #dbe4d9", fontSize: 11 }} /><Area type="monotone" dataKey="accuracy" stroke="#287a59" strokeWidth={3} fill="url(#accuracyFill)" connectNulls={false} /></AreaChart></ResponsiveContainer></div><div className="mini-bars"><ResponsiveContainer width="100%" height="100%"><BarChart data={data.intelligence.trends}><XAxis dataKey="week" hide /><Tooltip contentStyle={{ borderRadius: 12, fontSize: 11 }} /><Bar dataKey="revisions" fill="#e0ae49" radius={[5, 5, 0, 0]} /></BarChart></ResponsiveContainer></div><small className="chart-note">Gold bars show completed revision sessions. Empty weeks remain empty rather than being estimated.</small></article>
      <article className="learning-panel recommendation-panel"><div className="panel-head"><div><span className="eyebrow">Next seven days</span><h2>Your evidence-led plan</h2></div><Sparkles /></div>{data.intelligence.recommendations.map((item, index) => <div className="recommendation" key={item.topicId}><span>{String(index + 1).padStart(2, "0")}</span><div><h3>{item.title}</h3><p>{item.reason}</p><small>{item.action} · {item.minutes} min</small></div><i style={{ height: `${Math.max(30, item.priority)}%` }} /></div>)}</article>
    </section>
    <section className="learning-panel"><div className="panel-head"><div><span className="eyebrow">Topic diagnostics</span><h2>What needs attention</h2></div><span className="verified-pill">Verified activity only</span></div><div className="topic-table" role="table"><div className="topic-row topic-head" role="row"><span>Topic</span><span>Recent accuracy</span><span>Mistakes</span><span>Priority</span></div>{data.intelligence.topics.slice(0, 8).map((topic) => <div className="topic-row" role="row" key={topic.id}><span><strong>{topic.title}</strong><small>{topic.subject} · {topic.reason}</small></span><span>{topic.recentAccuracy === null ? "No quiz data" : `${topic.recentAccuracy}%`}</span><span>{topic.repeatedMistakes}</span><span className="priority-cell"><i><b style={{ width: `${topic.priority}%` }} /></i><strong>{topic.priority}</strong></span></div>)}</div></section>
  </>;
}

function RevisionCenter({ data, act }: { data: LearningData; act: (action: string, value: unknown, message: string) => Promise<void> }) {
  const [rescheduling, setRescheduling] = useState<string | null>(null);
  const now = useMemo(() => new Date(data.serverNow), [data.serverNow]);
  const calendar = useMemo(() => Array.from({ length: 21 }, (_, index) => { const date = new Date(now); date.setDate(date.getDate() + index); const key = date.toISOString().slice(0, 10); return { date, key, count: data.revisions.filter((revision) => revision.nextDueAt.slice(0, 10) === key).length }; }), [data.revisions, now]);
  const due = data.revisions.filter((revision) => revision.due);
  const upcoming = data.revisions.filter((revision) => !revision.due);
  return <>
    <header className="learning-heading"><div><span className="eyebrow">Smart revision</span><h1>Return at the moment recall matters.</h1><p>Weak topics rise first. Snoozes are limited, manual dates are validated, and every completed review advances a proven interval.</p></div><div className="revision-badge"><BellRing /><strong>{due.length}</strong><span>due now</span></div></header>
    {!!data.reminders.length && <section className="reminder-strip" aria-label="Revision reminders"><BellRing /><div><strong>{data.reminders[0].title}</strong><p>{data.reminders.length > 1 ? `And ${data.reminders.length - 1} more due topic${data.reminders.length > 2 ? "s" : ""}.` : data.reminders[0].message}</p></div></section>}
    <section className="revision-calendar" aria-label="21-day revision calendar"><div className="calendar-head"><div><span className="eyebrow">21-day calendar</span><h2>Your recall horizon</h2></div><span>{due.length} due · {upcoming.length} upcoming</span></div><div className="calendar-days">{calendar.map((day) => <div className={day.key === data.serverNow.slice(0, 10) ? "today" : ""} key={day.key}><small>{day.date.toLocaleDateString("en-IN", { weekday: "short" })}</small><strong>{day.date.getDate()}</strong>{day.count ? <i aria-label={`${day.count} revisions`}>{day.count}</i> : <span />}</div>)}</div></section>
    <div className="revision-sections"><section><div className="section-label"><span>Due now</span><strong>{due.length}</strong></div>{due.map((revision) => <RevisionCard key={revision._id} revision={revision} rescheduling={rescheduling} setRescheduling={setRescheduling} act={act} />)}{!due.length && <div className="revision-empty"><Check /><h3>You’re caught up</h3><p>Upcoming intervals will appear below.</p></div>}</section><section><div className="section-label"><span>Coming up</span><strong>{upcoming.length}</strong></div>{upcoming.map((revision) => <RevisionCard key={revision._id} revision={revision} rescheduling={rescheduling} setRescheduling={setRescheduling} act={act} />)}</section></div>
  </>;
}

function RevisionCard({ revision, rescheduling, setRescheduling, act }: { revision: Revision; rescheduling: string | null; setRescheduling: (id: string | null) => void; act: (action: string, value: unknown, message: string) => Promise<void> }) {
  const [confidence, setConfidence] = useState(3);
  return <article className={`revision-card ${revision.due ? "due" : ""}`}><div className="revision-mark"><RefreshCw /></div><div className="revision-copy"><small>{revision.due ? "Ready now" : `Due ${new Date(revision.nextDueAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}`}</small><h3>{revision.title}</h3><p>Interval {revision.intervalIndex + 1} of 6 · {revision.historyCount} verified reviews</p><div className="confidence-picker"><span>Recall confidence</span>{[1, 2, 3, 4, 5].map((value) => <button className={confidence === value ? "active" : ""} aria-label={`Set recall confidence to ${value}`} onClick={() => setConfidence(value)} key={value}>{value}</button>)}</div></div><div className="revision-actions"><button className="button" onClick={() => act("revision-complete", { revisionId: revision._id, confidence }, "Revision completed and the next interval is scheduled.")}><Check size={15} /> Complete</button><div><button className="text-action" disabled={revision.snoozeCount >= 3} onClick={() => act("revision-snooze", { revisionId: revision._id, hours: 24 }, "Revision snoozed for 24 hours.")}><Clock3 size={14} /> Snooze 24h</button><button className="text-action" onClick={() => setRescheduling(rescheduling === revision._id ? null : revision._id)}><CalendarClock size={14} /> Reschedule</button></div>{rescheduling === revision._id && <form className="reschedule-form" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); const value = String(form.get("date")); act("revision-reschedule", { revisionId: revision._id, scheduledFor: new Date(`${value}T12:00:00.000Z`).toISOString() }, "Revision date updated."); setRescheduling(null); }}><input name="date" type="date" required /><button className="mini" aria-label="Save revision date"><ChevronRight size={16} /></button></form>}</div></article>;
}

function Metric({ icon, label, value, note }: { icon: React.ReactNode; label: string; value: string; note: string }) {
  return <article><div>{icon}<span>{label}</span></div><strong>{value}</strong><small>{note}</small></article>;
}

function WeeklyCard({ weekly }: { weekly: NonNullable<LearningData["weekly"]> }) {
  const queryClient = useQueryClient();
  const [text, setText] = useState(weekly.narrative);
  const [source, setSource] = useState<"deterministic" | "ai">("deterministic");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  async function call(action: string, data: unknown) {
    setBusy(true);
    try {
      const response = await fetch("/api/learning", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, data }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      return result;
    } catch (error) { setNote(error instanceof Error ? error.message : "Unable to update"); return null; } finally { setBusy(false); }
  }
  async function explain() {
    const result = await call("insight-narrative", {});
    if (!result) return;
    setText(result.narrative); setSource(result.source);
    setNote(result.fallback ? "AI wording was unavailable or did not pass checks, so the verified summary is shown." : "");
  }
  async function save() {
    const result = await call("insight-save", { narrative: text });
    if (result) { setNote("Weekly insight saved."); await queryClient.invalidateQueries({ queryKey: ["learning"] }); }
  }
  return <section className="weekly-card" aria-label="Weekly insight">
    <div className="section-label"><span>This week</span><small>{source === "ai" ? "AI-worded from your verified numbers · may be imperfect" : "Calculated from verified activity"}</small></div>
    <p className="weekly-text">{text}</p>
    <ul className="weekly-goals">{weekly.summary.goals.map((goal) => <li key={goal.id}><strong>{goal.target}</strong><span>{goal.label} ({goal.unit})</span></li>)}</ul>
    <div className="queue-actions">
      {weekly.aiAvailable && <button className="button secondary" disabled={busy} onClick={explain}>Reword with AI</button>}
      <button className="button" disabled={busy} onClick={save}>Save this week</button>
    </div>
    <small aria-live="polite">{note || "Suggestions only. Nothing here predicts exam results or selection chances."}</small>
  </section>;
}
