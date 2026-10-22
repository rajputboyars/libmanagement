import type { Metadata } from "next";
import { AppEntry } from "@/components/app-entry";
import { guideMeta } from "@/lib/guide-route";

const PUBLIC: Record<string, { title: string; description: string }> = {
  "/": { title: "StudyQuest — A little focus. A bigger future.", description: "Manage your study library and give students a rewarding way to focus: seats, memberships, attendance, fees and study progress in one place." },
  "/features": { title: "Features", description: "Seat and shift management, memberships, fee records, QR attendance, admissions CRM and a gamified study experience for students." },
  "/pricing": { title: "Pricing", description: "Simple plans for study libraries: Free, Starter, Pro and Business. Start with a free trial; no card needed." },
  "/owners": { title: "For library owners", description: "Seats, shifts, fee receipts, live attendance, admissions and profit reports: everything a study library owner needs in one dashboard." },
  "/students": { title: "For students", description: "A study app connected to your library: focus timer, XP and quests, attendance, fees and receipts, mock tests and smart revision." },
  "/how-it-works": { title: "How it works", description: "A day in a StudyQuest library, from joining with a Library ID to a fee receipt, in five steps." },
  "/coming-soon": { title: "Coming soon", description: "What StudyQuest is building next: SMS and WhatsApp reminders, online fee payment, parent updates, two-step login and a visual syllabus map." },
  "/guide": { title: "Video guide", description: "Short videos with Hindi audio explaining every StudyQuest screen for students and library owners." },
  "/demo": { title: "Book a demo", description: "See StudyQuest running a real library. Book a short walkthrough." },
  "/discover": { title: "Find a study library", description: "Search study libraries by location, fees, facilities and live seat availability." },
};
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
  return <AppEntry path={"/" + slug.join("/")} />;
}
