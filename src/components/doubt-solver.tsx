"use client";

import { useRef, useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BrainCircuit, Camera, ChevronDown, CircleAlert, ImagePlus, Lightbulb, LoaderCircle, Send, ShieldCheck, Sparkles } from "lucide-react";

type Doubt = { _id: string; subject: string; difficulty: string; question: string; provider: "ollama" | "fallback"; steps: string[]; hints: string[]; answer: string; disclaimer: string; image?: { mime?: string; size?: number }; createdAt: string };
type Data = { items: Doubt[]; usage: number; limit: number; provider: string };
const demo: Data = {
  usage: 2, limit: 10, provider: "fallback",
  items: [{ _id: "demo", subject: "Physics", difficulty: "standard", question: "Why does acceleration remain constant in ideal free fall?", provider: "fallback", steps: ["List the forces acting after release.", "Ignore air resistance as stated by the ideal model.", "Apply Newton’s second law: the gravitational force and mass scale together.", "Check the direction and units of the resulting acceleration."], hints: ["What force remains after the object is released?", "Write F = ma and F = mg side by side."], answer: "In the ideal model, gravity is the only force. Equating ma with mg gives a = g, which is constant near Earth’s surface.", disclaimer: "AI assistance can be incomplete or incorrect. Verify important exam answers with your syllabus, teacher, or an authoritative source.", createdAt: "2026-10-16T10:00:00.000Z" }],
};

export function DoubtSolver({ preview, notify }: { preview: boolean; notify: (message: string) => void }) {
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [imageDataUrl, setImageDataUrl] = useState<string>();
  const [imageName, setImageName] = useState("");
  const [active, setActive] = useState<Doubt | null>(demo.items[0]);
  const [busy, setBusy] = useState(false);
  const { data = demo, isLoading } = useQuery<Data>({ queryKey: ["doubts"], queryFn: async () => { const response = await fetch("/api/doubts"); if (!response.ok) throw new Error("Doubt history could not load"); return response.json(); }, enabled: !preview, initialData: preview ? demo : undefined });

  async function chooseImage(file?: File) {
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 2 * 1024 * 1024) return notify("Choose a PNG, JPEG or WebP image smaller than 2 MB.");
    const reader = new FileReader();
    reader.onload = () => { setImageDataUrl(String(reader.result)); setImageName(file.name); };
    reader.readAsDataURL(file);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (preview) return notify("Preview mode does not use your daily doubt allowance.");
    const form = new FormData(event.currentTarget);
    setBusy(true);
    try {
      const response = await fetch("/api/doubts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question: form.get("question"), subject: form.get("subject"), difficulty: form.get("difficulty"), imageDataUrl }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Unable to solve this doubt");
      setActive(result.record); setImageDataUrl(undefined); setImageName(""); event.currentTarget.reset();
      await queryClient.invalidateQueries({ queryKey: ["doubts"] });
      notify(result.record.provider === "ollama" ? "Your guided explanation is ready." : "AI is unavailable; a safe study path was saved instead.");
    } catch (error) { notify(error instanceof Error ? error.message : "Unable to solve this doubt"); } finally { setBusy(false); }
  }

  if (isLoading) return <div className="doubt-skeleton" />;
  return <>
    <header className="doubt-heading"><div><span className="eyebrow">AI doubt solver</span><h1>Untangle the question, one clue at a time.</h1><p>Ask with text or an image. StudyQuest gives steps and hints, saves the session, and clearly marks fallback guidance.</p></div><div className="usage-orb"><BrainCircuit /><strong>{data.limit - data.usage}</strong><span>questions left today</span></div></header>
    <section className="doubt-layout">
      <form className="doubt-composer" onSubmit={submit}>
        <div className="composer-top"><label>Subject<select name="subject" defaultValue="Mathematics"><option>Mathematics</option><option>Physics</option><option>Chemistry</option><option>Biology</option><option>Reasoning</option><option>General Studies</option><option>English</option></select></label><label>Difficulty<select name="difficulty" defaultValue="standard"><option value="foundation">Foundation</option><option value="standard">Standard</option><option value="advanced">Advanced</option></select></label></div>
        <label className="question-box"><span>Your question</span><textarea name="question" maxLength={3000} placeholder="Type the exact question and what you have tried…" /><button type="button" aria-label="Attach question image" onClick={() => fileRef.current?.click()}><ImagePlus /></button><input ref={fileRef} hidden type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => chooseImage(event.target.files?.[0])} /></label>
        {imageDataUrl && <div className="image-chip"><Camera /><span>{imageName}</span><button type="button" onClick={() => { setImageDataUrl(undefined); setImageName(""); }}>Remove</button></div>}
        <div className="composer-foot"><span><ShieldCheck /> Images are validated and remain private.</span><button className="button" disabled={busy}>{busy ? <LoaderCircle className="spin" /> : <Send size={16} />}{busy ? "Thinking…" : "Explain step by step"}</button></div>
      </form>
      <aside className="doubt-history"><div><span className="eyebrow">Saved history</span><strong>{data.items.length} recent doubts</strong></div>{data.items.map((item) => <button className={active?._id === item._id ? "active" : ""} onClick={() => setActive(item)} key={item._id}><span>{item.subject}</span><p>{item.question || "Image question"}</p><small>{new Date(item.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" })} · {item.provider}</small><ChevronDown /></button>)}</aside>
    </section>
    {active && <section className="answer-sheet"><header><div className={`provider-mark ${active.provider}`}><Sparkles />{active.provider === "ollama" ? "AI-guided explanation" : "Offline study guide"}</div><h2>{active.question || "Image-based question"}</h2><span>{active.subject} · {active.difficulty}</span></header><div className="answer-columns"><article><span className="eyebrow">Reasoning path</span><ol>{active.steps.map((step, index) => <li key={index}><i>{index + 1}</i><p>{step}</p></li>)}</ol></article><aside><div className="hint-card"><Lightbulb /><span className="eyebrow">Hints</span>{active.hints.map((hint, index) => <p key={index}>{hint}</p>)}</div><div className="answer-card"><strong>Working answer</strong><p>{active.answer}</p></div></aside></div><footer><CircleAlert />{active.disclaimer}</footer></section>}
  </>;
}
