"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type FormEvent } from "react";
import {
  BellRing, BookOpenCheck, CalendarClock, Check, ChevronRight, Clock3,
  Copy, Download, Flower2, LockKeyhole, Map as MapIcon, Play, Plus, RefreshCw, Share2,
  ShieldCheck, Sparkles, Sprout, Swords, Trophy, UserPlus, Users,
} from "lucide-react";

type Item = { _id?: string; [key: string]: unknown };
type P2Data = {
  exams?: Item[]; selectedExam?: Item; syllabus?: Item[]; progress?: Item[]; plan?: Item;
  tasks?: Item[]; attempts?: Item[]; revisions?: Item[]; garden?: Item; gardenRecord?: Item;
  friendships?: Item[]; challenges?: Item[]; rooms?: Item[]; feedback?: Item[];
  events?: Item[]; registrations?: Item[]; questions?: Item[]; aiAvailable?: boolean; serverNow?: string;
};
const txt = (value: unknown, fallback = "") => typeof value === "string" ? value : fallback;
const num = (value: unknown, fallback = 0) => typeof value === "number" ? value : fallback;
const id = (item?: Item) => txt(item?._id);
const dateLabel = (value: unknown) => value ? new Date(String(value)).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "—";
const inputDate = (days = 90) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);

const demo: P2Data = {
  serverNow: "2026-10-16T12:00:00.000Z",
  exams: ["SSC", "Banking", "Railway", "UPSC", "NEET"].map((title) => ({ _id: title, key: title.toLowerCase(), title })),
  selectedExam: { examKey: "upsc", examDate: inputDate(142), weeklyMinutes: 720 },
  syllabus: [
    { _id: "s1", type: "subject", title: "General Studies", order: 1 },
    { _id: "c1", parentId: "s1", type: "chapter", title: "Indian Polity", order: 1 },
    { _id: "t1", parentId: "c1", type: "topic", title: "Fundamental Rights", estimatedMinutes: 90 },
    { _id: "t2", parentId: "c1", type: "topic", title: "Parliament", estimatedMinutes: 120 },
    { _id: "s2", type: "subject", title: "Environment", order: 2 },
    { _id: "t3", parentId: "s2", type: "topic", title: "Biodiversity", estimatedMinutes: 80 },
  ],
  progress: [{ topicId: "t1", status: "completed", mastery: 72 }],
  tasks: [
    { _id: "p1", title: "Parliament · part 1", kind: "study", scheduledFor: new Date().toISOString(), durationMinutes: 50, status: "pending" },
    { _id: "p2", title: "Recall · Fundamental Rights", kind: "revision", scheduledFor: new Date().toISOString(), durationMinutes: 20, status: "pending" },
  ],
  attempts: [{ _id: "a1", accuracy: 80, score: 8, xpGranted: 30, submittedAt: new Date().toISOString() }],
  revisions: [{ _id: "r1", topicId: "t1", nextDueAt: new Date().toISOString(), intervalIndex: 2 }],
  garden: { points: 365, progress: 3, stage: { key: "bloom", label: "Bloom" }, unlockedPlants: [{ key: "fern", name: "Focus Fern" }, { key: "lavender", name: "Recall Lavender" }] },
  gardenRecord: { activePlantKey: "lavender" },
  friendships: [], challenges: [], rooms: [], feedback: [], registrations: [],
  events: [{ _id: "e1", type: "workshop", title: "Memory systems workshop", description: "Build a revision loop that lasts.", startsAt: new Date(Date.now() + 86400000).toISOString(), capacity: 30 }],
};

