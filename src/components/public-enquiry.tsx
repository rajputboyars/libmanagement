"use client";

import { useState, type FormEvent } from "react";
import { send } from "./prep-api";

export function EnquiryForm({ slug }: { slug: string }) {
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");
  const [message, setMessage] = useState("");
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); const f = new FormData(e.currentTarget); setState("busy"); setMessage("");
    try {
      const r = await send("/api/leads", "POST", { library: slug, name: f.get("name"), phone: f.get("phone") || "", email: f.get("email") || "", message: f.get("message") || "", consentContact: f.get("consent") === "on", website: f.get("website") || "" });
      setMessage(r.message); setState("done");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to send"); setState("idle"); }
  }
  if (state === "done") return <p className="cm-note" role="status">{message}</p>;
  return (
    <form className="mt-form" onSubmit={submit}>
      <label>Your name<input name="name" required minLength={2} maxLength={80} autoComplete="name" /></label>
      <label>Phone<input name="phone" inputMode="tel" maxLength={20} autoComplete="tel" /></label>
      <label>Email<input name="email" type="email" autoComplete="email" /></label>
      <label className="wide">Message<textarea name="message" maxLength={500} /></label>
      <input name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" style={{ position: "absolute", left: "-9999px", width: 1, height: 1 }} />
      <label className="mt-check wide"><input type="checkbox" name="consent" />This library may contact me about admission</label>
      {message && <p className="wide cm-note danger" role="alert">{message}</p>}
      <button className="button" disabled={state === "busy"}>{state === "busy" ? "Sending…" : "Send enquiry"}</button>
    </form>
  );
}
