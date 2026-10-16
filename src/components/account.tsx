"use client";

import Link from "next/link";
import { useState, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { clearClientCaches } from "./pwa";
import { send } from "./prep-api";

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="discovery-public">
      <header><Link className="brand" href="/"><span className="brand-mark">✳</span>StudyQuest<span className="brand-dot">.</span></Link><nav><Link href="/login">Sign in</Link></nav></header>
      <main><section className="weekly-card" style={{ maxWidth: 480, margin: "24px auto" }}><h1 style={{ marginTop: 0 }}>{title}</h1>{children}</section></main>
    </div>
  );
}

export function ForgotPassword() {
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setError(""); setState("busy");
    try {
      const r = await send("/api/auth/forgot", "POST", { email: new FormData(e.currentTarget).get("email") });
      setNotice(r.sandboxToken ? `Local sandbox (no email provider): open /reset-password?token=${r.sandboxToken}` : r.message); setState("done");
    } catch (err) { setError(err instanceof Error ? err.message : "Unable to send"); setState("idle"); }
  }
  return (
    <Card title="Reset your password">
      {state === "done" ? <p role="status">{notice}</p> : (
        <form className="dialog-form" onSubmit={submit}>
          <p className="pr-hint">Enter your account email. If it exists, we&apos;ll send a link that works for 30 minutes.</p>
          <label>Email<input name="email" type="email" required autoComplete="email" /></label>
          {error && <p className="cm-note danger" role="alert">{error}</p>}
          <button className="button" disabled={state === "busy"}>{state === "busy" ? "Sending…" : "Send reset link"}</button>
        </form>)}
      <p className="pr-hint"><Link href="/login">Back to sign in</Link></p>
    </Card>
  );
}

export function ResetPassword() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const token = typeof window === "undefined" ? "" : new URLSearchParams(window.location.search).get("token") ?? "";
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setError("");
    const f = new FormData(e.currentTarget);
    if (f.get("password") !== f.get("confirm")) return setError("The passwords do not match.");
    setBusy(true);
    try {
      const r = await send("/api/auth/reset", "POST", { token, password: f.get("password") });
      router.push(r.role === "owner" || r.role === "staff" ? "/owner" : r.role === "super-admin" ? "/super-admin" : "/app"); router.refresh();
    } catch (err) { setError(err instanceof Error ? err.message : "Unable to reset"); setBusy(false); }
  }
  return (
    <Card title="Choose a new password">
      <form className="dialog-form" onSubmit={submit}>
        <p className="pr-hint">Resetting signs you out everywhere else.</p>
        <label>New password<input name="password" type="password" required minLength={10} maxLength={100} autoComplete="new-password" /></label>
        <label>Confirm password<input name="confirm" type="password" required minLength={10} maxLength={100} autoComplete="new-password" /></label>
        {error && <p className="cm-note danger" role="alert">{error}</p>}
        <button className="button" disabled={busy || !token}>{busy ? "Saving…" : "Set new password"}</button>
        {!token && <p className="cm-note danger">This link is missing its token. Request a new one.</p>}
      </form>
    </Card>
  );
}

/** Password, session, data export and deletion controls. Used inside both student and owner workspaces. */
export function AccountSecurity({ role, notify }: { role: string; notify: (m: string) => void }) {
  const router = useRouter();
  const [busy, setBusy] = useState("");
  const run = async (key: string, fn: () => Promise<void>) => { setBusy(key); try { await fn(); } catch (e) { notify(e instanceof Error ? e.message : "Unable to complete"); } finally { setBusy(""); } };
  return (
    <>
      <header className="p2-heading"><div><span className="eyebrow">Account</span><h1>Security &amp; privacy</h1><p>Control your password, signed-in devices and personal data.</p></div></header>
      <form className="mt-form" onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); const form = e.currentTarget; run("pw", async () => { await send("/api/auth/change-password", "POST", { current: f.get("current"), password: f.get("password") }); form.reset(); notify("Password changed. Other devices were signed out."); }); }}>
        <label>Current password<input name="current" type="password" required autoComplete="current-password" /></label>
        <label>New password (10+ characters)<input name="password" type="password" required minLength={10} maxLength={100} autoComplete="new-password" /></label>
        <button className="button" disabled={busy === "pw"}>Change password</button>
      </form>
      <div className="queue-actions">
        <button className="button secondary" disabled={busy === "all"} onClick={() => run("all", async () => { await send("/api/auth/logout-all", "POST", {}); await clearClientCaches(); router.push("/login"); router.refresh(); })}>Sign out of all devices</button>
        <a className="button secondary" href="/api/privacy?download=1" download>Download my data</a>
      </div>
      <div className="section-label"><span>{role === "student" ? "Delete my account" : "Delete my organization"}</span></div>
      <form className="mt-form" onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); if (!confirm(role === "student" ? "Delete your account and learning data permanently?" : "Send a deletion request for your organization?")) return;
        run("del", async () => { const r = await send("/api/privacy", "POST", { action: role === "student" ? "delete-account" : "request-organization-deletion", password: f.get("password"), confirm: f.get("confirm") }); if (role === "student") { await clearClientCaches(); router.push("/"); router.refresh(); } else notify(r.message || "Request received."); }); }}>
        <p className="wide cm-note danger">{role === "student" ? "This permanently removes your study history, notes, quiz data and community profile. Fee and attendance records kept by your library are anonymised. It cannot be undone." : "A platform administrator reviews organization deletions. Billing records may need to be retained by law."}</p>
        <label>Password<input name="password" type="password" required autoComplete="current-password" /></label>
        <label>Type DELETE to confirm<input name="confirm" required pattern="DELETE" autoComplete="off" /></label>
        <button className="button secondary" disabled={busy === "del"}>{role === "student" ? "Delete account" : "Request deletion"}</button>
      </form>
    </>
  );
}