export function Phase2Experience({ path, preview, userName, notify }: { path: string; preview: boolean; userName?: string; notify: (message: string) => void }) {
  const queryClient = useQueryClient();
  const { data = demo, isLoading } = useQuery<P2Data>({
    queryKey: ["phase2"],
    queryFn: async () => { const response = await fetch("/api/phase2"); if (!response.ok) throw new Error("Learning workspace could not load"); return response.json(); },
    enabled: !preview,
    initialData: preview ? demo : undefined,
  });
  const [activeQuiz, setActiveQuiz] = useState<Item | null>(null);
  const [quizResult, setQuizResult] = useState<Item | null>(null);

  async function act(action: string, value: unknown = {}) {
    if (preview) { notify("Preview mode keeps your sample data unchanged."); return { ok: true, record: null }; }
    const response = await fetch("/api/phase2", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, data: value }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Unable to save");
    await queryClient.invalidateQueries({ queryKey: ["phase2"] });
    return result;
  }
  async function safely(action: string, value: unknown, success: string) {
    try { const result = await act(action, value); notify(success); return result; } catch (error) { notify(error instanceof Error ? error.message : "Unable to save"); }
  }

  if (isLoading) return <div className="p2-skeleton" aria-label="Loading learning workspace" />;
  const props = { data, act, safely, preview, notify, activeQuiz, setActiveQuiz, quizResult, setQuizResult, userName };
  if (path === "/app/roadmap") return <Roadmap {...props} />;
  if (path === "/app/planner") return <Planner {...props} />;
  if (path === "/app/quiz") return <QuizArena {...props} />;
  if (path === "/app/revisions") return <Revisions {...props} />;
  if (path === "/app/garden") return <Garden {...props} />;
  if (path === "/app/friends") return <Community {...props} />;
  if (path === "/app/share") return <AchievementCard {...props} />;
  if (path === "/app/rooms") return <Rooms {...props} />;
  if (path === "/app/events") return <EventsAndFeedback {...props} />;
  if (path === "/owner/feedback") return <OwnerFeedback {...props} />;
  if (path === "/owner/events") return <OwnerEvents {...props} />;
  if (path === "/super-admin/syllabus") return <SyllabusAdmin {...props} />;
  if (path === "/super-admin/questions") return <QuestionAdmin {...props} />;
  return null;
}

type ViewProps = {
  data: P2Data; preview: boolean; userName?: string; notify: (message: string) => void;
  act: (action: string, value?: unknown) => Promise<{ ok: boolean; record: Item | null }>;
  safely: (action: string, value: unknown, success: string) => Promise<{ ok: boolean; record: Item | null } | undefined>;
  activeQuiz: Item | null; setActiveQuiz: (value: Item | null) => void; quizResult: Item | null; setQuizResult: (value: Item | null) => void;
};

function Heading({ eyebrow, title, copy, action }: { eyebrow: string; title: string; copy: string; action?: React.ReactNode }) {
  return <header className="p2-heading"><div><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p>{copy}</p></div>{action}</header>;
}

function Roadmap({ data, safely }: ViewProps) {
  const selected = data.selectedExam;
  const [exam, setExam] = useState(txt(selected?.examKey, "ssc"));
  const [customExam, setCustomExam] = useState(txt(selected?.customExam));
  const [examDate, setExamDate] = useState(selected?.examDate ? new Date(String(selected.examDate)).toISOString().slice(0, 10) : inputDate());
  const [weeklyMinutes, setWeeklyMinutes] = useState(num(selected?.weeklyMinutes, 720));
  const [weakTopics, setWeakTopics] = useState<string[]>(() => ((selected?.weakTopicIds as unknown[] | undefined) || []).map(String));
  const progress = new Map((data.progress || []).map((item) => [txt(item.topicId), item]));
  const days = Math.max(0, Math.ceil((new Date(examDate).getTime() - new Date(txt(data.serverNow, "2026-10-16T12:00:00.000Z")).getTime()) / 86400000));
  const subjects = (data.syllabus || []).filter((item) => item.type === "subject");
  const topics = (data.syllabus || []).filter((item) => item.type === "topic");
  async function save(event: FormEvent) { event.preventDefault(); await safely("exam-save", { examKey: exam, customExam: exam === "custom" ? customExam : "", examDate: new Date(`${examDate}T12:00:00.000Z`).toISOString(), weeklyMinutes, subjectIds: subjects.map(id), weakTopicIds: weakTopics }, "Your expedition is ready."); }
  return <>
    <Heading eyebrow="Exam expedition" title="Your path, one checkpoint at a time." copy="Choose the summit, map the syllabus and turn every completed topic into visible progress." action={<div className="countdown"><strong>{days}</strong><span>days to go</span></div>} />
    <form className="p2-card exam-bar" onSubmit={save}><label>Exam<select value={exam} onChange={(event) => { setExam(event.target.value); setWeakTopics([]); }}>{(data.exams?.length ? data.exams : demo.exams || []).map((item) => <option key={id(item) || txt(item.key)} value={txt(item.key)}>{txt(item.title)}</option>)}<option value="custom">Custom exam</option></select></label>{exam === "custom" && <label>Custom exam name<input value={customExam} onChange={(event) => setCustomExam(event.target.value)} maxLength={100} required /></label>}<label>Exam date<input type="date" min={inputDate(1)} value={examDate} onChange={(event) => setExamDate(event.target.value)} required /></label><label>Weekly target<input type="number" min="60" max="5040" step="30" value={weeklyMinutes} onChange={(event) => setWeeklyMinutes(Number(event.target.value))} required /><span>{Math.round(weeklyMinutes / 60)} focused hours</span></label><button className="button" type="submit">Save target</button></form>
    {!!topics.length && <section className="weak-targets"><span>Prioritize weak topics</span>{topics.map((topic) => <label key={id(topic)} className={weakTopics.includes(id(topic)) ? "active" : ""}><input type="checkbox" checked={weakTopics.includes(id(topic))} onChange={() => setWeakTopics((current) => current.includes(id(topic)) ? current.filter((value) => value !== id(topic)) : [...current, id(topic)])} />{txt(topic.title)}</label>)}</section>}
    <section className="adventure-map" aria-label="Syllabus adventure map">
      <div className="map-trail" />
      {topics.map((topic, index) => {
        const itemProgress = progress.get(id(topic)); const complete = itemProgress?.status === "completed";
        return <article className={`map-stop ${complete ? "complete" : ""}`} key={id(topic)} style={{ "--stop": index } as React.CSSProperties}><button aria-label={`${txt(topic.title)}: ${complete ? "completed" : "not completed"}`} onClick={() => safely("topic-progress", { topicId: id(topic), status: complete ? "studying" : "completed" }, complete ? "Topic reopened." : "Checkpoint complete. Revision scheduled.")}>{complete ? <Check /> : <span>{index + 1}</span>}</button><div><small>Checkpoint {String(index + 1).padStart(2, "0")}</small><h3>{txt(topic.title)}</h3><p>{num(topic.estimatedMinutes, 50)} min quest · {num(itemProgress?.mastery)}% mastery</p></div></article>;
      })}
      {!(data.syllabus || []).some((item) => item.type === "topic") && <Empty icon={<MapIcon />} title="The trail is being mapped" copy="An administrator can add subjects, chapters and topics to this exam." />}
    </section>
  </>;
}

