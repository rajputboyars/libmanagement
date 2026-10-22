"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Copy, MessageCircle, Share2 } from "lucide-react";
import { BrandLoader } from "@/components/brand-loader";
import { getJson, post } from "./prep-api";
import type { WeeklyReport } from "@/lib/weekly-report";

const hm = (minutes: number) => (minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${minutes}m`);
const dayShort = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-IN", { weekday: "short", timeZone: "UTC" });
const dateLong = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });

/** The report itself; used in the app and on the public share page. */
export function ReportCard({ report }: { report: WeeklyReport }) {
  const max = Math.max(report.goalMinutes, ...report.days.map((d) => d.minutes), 1);
  const stats: [string, string, string][] = [
    ["Focused study", hm(report.focusMinutes), `${report.sessions} completed sessions`],
    ["Library visits", String(report.visits), "days punched in this week"],
    ["Daily goal met", `${report.goalDays} / 7`, `goal ${hm(report.goalMinutes)} a day`],
    ["Current streak", `${report.streak} days`, `${report.xp} XP this week`],
  ];
  return (
    <article className="report-card">
      <header>
        <span className="eyebrow">Weekly report · {dateLong(report.from)} – {dateLong(report.to)}</span>
        <h2>{report.name}&apos;s study week</h2>
        {report.library && <p className="muted">{report.library} · StudyQuest</p>}
      </header>
      <div className="report-stats">
        {stats.map(([label, value, detail]) => (
          <div key={label}>
            <small>{label}</small>
            <strong>{value}</strong>
            <span>{detail}</span>
          </div>
        ))}
      </div>
      <div className="report-bars" role="img" aria-label="Minutes studied each day this week">
        {report.days.map((d) => (
          <div key={d.date} className="report-bar">
            <span className="report-bar-fill" style={{ height: `${Math.round((d.minutes / max) * 100)}%` }} data-goal={d.minutes >= report.goalMinutes} />
            <small>{dayShort(d.date)}</small>
            <em>{d.minutes ? hm(d.minutes) : "–"}</em>
          </div>
        ))}
      </div>
      <p className="report-tests">
        {report.tests
          ? `${report.tests} mock test${report.tests === 1 ? "" : "s"} taken${report.avgScore !== null ? ` · average score ${report.avgScore}%` : ""}.`
          : "No mock tests this week."}
      </p>
      <p className="report-foot muted">Study time is measured by StudyQuest&apos;s server timer, not typed in by hand.</p>
    </article>
  );
}

/** Student page: live report plus a private share link for parents. */
export function StudentWeeklyReport({ notify }: { notify: (m: string) => void }) {
  const q = useQuery<{ report: WeeklyReport }>({ queryKey: ["weekly-report"], queryFn: () => getJson("/api/report") });
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState(false);
  if (q.isLoading) return <BrandLoader compact text="Building your report…" />;
  if (q.isError || !q.data) return <div className="mt-empty"><h2>Could not load your report</h2><p>{q.error instanceof Error ? q.error.message : "Try again."}</p></div>;
  const share = async () => {
    setBusy(true);
    try {
      const r = await post<{ path: string }>("/api/report", "share");
      setLink(`${window.location.origin}${r.path}`);
      notify("Private link created. It works for 30 days.");
    } catch (e) {
      notify(e instanceof Error ? e.message : "Could not create the link");
    } finally {
      setBusy(false);
    }
  };
  const message = `My study week on StudyQuest: ${hm(q.data.report.focusMinutes)} of focused study, ${q.data.report.visits} library visits. ${link}`;
  return (
    <div className="report-page">
      <ReportCard report={q.data.report} />
      <section className="card report-share">
        <h2>Share with parents</h2>
        <p className="muted">Creates a private read-only link with this week&apos;s numbers. No login needed to open it, and it stops working after 30 days.</p>
        {!link ? (
          <button className="button" disabled={busy} onClick={share}>
            <Share2 size={17} /> Create share link
          </button>
        ) : (
          <>
            <input className="report-link" readOnly value={link} aria-label="Share link" onFocus={(e) => e.currentTarget.select()} />
            <div className="queue-actions">
              <a className="button" href={`https://wa.me/?text=${encodeURIComponent(message)}`} target="_blank" rel="noopener noreferrer">
                <MessageCircle size={17} /> Share on WhatsApp
              </a>
              <button
                className="button secondary"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(link);
                    notify("Link copied.");
                  } catch {
                    notify("Select the link and copy it.");
                  }
                }}
              >
                <Copy size={17} /> Copy link
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}

/** Public page at /r/<token>: shows only the saved snapshot. */
export function PublicReport({ token }: { token: string }) {
  const q = useQuery<{ report: WeeklyReport; expiresAt: string }>({
    queryKey: ["public-report", token],
    queryFn: () => getJson(`/api/report?token=${encodeURIComponent(token)}`),
    retry: false,
  });
  return (
    <main className="report-public">
      <Link href="/" className="brand">
        <span className="brand-mark">✳</span>StudyQuest<span className="brand-dot">.</span>
      </Link>
      {q.isLoading ? (
        <BrandLoader compact text="Opening the report…" />
      ) : q.data ? (
        <>
          <ReportCard report={q.data.report} />
          <p className="muted report-expiry">Shared by the student. This link stops working on {new Date(q.data.expiresAt).toLocaleDateString("en-IN", { day: "numeric", month: "long" })}.</p>
        </>
      ) : (
        <div className="mt-empty">
          <h2>This report is not available</h2>
          <p>{q.error instanceof Error ? q.error.message : "The link may have expired."}</p>
        </div>
      )}
    </main>
  );
}
