"use client";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";
import { OwnerSeatChanges, StudentSeatChange } from "@/components/seat-change";
import { FocusTools, Insights, ReportSwitch, StudyPartnerPage, SubjectInput, SyllabusTracker, TodayCards } from "@/components/self-study";
import { focusQuality } from "@/lib/self-study";
import { PushToggle } from "@/components/push-toggle";
import { Leaderboard } from "@/components/leaderboard";
import { LibraryNotes, OwnerSharedNotes } from "@/components/shared-notes";
import { countdownText, daysUntil } from "@/lib/exam-countdown";
import { STUDENT_FEATURES, lockedMessage, studentFeatureForPath, type StudentAccess } from "@/lib/student-access";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useUI } from "@/lib/ui-store";
import { PublicPage } from "@/components/site";
import {
  Auth,
  StudentJoin,
  StudentPunch,
  OwnerJoinRequests,
  OwnerPresence,
} from "@/components/lazy";
import { Empty, Garden } from "@/components/ui-bits";
import { BrandLoader } from "@/components/brand-loader";
import { motion } from "motion/react";
import {
  AreaChart,
  Area,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  BarChart,
  Bar,
} from "recharts";
import {
  ArrowUpRight,
  ArrowRight,
  BookOpen,
  LayoutDashboard,
  Armchair,
  Users,
  Flame,
  Clock3,
  Trophy,
  ChartNoAxesCombined,
  Wallet,
  Bell,
  Settings,
  Search,
  ChevronRight,
  ChevronLeft,
  Plus,
  Check,
  Play,
  Pause,
  Menu,
  X,
  Sun,
  Moon,
  LogOut,
  ShieldCheck,
  Leaf,
  CalendarDays,
  Sparkles,
  Zap,
  HelpCircle,
  Flag,
  CreditCard,
  Receipt,
  MessageSquare,
  Building2,
  CheckCircle2,
  Gift,
  Wrench,
  Target,
  ListChecks,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  FOCUS_LENGTHS,
  breakMinutes,
  focusLength,
  focusXP,
  level,
  streak,
} from "@/lib/rules";
import {
  DAY_NAMES,
  DEFAULT_HOURS,
  clockLabel,
  todayStatus,
  upcomingHolidays,
  type DayHours,
  type Holiday,
} from "@/lib/library-hours";
import {
  BranchSwitcher,
  JoinBanner,
  LibraryIdChip,
  PlanBanner,
  RememberLibraryName,
  RememberStudentLibrary,
} from "@/components/org-chrome";
import { clearClientCaches } from "@/components/pwa";
import {
  Phase2Experience,
  LearningIntelligence,
  DoubtSolver,
  RewardsMarketplace,
  LibraryDiscovery,
  Maintenance,
  ExamPrep,
  TestResult,
  TestRunner,
  PrepAdmin,
  OwnerBilling,
  OwnerBranches,
  OwnerCrm,
  OwnerSupport,
  Onboarding,
  SaasAdmin, PlatformFeatures, PlatformStudentRules, PlatformAccounts,
  PilotImport,
  AccountSecurity,
  ForgotPassword,
  ResetPassword,
  Community,
  CommunityModeration,
  DemoPage,
  SandboxCheckout,
  SaasPricing,
} from "@/components/lazy";
type Row = Record<string, string | number | boolean>;
type Data = {
  user?: Row;
  students: Row[];
  seats: Row[];
  shifts: Row[];
  plans: Row[];
  memberships: Row[];
  payments: Row[];
  expenses: Row[];
  attendance: Row[];
  complaints: Row[];
  notifications: Row[];
  xp: Row[];
  libraries: Row[];
  assignments?: Row[];
  audit?: Row[];
  staff?: Row[];
  focus?: Row;
  profile?: Row;
  summary?: Record<string, number>;
  library?: { name?: string; hours?: DayHours[]; holidays?: Holiday[] } | null;
  studentAccess?: StudentAccess;
  exam?: { title: string; date: string } | null;
};
// True when StudyQuest runs as the installed app (home-screen icon) or was opened from its start_url.
const subscribeDisplayMode = (onChange: () => void) => {
  const mq = window.matchMedia("(display-mode: standalone)");
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
};
const isInstalledApp = () =>
  window.matchMedia("(display-mode: standalone)").matches ||
  new URLSearchParams(window.location.search).get("source") === "pwa";