function Planner({ data, safely }: ViewProps) {
  const [minutes, setMinutes] = useState(90);
  const [editing, setEditing] = useState<Item | null>(null);
  const tasks = data.tasks || [];
  const grouped = Object.entries(tasks.reduce<Record<string, Item[]>>((all, task) => { const key = new Date(String(task.scheduledFor)).toISOString().slice(0, 10); (all[key] ||= []).push(task); return all; }, {}));
  return <>
    <Heading eyebrow="Smart planner" title="A schedule built for real weeks." copy="Study blocks fit your availability, weak topics lead, and revision and recovery are part of the plan." action={<button className="button" onClick={() => safely("plan-generate", { availability: { mon: minutes, tue: minutes, wed: minutes, thu: minutes, fri: minutes, sat: minutes * 2, sun: 0 }, preferAI: false }, "A fresh deterministic plan is ready.")}><Sparkles size={16} /> Generate plan</button>} />
    <div className="planner-controls p2-card"><label>Weekday availability <span>{minutes} min</span><input type="range" min="30" max="240" step="15" value={minutes} onChange={(event) => setMinutes(Number(event.target.value))} /></label><div><ShieldCheck /><span>Core planning always works without a paid AI service.</span></div></div>
    {grouped.length ? <div className="plan-grid">{grouped.slice(0, 14).map(([day, dayTasks]) => <section className="plan-day" key={day}><header><span>{new Date(`${day}T12:00:00`).toLocaleDateString("en-IN", { weekday: "short" })}</span><strong>{new Date(`${day}T12:00:00`).getDate()}</strong></header><div>{dayTasks.map((task) => <article className={`plan-task ${txt(task.status)}`} key={id(task)}><i className={`task-dot ${txt(task.kind)}`} /><div><small>{txt(task.kind)} · {num(task.durationMinutes)} min</small><strong>{txt(task.title)}</strong></div>{task.status === "pending" && <div className="task-actions"><button className="mini" aria-label="Edit task" onClick={() => setEditing(task)}>Edit</button><button className="mini" aria-label="Complete task" onClick={() => safely("plan-task", { id: id(task), status: "completed" }, "Study block completed.")}><Check size={14} /></button><button className="mini" aria-label="Reschedule missed task" onClick={() => safely("plan-task", { id: id(task), status: "missed" }, "Task moved to tomorrow.")}><RefreshCw size={14} /></button></div>}</article>)}</div></section>)}</div> : <Empty icon={<CalendarClock />} title="Your week is open" copy="Set your availability and generate a realistic plan." />}
    {editing && <div className="p2-modal" role="dialog" aria-modal="true"><form className="p2-card" onSubmit={async (event) => { event.preventDefault(); const form = new FormData(event.currentTarget); await safely("plan-edit", { id: id(editing), title: form.get("title"), scheduledFor: new Date(`${form.get("date")}T12:00:00.000Z`).toISOString(), durationMinutes: Number(form.get("duration")) }, "Task updated."); setEditing(null); }}><h2>Edit study block</h2><label>Title<input name="title" defaultValue={txt(editing.title)} required /></label><label>Date<input name="date" type="date" defaultValue={new Date(String(editing.scheduledFor)).toISOString().slice(0, 10)} required /></label><label>Minutes<input name="duration" type="number" min="10" max="360" defaultValue={num(editing.durationMinutes)} required /></label><div className="form-actions"><button type="button" className="button secondary" onClick={() => setEditing(null)}>Cancel</button><button className="button">Save</button></div></form></div>}
  </>;
}

