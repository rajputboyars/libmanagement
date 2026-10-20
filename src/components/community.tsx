"use client";

import { BrandLoader } from "@/components/brand-loader";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Ban, Flag, Heart, ShieldCheck, Users } from "lucide-react";
import { LADDERS, MILESTONE_TYPES, REPORT_REASONS, headline, type MilestoneType } from "@/lib/community";

type Act = (action: string, data: unknown, success: string) => Promise<boolean>;
type Person = { userId: string; alias: string; sharedGoal?: string };
type Profile = { optedIn: boolean; alias: string; ageBand: "adult" | "minor"; consentStatus: string; guardianName: string; lookingForBuddy: boolean; mentorship: string; sharedGoal: string; moderation: string; moderationNote?: string };
type Hub = { profile: Profile | null; hasExam: boolean; blocks: { userId: string; alias: string }[]; buddies: Person[]; mentors: Person[]; group: { examKey: string; count: number; members: Person[] } | null; links: { _id: string; kind: string; status: string; incoming: boolean; alias: string }[] };
type Post = { _id: string; alias?: string; headline: string; message: string; visibility: string; createdAt: string; milestoneType?: string; milestoneValue?: number; status?: string };
type Wall = { posts: Post[]; mine: Post[]; locked?: boolean; stats?: Record<MilestoneType, number>; rungs?: Record<MilestoneType, number[]> };

function useCommunity(notify: (m: string) => void) {
  const queryClient = useQueryClient();
  const act: Act = async (action, data, success) => {
    try {
      const response = await fetch("/api/community", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, data }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      await queryClient.invalidateQueries({ queryKey: ["community"] });
      notify(success);
      return true;
    } catch (error) { notify(error instanceof Error ? error.message : "Unable to update"); return false; }
  };
  return act;
}
const Skeleton = () => <BrandLoader compact text="Loading…" />;
const Empty = ({ title, text }: { title: string; text: string }) => <div className="mt-empty"><h2>{title}</h2><p>{text}</p></div>;

export function Community({ notify, preview }: { notify: (m: string) => void; preview: boolean }) {
  const act = useCommunity(notify);
  const [tab, setTab] = useState<"hub" | "wall">("hub");
  const hub = useQuery<Hub>({ queryKey: ["community", "hub"], enabled: !preview, queryFn: async () => { const r = await fetch("/api/community?view=hub"); if (!r.ok) throw new Error((await r.json()).error); return r.json(); } });
  if (preview) return <Empty title="Sign in to join the community" text="Preview mode saves nothing, so community features are disabled." />;
  if (hub.isLoading) return <Skeleton />;
  if (hub.isError || !hub.data) return <Empty title="Community could not load" text={hub.error instanceof Error ? hub.error.message : "Check the connection and refresh."} />;
  const data = hub.data;
  const active = !!data.profile?.optedIn && data.profile.moderation === "active" && ["not-required", "approved"].includes(data.profile.consentStatus);
  return (
    <>
      <header className="p2-heading"><div><span className="eyebrow">Study community</span><h1>Study alongside people, on your terms.</h1><p>Opt-in only. Others see your alias, exam group and shared goal — never your name, contact details, marks or attendance. There is no chat, and you can block or report anyone.</p></div></header>
      <div className="mt-filter" role="tablist">{(["hub", "wall"] as const).map((item) => <button key={item} role="tab" aria-selected={tab === item} className={tab === item ? "active" : ""} onClick={() => setTab(item)}>{item === "hub" ? "Buddies & groups" : "Success wall"}</button>)}</div>
      {tab === "hub" ? <HubView data={data} active={active} act={act} /> : <WallView active={active} act={act} />}
    </>
  );
}

