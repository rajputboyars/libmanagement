"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { LEGAL_VERSIONS } from "@/lib/legal";

type ConsentView = { accepted: boolean; version: string; at: string; current: boolean } | null;
type Status = { versions: typeof LEGAL_VERSIONS; terms: ConsentView; marketing: ConsentView; termsNeedAcceptance: boolean };

async function load(): Promise<Status | null> {
  const res = await fetch("/api/consent", { cache: "no-store" });
  if (!res.ok) return null; // signed out (preview) or unavailable: show nothing
  return res.json();
}
export const useConsentStatus = () => useQuery({ queryKey: ["consent"], queryFn: load, staleTime: 60_000, retry: false });
async function post(body: unknown) {
  const res = await fetch("/api/consent", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? "Unable to save");
  return json as Status;
}
const dismissedKey = (v: string) => `sq-legal-dismissed-${v}`;
const readDismissed = (v: string) => { try { return sessionStorage.getItem(dismissedKey(v)) === "1"; } catch { return false; } };

/** A gentle, dismissible prompt for people who have not accepted the current Terms. It never blocks or limits the account. */
export function LegalBanner() {
  const q = useConsentStatus();
  const qc = useQueryClient();
  const [hidden, setHidden] = useState(false);
  const [busy, setBusy] = useState(false);
  const s = q.data;
  if (!s || !s.termsNeedAcceptance || hidden || readDismissed(s.versions.terms)) return null;
  return (
    <div className="legal-banner" role="region" aria-label="Updated terms">
      <span>{s.terms ? "We updated our Terms of Service and Privacy Notice." : "Please review our Terms of Service and Privacy Notice."} You can keep using StudyQuest while you decide.</span>
      <span className="queue-actions">
        <Link className="button secondary" href="/terms" target="_blank" rel="noopener">Terms</Link>
        <Link className="button secondary" href="/privacy" target="_blank" rel="noopener">Privacy</Link>
        <button className="button" disabled={busy} onClick={async () => { setBusy(true); try { await post({ action: "accept-terms", accept: true }); await qc.invalidateQueries({ queryKey: ["consent"] }); } finally { setBusy(false); } }}>I accept</button>
        <button className="button secondary" onClick={() => { try { sessionStorage.setItem(dismissedKey(s.versions.terms), "1"); } catch { /* ignore */ } setHidden(true); }}>Later</button>
      </span>
    </div>
  );
}

/** Security & privacy page section: what you accepted and when, and the separate optional marketing choice. */
export function ConsentPanel({ notify }: { notify: (m: string) => void }) {
  const q = useConsentStatus();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const s = q.data;
  if (!s) return null;
  const when = (v: ConsentView) => (v ? new Date(v.at).toLocaleString("en-IN") : "");
  const run = async (body: unknown, message: string) => { setBusy(true); try { await post(body); await qc.invalidateQueries({ queryKey: ["consent"] }); notify(message); } catch (e) { notify(e instanceof Error ? e.message : "Unable to save"); } finally { setBusy(false); } };
  return (
    <section className="weekly-card" aria-label="Legal and consent">
      <div className="section-label"><span>Terms, privacy and consent</span></div>
      <p>Current versions: <Link href="/terms">Terms of Service {s.versions.terms}</Link> · <Link href="/privacy">Privacy Notice {s.versions.privacy}</Link>.</p>
      {s.terms?.accepted && !s.termsNeedAcceptance
        ? <p className="pr-hint">You accepted these versions on {when(s.terms)}.</p>
        : <div className="queue-actions"><span className="pr-hint">{s.terms?.accepted ? `You accepted an earlier version on ${when(s.terms)}.` : "You have not accepted the current Terms yet."}</span><button className="button" disabled={busy} onClick={() => run({ action: "accept-terms", accept: true }, "Thank you. Your acceptance was recorded.")}>Accept current Terms</button></div>}
      <label className="consent-row">
        <input type="checkbox" checked={!!s.marketing?.accepted} disabled={busy} onChange={(e) => run({ action: "marketing", value: e.target.checked }, e.target.checked ? "You will get product news by email." : "Marketing email is off.")} />
        <span>Send me product news and offers by email (optional, separate from the Terms; you can change this any time).</span>
      </label>
    </section>
  );
}