function QuizArena({ data, act, notify, activeQuiz, setActiveQuiz, quizResult, setQuizResult }: ViewProps) {
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [remaining, setRemaining] = useState(0);
  const questions = (activeQuiz?.questions as Item[] | undefined) || [];
  useEffect(() => { if (!activeQuiz?.expiresAt) return; const update = () => setRemaining(Math.max(0, Math.floor((new Date(String(activeQuiz.expiresAt)).getTime() - Date.now()) / 1000))); update(); const timer = setInterval(update, 1000); return () => clearInterval(timer); }, [activeQuiz]);
  async function start() { try { const result = await act("quiz-start", { examKey: txt(data.selectedExam?.examKey, "ssc"), count: 5 }); setActiveQuiz(result.record); setQuizResult(null); setAnswers({}); } catch (error) { notify(error instanceof Error ? error.message : "Unable to start quiz"); } }
  async function submit() { try { const result = await act("quiz-submit", { attemptId: txt(activeQuiz?.attemptId), answers: Object.entries(answers).map(([questionId, selectedIndex]) => ({ questionId, selectedIndex })) }); setQuizResult(result.record); setActiveQuiz(null); notify("Quiz scored on the server."); } catch (error) { notify(error instanceof Error ? error.message : "Unable to score quiz"); } }
  if (quizResult) return <><Heading eyebrow="Arena results" title={`${num(quizResult.accuracy)}% accuracy`} copy={`${num(quizResult.correct)} of ${num(quizResult.total)} correct · ${num(quizResult.xpGranted)} new XP after repeat protection.`} action={<button className="button" onClick={() => setQuizResult(null)}>Back to arena</button>} /><div className="result-orbit"><div><Trophy /><strong>{num(quizResult.accuracy)}%</strong><span>accuracy</span></div></div><section className="p2-card"><h2>What to strengthen</h2>{((quizResult.topicBreakdown as Item[]) || []).map((topic) => <div className="result-row" key={txt(topic.topicId)}><span>{txt(topic.topicId, "General")}</span><strong>{num(topic.correct)}/{num(topic.total)}</strong></div>)}</section></>;
  if (activeQuiz) return <><Heading eyebrow="Live quiz" title="Trust your preparation." copy="Answers lock when you submit. Scores and XP are calculated on the server." action={<div className="quiz-clock"><Clock3 />{Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, "0")}</div>} /><div className="quiz-stack">{questions.map((question, index) => <fieldset className="p2-card question" key={id(question)}><legend><span>{index + 1}</span>{txt(question.prompt)}</legend>{(question.options as string[]).map((option, optionIndex) => <label className={answers[id(question)] === optionIndex ? "selected" : ""} key={option}><input type="radio" name={id(question)} checked={answers[id(question)] === optionIndex} onChange={() => setAnswers((all) => ({ ...all, [id(question)]: optionIndex }))} /><i>{String.fromCharCode(65 + optionIndex)}</i>{option}</label>)}</fieldset>)}</div><button className="button quiz-submit" disabled={Object.keys(answers).length !== questions.length || remaining === 0} onClick={submit}>Submit answers <ChevronRight size={16} /></button></>;
  return <><Heading eyebrow="Quiz arena" title="Practice under pressure. Learn without punishment." copy="Fresh questions earn XP once. Every result explains the answer and reveals topics to revisit." action={<button className="button" onClick={start}><Play size={16} /> Start timed quiz</button>} /><section className="arena-hero"><div className="arena-ring"><Swords /><span>READY</span></div><div><span className="eyebrow">Personal best</span><strong>{Math.max(0, ...(data.attempts || []).map((attempt) => num(attempt.accuracy)))}%</strong><p>Accuracy across your strongest attempt.</p></div></section><div className="p2-card history"><h2>Recent matches</h2>{(data.attempts || []).map((attempt) => <div className="result-row" key={id(attempt)}><span>{dateLabel(attempt.submittedAt)}</span><strong>{num(attempt.accuracy)}% · +{num(attempt.xpGranted)} XP</strong></div>)}</div></>;
}