function ProfileForm({ data, act }: { data: Hub; act: Act }) {
  const p = data.profile;
  const [age, setAge] = useState<"adult" | "minor">(p?.ageBand || "adult");
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    act("profile-save", { optedIn: f.get("optedIn") === "on", alias: f.get("alias"), ageBand: age, guardianName: f.get("guardianName") || "", guardianContact: f.get("guardianContact") || "", lookingForBuddy: f.get("buddy") === "on", mentorship: f.get("mentorship"), sharedGoal: f.get("sharedGoal") || "" }, "Community settings saved.");
  }
  return (
    <form className="mt-form" onSubmit={submit}>
      {!data.hasExam && <p className="wide cm-note">Set an exam target on the roadmap page first so we can place you in an exam group.</p>}
      <label className="mt-check wide"><input type="checkbox" name="optedIn" defaultChecked={p?.optedIn} />Show me in my library&apos;s community (you can leave any time)</label>
      <label>Alias (not your name)<input name="alias" required minLength={3} maxLength={30} defaultValue={p?.alias} /></label>
      <label>Age group<select value={age} onChange={(e) => setAge(e.target.value as "adult" | "minor")} disabled={p?.ageBand === "minor"}><option value="adult">18 or over</option><option value="minor">13 to 17</option></select></label>
      {age === "minor" && <><label>Guardian name<input name="guardianName" required defaultValue={p?.guardianName} maxLength={80} /></label><label>Guardian phone or email (seen only by library staff)<input name="guardianContact" maxLength={80} placeholder={p?.consentStatus === "approved" ? "Already on file" : ""} /></label><p className="wide cm-note">Library staff confirm guardian consent before you can take part. Public sharing is not available under 18.</p></>}
      <label>Mentorship<select name="mentorship" defaultValue={p?.mentorship || "none"}><option value="none">Not interested</option><option value="seeking">Looking for a mentor</option><option value="offering">Happy to mentor</option></select></label>
      <label className="mt-check"><input type="checkbox" name="buddy" defaultChecked={p?.lookingForBuddy} />Match me with a study buddy</label>
      <label className="wide">Shared goal (optional)<input name="sharedGoal" maxLength={140} defaultValue={p?.sharedGoal} placeholder="Finish the quant syllabus by December" /></label>
      <button className="button">Save</button>
    </form>
  );
}

function PersonCard({ person, label, onRequest, act }: { person: Person; label: string; onRequest: () => void; act: Act }) {
  return (
    <article className="queue-card"><div><Users /><span><strong>{person.alias}</strong><small>{person.sharedGoal || "No shared goal"}</small></span></div>
      <div className="queue-actions"><button className="button" onClick={onRequest}>{label}</button><button className="button secondary" onClick={() => { if (confirm(`Block ${person.alias}?`)) act("block", { userId: person.userId }, "Member blocked."); }}><Ban /> Block</button></div></article>
  );
}

function HubView({ data, active, act }: { data: Hub; active: boolean; act: Act }) {
  const p = data.profile;
  return (
    <>
      {p && p.moderation === "suspended" && <div className="cm-note danger">Your community access is paused by the library team.{p.moderationNote ? ` Reason: ${p.moderationNote}` : ""}</div>}
      {p?.optedIn && p.consentStatus === "pending" && <div className="cm-note">Waiting for the library team to confirm guardian consent. Nothing is visible to others until then.</div>}
      {p?.consentStatus === "rejected" && <div className="cm-note danger">Guardian consent was not confirmed. Please speak to the library team.</div>}
      <ProfileForm data={data} act={act} />
      {active && (
        <div className="queue-columns">
          <section>
            <div className="section-label"><span>{data.group ? `${data.group.examKey.toUpperCase()} group` : "Exam group"}</span><strong>{data.group?.count ?? 0} members</strong></div>
            {data.group?.members.map((m) => <article className="queue-card" key={m.userId}><div><Users /><span><strong>{m.alias}</strong><small>{m.sharedGoal || "No shared goal"}</small></span></div><div className="queue-actions"><ReportButton target={m.userId} act={act} /><button className="button secondary" onClick={() => { if (confirm(`Block ${m.alias}?`)) act("block", { userId: m.userId }, "Member blocked."); }}><Ban /> Block</button></div></article>)}
            {!data.group?.members.length && <Empty title="You are the first here" text="Others in your exam group will appear as they opt in." />}
            <div className="section-label"><span>Connections</span><strong>{data.links.length}</strong></div>
            {data.links.map((l) => (
              <article className="queue-card" key={l._id}><div><Heart /><span><strong>{l.alias}</strong><small>{l.kind} · {l.status}{l.status === "pending" ? (l.incoming ? " · wants to connect" : " · awaiting reply") : ""}</small></span></div>
                <div className="queue-actions">{l.incoming && l.status === "pending" && <><button className="button" onClick={() => act("link-respond", { id: l._id, accept: true }, "Connected.")}>Accept</button><button className="button secondary" onClick={() => act("link-respond", { id: l._id, accept: false }, "Declined.")}>Decline</button></>}<button className="button secondary" onClick={() => act("link-end", { id: l._id }, l.status === "pending" ? "Request withdrawn." : "Connection ended.")}>{l.status === "pending" && !l.incoming ? "Withdraw" : "End"}</button></div></article>
            ))}
          </section>
          <section>
            <div className="section-label"><span>Suggested buddies</span><strong>{data.buddies.length}</strong></div>
            {data.buddies.map((b) => <PersonCard key={b.userId} person={b} label="Invite" act={act} onRequest={() => act("buddy-request", { userId: b.userId }, "Invite sent.")} />)}
            {!data.buddies.length && <Empty title="No matches yet" text={p?.lookingForBuddy ? "Matches use your exam, weekly target and subjects, and appear when others opt in." : "Turn on buddy matching above."} />}
            {p?.mentorship === "seeking" && <><div className="section-label"><span>Mentors</span><strong>{data.mentors.length}</strong></div>
              {data.mentors.map((m) => <PersonCard key={m.userId} person={m} label="Ask to mentor me" act={act} onRequest={() => act("mentor-request", { userId: m.userId }, "Request sent.")} />)}
              {!data.mentors.length && <Empty title="No mentors yet" text="Mentors in your age group and exam appear here." />}</>}
            {p?.mentorship === "offering" && <p className="cm-note">Mentees ask you directly. Requests appear under Connections.</p>}
          </section>
        </div>
      )}
      {data.blocks.length > 0 && <div className="mt-actions"><span>Blocked members: {data.blocks.length}</span>{data.blocks.map((b, i) => <button key={i} className="button secondary" onClick={() => act("unblock", { userId: b.userId }, "Unblocked.")}>Unblock {b.alias}</button>)}</div>}
    </>
  );
}