const blank: Data = {
  students: [],
  seats: [],
  shifts: [],
  plans: [],
  memberships: [],
  payments: [],
  expenses: [],
  attendance: [],
  complaints: [],
  notifications: [],
  xp: [],
  libraries: [],
};
const money = (n: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(n / 100);
const previewChart = [
  { day: "Mon", hours: 2.5 },
  { day: "Tue", hours: 3.2 },
  { day: "Wed", hours: 2 },
  { day: "Thu", hours: 4.1 },
  { day: "Fri", hours: 3.5 },
  { day: "Sat", hours: 4.8 },
  { day: "Sun", hours: 3 },
];
const studentNav: [string, string, LucideIcon][] = [
  ["/app", "Overview", LayoutDashboard],
  ["/app/roadmap", "Exam roadmap", Leaf],
  ["/app/intelligence", "Learning insights", ChartNoAxesCombined],
  ["/app/revisions", "Smart revision", CalendarDays],
  ["/app/doubts", "Doubt solver", HelpCircle],
  ["/app/rewards", "Rewards", Gift],
  ["/app/library-requests", "Library requests", Building2],
  ["/app/join", "Join a library", Building2],
  ["/app/punch", "Punch in / out", Clock3],
  ["/app/prep", "Exam prep", Target],
  ["/app/planner", "Study planner", CalendarDays],
  ["/app/tracker", "Syllabus tracker", CheckCircle2],
  ["/app/partner", "Study partner", Users],
  ["/app/quiz", "Quiz arena", HelpCircle],
  ["/app/garden", "Study garden", Leaf],
  ["/app/friends", "Friends & challenges", Users],
  ["/app/rooms", "Focus rooms", Users],
  ["/app/events", "Events & feedback", MessageSquare],
  ["/app/share", "Share achievements", Trophy],
  ["/app/community", "Community", Users],
  ["/app/maintenance", "Report an issue", Wrench],
  ["/app/focus", "Focus room", Clock3],
  ["/app/quests", "My quests", Flag],
  ["/app/progress", "My progress", ChartNoAxesCombined],
  ["/app/report", "Weekly report", ChartNoAxesCombined],
  ["/app/leaderboard", "Leaderboard", Trophy],
  ["/app/library-notes", "Library notes", BookOpen],
  ["/app/achievements", "Achievements", Trophy],
  ["/app/membership", "My library", BookOpen],
  ["/app/security", "Account & privacy", ShieldCheck],
];
const ownerNav: [string, string, LucideIcon][] = [
  ["/owner", "Overview", LayoutDashboard],
  ["/owner/students", "Students", Users],
  ["/owner/seats", "Seat map", Armchair],
  ["/owner/shifts", "Shifts", Clock3],
  ["/owner/plans", "Fee plans", CreditCard],
  ["/owner/memberships", "Memberships", BookOpen],
  ["/owner/payments", "Payments", Wallet],
  ["/owner/attendance", "Attendance", CheckCircle2],
  ["/owner/expenses", "Expenses", Receipt],
  ["/owner/reports", "Reports", ChartNoAxesCombined],
  ["/owner/complaints", "Complaints", MessageSquare],
  ["/owner/rewards", "Rewards", Trophy],
  ["/owner/discovery", "Public listing", Building2],
  ["/owner/join-requests", "Join requests", Users],
  ["/owner/presence", "Live presence", CheckCircle2],
  ["/owner/waitlist", "Waitlist", Users],
  ["/owner/crm", "Admissions", Users],
  ["/owner/branches", "Branches", Building2],
  ["/owner/billing", "Billing", CreditCard],
  ["/owner/support", "Support", HelpCircle],
  ["/owner/onboarding", "Setup guide", CheckCircle2],
  ["/owner/import", "Import register", Receipt],
  ["/owner/feedback", "Feedback", MessageSquare],
  ["/owner/events", "Events", CalendarDays],
  ["/owner/maintenance", "Maintenance", Wrench],
  ["/owner/moderation", "Community safety", ShieldCheck],
  ["/owner/security", "Account & privacy", ShieldCheck],
  ["/owner/settings", "Settings", Settings],
];
export function Experience({ path }: { path: string }) {
  const router = useRouter();
  const { dark, toggle } = useUI();
  const [menu, setMenu] = useState(false);
  const [toast, setToast] = useState("");
  const queryClient = useQueryClient();
  const { data, isLoading, isError } = useQuery<Data>({
    queryKey: ["workspace"],
    queryFn: async () => {
      const res = await fetch("/api/workspace");
      if (res.status === 401) return blank;
      if (!res.ok) throw new Error("Your workspace could not be loaded");
      return res.json();
    },
  });
  const d = data || blank,
    preview = !d.user;
  const owner = path.startsWith("/owner"),
    admin = path.startsWith("/super-admin"),
    app = path.startsWith("/app") || owner || admin;
  const installed = useSyncExternalStore(
    subscribeDisplayMode,
    isInstalledApp,
    () => false,
  );
  const role = d.user?.role as string | undefined;
  const home =
    role === "super-admin"
      ? "/super-admin"
      : role === "owner" || role === "staff"
        ? "/owner"
        : role === "student"
          ? "/app"
          : null;
  const area = admin
    ? "/super-admin"
    : owner
      ? "/owner"
      : path.startsWith("/app")
        ? "/app"
        : null;
  useEffect(() => {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
  }, [dark]);
  useEffect(() => {
    if (isLoading) return;
    // A signed-in person who lands in the wrong area (for example an owner opening the installed app at /app) goes to their own workspace.
    if (home && area && area !== home) router.replace(home);
    // The installed app opens the sign-in page when nobody is signed in, never the sample preview.
    else if (!home && area && installed) router.replace("/login");
  }, [isLoading, home, area, installed, router]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 5000);
    return () => clearTimeout(timer);
  }, [toast]);
  async function mutate(action: string, value: unknown = {}) {
    const res = await fetch("/api/workspace", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, data: value }),
    });
    const result = await res.json();
    if (!res.ok) throw new Error(result.error);
    await queryClient.invalidateQueries({ queryKey: ["workspace"] });
    return result;
  }
  const nav = owner
    ? ownerNav
    : admin
      ? ([
          ["/super-admin", "Overview", LayoutDashboard],
          ["/super-admin/libraries", "Libraries", Building2],
          ["/super-admin/subscriptions", "Subscriptions", CreditCard],
          ["/super-admin/analytics", "Analytics", ChartNoAxesCombined],
          ["/super-admin/business", "Business", ChartNoAxesCombined],
          ["/super-admin/syllabus", "Syllabus", BookOpen],
          ["/super-admin/question-bank", "Question bank", ListChecks],
          ["/super-admin/features", "Feature access", ShieldCheck],
          ["/super-admin/student-features", "Student features", Users],
          ["/super-admin/accounts", "Accounts", Users],
          ["/super-admin/plans", "Plans", CreditCard],
        ] as typeof ownerNav)
      : studentNav;
  const allowed =
    preview ||
    (!owner && !admin && d.user?.role === "student") ||
    (owner && ["owner", "staff"].includes(String(d.user?.role))) ||
    (admin && d.user?.role === "super-admin");
  // Owners and staff stay inside /owner; /app links would bounce them back to the dashboard.
  const profileHref = owner
    ? "/owner/settings"
    : admin
      ? "/super-admin"
      : "/app/profile";
  const notificationsHref = owner
    ? "/owner/notifications"
    : "/app/notifications";
  const unread = d.notifications.some((n) => !n.read);
  if (path === "/login" || path === "/register")
    return <Auth register={path === "/register"} />;
  if (path === "/discover") return <LibraryDiscovery />;
  if (path === "/pricing") return <SaasPricing />;
  if (path === "/forgot-password") return <ForgotPassword />;
  if (path === "/reset-password") return <ResetPassword />;
  if (path === "/demo") return <DemoPage />;
  if (path.startsWith("/billing/sandbox/"))
    return <SandboxCheckout id={path.split("/")[3] ?? ""} />;
  if (path.startsWith("/app/prep/test/"))
    return <TestRunner id={path.split("/")[4] ?? ""} />;
  if (path.startsWith("/app/prep/result/"))
    return <TestResult id={path.split("/")[4] ?? ""} />;
  if (!app) return <PublicPage path={path} />;
  // Show only the loader while the session is checked or a redirect is on its way,
  // so the installed app never flashes the sample "preview" workspace first.
  if (
    app &&
    !isError &&
    (isLoading || (home && area && area !== home) || (!home && installed))
  )
    return (
      <main className="loading">
        <BrandLoader />
      </main>
    );
  if (isError)
    return (
      <main className="loading">
        <h1>Your space couldn’t load.</h1>
        <p>Please check the connection and try again.</p>
        <button
          className="button"
          onClick={() =>
            queryClient.refetchQueries({ queryKey: ["workspace"] })
          }
        >
          Try again
        </button>
      </main>
    );
  const title =
    nav.find((n) => n[0] === path)?.[1] ||
    {
      "/app/profile": "My profile",
      "/app/notifications": "Notifications",
      "/owner/notifications": "Notifications",
    }[path] ||
    "Overview";
  const learningPath = ["/app/intelligence", "/app/revisions"].includes(path);
  const doubtPath = path === "/app/doubts";
  const rewardsPath = path === "/app/rewards" || path === "/owner/rewards";
  const discoveryPath = [
    "/owner/discovery",
    "/owner/waitlist",
    "/app/library-requests",
  ].includes(path);
  const saasOwnerPath = [
    "/owner/billing",
    "/owner/branches",
    "/owner/crm",
    "/owner/support",
    "/owner/onboarding",
  ].includes(path);
  const joinPath = [
    "/app/join",
    "/app/punch",
    "/owner/join-requests",
    "/owner/presence",
  ].includes(path);
  const importPath = path === "/owner/import";
  const securityPath = path === "/app/security" || path === "/owner/security";
  const saasAdminPath = path === "/super-admin/business" || path === "/super-admin/plans";
  const platformPath = ["/super-admin/features", "/super-admin/student-features", "/super-admin/accounts"].includes(path);
  const prepPath = path === "/app/prep";
  const reportPath = path === "/app/report";
  const leaderboardPath = path === "/app/leaderboard";
  const libraryNotesPath = path === "/app/library-notes";
  const trackerPath = path === "/app/tracker";
  const partnerPath = path === "/app/partner";
  // Premium student features the platform owner has locked for students who are not paid up.
  const lockedList = !preview && !owner && !admin ? (d.studentAccess?.locked ?? []) : [];
  const lockedPaths = new Set<string>(lockedList.flatMap((f) => [...STUDENT_FEATURES[f].paths]));
  const pageFeature = studentFeatureForPath(path);
  const lockedFeature = pageFeature && lockedList.includes(pageFeature) ? pageFeature : null;
  const prepAdminPath = path === "/super-admin/question-bank";
  const communityPath =
    path === "/app/community" || path === "/owner/moderation";
  const maintenancePath =
    path === "/app/maintenance" || path === "/owner/maintenance";
  const phase2Path = [
    "/app/roadmap",
    "/app/planner",
    "/app/quiz",
    "/app/friends",
    "/app/garden",
    "/app/rooms",
    "/app/events",
    "/app/share",
    "/owner/feedback",
    "/owner/events",
    "/super-admin/syllabus",
  ].includes(path);
  return (
    <div className="workspace">
      <aside className={`sidebar ${menu ? "open" : ""}`}>
        <Link className="brand" href="/">
          <span className="brand-mark">✳</span>StudyQuest
          <span className="brand-dot">.</span>
        </Link>
        <button
          className="mobile-close icon-btn"
          onClick={() => setMenu(false)}
          aria-label="Close navigation"
        >
          <X />
        </button>
        <Link
          className="workspace-switch"
          href={profileHref}
          onClick={() => setMenu(false)}
          aria-label={owner ? "Open library profile" : "Open my profile"}
        >
          <span className="workspace-icon">{owner ? "L" : "S"}</span>
          <div>
            <strong>
              {owner
                ? "Library workspace"
                : admin
                  ? "Platform administration"
                  : "My study space"}
            </strong>
            <small>
              {owner
                ? "Build a thriving community"
                : "A little better, every day"}
            </small>
          </div>
          <ChevronRight size={15} />
        </Link>
        {owner && !preview && <BranchSwitcher />}
        {owner && !preview && String(d.user?.role) === "owner" && (
          <LibraryIdChip notify={setToast} />
        )}
        <div className="nav-label">{owner ? "WORKSPACE" : "YOUR JOURNEY"}</div>
        <nav>
          {nav.map(([href, label, Icon]) => (
            <Link
              key={href}
              className={path === href ? "nav-item active" : "nav-item"}
              href={href}
              onClick={() => setMenu(false)}
            >
              <Icon size={19} />
              {label}
              {label === "My quests" && <span className="nav-count">✦</span>}
              {lockedPaths.has(href) && (
                <span className="nav-lock" title="Premium: clear your fees to unlock" aria-label="locked">
                  🔒
                </span>
              )}
            </Link>
          ))}
        </nav>
        <div className="sidebar-bottom">
          {owner ? (
            <div className="grow-card">
              <Leaf size={23} />
              <strong>Fill every seat.</strong>
              <p>Share your Library ID so students can join and punch in.</p>
              <Link href="/owner/join-requests" onClick={() => setMenu(false)}>
                Invite students <ArrowUpRight size={15} />
              </Link>
            </div>
          ) : (
            !admin && (
              <div className="grow-card">
                <Leaf size={23} />
                <strong>Small steps. Big things.</strong>
                <p>Your next chapter starts with today’s focus.</p>
                <Link href="/app/focus" onClick={() => setMenu(false)}>
                  Find your focus <ArrowUpRight size={15} />
                </Link>
              </div>
            )
          )}
          {!admin && (
            <Link
              className="nav-item"
              href={profileHref}
              onClick={() => setMenu(false)}
            >
              <Settings size={19} />
              Settings
            </Link>
          )}
          <Link
            className="nav-item"
            href={
              owner
                ? "/guide?for=owner"
                : admin
                  ? "/features"
                  : "/guide?for=student"
            }
          >
            <HelpCircle size={19} />
            Help & resources
          </Link>
          <div className="profile-row">
            <span className="avatar">
              {preview ? "A" : String(d.user?.name || "S").slice(0, 1)}
            </span>
            <div>
              <strong>{preview ? "Alex Morgan" : String(d.user?.name)}</strong>
              <small>
                {preview ? "Preview account" : String(d.user?.role)}
              </small>
            </div>
            <button
              className="icon-btn"
              aria-label="Sign out"
              onClick={async () => {
                await fetch("/api/auth/logout", { method: "POST" });
                await clearClientCaches();
                router.push("/login");
                router.refresh();
              }}
            >
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </aside>
      <div className="main-wrap">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="icon-btn menu-toggle"
              onClick={() => setMenu(true)}
              aria-label="Open navigation"
            >
              <Menu />
            </button>
            <span>{owner ? "Workspace" : "My study space"}</span>
            <ChevronRight size={14} />
            <strong>{title}</strong>
          </div>
          <div className="top-actions">
            <span className="today">
              <CalendarDays size={15} />
              {new Date().toLocaleDateString("en-IN", {
                day: "numeric",
                month: "short",
                year: "numeric",
              })}
            </span>
            <button
              className="icon-btn"
              aria-label="Toggle color theme"
              onClick={toggle}
            >
              {dark ? <Sun size={19} /> : <Moon size={19} />}
            </button>
            {!admin && (
              <Link
                className="icon-btn bell"
                aria-label={unread ? "Notifications (unread)" : "Notifications"}
                href={notificationsHref}
              >
                <Bell size={20} />
                {unread && <i />}
              </Link>
            )}
            <Link
              className="avatar small"
              href={profileHref}
              aria-label={owner ? "Open library profile" : "Open my profile"}
            >
              {preview ? "A" : String(d.user?.name || "S")[0]}
            </Link>
          </div>
        </header>
        <main className="main-content">
          {owner && !preview && <RememberLibraryName />}
          {owner && !preview && path !== "/owner/onboarding" && <PlanBanner />}
          {!owner &&
            !admin &&
            !preview &&
            String(d.user?.role) === "student" && <RememberStudentLibrary />}
          {!owner &&
            !admin &&
            !preview &&
            String(d.user?.role) === "student" &&
            path !== "/app/join" && <JoinBanner />}
          {preview && (
            <div className="preview-banner">
              <Sparkles size={14} />
              <span>Interactive preview · Sample data, no changes saved</span>
              <Link href="/register">
                Create your account <ArrowRight size={13} />
              </Link>
            </div>
          )}
          {!allowed ? (
            <div className="empty">
              <ShieldCheck />
              <h2>This workspace requires a different role.</h2>
              <Link
                className="button"
                href={d.user?.role === "student" ? "/app" : "/owner"}
              >
                Open my workspace
              </Link>
            </div>
          ) : isLoading ? (
            <BrandLoader compact text="Loading your workspace…" />
          ) : lockedFeature ? (
            <div className="premium-lock">
              <span className="premium-lock-icon" aria-hidden="true">🔒</span>
              <h2>{STUDENT_FEATURES[lockedFeature].label} is a premium feature</h2>
              <p>{lockedMessage(d.studentAccess?.reason ?? "no-membership")}</p>
              {d.studentAccess?.reason === "dues" && d.studentAccess.duePaise > 0 && (
                <p className="premium-lock-due">Fees due: {money(d.studentAccess.duePaise)}</p>
              )}
              <div className="queue-actions">
                <Link className="button" href="/app/membership">
                  See my fees
                </Link>
                <Link className="button secondary" href="/app">
                  Back to home
                </Link>
              </div>
            </div>
          ) : joinPath ? (
            preview ? (
              <div className="mt-empty">
                <h2>Sign in to use this page</h2>
                <p>Preview mode saves nothing.</p>
              </div>
            ) : path === "/app/join" ? (
              <StudentJoin notify={setToast} />
            ) : path === "/app/punch" ? (
              <StudentPunch notify={setToast} />
            ) : path === "/owner/join-requests" ? (
              <>
                <OwnerSeatChanges notify={setToast} />
                <OwnerJoinRequests notify={setToast} />
              </>
            ) : (
              <OwnerPresence notify={setToast} />
            )
          ) : importPath ? (
            preview ? (
              <div className="mt-empty">
                <h2>Sign in to import</h2>
              </div>
            ) : (
              <PilotImport notify={setToast} />
            )
          ) : securityPath ? (
            preview ? (
              <div className="mt-empty">
                <h2>Sign in to manage your account</h2>
              </div>
            ) : (
              <AccountSecurity role={String(d.user?.role)} notify={setToast} />
            )
          ) : platformPath ? (
            path === "/super-admin/features" ? (
              <PlatformFeatures notify={setToast} />
            ) : path === "/super-admin/student-features" ? (
              <PlatformStudentRules notify={setToast} />
            ) : (
              <PlatformAccounts notify={setToast} />
            )
          ) : saasAdminPath ? (
            <SaasAdmin
              key={path}
              notify={setToast}
              initialTab={path === "/super-admin/plans" ? "plans" : "overview"}
            />
          ) : saasOwnerPath ? (
            preview ? (
              <div className="mt-empty">
                <h2>Sign in to use this page</h2>
                <p>Preview mode saves nothing.</p>
              </div>
            ) : path === "/owner/billing" ? (
              <OwnerBilling notify={setToast} />
            ) : path === "/owner/branches" ? (
              <OwnerBranches notify={setToast} />
            ) : path === "/owner/crm" ? (
              <OwnerCrm notify={setToast} />
            ) : path === "/owner/support" ? (
              <OwnerSupport notify={setToast} />
            ) : (
              <Onboarding notify={setToast} />
            )
          ) : trackerPath || partnerPath ? (
            preview ? (
              <div className="mt-empty">
                <h2>Sign in to use this</h2>
                <p>Preview mode saves nothing.</p>
              </div>
            ) : trackerPath ? (
              <SyllabusTracker notify={setToast} />
            ) : (
              <StudyPartnerPage notify={setToast} />
            )
          ) : libraryNotesPath ? (
            preview ? (
              <div className="mt-empty">
                <h2>Sign in to read your library&apos;s notes</h2>
                <p>Preview mode has no real library.</p>
              </div>
            ) : (
              <LibraryNotes />
            )
          ) : leaderboardPath ? (
            preview ? (
              <div className="mt-empty">
                <h2>Sign in to see your library leaderboard</h2>
                <p>Preview mode has no real study data.</p>
              </div>
            ) : (
              <Leaderboard notify={setToast} />
            )
          ) : reportPath ? (
            preview ? (
              <div className="mt-empty">
                <h2>Sign in to see your weekly report</h2>
                <p>Preview mode has no real study data.</p>
              </div>
            ) : (
              <ReportSwitch notify={setToast} />
            )
          ) : prepPath ? (
            <ExamPrep preview={preview} notify={setToast} />
          ) : prepAdminPath ? (
            <PrepAdmin notify={setToast} />
          ) : communityPath ? (
            path === "/owner/moderation" ? (
              <>
                <CommunityModeration notify={setToast} />
                <OwnerSharedNotes notify={setToast} />
              </>
            ) : (
              <Community preview={preview} notify={setToast} />
            )
          ) : maintenancePath ? (
            preview ? (
              <div className="mt-empty">
                <h2>Sign in to use maintenance</h2>
                <p>
                  Preview mode saves nothing, so issue reporting is disabled.
                </p>
              </div>
            ) : (
              <Maintenance owner={owner} notify={setToast} />
            )
          ) : discoveryPath ? (
            <LibraryDiscovery
              mode={
                path === "/app/library-requests"
                  ? "mine"
                  : path === "/owner/waitlist"
                    ? "waitlist"
                    : "owner"
              }
              notify={setToast}
            />
          ) : rewardsPath ? (
            <RewardsMarketplace
              owner={owner}
              preview={preview}
              notify={setToast}
            />
          ) : doubtPath ? (
            <DoubtSolver preview={preview} notify={setToast} />
          ) : learningPath ? (
            <LearningIntelligence
              key={path}
              path={path}
              preview={preview}
              notify={setToast}
            />
          ) : phase2Path ? (
            <Phase2Experience
              key={path}
              path={path}
              preview={preview}
              userName={String(d.user?.name || "")}
              notify={setToast}
            />
          ) : owner ? (
            <Owner
              key={path}
              path={path}
              data={d}
              preview={preview}
              mutate={mutate}
              notify={setToast}
            />
          ) : admin ? (
            <Admin
              data={d}
              preview={preview}
              mutate={mutate}
              notify={setToast}
            />
          ) : (
            <Student
              path={path}
              data={d}
              preview={preview}
              mutate={mutate}
              notify={setToast}
            />
          )}
        </main>
        <footer className="app-footer">
          <span>Made for a little more focus, and a lot more you.</span>
          <span>
            <span className="status-dot" />{" "}
            {preview ? "Preview mode" : "Your personal study space"}
          </span>
        </footer>
      </div>
      <nav className="bottom-nav">
        {nav.slice(0, 4).map(([href, label, Icon]) => (
          <Link
            key={href}
            href={href}
            className={path === href ? "active" : ""}
          >
            <Icon size={21} />
            <span>{label}</span>
          </Link>
        ))}
        <button
          type="button"
          className={menu ? "active" : ""}
          onClick={() => setMenu(true)}
          aria-label="Open full menu"
          aria-expanded={menu}
        >
          <Menu size={21} />
          <span>More</span>
        </button>
      </nav>
      {toast && (
        <div role="status" className="toast">
          <CheckCircle2 size={18} />
          {toast}
          <button
            className="icon-btn"
            onClick={() => setToast("")}
            aria-label="Dismiss"
          >
            <X size={15} />
          </button>
        </div>
      )}
    </div>
  );
}
type Props = {
  path: string;
  data: Data;
  preview: boolean;
  mutate: (a: string, d?: unknown) => Promise<unknown>;
  notify: (v: string) => void;
};
function Student({ path, data: d, preview, mutate, notify }: Props) {
  const [complaintOpen, setComplaintOpen] = useState(false);
  const xp = preview ? 1240 : d.summary?.xp || 0;
  const lv = level(xp);
  const [goal, setGoal] = useState(Number(d.profile?.goalMinutes) || 120);
  const [exam, setExam] = useState(
    String(d.profile?.exam || "Competitive exams"),
  );
  const [anonymous, setAnonymous] = useState(d.profile?.anonymous !== false);
  const today = new Date().toISOString().slice(0, 10);
  const todayFocus = d.xp.filter(
    (x) => x.day === today && String(x.source).startsWith("focus:"),
  ).length;
  const minutes = preview ? 85 : todayFocus * 25;
  const chart = preview
    ? previewChart
    : Array.from({ length: 7 }, (_, i) => {
        const date = new Date();
        date.setDate(date.getDate() - 6 + i);
        const day = date.toISOString().slice(0, 10);
        return {
          day: date.toLocaleDateString("en", { weekday: "short" }),
          hours:
            (d.xp.filter(
              (x) => x.day === day && String(x.source).startsWith("focus:"),
            ).length *
              25) /
            60,
        };
      });
  const quests = [
    {
      icon: Clock3,
      title: "Find your flow",
      description: "Complete 2 focus sessions",
      current: preview ? 1 : todayFocus,
      total: 2,
      xp: 20,
      color: "mint",
    },
    {
      icon: BookOpen,
      title: "Make time for yourself",
      description: `Reach your ${goal}-minute daily goal`,
      current: minutes,
      total: goal,
      xp: 20,
      color: "violet",
    },
    {
      icon: Flame,
      title: "Keep the spark alive",
      description: "Study on 5 days this week",
      current: preview
        ? 4
        : new Set(
            d.xp
              .filter(
                (x) =>
                  String(x.day) >=
                  new Date(+new Date(today) - 6 * 86400000)
                    .toISOString()
                    .slice(0, 10),
              )
              .map((x) => x.day),
          ).size,
      total: 5,
      xp: 50,
      color: "peach",
    },
  ];
  const achievements = [
    {
      title: "First steps",
      description: "Complete your first focus session",
      icon: Leaf,
      unlocked: preview || d.xp.length > 0,
    },
    {
      title: "In the zone",
      description: "Complete 10 focus sessions",
      icon: Zap,
      unlocked:
        preview ||
        d.xp.filter((x) => String(x.source).startsWith("focus:")).length >= 10,
    },
    {
      title: "A steady spark",
      description: "Study on 7 different days",
      icon: Flame,
      unlocked: preview || new Set(d.xp.map((x) => x.day)).size >= 7,
    },
    {
      title: "The long game",
      description: "Earn 2,500 XP",
      icon: Trophy,
      unlocked: xp >= 2500,
    },
  ];
  const greeting = (
    <div className="page-heading">
      <div>
        <div className="eyebrow">YOUR NEXT CHAPTER STARTS HERE</div>
        <h1>
          {path === "/app"
            ? `Let’s make today count, ${preview ? "Alex" : String(d.user?.name).split(" ")[0]}`
            : path === "/app/focus"
              ? "One thing at a time."
              : path === "/app/quests"
                ? "A little challenge. A little growth."
                : path === "/app/achievements"
                  ? "Look how far you’ve come."
                  : path === "/app/progress"
                    ? "Your effort adds up."
                    : path === "/app/membership"
                      ? "Your space to grow."
                      : path === "/app/profile"
                        ? "Make this space yours."
                        : "You’re all caught up."}
          <span className="heading-spark"> ✦</span>
        </h1>
        <p>
          {path === "/app"
            ? "Big dreams are built on small, focused moments. You’ve got this."
            : "Every small step is part of your bigger story."}
        </p>
      </div>
      {path === "/app" && (
        <Link className="button" href="/app/focus">
          <Play size={16} fill="currentColor" />
          Start a focus session
        </Link>
      )}
    </div>
  );
  if (path === "/app/check-in")
    return (
      <>
        {greeting}
        <section className="card focus-room">
          <span className="icon-tile mint">
            <CheckCircle2 />
          </span>
          <h2>Make yourself at home.</h2>
          <p>Check in to your library using this time-limited code.</p>
          <button
            className="button"
            onClick={async () => {
              try {
                const token = new URLSearchParams(window.location.search).get(
                  "token",
                );
                await mutate("check-in", { token });
                notify("You’re checked in. Have a great study session.");
              } catch (e) {
                notify((e as Error).message);
              }
            }}
          >
            Confirm my check-in
          </button>
        </section>
      </>
    );
  if (path === "/app/profile")
    return (
      <>
        {greeting}
        <section className="card form-card">
          <h2>Your study preferences</h2>
          <label>
            Exam / preparation category
            <input value={exam} onChange={(e) => setExam(e.target.value)} />
          </label>
          <label>
            Daily focus goal (minutes)
            <input
              type="number"
              min="25"
              max="480"
              value={goal}
              onChange={(e) => setGoal(+e.target.value)}
            />
          </label>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={anonymous}
              onChange={(e) => setAnonymous(e.target.checked)}
            />
            Keep my profile private on leaderboards
          </label>
          <button
            className="button"
            onClick={async () => {
              try {
                await mutate("profile", { exam, goalMinutes: goal, anonymous });
                notify("Preferences saved");
              } catch (e) {
                notify((e as Error).message);
              }
            }}
          >
            Save preferences
          </button>
          <p className="muted">
            Rest days preserve your momentum. No public leaderboard is enabled.
          </p>
          <button
            className="button secondary"
            onClick={async () => {
              try {
                await mutate("rest-day");
                notify("Rest day saved. Your streak is protected.");
              } catch (e) {
                notify((e as Error).message);
              }
            }}
          >
            <Leaf size={17} />
            Take a rest day
          </button>
        </section>
        {!preview && <PushToggle notify={notify} />}
      </>
    );
  if (path === "/app/focus")
    return (
      <>
        {greeting}
        <Focus data={d} preview={preview} mutate={mutate} notify={notify} />
        <div className="gentle-note">
          <Leaf size={20} />
          <div>
            <strong>Progress includes taking a break.</strong>
            <p>
              After a focus session, step away for five minutes. Your mind
              deserves a little breathing room.
            </p>
          </div>
        </div>
      </>
    );
  if (path === "/app/notifications")
    return (
      <>
        {greeting}
        <section className="card">
          {d.notifications.length ? (
            d.notifications.map((n) => (
              <div className="list-row" key={String(n._id)}>
                <Bell />
                <div>
                  <strong>{n.title}</strong>
                  <p>{n.message}</p>
                </div>
              </div>
            ))
          ) : (
            <Empty
              icon={Bell}
              title="A quiet moment"
              text="Library announcements and personal updates will appear here."
            />
          )}
        </section>
      </>
    );
  if (path === "/app/membership")
    return (
      <>
        {greeting}
        <section className="card">
          {d.memberships.length ? (
            d.memberships.map((m) => (
              <div className="membership-detail" key={String(m._id)}>
                <BookOpen />
                <h2>Your membership</h2>
                <p>
                  Valid until {new Date(String(m.end)).toLocaleDateString()}
                </p>
                <span className="pill">{m.status}</span>
                <p>
                  Seat{" "}
                  {String(
                    d.seats.find(
                      (s) =>
                        String(s._id) ===
                        String(
                          d.assignments?.find(
                            (a) => String(a.membershipId) === String(m._id),
                          )?.seatId,
                        ),
                    )?.label || "—",
                  )}
                </p>
                <h3>
                  Balance due:{" "}
                  {money(
                    Number(m.amount) - Number(m.discount) - Number(m.paid),
                  )}
                </h3>
                <p>
                  Contact your library to renew or record a cash / UPI payment.
                </p>
              </div>
            ))
          ) : (
            <Empty
              icon={BookOpen}
              title="Your next favourite study spot"
              text="Already a library member? Ask the owner to connect your registered email. Standalone study mode is always available."
            />
          )}
        </section>
        {!preview && <LibraryTimings library={d.library} />}
        {!preview && d.user?.libraryId && d.memberships.length > 0 && (
          <StudentSeatChange seats={d.seats} shifts={d.shifts} notify={notify} />
        )}
        {d.user?.libraryId && (
          <section className="card" style={{ marginTop: 20 }}>
            <div className="section-heading">
              <h2>Your library, your voice.</h2>
              <button
                className="button secondary"
                onClick={() => setComplaintOpen(true)}
              >
                Raise a concern
              </button>
            </div>
            {d.payments.map((p) => (
              <Link
                key={String(p._id)}
                className="list-row"
                href={`/api/receipts/${p._id}`}
                target="_blank"
              >
                <Receipt size={18} />
                <strong>{p.receipt}</strong>
                <span>{money(Number(p.amount))}</span>
                <ArrowUpRight size={16} />
              </Link>
            ))}
          </section>
        )}
        {complaintOpen && (
          <RecordModal
            title="Share a concern"
            fields={[
              { name: "title", label: "Subject" },
              { name: "message", label: "What can your library help with?" },
            ]}
            onClose={() => setComplaintOpen(false)}
            onSubmit={async (values) => {
              await mutate("complaints", values);
              notify("Your concern has been shared with your library.");
              setComplaintOpen(false);
            }}
          />
        )}
      </>
    );
  return (
    <>
      {greeting}
      {path === "/app" && !preview && <LibraryToday library={d.library} />}
      {path === "/app" && !preview && <ExamCountdown exam={d.exam} />}
      {path === "/app" && (
        <>
          <section className="journey-hero">
            <div className="hero-copy">
              <span className="pill translucent">
                <span className="tiny-spark">✦</span> YOUR JOURNEY, YOUR PACE
              </span>
              <h2>
                A little focus.
                <br />A bigger future.
              </h2>
              <p>
                Show up for your goals. Build your momentum.
                <br />
                Become who you’re working towards.
              </p>
              <Link href="/app/focus" className="button white">
                Let’s get into the zone <ArrowRight size={17} />
              </Link>
              <div className="hero-foot">
                <span className="hero-avatars">◉ ◉ ◉</span>
                <span>A good day starts with one small step.</span>
              </div>
            </div>
            <Garden />
            <span className="hero-label">
              <Leaf size={14} /> Grow at your own pace
            </span>
          </section>
          <div className="stats-grid">
            <Stat
              icon={Clock3}
              color="mint"
              label="Focused today"
              value={`${minutes} min`}
              detail={`of your ${goal} min daily goal`}
              progress={Math.min(100, (minutes / goal) * 100)}
            />
            <Stat
              icon={Flame}
              color="peach"
              label="Current streak"
              value={`${
                preview
                  ? 7
                  : streak(
                      d.xp
                        .filter((x) => String(x.source).startsWith("focus:"))
                        .map((x) => String(x.day)),
                      today,
                      Array.isArray(d.profile?.restDays)
                        ? d.profile.restDays
                        : [],
                    )
              } days`}
              detail="One day at a time. Keep going!"
            />
            <Stat
              icon={Zap}
              color="violet"
              label="Total XP earned"
              value={xp.toLocaleString()}
              detail={`Level ${lv} · ${Math.max(0, lv * lv * 50 - xp)} XP to next level`}
              progress={
                ((xp - (lv - 1) ** 2 * 50) /
                  (lv ** 2 * 50 - (lv - 1) ** 2 * 50)) *
                100
              }
            />
            <Stat
              icon={Trophy}
              color="amber"
              label="Achievements"
              value={`${achievements.filter((a) => a.unlocked).length} / 4`}
              detail="Little milestones. Big meaning."
            />
          </div>
        </>
      )}
      <div className={path === "/app" ? "dashboard-grid" : "single-grid"}>
        {(path === "/app" || path === "/app/quests") && (
          <section className="card quests">
            <div className="section-heading">
              <div>
                <h2>
                  Your next quests{" "}
                  <span className="pill">
                    {quests.filter((q) => q.current >= q.total).length} / 3
                  </span>
                </h2>
                <p>A few small wins for a better you.</p>
              </div>
              <span className="muted tiny">
                <Clock3 size={13} /> Daily & weekly
              </span>
            </div>
            {quests.map((q) => (
              <div className="quest" key={q.title}>
                <span className={`icon-tile ${q.color}`}>
                  <q.icon size={21} />
                </span>
                <div className="quest-body">
                  <div className="quest-title">
                    <strong>{q.title}</strong>
                    <span className="xp-label">✦ {q.xp} XP</span>
                  </div>
                  <p>{q.description}</p>
                  <div className="quest-progress">
                    <div className="progress-track">
                      <div
                        style={{
                          width: `${Math.min(100, (q.current / q.total) * 100)}%`,
                        }}
                      />
                    </div>
                    <span>
                      {Math.min(q.current, q.total)}/{q.total}
                    </span>
                  </div>
                </div>
                <span
                  className={`quest-check ${q.current >= q.total ? "done" : ""}`}
                >
                  {q.current >= q.total && <Check size={12} />}
                </span>
              </div>
            ))}
            <p className="tiny muted">
              Progress is verified from completed focus sessions.
            </p>
          </section>
        )}
        {path === "/app" && !preview && <TodayCards notify={notify} />}
        {path === "/app/progress" && !preview && <Insights />}
        {(path === "/app" || path === "/app/progress") && (
          <section className="card chart-card">
            <div className="section-heading">
              <div>
                <h2>Your focus, in perspective</h2>
                <p>Every minute is an investment in you.</p>
              </div>
              <span className="pill neutral">This week</span>
            </div>
            <div className="chart-total">
              <strong>
                {chart.reduce((s, p) => s + p.hours, 0).toFixed(1)}
                <span> hrs</span>
              </strong>
              <span className="positive">
                <ArrowUpRight size={14} />
                {preview ? "Your momentum is growing" : "Time well spent"}
              </span>
            </div>
            <div className="chart">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chart}>
                  <defs>
                    <linearGradient
                      id="focusGradient"
                      x1="0"
                      y1="0"
                      x2="0"
                      y2="1"
                    >
                      <stop offset="0%" stopColor="#76bda3" stopOpacity={0.4} />
                      <stop offset="100%" stopColor="#76bda3" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis
                    dataKey="day"
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: "#89938e", fontSize: 11 }}
                    dy={8}
                  />
                  <Tooltip
                    contentStyle={{
                      borderRadius: 12,
                      border: "1px solid #dde7e0",
                    }}
                    formatter={(v) => [`${Number(v).toFixed(1)} hrs`, "Focus"]}
                  />
                  <Area
                    type="monotone"
                    dataKey="hours"
                    stroke="#318d73"
                    strokeWidth={2.5}
                    fill="url(#focusGradient)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </section>
        )}
        {(path === "/app" || path === "/app/achievements") && (
          <section className="card achievement-card">
            <div className="section-heading">
              <div>
                <h2>Little badges. Real growth.</h2>
                <p>Celebrate the person you’re becoming.</p>
              </div>
              <Link href="/app/achievements" className="text-link">
                View all <ArrowRight size={14} />
              </Link>
            </div>
            <div className="badges">
              {achievements.map((a) => (
                <div
                  key={a.title}
                  className={`badge-item ${a.unlocked ? "" : "locked"}`}
                  title={a.description}
                >
                  <div className="medallion">
                    <a.icon size={30} />
                    <span>✦</span>
                  </div>
                  <strong>{a.title}</strong>
                  <small>{a.unlocked ? "Unlocked" : a.description}</small>
                </div>
              ))}
            </div>
          </section>
        )}
        {path === "/app" && (
          <section className="card streak-card">
            <div className="section-heading">
              <div>
                <h2>
                  Keep your spark alive <Flame size={18} color="#dd905d" />
                </h2>
                <p>Consistency feels good. Rest counts too.</p>
              </div>
              <strong className="streak-number">
                {preview
                  ? 7
                  : streak(
                      d.xp
                        .filter((x) => String(x.source).startsWith("focus:"))
                        .map((x) => String(x.day)),
                      today,
                      Array.isArray(d.profile?.restDays)
                        ? d.profile.restDays
                        : [],
                    )}
                <small>day streak</small>
              </strong>
            </div>
            <div className="week-days">
              {["M", "T", "W", "T", "F", "S", "S"].map((day, i) => (
                <div key={i}>
                  <small>{day}</small>
                  <span
                    className={preview || chart[i].hours > 0 ? "studied" : ""}
                  >
                    {preview || chart[i].hours > 0 ? (
                      <Check size={16} />
                    ) : (
                      <span>·</span>
                    )}
                  </span>
                </div>
              ))}
            </div>
            <div className="streak-note">
              <Leaf size={15} /> A little progress, every day.
            </div>
          </section>
        )}
      </div>
      {path === "/app" && (
        <div className="daily-quote">
          <span>“</span>
          <p>
            You don’t have to be great to start, but you have to start to be
            great.<small>YOUR DAILY DOSE OF PERSPECTIVE</small>
          </p>
          <Sparkles size={22} />
        </div>
      )}
    </>
  );
}
// Group amounts (paise) by a label and return them largest first.
function totalsBy(rows: Row[], key: string) {
  const sums = new Map<string, number>();
  for (const r of rows) {
    const label = String(r[key] || "Other");
    sums.set(label, (sums.get(label) || 0) + Number(r.amount || 0));
  }
  return [...sums].sort((a, b) => b[1] - a[1]);
}
function OwnerReports({ data: d }: { data: Data }) {
  const revenue = d.summary?.revenue || 0,
    expenses = d.summary?.expenses || 0,
    due = d.summary?.due || 0;
  const [now] = useState(() => new Date());
  const months = Array.from({ length: 6 }, (_, i) => {
    const m = new Date(now.getFullYear(), now.getMonth() - 5 + i, 1);
    return {
      key: `${m.getFullYear()}-${m.getMonth()}`,
      name: m.toLocaleDateString("en-IN", { month: "short" }),
      Revenue: 0,
      Expenses: 0,
    };
  });
  const bucket = (value: unknown) => {
    const t = new Date(String(value));
    return months.find((m) => m.key === `${t.getFullYear()}-${t.getMonth()}`);
  };
  for (const p of d.payments) {
    const m = bucket(p.createdAt);
    if (m) m.Revenue += Number(p.amount || 0) / 100;
  }
  for (const e of d.expenses) {
    const m = bucket(e.date || e.createdAt);
    if (m) m.Expenses += Number(e.amount || 0) / 100;
  }
  const byCategory = totalsBy(d.expenses, "category");
  const byMethod = totalsBy(d.payments, "method");
  const statusCounts = new Map<string, number>();
  for (const m of d.memberships)
    statusCounts.set(
      String(m.status || "unknown"),
      (statusCounts.get(String(m.status || "unknown")) || 0) + 1,
    );
  const weekAgo = +now - 7 * 864e5;
  const visits = d.attendance.filter(
    (a) => +new Date(String(a.checkIn || a.day)) >= weekAgo,
  ).length;
  const seatsTaken = new Set(
    (d.assignments || [])
      .filter(
        (a) =>
          +new Date(String(a.start)) <= +now && +new Date(String(a.end)) > +now,
      )
      .map((a) => String(a.seatId)),
  ).size;
  const seats = d.summary?.seats || d.seats.length;
  const list = (rows: [string, number][], empty: string) =>
    rows.length ? (
      rows.map(([label, amount]) => (
        <div className="list-row" key={label}>
          <strong style={{ textTransform: "capitalize" }}>{label}</strong>
          <span style={{ marginLeft: "auto" }}>{money(amount)}</span>
        </div>
      ))
    ) : (
      <p className="muted">{empty}</p>
    );
  return (
    <>
      <div className="stats-grid">
        <Stat
          icon={Wallet}
          color="mint"
          label="Money in"
          value={money(revenue)}
          detail="All confirmed payments"
        />
        <Stat
          icon={Receipt}
          color="amber"
          label="Money out"
          value={money(expenses)}
          detail="All recorded expenses"
        />
        <Stat
          icon={ChartNoAxesCombined}
          color="violet"
          label="Net profit"
          value={money(revenue - expenses)}
          detail="Money in minus money out"
        />
        <Stat
          icon={CreditCard}
          color="peach"
          label="Fees still due"
          value={money(due)}
          detail="Unpaid membership balance"
        />
      </div>
      <section className="card">
        <div className="section-heading">
          <div>
            <h2>Last 6 months</h2>
            <p>
              Money in (green) and money out (orange) each month, from your
              latest 100 payments and expenses.
            </p>
          </div>
          <ChartNoAxesCombined size={20} />
        </div>
        <div className="chart">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={months}>
              <XAxis dataKey="name" axisLine={false} tickLine={false} />
              <Tooltip formatter={(v) => money(Number(v) * 100)} />
              <Bar dataKey="Revenue" fill="#438d75" radius={[6, 6, 0, 0]} />
              <Bar dataKey="Expenses" fill="#d9925b" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>
      <div className="dashboard-grid">
        <section className="card">
          <h2>Where money goes</h2>
          <p className="muted">Expenses by category.</p>
          {list(byCategory, "No expenses recorded yet.")}
        </section>
        <section className="card">
          <h2>How students pay</h2>
          <p className="muted">Payments by method.</p>
          {list(byMethod, "No payments recorded yet.")}
        </section>
      </div>
      <div className="stats-grid">
        <Stat
          icon={Armchair}
          color="mint"
          label="Seats in use now"
          value={`${seatsTaken} / ${seats}`}
          detail={
            seats
              ? `${Math.round((seatsTaken / seats) * 100)}% filled`
              : "Add seats to start"
          }
        />
        <Stat
          icon={CheckCircle2}
          color="violet"
          label="Visits this week"
          value={String(visits)}
          detail="Check-ins in the last 7 days"
        />
        {[...statusCounts].slice(0, 2).map(([status, count]) => (
          <Stat
            key={status}
            icon={BookOpen}
            color="peach"
            label={`${status[0].toUpperCase()}${status.slice(1)} memberships`}
            value={String(count)}
            detail="From your latest 100"
          />
        ))}
      </div>
    </>
  );
}
function Stat({
  icon: Icon,
  color,
  label,
  value,
  detail,
  progress,
}: {
  icon: LucideIcon;
  color: string;
  label: string;
  value: string;
  detail: string;
  progress?: number;
}) {
  return (
    <section className="card stat">
      <div className="stat-top">
        <span className={`icon-tile ${color}`}>
          <Icon size={20} />
        </span>
        <span>{label}</span>
      </div>
      <strong className="stat-value">{value}</strong>
      {progress !== undefined && (
        <div className="progress-track">
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${progress}%` }}
            transition={{ duration: 0.4 }}
          />
        </div>
      )}
      <p>{detail}</p>
    </section>
  );
}
const toTime = (m: number) =>
  `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const fromTime = (v: string) => {
  const [h, m] = v.split(":").map(Number);
  return h * 60 + m;
};
const prettyDate = (d: string) =>
  new Date(`${d}T00:00:00`).toLocaleDateString("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });

/** Days left to the student's exam, or a nudge to set it. */
function ExamCountdown({ exam }: { exam?: Data["exam"] }) {
  const [now] = useState(() => new Date());
  if (!exam)
    return (
      <Link className="exam-countdown empty" href="/app/roadmap">
        <CalendarDays size={18} aria-hidden="true" />
        <span>Set your exam and date to see a countdown</span>
        <ArrowRight size={16} aria-hidden="true" />
      </Link>
    );
  const days = daysUntil(exam.date, now);
  return (
    <Link className={`exam-countdown${days >= 0 && days <= 30 ? " soon" : ""}`} href="/app/roadmap">
      {days > 0 && <strong className="exam-days">{days}</strong>}
      <span>
        {countdownText(days, exam.title)}
        <small>{new Date(`${exam.date}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })}</small>
      </span>
      <ArrowRight size={16} aria-hidden="true" />
    </Link>
  );
}

/** One line for students: open now / closed today / holiday, from the library's timings. */
function LibraryToday({ library }: { library?: Data["library"] }) {
  const [now] = useState(() => new Date());
  if (!library?.hours?.length && !library?.holidays?.length) return null;
  const t = todayStatus(library.hours, library.holidays, now);
  if (t.kind === "unknown") return null;
  const text =
    t.kind === "holiday"
      ? `${library.name ?? "Your library"} is closed today: ${t.note}.`
      : t.kind === "closed"
        ? `${library.name ?? "Your library"} is closed today.`
        : `${t.openNow ? "Open now" : "Closed now"} · today ${clockLabel(t.open)} – ${clockLabel(t.close)}`;
  return (
    <div
      className={`library-today ${t.kind === "open" && t.openNow ? "open" : "closed"}`}
      role="status"
    >
      <Clock3 size={16} aria-hidden="true" />
      <span>{text}</span>
    </div>
  );
}

/** Students: the full week and the next holidays. */
function LibraryTimings({ library }: { library?: Data["library"] }) {
  const [now] = useState(() => new Date());
  if (!library?.hours?.length) return null;
  const holidays = upcomingHolidays(library.holidays, now);
  return (
    <section className="card" style={{ marginTop: 20 }}>
      <h2>Library timings</h2>
      <div className="hours-list">
        {[1, 2, 3, 4, 5, 6, 0].map((day) => {
          const h = library.hours?.find((x) => x.day === day);
          return (
            <div key={day} className="hours-row">
              <span>{DAY_NAMES[day]}</span>
              <strong>
                {!h || h.closed
                  ? "Closed"
                  : `${clockLabel(h.open)} – ${clockLabel(h.close)}`}
              </strong>
            </div>
          );
        })}
      </div>
      <h3 className="hours-sub">Upcoming holidays</h3>
      {holidays.length ? (
        holidays.map((h) => (
          <div key={h.date} className="hours-row">
            <span>{prettyDate(h.date)}</span>
            <strong>{h.note}</strong>
          </div>
        ))
      ) : (
        <p className="muted">No holidays announced.</p>
      )}
    </section>
  );
}

/** Owners: edit weekly timings and holidays. */
function LibraryHoursEditor({
  library,
  mutate,
  notify,
}: {
  library?: Data["library"];
  mutate: Props["mutate"];
  notify: Props["notify"];
}) {
  const [hours, setHours] = useState<DayHours[]>(() =>
    DEFAULT_HOURS.map((d) => library?.hours?.find((h) => h.day === d.day) ?? d),
  );
  const [busy, setBusy] = useState(false);
  const run = async (action: string, value: unknown, done: string) => {
    setBusy(true);
    try {
      await mutate(action, value);
      notify(done);
      return true;
    } catch (e) {
      notify((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  };
  const set = (day: number, patch: Partial<DayHours>) =>
    setHours((list) =>
      list.map((h) => (h.day === day ? { ...h, ...patch } : h)),
    );
  return (
    <section className="card" style={{ marginTop: 20 }}>
      <h2>Library timings & holidays</h2>
      <p className="muted">
        Students see “open now” or “closed today” in their app, so nobody comes
        to a closed library.
      </p>
      <div className="hours-edit">
        {[1, 2, 3, 4, 5, 6, 0].map((day) => {
          const h = hours.find((x) => x.day === day)!;
          return (
            <div key={day} className="hours-edit-row">
              <span>{DAY_NAMES[day]}</span>
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={h.closed}
                  onChange={(e) => set(day, { closed: e.target.checked })}
                />{" "}
                Closed
              </label>
              <input
                type="time"
                aria-label={`${DAY_NAMES[day]} opens`}
                value={toTime(h.open)}
                disabled={h.closed}
                onChange={(e) =>
                  e.target.value && set(day, { open: fromTime(e.target.value) })
                }
              />
              <input
                type="time"
                aria-label={`${DAY_NAMES[day]} closes`}
                value={toTime(h.close)}
                disabled={h.closed}
                onChange={(e) =>
                  e.target.value &&
                  set(day, { close: fromTime(e.target.value) })
                }
              />
            </div>
          );
        })}
      </div>
      <button
        className="button"
        disabled={busy}
        onClick={() =>
          run("library-hours", { hours }, "Library timings saved.")
        }
      >
        Save timings
      </button>
      <h3 className="hours-sub">Holidays</h3>
      <form
        className="hours-holiday-form"
        onSubmit={async (e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          const form = e.currentTarget;
          if (
            await run(
              "holiday-add",
              { date: f.get("date"), note: f.get("note") },
              "Holiday added. Students will see it.",
            )
          )
            form.reset();
        }}
      >
        <input name="date" type="date" required aria-label="Holiday date" />
        <input
          name="note"
          required
          maxLength={80}
          placeholder="Reason, e.g. Diwali"
          aria-label="Holiday reason"
        />
        <button className="button secondary" disabled={busy}>
          Add holiday
        </button>
      </form>
      {(library?.holidays ?? []).length ? (
        [...(library?.holidays ?? [])]
          .sort((a, b) => a.date.localeCompare(b.date))
          .map((h) => (
            <div key={h.date} className="hours-row">
              <span>{prettyDate(h.date)}</span>
              <strong>{h.note}</strong>
              <button
                className="text-link"
                disabled={busy}
                onClick={() =>
                  run("holiday-remove", { date: h.date }, "Holiday removed.")
                }
              >
                Remove
              </button>
            </div>
          ))
      ) : (
        <p className="muted">No holidays yet.</p>
      )}
    </section>
  );
}

function Focus({ data, preview, mutate, notify }: Omit<Props, "path">) {
  const [now, setNow] = useState(() => Date.now());
  const [local, setLocal] = useState<{
    state: string;
    last: number;
    seconds: number;
    target: number;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [pick, setPick] = useState<number>(25);
  const [subject, setSubject] = useState("");
  // Times the student left the app while the timer ran (sent with pause/complete).
  const [left_, setLeft] = useState(0);
  const [quality, setQuality] = useState<number | null>(null);
  const running = data.focus?.state === "running" || local?.state === "running";
  useEffect(() => {
    if (!running) return;
    const away = () => document.visibilityState === "hidden" && setLeft((n) => n + 1);
    document.addEventListener("visibilitychange", away);
    return () => document.removeEventListener("visibilitychange", away);
  }, [running]);
  // Client-only break countdown after a completed session (nothing is saved).
  const [breakEnd, setBreakEnd] = useState<number | null>(null);
  useEffect(() => {
    const i = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(i);
  }, []);
  const focus = preview
    ? local
    : data.focus
      ? {
          state: String(data.focus.state),
          last: +new Date(String(data.focus.lastResumedAt)),
          seconds: Number(data.focus.activeSeconds),
          target: focusLength(Number(data.focus.targetMinutes)),
        }
      : null;
  const target = focus ? focus.target : pick;
  const total = target * 60;
  const elapsed = focus
    ? focus.seconds +
      (focus.state === "running" ? Math.max(0, (now - focus.last) / 1000) : 0)
    : 0;
  const left = Math.max(0, total - Math.floor(elapsed));
  const breakLeft = breakEnd
    ? Math.max(0, Math.round((breakEnd - now) / 1000))
    : 0;
  const onBreak = !focus && breakLeft > 0;
  const shown = onBreak ? breakLeft : left;
  async function act(action: string) {
    setBusy(true);
    try {
      if (preview) {
        if (action === "start")
          setLocal({
            state: "running",
            last: Date.now(),
            seconds: 0,
            target: pick,
          });
        if (action === "pause")
          setLocal({
            state: "paused",
            last: Date.now(),
            seconds: elapsed,
            target,
          });
        if (action === "resume")
          setLocal({
            state: "running",
            last: Date.now(),
            seconds: elapsed,
            target,
          });
        if (action === "complete") {
          setLocal(null);
          setBreakEnd(Date.now() + breakMinutes(target) * 60000);
          notify(
            "Preview complete. Sign up to save your progress and earn XP.",
          );
        }
      } else {
        await mutate(
          "focus." + action,
          action === "start" ? { minutes: pick, subject } : { distractions: left_ },
        );
        if (action !== "start") setLeft(0);
        if (action === "start") {
          setBreakEnd(null);
          setQuality(null);
        }
        if (action === "complete") {
          setQuality(focusQuality(Number(data.focus?.distractions ?? 0) + left_));
          setBreakEnd(Date.now() + breakMinutes(target) * 60000);
          notify(
            `Focus session verified. +${focusXP(target)} XP recorded. Time for a ${breakMinutes(target)}-minute break.`,
          );
        }
      }
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="card focus-room">
      <span className="pill">
        <Leaf size={14} /> {onBreak ? "BREAK TIME" : "FOCUS ROOM"}
      </span>
      <h2>
        {onBreak
          ? "Step away for a moment."
          : "A quiet space for your next big thing."}
      </h2>
      <p>
        {onBreak
          ? "Drink some water, stretch, rest your eyes. Your next session will be sharper."
          : `${target} minutes of intention. One step closer.`}
      </p>
      {!focus && !onBreak && !preview && <SubjectInput value={subject} onChange={setSubject} />}
      {quality !== null && !focus && <p className="pill neutral">Focus quality {quality}%</p>}
      {!focus && !onBreak && (
        <div className="focus-lengths" role="group" aria-label="Session length">
          {FOCUS_LENGTHS.map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={pick === m}
              onClick={() => setPick(m)}
            >
              {m} min
              <small>+{focusXP(m)} XP</small>
            </button>
          ))}
        </div>
      )}
      <div
        className={onBreak ? "timer-ring break" : "timer-ring"}
        style={
          {
            "--progress": `${
              onBreak
                ? Math.min(100, (breakLeft / (breakMinutes(target) * 60)) * 100)
                : Math.min(100, (elapsed / total) * 100)
            }%`,
          } as React.CSSProperties
        }
      >
        <div>
          <span>
            {String(Math.floor(shown / 60)).padStart(2, "0")}
            <i>:</i>
            {String(shown % 60).padStart(2, "0")}
          </span>
          <small>
            {onBreak
              ? "BREAK"
              : focus?.state === "running"
                ? "YOU’RE DOING GREAT"
                : focus?.state === "paused"
                  ? "TAKE YOUR TIME"
                  : "READY WHEN YOU ARE"}
          </small>
        </div>
      </div>
      {onBreak ? (
        <button className="button secondary" onClick={() => setBreakEnd(null)}>
          Skip break
        </button>
      ) : (
        <button
          disabled={busy}
          className="button"
          onClick={() =>
            act(
              !focus
                ? "start"
                : left === 0
                  ? "complete"
                  : focus.state === "running"
                    ? "pause"
                    : "resume",
            )
          }
        >
          {focus?.state === "running" && left > 0 ? (
            <Pause size={18} />
          ) : (
            <Play size={18} />
          )}{" "}
          {!focus
            ? `Begin ${target}-minute focus`
            : left === 0
              ? "Complete & collect XP"
              : focus.state === "running"
                ? "Pause session"
                : "Resume focus"}
        </button>
      )}
      <p className="tiny muted">
        {preview
          ? "Preview timer · XP is only saved for signed-in accounts"
          : `Time is verified on the server · +${focusXP(target)} XP for a complete ${target}-minute session`}
      </p>
      {focus && left_ > 0 && <p className="tiny muted">App {left_} baar chhoda · phone door rakho</p>}
      <FocusTools />
    </section>
  );
}
type Field = {
  name: string;
  label: string;
  type?: string;
  options?: { value: string; label: string }[];
  default?: string;
};
function Owner({ path, data: d, preview, mutate, notify }: Props) {
  const [modal, setModal] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedSeat, setSelectedSeat] = useState("");
  const section = path.split("/")[2] || "overview";
  const title =
    ownerNav.find((n) => n[0] === path)?.[1] ||
    (section === "notifications" ? "Notifications" : "Overview");
  const total = d.summary?.revenue || 0,
    cost = d.summary?.expenses || 0,
    due = d.summary?.due || 0;
  const options = (rows: Row[], key = "name") =>
    rows.map((r) => ({
      value: String(r._id),
      label: String(r[key] || r.label || r._id),
    }));
  const fields: Record<string, Field[]> = {
    students: [
      { name: "name", label: "Student name" },
      { name: "email", label: "Registered student email", type: "email" },
    ],
    seats: [
      { name: "label", label: "Seat label" },
      { name: "floor", label: "Floor", default: "Ground floor" },
    ],
    shifts: [
      { name: "name", label: "Shift name" },
      { name: "start", label: "Start time", type: "time", default: "06:00" },
      { name: "end", label: "End time", type: "time", default: "14:00" },
    ],
    plans: [
      { name: "name", label: "Plan name" },
      { name: "amount", label: "Price (₹)", type: "number" },
      {
        name: "days",
        label: "Duration in days",
        type: "number",
        default: "30",
      },
    ],
    memberships: [
      { name: "userId", label: "Student", options: options(d.students) },
      { name: "planId", label: "Plan", options: options(d.plans) },
      {
        name: "seatId",
        label: "Seat",
        options: options(d.seats, "label"),
        default: selectedSeat,
      },
      {
        name: "start",
        label: "Start date",
        type: "date",
        default: new Date().toISOString().slice(0, 10),
      },
      {
        name: "shiftStart",
        label: "Shift starts",
        type: "time",
        default: "06:00",
      },
      { name: "shiftEnd", label: "Shift ends", type: "time", default: "14:00" },
      { name: "discount", label: "Discount (₹)", type: "number", default: "0" },
    ],
    payments: [
      {
        name: "membershipId",
        label: "Membership",
        options: d.memberships.map((m) => ({
          value: String(m._id),
          label: `${String(m._id).slice(-6)} · Due ${money(Number(m.amount) - Number(m.paid) - Number(m.discount))}`,
        })),
      },
      { name: "amount", label: "Confirmed amount (₹)", type: "number" },
      {
        name: "method",
        label: "Method",
        options: [
          { value: "cash", label: "Cash" },
          { value: "upi", label: "UPI" },
        ],
      },
    ],
    expenses: [
      { name: "title", label: "Description" },
      { name: "amount", label: "Amount (₹)", type: "number" },
      {
        name: "category",
        label: "Category",
        options: ["Rent", "Utilities", "Maintenance", "Other"].map((x) => ({
          value: x,
          label: x,
        })),
      },
      {
        name: "date",
        label: "Date",
        type: "date",
        default: new Date().toISOString().slice(0, 10),
      },
    ],
    attendance: [
      { name: "userId", label: "Student", options: options(d.students) },
    ],
    notifications: [
      { name: "title", label: "Title" },
      { name: "message", label: "Message" },
    ],
  };
  fields.staff = [
    { name: "email", label: "Registered staff email", type: "email" },
    {
      name: "permission",
      label: "Permission (none revokes staff access)",
      options: ["attendance", "students", "payments", "expenses", "none"].map(
        (x) => ({
          value: x,
          label: x,
        }),
      ),
    },
  ];
  fields.renew = [
    {
      name: "membershipId",
      label: "Membership to renew",
      options: options(d.memberships, "_id"),
    },
    {
      name: "method",
      label: "Confirmed payment method",
      options: [
        { value: "cash", label: "Cash" },
        { value: "upi", label: "UPI" },
      ],
    },
    {
      name: "confirmation",
      label: "Type RECEIVED to confirm full plan payment",
    },
  ];
  fields["membership-status"] = [
    {
      name: "membershipId",
      label: "Membership",
      options: options(d.memberships, "_id"),
    },
    {
      name: "status",
      label: "Status",
      options: [
        { value: "active", label: "Active" },
        { value: "paused", label: "Paused (seat stays reserved)" },
        { value: "cancelled", label: "Cancelled (release seat)" },
      ],
    },
  ];
  const [action, setAction] = useState(section);
  const add = (a = section) => {
    setAction(a);
    setModal(true);
  };
  const tableRows = (d[section as keyof Data] || []) as Row[];
  const [page, setPage] = useState(1);
  const listEnabled =
    !preview &&
    [
      "students",
      "shifts",
      "plans",
      "memberships",
      "payments",
      "expenses",
      "attendance",
      "complaints",
    ].includes(section);
  const { data: listing, isFetching: listLoading } = useQuery<{
    records: Row[];
    total: number;
  }>({
    queryKey: ["workspace", section, page, search],
    enabled: listEnabled,
    queryFn: async () => {
      const response = await fetch(
        `/api/workspace?resource=${section}&page=${page}&q=${encodeURIComponent(search)}`,
      );
      if (!response.ok) throw new Error("Unable to load records");
      return response.json();
    },
  });
  const filtered = listing
    ? listing.records
    : Array.isArray(tableRows)
      ? tableRows.filter((r) =>
          Object.values(r)
            .join(" ")
            .toLowerCase()
            .includes(search.toLowerCase()),
        )
      : [];
  const columns: Record<string, [string, string][]> = {
    students: [
      ["name", "Student"],
      ["email", "Email"],
    ],
    shifts: [
      ["name", "Shift"],
      ["start", "Start (minutes)"],
      ["end", "End (minutes)"],
    ],
    plans: [
      ["name", "Plan"],
      ["amount", "Price"],
      ["days", "Days"],
    ],
    memberships: [
      ["_id", "Membership"],
      ["userId", "Student"],
      ["end", "Expires"],
      ["amount", "Plan total"],
      ["paid", "Confirmed paid"],
      ["status", "Status"],
    ],
    payments: [
      ["receipt", "Receipt"],
      ["membershipId", "Membership"],
      ["amount", "Amount"],
      ["method", "Method"],
      ["createdAt", "Recorded"],
    ],
    expenses: [
      ["title", "Description"],
      ["category", "Category"],
      ["amount", "Amount"],
      ["date", "Date"],
    ],
    attendance: [
      ["userId", "Student"],
      ["day", "Day"],
      ["checkIn", "Check in"],
    ],
    complaints: [
      ["title", "Subject"],
      ["message", "Message"],
      ["status", "Status"],
    ],
  };
  const sampleSeats = Array.from({ length: 60 }, (_, i) => ({
    _id: String(i),
    label: `${String(i + 1).padStart(2, "0")}`,
    floor: "Ground floor",
  }));
  const seats = preview ? sampleSeats : d.seats;
  const [seatAt] = useState(() => new Date());
  const seatMinute = seatAt.getUTCHours() * 60 + seatAt.getUTCMinutes();
  const occupied = new Set(
    (d.assignments || [])
      .filter(
        (a) =>
          +new Date(String(a.start)) <= +seatAt &&
          +new Date(String(a.end)) > +seatAt &&
          Number(a.shiftStart) <= seatMinute &&
          Number(a.shiftEnd) > seatMinute,
      )
      .map((a) => String(a.seatId)),
  );
  const [floor, setFloor] = useState("All floors");
  const floors = [...new Set(seats.map((s) => String(s.floor)))];
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">A BETTER SPACE TO GROW</div>
          <h1>
            {section === "overview" ? "Good things happen here." : title}
            <span className="heading-spark"> ✦</span>
          </h1>
          <p>
            {section === "overview"
              ? "Your community, your space, and everything that keeps it running."
              : section === "seats"
                ? "A place for every student. A clear view of every seat."
                : section === "reports"
                  ? "How your library is doing: money in, money out, and who is studying."
                  : section === "notifications"
                    ? "Updates for you and announcements you have shared with students."
                    : "Keep the little details in order. Make room for the big things."}
          </p>
        </div>
        {fields[section] && (
          <button className="button" onClick={() => add()}>
            <Plus size={17} />
            {section === "payments"
              ? "Record payment"
              : section === "attendance"
                ? "Check in student"
                : section === "notifications"
                  ? "Create announcement"
                  : `Add ${section === "memberships" ? "membership" : section === "students" ? "student" : section === "seats" ? "seat" : section === "shifts" ? "shift" : section === "plans" ? "plan" : "expense"}`}
          </button>
        )}
        {section === "overview" && (
          <button className="button" onClick={() => add("students")}>
            <Plus size={17} />
            Add a student
          </button>
        )}
      </div>
      {section === "attendance" && !preview && (
        <section className="card qr-panel">
          <Image
            src="/api/attendance-qr"
            width={160}
            height={160}
            alt="Scan to check in to this library"
            unoptimized
          />
          <div>
            <h2>A warmer welcome. A quicker check-in.</h2>
            <p>
              Students can scan this code and confirm attendance with an active
              membership. Codes expire after 10 minutes. Reload to generate a
              new code. Set APP_URL to your reachable site address.
            </p>
          </div>
        </section>
      )}
      {section === "memberships" && (
        <div className="lifecycle-toolbar">
          <button className="button secondary" onClick={() => add("renew")}>
            Renew with confirmed payment
          </button>
          <button
            className="button secondary"
            onClick={() => add("membership-status")}
          >
            Pause / resume / cancel
          </button>
        </div>
      )}
      {section === "reports" ? (
        <OwnerReports data={d} />
      ) : section === "notifications" ? (
        <section className="card">
          {d.notifications.length ? (
            d.notifications.map((n) => (
              <div className="list-row" key={String(n._id)}>
                <Bell />
                <div>
                  <strong>{n.title}</strong>
                  <p>{n.message}</p>
                </div>
              </div>
            ))
          ) : (
            <Empty
              icon={Bell}
              title="A quiet moment"
              text="Support replies, billing notices and your announcements will appear here."
            />
          )}
        </section>
      ) : section === "overview" ? (
        <>
          <div className="stats-grid">
            <Stat
              icon={Wallet}
              color="mint"
              label="Confirmed revenue"
              value={money(total)}
              detail="From recorded payments only"
            />
            <Stat
              icon={Users}
              color="violet"
              label="Active community"
              value={String(d.summary?.students || 0)}
              detail="Registered library students"
            />
            <Stat
              icon={Armchair}
              color="peach"
              label="Study spaces"
              value={String(d.summary?.seats || 0)}
              detail="Across all library floors"
            />
            <Stat
              icon={Receipt}
              color="amber"
              label="Outstanding dues"
              value={money(due)}
              detail="Membership balance remaining"
            />
          </div>
          <div className="dashboard-grid">
            <section className="card">
              <div className="section-heading">
                <div>
                  <h2>A healthier library</h2>
                  <p>Your revenue and expenses at a glance.</p>
                </div>
                <ChartNoAxesCombined size={20} />
              </div>
              <div className="chart">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={[
                      { name: "Revenue", amount: total / 100 },
                      { name: "Expenses", amount: cost / 100 },
                      { name: "Profit", amount: (total - cost) / 100 },
                    ]}
                  >
                    <XAxis dataKey="name" axisLine={false} tickLine={false} />
                    <Tooltip />
                    <Bar
                      dataKey="amount"
                      fill="#438d75"
                      radius={[6, 6, 0, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="report-bottom">
                Net profit <strong>{money(total - cost)}</strong>
              </div>
            </section>
            <section className="card">
              <h2>Your next steps</h2>
              <p className="muted">Build a space that works for everyone.</p>
              {[
                ["Configure your shifts", "shifts", Clock3],
                ["Set up your seat map", "seats", Armchair],
                ["Create a membership plan", "plans", CreditCard],
                ["Connect registered students", "students", Users],
              ].map(([text, route, Icon]) => {
                const I = Icon as LucideIcon;
                return (
                  <Link
                    className="list-row"
                    href={`/owner/${route}`}
                    key={String(route)}
                  >
                    <span className="icon-tile mint">
                      <I size={19} />
                    </span>
                    <strong>{String(text)}</strong>
                    <ChevronRight size={17} />
                  </Link>
                );
              })}
            </section>
          </div>
          <section className="card">
            <div className="section-heading">
              <div>
                <h2>Library announcements</h2>
                <p>Keep your community in the loop.</p>
              </div>
              <button
                className="button secondary"
                onClick={() => add("notifications")}
              >
                <Plus size={16} />
                Create announcement
              </button>
            </div>
            {d.notifications.length ? (
              d.notifications.map((n) => (
                <div className="list-row" key={String(n._id)}>
                  <Bell />
                  <div>
                    <strong>{n.title}</strong>
                    <p>{n.message}</p>
                  </div>
                </div>
              ))
            ) : (
              <p className="muted">
                No announcements yet. Create one to share an update in the app.
              </p>
            )}
          </section>
        </>
      ) : section === "seats" ? (
        <section className="card seat-panel">
          <div className="section-heading">
            <div>
              <h2>A space for great things</h2>
              <p>
                {preview
                  ? "Sample floor layout"
                  : `${d.seats.length} seats configured`}{" "}
                · Select a seat to create an allocation.
              </p>
            </div>
            <select
              aria-label="Floor"
              value={floor}
              onChange={(e) => setFloor(e.target.value)}
            >
              <option>All floors</option>
              {floors.map((f) => (
                <option key={f}>{f}</option>
              ))}
            </select>
          </div>
          <div className="seat-legend">
            <span>
              <i className="dot available" />
              Available now
            </span>
            <span>
              <i className="dot occupied" />
              {preview ? "Sample occupied" : "Occupied now"}
            </span>
          </div>
          <div className="seat-grid">
            {seats
              .filter((s) => floor === "All floors" || s.floor === floor)
              .map((s, i) => (
                <button
                  className={`seat ${(preview && i % 4 !== 0) || occupied.has(String(s._id)) ? "occupied" : ""}`}
                  key={String(s._id)}
                  onClick={() => {
                    setSelectedSeat(String(s._id));
                    add("memberships");
                  }}
                  aria-label={`Allocate seat ${s.label}`}
                >
                  <Armchair size={24} />
                  <span>{s.label}</span>
                </button>
              ))}
          </div>
          {!seats.length && (
            <Empty
              icon={Armchair}
              title="Room to grow"
              text="Add your first seat to start mapping your library."
            />
          )}
          <div className="seat-bottom">
            <Leaf size={16} /> Every seat is the beginning of someone’s next
            chapter.
          </div>
        </section>
      ) : section === "settings" ? (
        <>
          <section className="card">
            <h2>Your library workspace</h2>
            <div className="lifecycle-toolbar">
              <button className="button secondary" onClick={() => add("staff")}>
                Grant staff access
              </button>
            </div>
            <p className="muted">
              Library ID: {String(d.user?.libraryId || "Not connected")}
            </p>
            <div className="list-row">
              <ShieldCheck />
              <div>
                <strong>Tenant isolation enabled</strong>
                <p>
                  All library records are scoped to your authenticated library.
                </p>
              </div>
            </div>
            <div className="list-row">
              <MessageSquare />
              <div>
                <strong>In-app messaging</strong>
                <p>
                  Announcements are delivered inside StudyQuest. No WhatsApp
                  provider is configured.
                </p>
              </div>
            </div>
            <button className="button" onClick={() => add("notifications")}>
              Create announcement
            </button>
            <h2 style={{ marginTop: 28 }}>Recent audit history</h2>
            {(d.audit || []).map((a) => (
              <div className="list-row" key={String(a._id)}>
                <ShieldCheck size={16} />
                <strong>{a.action}</strong>
                <span className="muted">
                  {new Date(String(a.createdAt)).toLocaleString()}
                </span>
              </div>
            ))}
          </section>
          {!preview && String(d.user?.role) === "owner" && (
            <LibraryHoursEditor
              library={d.library}
              mutate={mutate}
              notify={notify}
            />
          )}
          {!preview && <PushToggle notify={notify} />}
        </>
      ) : (
        <section className="card table-card">
          <div className="table-toolbar">
            <h2>
              {title} <span className="pill neutral">{filtered.length}</span>
            </h2>
            <label className="search-box">
              <Search size={17} />
              <input
                aria-label={`Search ${title}`}
                placeholder={`Search ${title.toLowerCase()}…`}
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
              />
            </label>
          </div>
          {filtered.length ? (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    {(columns[section] || []).map(([key, label]) => (
                      <th key={key}>{label}</th>
                    ))}
                    {section === "complaints" && <th>Action</th>}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((row) => (
                    <tr key={String(row._id)}>
                      {(columns[section] || []).map(([key]) => (
                        <td key={key}>
                          {["amount", "paid"].includes(key) ? (
                            money(Number(row[key]))
                          ) : key === "receipt" ? (
                            <Link
                              className="text-link"
                              href={`/api/receipts/${row._id}`}
                              target="_blank"
                            >
                              {String(row.receipt)} <ArrowUpRight size={13} />
                            </Link>
                          ) : key === "status" ? (
                            <span className="pill">{row[key]}</span>
                          ) : ["end", "date", "createdAt", "checkIn"].includes(
                              key,
                            ) ? (
                            new Date(String(row[key])).toLocaleDateString()
                          ) : key.endsWith("Id") || key === "_id" ? (
                            String(row[key] || "—").slice(-8)
                          ) : (
                            String(row[key] || "—")
                          )}
                        </td>
                      ))}
                      {section === "complaints" && (
                        <td>
                          <button
                            className="text-link"
                            disabled={row.status === "resolved"}
                            onClick={async () => {
                              try {
                                await mutate("resolve", { id: row._id });
                                notify("Complaint resolved");
                              } catch (e) {
                                notify((e as Error).message);
                              }
                            }}
                          >
                            Resolve
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty
              icon={section === "students" ? Users : BookOpen}
              title={
                search
                  ? "No matching records"
                  : `Your ${title.toLowerCase()} start here`
              }
              text={
                section === "students"
                  ? "Connect students using the email they registered with. Their account stays theirs."
                  : "New records will appear here as you set up your workspace."
              }
            />
          )}
          {listEnabled && (
            <div className="pagination">
              <span>
                {listLoading
                  ? "Loading…"
                  : `${listing?.total || 0} records · Page ${page}`}
              </span>
              <button
                className="button secondary"
                disabled={page === 1 || listLoading}
                onClick={() => setPage((p) => p - 1)}
                aria-label="Previous page"
              >
                <ChevronLeft size={16} />
              </button>
              <button
                className="button secondary"
                disabled={listLoading || page * 25 >= (listing?.total || 0)}
                onClick={() => setPage((p) => p + 1)}
                aria-label="Next page"
              >
                <ChevronRight size={16} />
              </button>
            </div>
          )}
        </section>
      )}
      {modal && (
        <RecordModal
          title={
            action === "payments"
              ? "Record a confirmed payment"
              : `Add ${action}`
          }
          fields={fields[action] || []}
          onClose={() => setModal(false)}
          onSubmit={async (values) => {
            const data: Record<string, unknown> = { ...values };
            for (const key of ["amount", "discount"])
              if (key in data) data[key] = Math.round(Number(data[key]) * 100);
            if ("days" in data) data.days = Number(data.days);
            for (const key of ["start", "end", "shiftStart", "shiftEnd"])
              if (
                typeof data[key] === "string" &&
                String(data[key]).includes(":")
              ) {
                const [h, m] = String(data[key]).split(":").map(Number);
                data[key] = h * 60 + m;
              }
            for (const key of ["date", "start"])
              if (typeof data[key] === "string")
                data[key] = new Date(String(data[key])).toISOString();
            if (action === "payments" || action === "renew")
              data.key = crypto.randomUUID();
            await mutate(action, data);
            notify("Record saved");
            setModal(false);
          }}
        />
      )}
    </>
  );
}
function RecordModal({
  title,
  fields,
  onClose,
  onSubmit,
}: {
  title: string;
  fields: Field[];
  onClose: () => void;
  onSubmit: (v: Record<string, string>) => Promise<void>;
}) {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    const handle = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key === "Tab") {
        const elements = Array.from(
          document.querySelectorAll<HTMLElement>(
            ".modal button:not([disabled]),.modal input,.modal select,.modal a[href]",
          ),
        );
        const first = elements[0],
          last = elements.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", handle);
    const old = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handle);
      document.body.style.overflow = old;
      previousFocus?.focus();
    };
  }, [onClose]);
  return (
    <div
      className="modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
        className="modal"
      >
        <div className="section-heading">
          <h2 id="dialog-title">{title}</h2>
          <button
            className="icon-btn"
            aria-label="Close dialog"
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </div>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            try {
              await onSubmit(
                Object.fromEntries(new FormData(e.currentTarget)) as Record<
                  string,
                  string
                >,
              );
            } catch (err) {
              setError((err as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {fields.map((f, i) => (
            <label key={f.name}>
              {f.label}
              {f.options ? (
                <select
                  name={f.name}
                  required
                  defaultValue={f.default || ""}
                  autoFocus={i === 0}
                >
                  <option value="" disabled>
                    Select an option
                  </option>
                  {f.options.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  autoFocus={i === 0}
                  required
                  name={f.name}
                  type={f.type || "text"}
                  min={f.type === "number" ? 0 : undefined}
                  defaultValue={f.default}
                />
              )}
            </label>
          ))}
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <div className="modal-actions">
            <button
              type="button"
              className="button secondary"
              onClick={onClose}
            >
              Cancel
            </button>
            <button disabled={busy} className="button">
              {busy ? "Saving…" : "Save record"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
function Admin({
  data,
  preview,
  mutate,
  notify,
}: Pick<Props, "data" | "preview" | "mutate" | "notify">) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">THE BIGGER PICTURE</div>
          <h1>A growing community of spaces.</h1>
          <p>
            Platform administration ·{" "}
            {preview
              ? "Sign in with an administrator account to view data."
              : "Live library overview"}
          </p>
        </div>
        <button className="button" onClick={() => setOpen(true)}>
          Manage subscription
        </button>
      </div>
      <div className="stats-grid">
        <Stat
          icon={Building2}
          label="Libraries"
          value={String(data.libraries.length)}
          detail="Registered workspaces"
          color="mint"
        />
        <Stat
          icon={CheckCircle2}
          label="Active subscriptions"
          value={String(
            data.libraries.filter((l) => l.subscriptionStatus === "active")
              .length,
          )}
          detail="Manually confirmed status"
          color="violet"
        />
        <Stat
          icon={Clock3}
          label="Trial libraries"
          value={String(
            data.libraries.filter((l) => l.subscriptionStatus === "trial")
              .length,
          )}
          detail="Getting started"
          color="amber"
        />
        <Stat
          icon={Pause}
          label="Paused"
          value={String(
            data.libraries.filter((l) => l.subscriptionStatus === "paused")
              .length,
          )}
          detail="Subscription status"
          color="peach"
        />
      </div>
      <section className="card">
        <h2>Libraries & subscriptions</h2>
        {data.libraries.length ? (
          data.libraries.map((l) => (
            <div className="list-row" key={String(l._id)}>
              <Building2 />
              <strong>{l.name}</strong>
              <span className="pill">{l.plan}</span>
              <span className="pill neutral">{l.subscriptionStatus}</span>
            </div>
          ))
        ) : (
          <Empty
            icon={Building2}
            title="A fresh start"
            text="Registered libraries will appear here. External subscription billing is not connected."
          />
        )}
        <p className="tiny muted">
          Subscription status is managed manually. Changing it does not charge
          an account.
        </p>
      </section>
      {open && (
        <RecordModal
          title="Manage a library subscription"
          fields={[
            {
              name: "id",
              label: "Library",
              options: data.libraries.map((l) => ({
                value: String(l._id),
                label: String(l.name),
              })),
            },
            {
              name: "plan",
              label: "Plan",
              options: ["starter", "growth", "pro"].map((x) => ({
                value: x,
                label: x,
              })),
            },
            {
              name: "subscriptionStatus",
              label: "Status",
              options: ["trial", "active", "paused"].map((x) => ({
                value: x,
                label: x,
              })),
            },
          ]}
          onClose={() => setOpen(false)}
          onSubmit={async (values) => {
            await mutate("platform.library", values);
            notify("Subscription updated");
            setOpen(false);
          }}
        />
      )}
    </>
  );
}