function Revisions({ data, safely, notify }: ViewProps) {
  const topics = new Map((data.syllabus || []).map((item) => [id(item), txt(item.title)]));
  const due = (data.revisions || []).filter((item) => new Date(String(item.nextDueAt)) <= new Date());
  async function browserNotifications() { if (!("Notification" in window)) return notify("Browser notifications are not supported here."); const permission = await Notification.requestPermission(); notify(permission === "granted" ? "Revision reminders are enabled on this device." : "Notification permission was not enabled."); }
  return <><Heading eyebrow="Revision rhythm" title="Review just before memory fades." copy="Spaced intervals adapt to your confidence. Upcoming and due topics stay visible here and in your in-app notifications." action={<button className="button secondary" onClick={browserNotifications}><BellRing size={16} /> Enable browser reminders</button>} /><div className="revision-summary"><article><strong>{due.length}</strong><span>due now</span></article><article><strong>{(data.revisions || []).length - due.length}</strong><span>upcoming</span></article><article><strong>1·3·7·14</strong><span>day rhythm</span></article></div><div className="revision-list">{(data.revisions || []).map((revision) => <article className={`p2-card revision ${new Date(String(revision.nextDueAt)) <= new Date() ? "due" : ""}`} key={id(revision)}><div className="revision-icon"><BookOpenCheck /></div><div><small>{new Date(String(revision.nextDueAt)) <= new Date() ? "Due now" : `Due ${dateLabel(revision.nextDueAt)}`}</small><h3>{topics.get(txt(revision.topicId)) || "Study topic"}</h3><p>Interval {num(revision.intervalIndex) + 1} of 6</p></div><div className="confidence"><span>Recall confidence</span>{[1, 2, 3, 4, 5].map((value) => <button key={value} aria-label={`Confidence ${value}`} onClick={() => safely("revision-complete", { topicId: txt(revision.topicId), confidence: value }, "Next revision scheduled.")}>{value}</button>)}</div></article>)}</div></>;
}

function Garden({ data, safely }: ViewProps) {
  const state = data.garden || {}; const stage = state.stage as Item | undefined; const plants = (state.unlockedPlants as Item[] | undefined) || [];
  return <><Heading eyebrow="Study garden" title="Consistent effort grows here." copy="Validated focus, planning and quiz activity becomes growth. Completed milestones are permanent." action={<button className="button" onClick={() => safely("garden-refresh", {}, "Your garden is up to date.")}><RefreshCw size={16} /> Water with progress</button>} /><section className="garden-scene"><div className="sun-orbit" /><div className={`plant plant-${txt(stage?.key, "seed")}`} aria-label={`${txt(stage?.label, "Seed")} growth stage`}><span className="stem" /><i className="leaf left" /><i className="leaf right" /><i className="crown"><Flower2 /></i></div><div className="soil"><span /><span /><span /></div><div className="garden-caption"><small>Current stage</small><h2>{txt(stage?.label, "Seed")}</h2><p>{num(state.points)} lifetime growth points</p><div className="meter"><i style={{ width: `${num(state.progress)}%` }} /></div><span>{num(state.progress)}% to the next stage</span></div></section><section><Heading eyebrow="Plant cabinet" title="Your collection" copy="Choose any plant you have earned. Rarer species unlock as lifetime progress grows." /><div className="plant-grid">{plants.map((plant) => <button className={`plant-card ${data.gardenRecord?.activePlantKey === plant.key ? "active" : ""}`} key={txt(plant.key)} onClick={() => safely("garden-select", { plantKey: plant.key }, `${txt(plant.name)} is now growing.`)}><Sprout /><strong>{txt(plant.name)}</strong><span>{txt(plant.rarity)}</span></button>)}</div></section></>;
}

function Community({ data, safely }: ViewProps) {
  const [email, setEmail] = useState("");
  return <><Heading eyebrow="Private circle" title="Learn with people you choose." copy="Friendship is request-based. Challenges require opt-in, and exam scores stay private by default." /><div className="p2-columns"><section className="p2-card"><h2><UserPlus /> Add a study friend</h2><form className="inline-form" onSubmit={async (event) => { event.preventDefault(); await safely("friend-request", { email }, "Friend request sent privately."); setEmail(""); }}><input type="email" placeholder="friend@example.com" value={email} onChange={(event) => setEmail(event.target.value)} required /><button className="button">Send request</button></form><div className="privacy-note"><LockKeyhole /><span>Only accepted friends can invite you to a challenge.</span></div>{(data.friendships || []).map((friend) => <div className="friend-row" key={id(friend)}><div className="avatar small">F</div><span><strong>Study friend</strong><small>{txt(friend.status)}</small></span>{friend.status === "pending" && <button className="mini" onClick={() => safely("friend-respond", { id: id(friend), status: "accepted" }, "Friend request accepted.")}>Accept</button>}</div>)}</section><section className="p2-card"><h2><Trophy /> Weekly challenges</h2>{(data.challenges || []).map((challenge) => <article className="challenge" key={id(challenge)}><small>{txt(challenge.metric)} · ends {dateLabel(challenge.endsAt)}</small><h3>{txt(challenge.title)}</h3><strong>Target {num(challenge.target)}</strong><button className="button secondary" onClick={() => safely("challenge-join", { id: id(challenge) }, "You opted into the challenge.")}>Opt in</button></article>)}{!(data.challenges || []).length && <Empty icon={<Users />} title="A quiet circle" copy="Add a friend to begin a private weekly challenge." />}</section></div></>;
}

