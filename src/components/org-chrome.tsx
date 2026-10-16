"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Building2, Sparkles } from "lucide-react";
import { getJson, post, type Json } from "./prep-api";

/** Compact plan/trial status for the owner workspace header area. */
export function PlanBanner() {
  const q = useQuery<Json>({ queryKey: ["org"], queryFn: () => getJson("/api/org"), staleTime: 60000, retry: false });
  const [now] = useState(() => Date.now());
  const d = q.data;
  if (!d) return null;
  const e = d.entitlements as Json;
  const until = e.accessUntil ? Math.ceil((new Date(e.accessUntil).getTime() - now) / 86400000) : null;
  if (d.organization.status === "suspended") return <div className="sq-banner danger" role="alert"><AlertTriangle size={16} /><span>This account is suspended. {d.organization.suspendedReason} Your data is safe and can be exported.</span><Link href="/owner/support">Contact support</Link></div>;
  if (e.restricted) return <div className="sq-banner warn" role="status"><AlertTriangle size={16} /><span>{e.reason}. Free plan limits apply ({e.limits.activeStudents} students).</span><Link href="/owner/billing">Choose a plan</Link></div>;
  if (e.reason === "Trial active" && until !== null && until <= 7) return <div className="sq-banner" role="status"><Sparkles size={16} /><span>{e.planName} trial ends in {Math.max(until, 0)} day{until === 1 ? "" : "s"}. No payment is needed to stay on Free.</span><Link href="/owner/billing">See plans</Link></div>;
  if (/grace|past due|Payment failed/i.test(e.reason)) return <div className="sq-banner warn" role="status"><AlertTriangle size={16} /><span>{e.reason}. Update your payment method to keep paid features.</span><Link href="/owner/billing">Fix billing</Link></div>;
  return null;
}

export function BranchSwitcher() {
  const q = useQuery<Json>({ queryKey: ["org"], queryFn: () => getJson("/api/org"), staleTime: 60000, retry: false });
  const [busy, setBusy] = useState(false);
  const d = q.data;
  if (!d || d.branches.length < 2) return null;
  return (
    <label className="sq-switch">
      <span><Building2 size={14} /> Branch</span>
      <select value={d.activeBranchId} disabled={busy} aria-label="Switch branch" onChange={async (e) => { setBusy(true); try { await post("/api/org", "switch-branch", { branchId: e.target.value }); window.location.reload(); } catch { setBusy(false); } }}>
        {d.branches.map((b: Json) => <option key={b._id} value={b._id}>{b.branchName || b.name}</option>)}
      </select>
    </label>
  );
}

