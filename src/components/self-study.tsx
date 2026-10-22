"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Maximize2, Minimize2, Volume2, VolumeX } from "lucide-react";
import { BrandLoader } from "@/components/brand-loader";
import { StudentWeeklyReport } from "@/components/weekly-report";
import { getJson, post, type Json } from "./prep-api";
import { CHAPTER_STEPS, heatLevel } from "@/lib/self-study";

const API = "/api/self-study";
const hm = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`);
const STEP_LABEL: Record<(typeof CHAPTER_STEPS)[number], string> = { read: "Read", notes: "Notes", rev1: "Rev 1", rev2: "Rev 2", pyq: "PYQs" };
type Notify = { notify: (m: string) => void };

function useSelf<T = Json>(view: string, enabled = true) {
  return useQuery<T>({ queryKey: ["self-study", view], queryFn: () => getJson<T>(`${API}?view=${view}`), enabled, retry: false });
}
function useSave(notify: (m: string) => void) {
  const qc = useQueryClient();
  return async (action: string, data: unknown, ok?: string) => {
    try {
      await post(API, action, data);
      await qc.invalidateQueries({ queryKey: ["self-study"] });
      if (ok) notify(ok);
      return true;
    } catch (e) {
      notify((e as Error).message);
      return false;
    }
  };
}

/** Subject box for the focus room, suggesting the student's recent subjects. */
export function SubjectInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { data } = useSelf<{ recentSubjects?: string[] }>("insights");
  return (
    <label className="ss-subject">
      <span>Aaj kya padh rahe ho? (subject)</span>
      <input list="ss-subjects" maxLength={40} value={value} onChange={(e) => onChange(e.target.value)} placeholder="e.g. Polity, Maths" />
      <datalist id="ss-subjects">{(data?.recentSubjects ?? []).map((s) => <option key={s} value={s} />)}</datalist>
    </label>
  );
}

type Sound = "off" | "white" | "rain" | "brown";
/** Calm background noise made in the browser (no audio files). */
function startNoise(kind: Exclude<Sound, "off">) {
  const ctx = new AudioContext();
  const buffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  let last = 0;
  for (let i = 0; i < data.length; i++) {
    const white = Math.random() * 2 - 1;
    last = kind === "brown" ? (last + 0.02 * white) / 1.02 : white;
    data[i] = kind === "brown" ? last * 3.5 : white;
  }
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.loop = true;
  const gain = ctx.createGain();
  gain.gain.value = kind === "white" ? 0.05 : 0.15;
  if (kind === "rain") {
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 1200;
    src.connect(filter).connect(gain);
  } else src.connect(gain);
  gain.connect(ctx.destination);
  src.start();
  return () => void ctx.close();
}

/** Full-screen and sound buttons for the focus room. */
export function FocusTools() {
  const [sound, setSound] = useState<Sound>("off");
  const [full, setFull] = useState(false);
  const stop = useRef<(() => void) | null>(null);
  useEffect(() => {
    const onChange = () => setFull(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onChange);
    return () => {
      document.removeEventListener("fullscreenchange", onChange);
      stop.current?.();
    };
  }, []);
  function pickSound(next: Sound) {
    stop.current?.();
    stop.current = next === "off" ? null : startNoise(next);
    setSound(next);
  }
  function toggleFull() {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.querySelector<HTMLElement>(".focus-room")?.requestFullscreen?.();
  }
  return (
    <div className="ss-tools">
      <button type="button" className="button secondary" onClick={toggleFull}>
        {full ? <Minimize2 size={16} /> : <Maximize2 size={16} />} {full ? "Exit full screen" : "Full screen"}
      </button>
      <div role="group" aria-label="Calm sound" className="ss-sounds">
        {sound === "off" ? <VolumeX size={16} /> : <Volume2 size={16} />}
        {(["off", "rain", "white", "brown"] as Sound[]).map((s) => (
          <button key={s} type="button" aria-pressed={sound === s} onClick={() => pickSound(s)}>
            {s === "off" ? "Off" : s === "rain" ? "Rain" : s === "white" ? "White" : "Deep"}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Insights block on My progress: heatmap, subject time, focus quality, plans, energy. */
export function Insights() {
  const { data, isLoading, error } = useSelf("insights");
  if (isLoading) return <section className="card"><BrandLoader /></section>;
  if (error || !data) return null;
  const days: { date: string; minutes: number }[] = data.heatmap;
  const pad = (new Date(`${days[0].date}T00:00:00Z`).getUTCDay() + 6) % 7;
  const subjects: { subject: string; minutes: number }[] = data.subjects;
  const max = Math.max(1, ...subjects.map((s) => s.minutes));
  return (
    <section className="card ss-insights">
      <div className="section-heading">
        <div>
          <h2>Study insights</h2>
          <p>{data.activeDays} din padhai in the last year.</p>
        </div>
      </div>
      <div className="ss-heat" role="img" aria-label="Study minutes for each day of the last year">
        {Array.from({ length: pad }, (_, i) => <span key={`p${i}`} className="ss-cell empty" />)}
        {days.map((d) => <span key={d.date} className="ss-cell" data-level={heatLevel(d.minutes)} title={`${d.date}: ${hm(d.minutes)}`} />)}
      </div>
      <p className="tiny muted ss-legend">Kam <span className="ss-cell" data-level="1" /><span className="ss-cell" data-level="2" /><span className="ss-cell" data-level="3" /><span className="ss-cell" data-level="4" /> Zyada</p>
      <div className="report-stats">
        <div><small>Focus quality</small><strong>{data.focusQuality ?? "—"}{data.focusQuality !== null && "%"}</strong><span>{data.distractions} times app chhoda (last {data.sessionsCounted} sessions)</span></div>
        <div><small>Plan kept</small><strong>{data.planKept ?? "—"}{data.planKept !== null && "%"}</strong><span>daily tasks done, last 30 days</span></div>
        <div><small>Energy pattern</small><strong>{data.energy?.morePercent != null ? `+${data.energy.morePercent}%` : "—"}</strong><span>{data.energy ? `High energy din: ${hm(data.energy.highMinutes)}, low: ${hm(data.energy.lowMinutes)}` : "Daily reflection bharo to pattern dikhega"}</span></div>
      </div>
      <h3>Subject-wise time (30 days)</h3>
      {subjects.length ? (
        <div className="ss-bars">
          {subjects.map((s) => (
            <div key={s.subject}><span>{s.subject}</span><i style={{ width: `${(s.minutes / max) * 100}%` }} /><em>{hm(s.minutes)}</em></div>
          ))}
        </div>
      ) : <p className="muted">Focus room me subject likh kar session shuru karo.</p>}
    </section>
  );
}

/** Home cards: today's 3-task plan and the evening reflection. */
export function TodayCards({ notify }: Notify) {
  const { data } = useSelf("today");
  const save = useSave(notify);
  const [tasks, setTasks] = useState(["", "", ""]);
  const [editing, setEditing] = useState(false);
  const [energy, setEnergy] = useState(0);
  const [hard, setHard] = useState("");
  if (!data) return null;
  const plan: { text: string; done: boolean }[] | undefined = data.plan?.tasks;
  const showForm = !plan || editing;
  return (
    <div className="ss-today">
      <section className="card">
        <h2>Aaj ke 3 kaam</h2>
        {showForm ? (
          <form onSubmit={async (e) => { e.preventDefault(); if (await save("plan-save", { tasks }, "Plan saved")) setEditing(false); }}>
            {tasks.map((t, i) => (
              <input key={i} maxLength={120} value={t} placeholder={`Task ${i + 1}`} onChange={(e) => setTasks(tasks.map((x, j) => (j === i ? e.target.value : x)))} />
            ))}
            <button className="button">Save plan</button>
          </form>
        ) : (
          <>
            <ul className="ss-tasks">
              {plan.map((t, i) => (
                <li key={i}>
                  <label><input type="checkbox" checked={t.done} onChange={(e) => save("plan-tick", { index: i, done: e.target.checked })} /> <span data-done={t.done}>{t.text}</span></label>
                </li>
              ))}
            </ul>
            <p className="tiny muted">{plan.filter((t) => t.done).length}/{plan.length} done · <button type="button" className="link-button" onClick={() => { setTasks([0, 1, 2].map((i) => plan[i]?.text ?? "")); setEditing(true); }}>Edit</button></p>
          </>
        )}
      </section>
      <section className="card">
        <h2>Aaj ka reflection</h2>
        {data.reflection && energy === 0 ? (
          <p>Energy {data.reflection.energy}/5 saved. {data.reflection.hard && <>Mushkil: “{data.reflection.hard}”</>} <button type="button" className="link-button" onClick={() => { setEnergy(data.reflection.energy); setHard(data.reflection.hard); }}>Edit</button></p>
        ) : (
          <form onSubmit={async (e) => { e.preventDefault(); if (!energy) return notify("Energy level choose karo"); if (await save("reflection-save", { energy, hard }, "Reflection saved")) setEnergy(0); }}>
            <p className="muted">{data.hour >= 17 ? "Din kaisa raha?" : "Shaam ko bharna best hai."} Energy level:</p>
            <div className="ss-energy" role="group" aria-label="Energy level">
              {[1, 2, 3, 4, 5].map((n) => <button key={n} type="button" aria-pressed={energy === n} onClick={() => setEnergy(n)}>{n}</button>)}
            </div>
            <textarea maxLength={300} value={hard} onChange={(e) => setHard(e.target.value)} placeholder="Aaj kya mushkil laga?" />
            <button className="button">Save</button>
          </form>
        )}
      </section>
    </div>
  );
}

type Chapter = { _id: string; title: string; steps: Record<string, boolean>; done: number };
type Subject = { _id: string; title: string; chapters: Chapter[]; percent: number; complete: number };
type Goal = { _id: string; title: string; deadline: string; chapters: number; done: number; percent: number; timeUsed: number; daysLeft: number; state: string };

/** Syllabus tracker page: chapter checklist and goals with deadlines. */
export function SyllabusTracker({ notify }: Notify) {
  const { data, isLoading, error } = useSelf<{ exam: Json | null; subjects: Subject[]; goals: Goal[] }>("tracker");
  const save = useSave(notify);
  const [goalSubject, setGoalSubject] = useState("");
  if (isLoading) return <BrandLoader />;
  if (error) return <div className="mt-empty"><h2>{(error as Error).message}</h2></div>;
  if (!data?.exam) return <div className="mt-empty"><h2>Pehle Exam prep me apna exam choose karo</h2><p>Phir yahan us exam ke chapters ka checklist aayega.</p></div>;
  const all = data.subjects.flatMap((s) => s.chapters);
  return (
    <div className="ss-tracker">
      <section className="card">
        <h2>Goals with deadline</h2>
        {data.goals.length ? (
          <ul className="ss-goals">
            {data.goals.map((g) => (
              <li key={g._id} data-state={g.state}>
                <div><strong>{g.title}</strong><span>{g.done}/{g.chapters} chapters · {g.state === "done" ? "Complete!" : g.state === "missed" ? "Deadline nikal gayi" : `${g.daysLeft} din baaki`}</span></div>
                <em>{g.state === "on-track" ? "On track" : g.state === "behind" ? "Peeche ho" : g.state === "done" ? "Done" : "Missed"}</em>
                <div className="ss-progress"><i style={{ width: `${g.percent}%` }} /><b style={{ left: `${g.timeUsed}%` }} title="Time used" /></div>
                <button type="button" className="link-button" onClick={() => save("goal-delete", { id: g._id })}>Remove</button>
              </li>
            ))}
          </ul>
        ) : <p className="muted">Koi goal nahi. Ek subject ke liye deadline set karo.</p>}
        <form className="ss-goal-form" onSubmit={async (e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          const subject = data.subjects.find((s) => s._id === goalSubject);
          if (!subject) return notify("Subject choose karo");
          if (await save("goal-save", { title: String(f.get("title") || `Finish ${subject.title}`), topicIds: subject.chapters.map((c) => c._id), deadline: String(f.get("deadline")) }, "Goal saved")) e.currentTarget?.reset();
        }}>
          <select value={goalSubject} onChange={(e) => setGoalSubject(e.target.value)} aria-label="Subject"><option value="">Subject…</option>{data.subjects.map((s) => <option key={s._id} value={s._id}>{s.title}</option>)}</select>
          <input name="title" maxLength={100} placeholder="Goal name (optional)" />
          <input name="deadline" type="date" required min={new Date().toISOString().slice(0, 10)} aria-label="Deadline" />
          <button className="button">Add goal</button>
        </form>
      </section>
      <section className="card">
        <h2>Chapter checklist</h2>
        <p className="muted">{all.filter((c) => c.done === CHAPTER_STEPS.length).length}/{all.length} chapters fully done. Har chapter: Read → Notes → Rev 1 → Rev 2 → PYQs.</p>
        {data.subjects.map((s) => (
          <details key={s._id} className="ss-subject-block">
            <summary><strong>{s.title}</strong><span>{s.complete}/{s.chapters.length} · {s.percent}%</span></summary>
            <ul>
              {s.chapters.map((c) => (
                <li key={c._id}>
                  <span>{c.title}</span>
                  <div className="ss-steps">
                    {CHAPTER_STEPS.map((k) => (
                      <button key={k} type="button" aria-pressed={Boolean(c.steps[k])} onClick={() => save("step-set", { topicId: c._id, step: k, done: !c.steps[k] })}>
                        {c.steps[k] && <Check size={12} />} {STEP_LABEL[k]}
                      </button>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          </details>
        ))}
      </section>
    </div>
  );
}

/** Study partner page: invite by email, see each other's minutes today. */
export function StudyPartnerPage({ notify }: Notify) {
  const { data, isLoading, error } = useSelf<{ me: number; partners: { _id: string; name: string; status: string; incoming: boolean; minutes: number | null }[] }>("partner");
  const save = useSave(notify);
  if (isLoading) return <BrandLoader />;
  if (error || !data) return <div className="mt-empty"><h2>{(error as Error)?.message ?? "Could not load"}</h2></div>;
  return (
    <section className="card ss-partner">
      <h2>Study partner</h2>
      <p className="muted">Ek dost ke saath padho. Dono ko sirf aaj ke study minutes dikhte hain. Jab aap session complete karte ho aur partner ne aaj nahi padha, use ek nudge jaata hai.</p>
      <p><strong>Aap aaj:</strong> {hm(data.me)}</p>
      <ul className="ss-partners">
        {data.partners.map((p) => (
          <li key={p._id}>
            <strong>{p.name}</strong>
            {p.status === "accepted" ? <span>{hm(p.minutes ?? 0)} aaj</span> : <span>{p.incoming ? "Request aayi hai" : "Request bheji hai"}</span>}
            {p.incoming ? (
              <>
                <button className="button" onClick={() => save("partner-respond", { id: p._id, accept: true }, "Partner added")}>Accept</button>
                <button className="button secondary" onClick={() => save("partner-respond", { id: p._id, accept: false })}>Decline</button>
              </>
            ) : <button className="link-button" onClick={() => save("partner-end", { id: p._id }, "Removed")}>Remove</button>}
          </li>
        ))}
      </ul>
      <form className="ss-goal-form" onSubmit={async (e) => { e.preventDefault(); const form = e.currentTarget; if (await save("partner-invite", { email: new FormData(form).get("email") }, "Request bheji")) form.reset(); }}>
        <input name="email" type="email" required placeholder="Dost ka StudyQuest email" />
        <button className="button">Invite</button>
      </form>
    </section>
  );
}

/** Monthly report card: this month vs last month. */
function MonthlyReport() {
  const { data, isLoading, error } = useSelf("month");
  if (isLoading) return <BrandLoader />;
  if (error || !data) return <div className="mt-empty"><h2>{(error as Error)?.message ?? "Could not load"}</h2></div>;
  const c = data.current, p = data.previous;
  const delta = (v: number | null) => (v === null ? "new" : `${v >= 0 ? "+" : ""}${v}% vs last month`);
  return (
    <article className="report-card">
      <header><span className="eyebrow">Monthly report</span><h2>{data.label}</h2></header>
      <div className="report-stats">
        <div><small>Study time</small><strong>{hm(c.minutes)}</strong><span>{delta(data.change.minutes)}</span></div>
        <div><small>Sessions</small><strong>{c.sessions}</strong><span>{delta(data.change.sessions)}</span></div>
        <div><small>Mock tests</small><strong>{c.tests}</strong><span>{c.avgScore !== null ? `avg ${c.avgScore}%` : "no score yet"} (last month {p.avgScore ?? "—"}{p.avgScore !== null && "%"})</span></div>
        <div><small>Chapters done</small><strong>{c.chapters}</strong><span>last month {p.chapters}</span></div>
      </div>
      <p className="report-tests">{c.topSubject ? `Sabse zyada time: ${c.topSubject}.` : "Subject tag karke padho to top subject yahan dikhega."}</p>
    </article>
  );
}

/** Report page with a Week / Month switch. */
export function ReportSwitch({ notify }: Notify) {
  const [tab, setTab] = useState<"week" | "month">("week");
  return (
    <>
      <div className="ss-tabs" role="tablist">
        {(["week", "month"] as const).map((t) => <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>{t === "week" ? "Week" : "Month"}</button>)}
      </div>
      {tab === "week" ? <StudentWeeklyReport notify={notify} /> : <MonthlyReport />}
    </>
  );
}