function WallView({ active, act }: { active: boolean; act: Act }) {
  const wall = useQuery<Wall>({ queryKey: ["community", "wall"], queryFn: async () => { const r = await fetch("/api/community?view=wall"); if (!r.ok) throw new Error("Wall could not load"); return r.json(); } });
  const [type, setType] = useState<MilestoneType>("focus-hours");
  if (wall.isLoading) return <Skeleton />;
  if (!wall.data) return <Empty title="Wall could not load" text="Check the connection and refresh." />;
  const d = wall.data;
  if (d.locked || !active) return <Empty title="Join the community to use the wall" text="Turn on community sharing above. Nothing is posted without your explicit consent for each card." />;
  const rungs = d.rungs?.[type] || [];
  function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    act("post-create", { milestoneType: type, milestoneValue: Number(f.get("value")), message: f.get("message") || "", visibility: f.get("visibility"), consent: f.get("consent") === "on" }, "Card created.");
  }
  return (
    <>
      <form className="mt-form" onSubmit={create}>
        <label>Milestone<select value={type} onChange={(e) => setType(e.target.value as MilestoneType)}>{MILESTONE_TYPES.map((m) => <option key={m} value={m}>{m.replace("-", " ")} (yours: {d.stats?.[m] ?? 0})</option>)}</select></label>
        <label>Earned level<select name="value" required disabled={!rungs.length}>{rungs.map((r) => <option key={r} value={r}>{headline(type, r)}</option>)}</select></label>
        <label>Who can see it<select name="visibility" defaultValue="private"><option value="private">Only me</option><option value="library">My library</option><option value="public">Everyone (18+)</option></select></label>
        <label className="wide">Message (optional)<input name="message" maxLength={140} /></label>
        <label className="mt-check wide"><input type="checkbox" name="consent" required />I agree to share this card with the audience I chose. I can change or delete it any time.</label>
        <button className="button" disabled={!rungs.length}>{rungs.length ? "Create card" : `Next: ${LADDERS[type].find((r) => r > (d.stats?.[type] ?? 0))} to unlock`}</button>
      </form>
      <div className="section-label"><span>My cards</span><strong>{d.mine.length}</strong></div>
      <div className="cm-cards">{d.mine.map((p) => (
        <article className="cm-card" key={p._id}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {p.status === "published" ? <img src={`/api/community/card/${p._id}`} alt={`Achievement card: ${p.headline}`} loading="lazy" /> : <div className="cm-removed">Removed by moderators</div>}
          <div className="queue-actions">
            {p.status === "published" && <><select aria-label="Visibility" defaultValue={p.visibility} onChange={(e) => act("post-update", { id: p._id, visibility: e.target.value }, "Visibility updated.")}><option value="private">Only me</option><option value="library">My library</option><option value="public">Everyone (18+)</option></select><a className="button secondary" href={`/api/community/card/${p._id}`} download="studyquest-card.svg">Download</a></>}
            <button className="button secondary" onClick={() => { if (confirm("Delete this card?")) act("post-delete", { id: p._id }, "Card deleted."); }}>Delete</button>
          </div>
        </article>))}</div>
      {!d.mine.length && <Empty title="No cards yet" text="Create one from a milestone you have verifiably earned." />}
      <div className="section-label"><span>From the community</span><strong>{d.posts.length}</strong></div>
      <div className="cm-cards">{d.posts.map((p) => (
        <article className="cm-card" key={p._id}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`/api/community/card/${p._id}`} alt={`${p.alias}: ${p.headline}`} loading="lazy" />
          <div className="queue-actions"><ReportButton post={p} act={act} /></div>
        </article>))}</div>
      {!d.posts.length && <Empty title="Nothing shared yet" text="Cards shared with your library or publicly will appear here." />}
    </>
  );
}