function AchievementCard({ data, userName, notify }: ViewProps) {
  const [nickname, setNickname] = useState("StudyQuest learner");
  const accuracy = Math.max(0, ...(data.attempts || []).map((attempt) => num(attempt.accuracy)));
  const points = num(data.garden?.points);
  function draw(): HTMLCanvasElement { const canvas = document.createElement("canvas"); canvas.width = 1200; canvas.height = 630; const context = canvas.getContext("2d")!; const gradient = context.createLinearGradient(0, 0, 1200, 630); gradient.addColorStop(0, "#10281f"); gradient.addColorStop(1, "#2d5c42"); context.fillStyle = gradient; context.fillRect(0, 0, 1200, 630); context.fillStyle = "#f4c86b"; context.beginPath(); context.arc(980, 110, 230, 0, Math.PI * 2); context.fill(); context.fillStyle = "#f6f1df"; context.font = "700 34px sans-serif"; context.fillText("✳ STUDYQUEST", 80, 90); context.font = "700 72px sans-serif"; context.fillText(nickname.slice(0, 28), 80, 220); context.font = "400 32px sans-serif"; context.fillStyle = "#c8dacd"; context.fillText("A growing record of focused learning", 80, 275); context.fillStyle = "#f6f1df"; context.font = "700 54px sans-serif"; context.fillText(`${points} growth`, 80, 420); context.fillText(`${accuracy}% best accuracy`, 500, 420); context.font = "400 25px sans-serif"; context.fillStyle = "#c8dacd"; context.fillText("Shared without email, exam score details or library information", 80, 545); return canvas; }
  async function blob() { return await new Promise<Blob>((resolve, reject) => draw().toBlob((value) => value ? resolve(value) : reject(new Error("Card unavailable")), "image/png")); }
  async function download() { const url = URL.createObjectURL(await blob()); const anchor = document.createElement("a"); anchor.href = url; anchor.download = "studyquest-achievement.png"; anchor.click(); URL.revokeObjectURL(url); notify("Achievement card downloaded."); }
  async function copy() { try { await navigator.clipboard.write([new ClipboardItem({ "image/png": await blob() })]); notify("Achievement image copied."); } catch { notify("Image copy is not supported by this browser."); } }
  async function share() { const file = new File([await blob()], "studyquest-achievement.png", { type: "image/png" }); if (navigator.canShare?.({ files: [file] })) await navigator.share({ title: "My StudyQuest milestone", files: [file] }); else await download(); }
  return <><Heading eyebrow="Achievement studio" title="Share the milestone, keep the details private." copy="Your card includes only the nickname, badge and milestones you choose." /><section className="share-layout"><div className="achievement-card"><div className="card-glow" /><span className="brand-mini">✳ STUDYQUEST</span><Trophy /><small>GROWING SCHOLAR</small><h2>{nickname}</h2><p>A focused learner building a lasting study rhythm.</p><div><strong>{points}<span>growth</span></strong><strong>{accuracy}%<span>best accuracy</span></strong></div><footer><ShieldCheck /> Private by default</footer></div><aside className="p2-card share-controls"><label>Public nickname<input value={nickname} maxLength={28} onChange={(event) => setNickname(event.target.value)} /></label><div className="privacy-note"><LockKeyhole /><span>Your account name ({userName || "private"}), email, exam details and library are excluded.</span></div><button className="button" onClick={share}><Share2 size={16} /> Share image</button><button className="button secondary" onClick={copy}><Copy size={16} /> Copy image</button><button className="button secondary" onClick={download}><Download size={16} /> Download PNG</button></aside></section></>;
}

