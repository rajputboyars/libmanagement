"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { clearClientCaches } from "./pwa";
import { getJson, send } from "./prep-api";

type Done = (role: string) => void;

export function useTwoFactorStatus() {
  return useQuery<{ enabled: boolean; enabledAt: string | null; recoveryRemaining: number }>({ queryKey: ["2fa-status"], queryFn: () => getJson("/api/auth/2fa-status"), staleTime: 30000 });
}

/** Second step of sign-in (and of a password reset): an authenticator code, or one recovery code. */
export function TwoFactorStep({ challenge, onDone, onExpired }: { challenge: string; onDone: Done; onExpired: () => void }) {
  const [recovery, setRecovery] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setBusy(true);
    const value = String(new FormData(e.currentTarget).get("value") ?? "");
    try {
      const res = await fetch("/api/auth/2fa-login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(recovery ? { challenge, recoveryCode: value } : { challenge, code: value }) });
      const result = await res.json();
      if (!res.ok) {
        if (result.code === "challenge-expired") return onExpired();
        throw new Error(result.error);
      }
      onDone(result.role);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to verify the code");
      setBusy(false);
    }
  }
  return (
    <form className="dialog-form" onSubmit={submit} aria-label="Two-step sign-in">
      <h1>Two-step sign-in</h1>
      <p className="muted">{recovery ? "Enter one of your saved recovery codes. Each works once." : "Open your authenticator app and enter the 6-digit code for StudyQuest."}</p>
      <label>
        {recovery ? "Recovery code" : "6-digit code"}
        <input key={recovery ? "r" : "c"} name="value" required autoFocus autoComplete="one-time-code" inputMode={recovery ? "text" : "numeric"} maxLength={recovery ? 20 : 8} placeholder={recovery ? "ABCD-EFGH-JKLM" : "123456"} />
      </label>
      {error && <p className="cm-note danger" role="alert">{error}</p>}
      <button className="button" disabled={busy}>{busy ? "Checking…" : "Verify and sign in"}</button>
      <button type="button" className="text-link" onClick={() => { setRecovery(!recovery); setError(""); }}>{recovery ? "Use my authenticator app instead" : "Use a recovery code instead"}</button>
      <button type="button" className="text-link" onClick={onExpired}>Back to password</button>
    </form>
  );
}

/** Security page panel: turn two-step sign-in on or off and manage recovery codes. Every change re-asks for the password. */
export function TwoFactorSettings({ notify }: { notify: (m: string) => void }) {
  const qc = useQueryClient();
  const status = useTwoFactorStatus();
  const [setup, setSetup] = useState<{ secret: string; qr: string } | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [mode, setMode] = useState<"" | "disable" | "regen">("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try { await fn(); } catch (e) { setError(e instanceof Error ? e.message : "Unable to complete"); } finally { setBusy(false); }
  };
  const refresh = () => qc.invalidateQueries({ queryKey: ["2fa-status"] });
  const enabled = !!status.data?.enabled;
  return (
    <section className="weekly-card" aria-label="Two-step sign-in">
      <div className="section-label"><span>Two-step sign-in</span><span className="mt-pill">{status.isLoading ? "…" : enabled ? "On" : "Off"}</span></div>
      {status.isError && <p className="cm-note danger" role="alert">Could not load your two-step sign-in status.</p>}
      {codes && (
        <div role="status">
          <p className="cm-note danger"><strong>Save these recovery codes now.</strong> They are shown once. Each works one time if you lose your authenticator. Keep them somewhere safe and private.</p>
          <ul className="mt-list" style={{ fontFamily: "monospace", listStyle: "none", padding: 0, columns: 2 }}>{codes.map((c) => <li key={c}>{c}</li>)}</ul>
          <div className="queue-actions">
            <button className="button secondary" onClick={() => { void navigator.clipboard?.writeText(codes.join("\n")); notify("Recovery codes copied."); }}>Copy codes</button>
            <button className="button" onClick={() => setCodes(null)}>I have saved them</button>
          </div>
        </div>
      )}
      {!codes && !enabled && !setup && (
        <>
          <p className="pr-hint">Adds a 6-digit code from an authenticator app (Google Authenticator, Microsoft Authenticator, Authy, 1Password and similar) to sign-in. Recommended for owners and administrators.</p>
          <form className="mt-form" onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); void run(async () => { const r = await send("/api/auth/2fa-setup", "POST", { password: f.get("password") }); setSetup({ secret: r.secret, qr: r.qr }); }); }}>
            <label>Your password<input name="password" type="password" required autoComplete="current-password" /></label>
            <button className="button" disabled={busy}>Set up two-step sign-in</button>
          </form>
        </>
      )}
      {!codes && !enabled && setup && (
        <form className="mt-form" onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); void run(async () => { const r = await send("/api/auth/2fa-enable", "POST", { code: f.get("code") }); setCodes(r.recoveryCodes); setSetup(null); await clearClientCaches(); await refresh(); notify("Two-step sign-in is on. Other devices were signed out."); }); }}>
          <p className="wide">Scan this code with your authenticator app, then enter the 6-digit code it shows.</p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={setup.qr} alt="QR code to add StudyQuest to your authenticator app" width={220} height={220} />
          <p className="wide pr-hint">Cannot scan? Enter this key manually: <code>{setup.secret.match(/.{1,4}/g)?.join(" ")}</code></p>
          <label>6-digit code<input name="code" required autoComplete="one-time-code" inputMode="numeric" maxLength={8} /></label>
          <button className="button" disabled={busy}>Turn on</button>
          <button type="button" className="button secondary" onClick={() => setSetup(null)}>Cancel</button>
        </form>
      )}
      {!codes && enabled && (
        <>
          <p className="pr-hint">Recovery codes left: <strong>{status.data?.recoveryRemaining ?? 0}</strong>{(status.data?.recoveryRemaining ?? 0) <= 2 ? ". Generate new codes soon." : "."}</p>
          {!mode && (
            <div className="queue-actions">
              <button className="button secondary" onClick={() => setMode("regen")}>Get new recovery codes</button>
              <button className="button secondary" onClick={() => setMode("disable")}>Turn off</button>
            </div>
          )}
          {mode && (
            <form className="mt-form" onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); void run(async () => {
              if (mode === "regen") { const r = await send("/api/auth/2fa-recovery", "POST", { password: f.get("password"), code: f.get("code") }); setCodes(r.recoveryCodes); setMode(""); notify("New recovery codes created. The old ones no longer work."); }
              else { const v = String(f.get("code") ?? ""); await send("/api/auth/2fa-disable", "POST", { password: f.get("password"), ...(v.length > 8 ? { recoveryCode: v } : { code: v }) }); setMode(""); await clearClientCaches(); notify("Two-step sign-in is off. Other devices were signed out."); }
              await refresh();
            }); }}>
              <p className="wide cm-note">{mode === "regen" ? "Creating new codes cancels all of your old ones." : "Turning this off makes your account depend on your password alone."}</p>
              <label>Your password<input name="password" type="password" required autoComplete="current-password" /></label>
              <label>{mode === "regen" ? "6-digit code" : "6-digit code or a recovery code"}<input name="code" required autoComplete="one-time-code" maxLength={20} /></label>
              <button className="button" disabled={busy}>{mode === "regen" ? "Create new codes" : "Turn off two-step sign-in"}</button>
              <button type="button" className="button secondary" onClick={() => { setMode(""); setError(""); }}>Cancel</button>
            </form>
          )}
        </>
      )}
      {error && <p className="cm-note danger" role="alert">{error}</p>}
    </section>
  );
}
