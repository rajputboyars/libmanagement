import type { Metadata } from "next";
import { AppEntry } from "@/components/app-entry";
import { guideMeta, guideRoute } from "@/lib/guide-route";
import { ownerGuide, studentGuide } from "@/lib/guide-videos";

const PUBLIC: Record<string, { title: string; description: string }> = {
  "/": { title: "StudyQuest — A little focus. A bigger future.", description: "Manage your study library and give students a rewarding way to focus: seats, memberships, attendance, fees and study progress in one place." },
  "/features": { title: "Features", description: "Seat and shift management, memberships, fee records, QR attendance, admissions CRM and a gamified study experience for students." },
  "/pricing": { title: "Pricing", description: "Simple plans for study libraries: Free, Starter, Pro and Business. Start with a free trial; no card needed." },
  "/owners": { title: "For library owners", description: "Seats, shifts, fee receipts, live attendance, admissions and profit reports: everything a study library owner needs in one dashboard." },
  "/students": { title: "For students", description: "A study app connected to your library: focus timer, XP and quests, attendance, fees and receipts, mock tests and smart revision." },
  "/how-it-works": { title: "How it works", description: "A day in a StudyQuest library, from joining with a Library ID to a fee receipt, in five steps." },
  "/coming-soon": { title: "Coming soon", description: "What StudyQuest is building next: SMS and WhatsApp reminders, online fee payment, parent updates, and a visual syllabus map." },
  "/guide": { title: "Video guide", description: "Short videos explaining every StudyQuest screen for students and library owners, with Hindi audio or English/Hinglish captions." },
  "/demo": { title: "Book a demo", description: "See StudyQuest running a real library. Book a short walkthrough." },
  "/discover": { title: "Find a study library", description: "Search study libraries by location, fees, facilities and live seat availability." },
};
const SOFTWARE_LD = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "StudyQuest",
  applicationCategory: "BusinessApplication",
  operatingSystem: "Web",
  description: PUBLIC["/"].description,
};
const origin = () => (process.env.APP_URL || "http://127.0.0.1:3000").replace(/\/$/, "");
/** VideoObject structured data for a single guide page (captioned videos were recorded 17 Nov 2026, the older ones 22 Oct 2026). */
function videoLd(path: string) {
  const r = guideRoute(path), meta = guideMeta(path);
  if (!r?.slug || !meta) return null;
  const v = (r.role === "owner" ? ownerGuide : studentGuide).find((x) => x.slug === r.slug);
  if (!v) return null;
  return { "@context": "https://schema.org", "@type": "VideoObject", name: meta.title, description: meta.description, thumbnailUrl: origin() + v.poster, contentUrl: origin() + v.src, duration: `PT${v.seconds}S`, uploadDate: v.captions ? "2026-11-17" : "2026-10-22", inLanguage: v.captions ? ["en", "hi-Latn"] : "hi" };
}
const PRIVATE = ["/app", "/owner", "/super-admin", "/billing", "/login", "/register", "/forgot-password", "/reset-password", "/onboarding"];

export async function generateMetadata({ params }: { params: Promise<{ slug?: string[] }> }): Promise<Metadata> {
  const { slug = [] } = await params;
  const path = "/" + slug.join("/");
  if (path.startsWith("/r/")) return { title: "Weekly study report", robots: { index: false, follow: false } };
  if (PRIVATE.some((p) => path === p || path.startsWith(p + "/"))) return { title: { absolute: "StudyQuest" }, robots: { index: false, follow: false } };
  const meta = PUBLIC[path] ?? guideMeta(path);
  if (!meta) return { title: "Page not found", robots: { index: false } };
  return { title: path === "/" ? { absolute: meta.title } : meta.title, description: meta.description, alternates: { canonical: path }, openGraph: { title: meta.title, description: meta.description, url: path, type: "website" } };
}
export default async function Page({
  params,
}: {
  params: Promise<{ slug?: string[] }>;
}) {
  const { slug = [] } = await params;
  const path = "/" + slug.join("/");
  return (
    <>
      {path === "/" && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(SOFTWARE_LD) }} />}
      {(() => { const ld = videoLd(path); return ld && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(ld) }} />; })()}
      <AppEntry path={path} />
    </>
  );
}