function Rooms({ data, safely }: ViewProps) {
  const [code, setCode] = useState("");
  return <><Heading eyebrow="Focus rooms" title="Arrive together. Study quietly." copy="A shared goal and synchronized start create presence without cameras, microphones or personal details." /><div className="room-actions"><button className="button" onClick={() => safely("room-create", { title: "Quiet focus", goalMinutes: 50 }, "Private focus room created.")}><Plus size={16} /> Create 50-min room</button><form onSubmit={async (event) => { event.preventDefault(); await safely("room-join", { joinCode: code }, "Joined the room."); setCode(""); }}><input value={code} maxLength={6} placeholder="JOIN CODE" onChange={(event) => setCode(event.target.value.toUpperCase())} /><button className="button secondary">Join room</button></form></div><div className="rooms-grid">{(data.rooms || []).map((room) => <article className="focus-room" key={id(room)}><div className="room-pulse"><Users /></div><small>{txt(room.state)} · code {txt(room.joinCode)}</small><h2>{txt(room.title)}</h2><p>{num(room.goalMinutes)} minutes of private, shared focus.</p>{room.state === "waiting" ? <button className="button" onClick={() => safely("room-start", { id: id(room) }, "Room begins in five seconds.")}><Play size={15} /> Start together</button> : <button className="button" onClick={() => safely("room-complete", { id: id(room) }, "Focus session complete.")}><Check size={15} /> Finish my session</button>}</article>)}{!(data.rooms || []).length && <Empty icon={<Clock3 />} title="The room is quiet" copy="Create a room for friends or use it alone as a focused fallback." />}</div></>;
}

function EventsAndFeedback({ data, safely }: ViewProps) {
  return <><Heading eyebrow="Library life" title="Events and support, in one calm place." copy="Register for workshops and challenges, or track a private service request through resolution." /><div className="p2-columns"><section><h2 className="section-title">Upcoming events</h2>{(data.events || []).map((event) => <article className="p2-card event" key={id(event)}><span className="event-date"><strong>{new Date(String(event.startsAt)).getDate()}</strong>{new Date(String(event.startsAt)).toLocaleDateString("en-IN", { month: "short" })}</span><div><small>{txt(event.type)}</small><h3>{txt(event.title)}</h3><p>{txt(event.description)}</p></div><button className="button secondary" onClick={() => safely("event-register", { id: id(event) }, "Your place is reserved.")}>Register</button></article>)}</section><section className="p2-card"><h2 className="section-title">Tell the library team</h2><form className="stack-form" onSubmit={async (event) => { event.preventDefault(); const form = new FormData(event.currentTarget); await safely("feedback-create", { kind: form.get("kind"), category: form.get("category"), message: form.get("message") }, "Your request is now tracked."); event.currentTarget.reset(); }}><label>Type<select name="kind"><option value="feedback">Facility feedback</option><option value="complaint">Service complaint</option></select></label><label>Category<select name="category"><option value="facilities">Facilities</option><option value="noise">Noise</option><option value="cleanliness">Cleanliness</option><option value="staff">Staff</option><option value="service">Service</option><option value="other">Other</option></select></label><label>Message<textarea name="message" minLength={10} maxLength={1200} required /></label><button className="button">Submit privately</button></form>{(data.feedback || []).map((item) => <article className="feedback-history" key={id(item)}><span>{txt(item.status)}</span><p>{txt(item.message)}</p>{((item.responses as Item[]) || []).map((response, index) => <blockquote key={index}>{txt(response.message)}</blockquote>)}</article>)}</section></div></>;
}

function OwnerFeedback({ data, safely }: ViewProps) {
  return <><Heading eyebrow="Student care" title="Resolve concerns with a visible history." copy="Every response stays attached to the issue so students can follow its progress." /><div className="management-list">{(data.feedback || []).map((item) => <article className="p2-card" key={id(item)}><div className="record-head"><span className={`status ${txt(item.status)}`}>{txt(item.status)}</span><small>{txt(item.category)} · {dateLabel(item.createdAt)}</small></div><p>{txt(item.message)}</p><form className="inline-form" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); safely("feedback-respond", { id: id(item), message: form.get("message"), status: "resolved" }, "Response sent and issue resolved."); }}><input name="message" placeholder="Write a helpful response" minLength={2} maxLength={1200} required /><button className="button">Respond & resolve</button></form></article>)}</div></>;
}

function OwnerEvents({ data, safely }: ViewProps) {
  return <><Heading eyebrow="Events desk" title="Create moments that move learning forward." copy="Publish quizzes, workshops and study challenges, then manage registration and attendance." /><form className="p2-card event-builder" onSubmit={async (event) => { event.preventDefault(); const form = new FormData(event.currentTarget); const startsAt = new Date(String(form.get("startsAt"))); await safely("event-save", { type: form.get("type"), title: form.get("title"), description: form.get("description"), startsAt: startsAt.toISOString(), endsAt: new Date(startsAt.getTime() + 3600000).toISOString(), capacity: Number(form.get("capacity")), status: "published" }, "Event published to students."); event.currentTarget.reset(); }}><label>Event type<select name="type"><option value="workshop">Workshop</option><option value="quiz">Quiz</option><option value="study-challenge">Study challenge</option></select></label><label>Title<input name="title" minLength={3} maxLength={120} required /></label><label>Starts<input name="startsAt" type="datetime-local" required /></label><label>Capacity<input name="capacity" type="number" min="1" max="1000" defaultValue="30" required /></label><label className="wide">Description<textarea name="description" maxLength={1000} /></label><button className="button">Publish event</button></form><div className="management-list">{(data.events || []).map((event) => <article className="p2-card record-head" key={id(event)}><div><small>{txt(event.type)} · {dateLabel(event.startsAt)}</small><h3>{txt(event.title)}</h3></div><span className={`status ${txt(event.status)}`}>{txt(event.status)}</span></article>)}</div></>;
}

