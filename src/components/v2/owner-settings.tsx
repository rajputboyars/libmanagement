"use client";
import { Bell, CreditCard, Info, LockKeyhole, Megaphone, ShieldCheck, ToggleRight, Users } from "lucide-react";
import { useState, type ReactNode } from "react";
import type { Json } from "@/components/prep-api";
import { clock, shortDate } from "./format";
import { Badge, EmptyState, PageHead, QuickAction, Tabs } from "./primitives";

/** Settings in clear sections. The hours editor and notification toggle are passed in unchanged so their behavior stays as it was. */
export function OwnerSettings({ d, isOwner, canDo, onAnnounce, hours, push }: { d: Json; isOwner: boolean; canDo: (p: string) => boolean; onAnnounce: () => void; hours?: ReactNode; push?: ReactNode }) {
  const tabs = [
    { id: "general", label: "General" },
    ...(hours ? [{ id: "hours", label: "Hours & holidays" }] : []),
    ...(push ? [{ id: "alerts", label: "Notifications" }] : []),
    { id: "activity", label: "Activity" },
  ];
  const [tab, setTab] = useState("general");
  const audit: Json[] = d.audit ?? [];
  return (
    <>
      <PageHead title="Settings" sub="Your library's details, opening hours, notifications and recent activity." />
      <Tabs label="Settings sections" items={tabs} value={tab} onChange={setTab} />
      <div style={{ marginTop: 18 }}>
        {tab === "general" && (
          <>
            <section className="sq-v2-panel" style={{ marginBottom: 14 }}>
              <h2 className="sq-v2-h2">{d.library?.name ?? "Your library"}</h2>
              <p className="sq-v2-muted">Library ID: <strong>{String(d.user?.libraryId || "Not connected")}</strong></p>
              <ul className="sq-v2-feed">
                <li><i><ShieldCheck size={16} /></i><span><strong>Your data stays in your library</strong><br /><small>All records are scoped to your signed-in library.</small></span></li>
                <li><i><Info size={16} /></i><span><strong>Messages stay inside StudyQuest</strong><br /><small>Announcements are delivered in the app. No WhatsApp provider is configured.</small></span></li>
              </ul>
            </section>
            <h2 className="sq-v2-h2">Manage</h2>
            <div className="sq-v2-tiles-links">
              {isOwner && <QuickAction icon={Users} label="Team & roles" href="/owner/team" />}
              {isOwner && <QuickAction icon={ToggleRight} label="Modules" href="/owner/modules" />}
              {isOwner && <QuickAction icon={CreditCard} label="Billing" href="/owner/billing" />}
              <QuickAction icon={LockKeyhole} label="Account & privacy" href="/owner/security" />
              {canDo("notifications.create") && <QuickAction icon={Megaphone} label="Create announcement" onClick={onAnnounce} />}
            </div>
          </>
        )}
        {tab === "hours" && hours}
        {tab === "alerts" && push}
        {tab === "activity" && (
          <section className="sq-v2-panel">
            <h2 className="sq-v2-h2">Recent activity</h2>
            {audit.length ? (
              <ul className="sq-v2-feed">
                {audit.map((a) => (
                  <li key={String(a._id)}><i><ShieldCheck size={16} /></i><span><strong>{String(a.action)}</strong></span><time dateTime={new Date(a.createdAt).toISOString()}>{shortDate(a.createdAt)}, {clock(a.createdAt)}</time></li>
                ))}
              </ul>
            ) : (
              <EmptyState icon={Bell} title="No recent activity" text={isOwner ? "Changes made in your library will be listed here." : "Only the owner can see the activity history."} action={undefined} />
            )}
            <Badge>Latest 30 entries</Badge>
          </section>
        )}
      </div>
    </>
  );
}