function ReportButton({ post, target, act }: { post?: Post; target?: string; act: Act }) {
  const [open, setOpen] = useState(false);
  if (!open) return <button className="button secondary" onClick={() => setOpen(true)}><Flag /> Report</button>;
  return (
    <form className="queue-actions" onSubmit={async (e) => { e.preventDefault(); const f = new FormData(e.currentTarget); if (await act("report", { postId: post?._id, targetUserId: target, reason: f.get("reason"), detail: f.get("detail") || "" }, "Report sent to the library team.")) setOpen(false); }}>
      <select name="reason" aria-label="Reason">{REPORT_REASONS.map((r) => <option key={r} value={r}>{r.replace("-", " ")}</option>)}</select>
      <input name="detail" maxLength={400} placeholder="What happened?" aria-label="Details" />
      <button className="button">Send</button><button type="button" className="button secondary" onClick={() => setOpen(false)}>Cancel</button>
    </form>
  );
}

type Mod = { reports: { _id: string; reason: string; detail: string; targetAlias: string; reporterAlias: string; createdAt: string; targetUserId?: string; postId?: string; post: { milestoneType: string; milestoneValue: number; message: string } | null }[]; consents: { userId: string; alias: string; guardianName: string; guardianContact?: string }[]; suspended: { userId: string; alias: string; moderationNote?: string }[] };

export function CommunityModeration({ notify }: { notify: (m: string) => void }) {
  const act = useCommunity(notify);
  const q = useQuery<Mod>({ queryKey: ["community", "moderation"], queryFn: async () => { const r = await fetch("/api/community?view=moderation"); if (!r.ok) throw new Error("Moderation could not load"); return r.json(); } });
  if (q.isLoading) return <Skeleton />;
  if (!q.data) return <Empty title="Moderation could not load" text="Check the connection and refresh." />;
  const d = q.data;
  return (
    <>
      <header className="p2-heading"><div><span className="eyebrow">Community safety</span><h1>Review reports and guardian consent.</h1><p>Every decision is audited. Members see only aliases; you can see who a report concerns. Contact guardians through your own channel, then confirm consent here.</p></div></header>
      <div className="queue-columns">
        <section>
          <div className="section-label"><span>Open reports</span><strong>{d.reports.length}</strong></div>
          {d.reports.map((r) => (
            <article className="queue-card" key={r._id}>
              <div><Flag /><span><strong>{r.reason.replace("-", " ")} · {r.targetAlias}</strong><small>Reported by {r.reporterAlias} · {new Date(r.createdAt).toLocaleDateString("en-IN")}</small><small>{r.detail || "No details"}</small>{r.post && <small>Post: {headline(r.post.milestoneType as MilestoneType, r.post.milestoneValue)}{r.post.message ? ` — “${r.post.message}”` : ""}</small>}</span></div>
              <form className="queue-actions" onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); act("mod-report", { id: r._id, decision: f.get("decision"), note: f.get("note") || "" }, "Report resolved."); }}>
                <select name="decision" aria-label="Decision"><option value="dismiss">Dismiss</option>{r.postId && <option value="remove-post">Remove post</option>}{r.targetUserId && <option value="suspend-member">Suspend member</option>}</select>
                <input name="note" maxLength={300} placeholder="Note" aria-label="Note" /><button className="button">Resolve</button>
              </form>
            </article>
          ))}
          {!d.reports.length && <Empty title="All clear" text="No open reports." />}
        </section>
        <section>
          <div className="section-label"><span>Guardian consent</span><strong>{d.consents.length}</strong></div>
          {d.consents.map((c) => (
            <article className="queue-card" key={c.userId}><div><ShieldCheck /><span><strong>{c.alias}</strong><small>Guardian: {c.guardianName}</small><small>Contact: {c.guardianContact || "—"}</small></span></div>
              <div className="queue-actions"><button className="button" onClick={() => act("mod-consent", { userId: c.userId, decision: "approved" }, "Consent confirmed.")}>Confirmed</button><button className="button secondary" onClick={() => act("mod-consent", { userId: c.userId, decision: "rejected" }, "Consent rejected.")}>Reject</button></div></article>
          ))}
          {!d.consents.length && <Empty title="No pending consents" text="Members under 18 appear here after they opt in." />}
          <div className="section-label"><span>Suspended members</span><strong>{d.suspended.length}</strong></div>
          {d.suspended.map((s) => <article className="queue-card" key={s.userId}><div><Ban /><span><strong>{s.alias}</strong><small>{s.moderationNote || "No note"}</small></span></div><button className="button secondary" onClick={() => act("mod-member", { userId: s.userId, decision: "restore" }, "Member restored.")}>Restore</button></article>)}
        </section>
      </div>
    </>
  );
}