function SyllabusAdmin({ data, safely }: ViewProps) {
  return <><Heading eyebrow="Curriculum studio" title="Shape the exam adventure." copy="Manage ordered subjects, chapters and topics. Changes become available to students without exposing inactive content." /><AdminForm title="Add syllabus node" submit={async (form) => safely("syllabus-save", { examKey: form.get("examKey"), type: form.get("type"), title: form.get("title"), order: Number(form.get("order")), estimatedMinutes: Number(form.get("minutes")), parentId: form.get("parentId") || null }, "Syllabus node added.")} fields={<><label>Exam<select name="examKey">{(data.exams || []).map((exam) => <option key={id(exam) || txt(exam.key)} value={txt(exam.key)}>{txt(exam.title)}</option>)}</select></label><label>Level<select name="type"><option value="subject">Subject</option><option value="chapter">Chapter</option><option value="topic">Topic</option></select></label><label>Parent<select name="parentId"><option value="">None for subjects</option>{(data.syllabus || []).filter((node) => node.type !== "topic").map((node) => <option key={id(node)} value={id(node)}>{txt(node.examKey).toUpperCase()} · {txt(node.type)} · {txt(node.title)}</option>)}</select></label><label>Title<input name="title" required /></label><label>Order<input name="order" type="number" min="0" defaultValue="1" /></label><label>Study minutes<input name="minutes" type="number" min="10" defaultValue="50" /></label></>} /><div className="tree-list">{(data.syllabus || []).map((node) => <div className={`tree-node ${txt(node.type)}`} key={id(node)}><span>{txt(node.examKey).toUpperCase()} · {txt(node.type)}</span><strong>{txt(node.title)}</strong><small>{num(node.estimatedMinutes)} min</small></div>)}</div></>;
}

function QuestionAdmin({ data, safely }: ViewProps) {
  return <><Heading eyebrow="Question bank" title="Build fair, explainable practice." copy="Correct answers remain server-only during quizzes. Explanations appear after validated submission." /><AdminForm title="Add question" submit={async (form) => safely("question-save", { examKey: form.get("examKey"), prompt: form.get("prompt"), options: [form.get("a"), form.get("b"), form.get("c"), form.get("d")], correctIndex: Number(form.get("correctIndex")), explanation: form.get("explanation"), difficulty: form.get("difficulty") }, "Question added to the bank.")} fields={<><label>Exam<select name="examKey">{(data.exams || []).map((exam) => <option key={id(exam)} value={txt(exam.key)}>{txt(exam.title)}</option>)}</select></label><label>Difficulty<select name="difficulty"><option value="easy">Easy</option><option value="medium">Medium</option><option value="hard">Hard</option></select></label><label className="wide">Question<textarea name="prompt" minLength={10} required /></label>{["a", "b", "c", "d"].map((name, index) => <label key={name}>Option {String.fromCharCode(65 + index)}<input name={name} required /></label>)}<label>Correct option<select name="correctIndex"><option value="0">A</option><option value="1">B</option><option value="2">C</option><option value="3">D</option></select></label><label className="wide">Explanation<textarea name="explanation" minLength={5} required /></label></>} /><div className="management-list">{(data.questions || []).map((question) => <article className="p2-card" key={id(question)}><small>{txt(question.difficulty)} · {txt(question.examKey).toUpperCase()}</small><h3>{txt(question.prompt)}</h3><p>{txt(question.explanation)}</p></article>)}</div></>;
}

function AdminForm({ title, fields, submit }: { title: string; fields: React.ReactNode; submit: (form: FormData) => Promise<unknown> }) {
  return <form className="p2-card admin-form" onSubmit={async (event) => { event.preventDefault(); await submit(new FormData(event.currentTarget)); event.currentTarget.reset(); }}><h2>{title}</h2>{fields}<button className="button"><Plus size={15} /> Add</button></form>;
}

function Empty({ icon, title, copy }: { icon: React.ReactNode; title: string; copy: string }) {
  return <div className="p2-empty">{icon}<h3>{title}</h3><p>{copy}</p></div>;
}
