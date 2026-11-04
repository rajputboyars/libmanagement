# StudyQuest — Product Audit & Architecture

_Audit date: 27 Oct 2026 · Branch audited: `main` @ `400652d` (60 commits) · Author: engineering audit (code-read + safe local checks)_

> **How to read this document.** Every significant claim cites a file path. Status labels follow one rule: **"Implemented and verified"** means the behaviour was exercised during this audit or the immediately preceding QA session (23 Oct 2026) against a local, disposable database (`scripts/qa-server.ts`, in-memory MongoDB) or by an automated test that ran green. Everything else is labelled honestly as *not verified*, *partial*, *UI only*, *missing* or *unknown*. No production system, real user data or secret value was accessed. Environment variables are named, never valued.

---

## Table of contents

1. Product overview
2. End-to-end user flows (owner, staff, student, super-admin)
3. Codebase and architecture
4. Existing product inventory (feature matrix)
5. Student product — improvement opportunities
6. Library product — improvement opportunities
7. UX and design audit
8. Security, data integrity and reliability
9. Market differentiation and business potential
10. Monetization and fundraising readiness
11. Prioritized roadmap (P0–P3)
12. Final co-founder assessment

Appendix A — Checks performed · Appendix B — Environment variable names

---

## 1. Product overview

### 1.1 What the platform does today

StudyQuest is a single Next.js web application (installable as a PWA) with three faces:

| Face | Audience | What it does today |
|---|---|---|
| **Public website** (`/`, `/owners`, `/students`, `/pricing`, `/guide`, `/discover`, `/demo`, `/l/[slug]`) | Prospective owners and students | Marketing pages (English/Hinglish toggle), pricing, video guide, public library directory with seat availability, demo booking. `src/components/site.tsx`, `marketing.tsx`, `saas-public.tsx`, `library-discovery.tsx`, `src/app/l/[slug]/page.tsx` |
| **Owner workspace** (`/owner/*`) | Library owners and staff | Seats, shifts, fee plans, memberships (seat allocation), offline fee recording with receipts, attendance and live presence, expenses, reports, admissions CRM, join requests/invites, waitlist, branches, SaaS billing, support, import from paper register. `src/components/experience.tsx` (owner sections), `join.tsx`, `saas-owner.tsx`, `pilot.tsx` |
| **Student app** (`/app/*`) | Students (with or without a library) | Focus timer with XP, punch in/out at the library, exam prep (tests, mistakes, flashcards, PYQs, current affairs), study plan, syllabus tracker, daily plan/reflection, insights, weekly/monthly report, community, rewards, gamification. `experience.tsx`, `prep.tsx`, `prep-test.tsx`, `phase2.tsx`, `self-study.tsx`, `learning-intelligence.tsx`, `community.tsx` |
| **Super-admin** (`/super-admin/*`) | Platform operator | Libraries, subscriptions, SaaS business metrics, syllabus and question bank, feature access per plan, student premium switch (free trial), accounts, plans. `saas-admin.tsx`, `platform-admin.tsx`, `prep-admin.tsx` |

Everything routes through one catch-all page: `src/app/[[...slug]]/page.tsx` → `src/components/app-entry.tsx` → `Experience` (`src/components/experience.tsx`, 3,258 lines) which switches on the path.

### 1.2 Roles and permissions

Roles are stored on `User.role` (`src/lib/models.ts`): `student | owner | staff | super-admin` (`AuthUser` type in `src/lib/auth.ts`).

| Role | How it is created | Scope | Permissions (evidence) |
|---|---|---|---|
| **student** | Self-registration (`POST /api/auth/register`, default role) | Own data; library data only after joining | Joins a library via Library ID request (`/api/join` `request`) or by accepting an owner invite (`invite-accept`). Premium student features gated by `studentFeatureBlocked()` (`src/lib/student-access-server.ts`) — currently all free while `PlatformSettings.freeTrial` is on. |
| **owner** | Registration with `role: "owner"` creates `User` + `Library` + `Organization` with a Pro trial in one transaction (`src/app/api/auth/[action]/route.ts`) | Their `libraryId` (and branches in their organization) | All `/api/workspace` owner actions; tenant writes serialised by bumping `Library.__v` inside the transaction (`src/app/api/workspace/route.ts` ~L596). Plan features enforced by `requireFeature` / `requireStudentRoom` / `assertWritable` (`src/lib/saas-server.ts`). |
| **staff** | Owner action `staff` on an account **that already joined the library** (changed 23 Oct 2026) | Same library | Per-permission grants in `StaffMembership.permissions`: `attendance`, `students`, `payments`, `expenses` (`workspace/route.ts` staff branch). Join-request handling needs the `students` permission (`team()` in `src/app/api/join/route.ts`). |
| **super-admin** | `npm run bootstrap-admin` (`scripts/bootstrap-admin.ts`) | Platform-wide | `/api/saas-admin`, `/api/platform`, `/api/prep-admin`. Verified: student/owner get 403 on these. |

### 1.3 Implementation status at a glance

* **Fully built and exercised:** auth/sessions, tenant isolation, seats/plans/memberships with conflict checks, offline fee recording with idempotency and over-payment guard, join requests and owner invites, focus timer with server-verified time, self-study tools (plan, reflection, tracker, goals, partner, insights, monthly report), mistake re-test API, scheduled-job endpoint auth.
* **Built, not exercised in this audit:** QR attendance, geofenced punch, SaaS billing via Razorpay (no gateway keys configured locally), CRM, branches, pilot import, community moderation, rewards marketplace, doubt solver (AI provider optional), backups.
* **Depends on content that does not exist yet:** exam prep, syllabus tracker, study plan generation and quizzes all need `SyllabusNode` and `Question` data entered by the super-admin (`/super-admin/syllabus`, `/super-admin/question-bank`). The seed creates only a tiny sample (`scripts/seed.ts` L107–130). **Without content, most student learning features show empty states.**
* **Integrations present as adapters only:** email (`EMAIL_WEBHOOK_URL`), SMS/WhatsApp (`WHATSAPP_API_URL`), AI (`STUDYQUEST_AI_PROVIDER=ollama`). If unset, emails (password reset!) are not delivered in production (`src/lib/auth-extra.ts` `forgot`).
* **Not built:** online fee collection from students (Razorpay is only for owner SaaS subscriptions); refund/void/edit of a recorded fee payment; product-event analytics (model `ProductEvent` exists in `src/lib/ops-models.ts` but nothing writes to it); Plan A/B/C study plans; student guided onboarding.

---

## 2. End-to-end user flows

Notation: **UI** = component · **API** = endpoint/action · **DB** = collections read (R) / written (W).

### 2.1 Library owner

#### 2.1.1 Registration → login → onboarding

| Step | Detail |
|---|---|
| Sees | `/register` (`src/components/auth.tsx`, lazy-loaded via `lazy.tsx`), picks "owner", enters name, email, password (≥10 chars), library name, optional referral code. |
| API | `POST /api/auth/register` (`src/app/api/auth/[action]/route.ts`) — rate-limited 20/hour/IP (`limitedShared`), bcrypt cost 12, single Mongo transaction. |
| DB | W `User`, `Library` (with generated `libraryCode` from `src/lib/join.ts`), `Organization` + trial subscription (`createOrganization` in `src/lib/saas-server.ts`), optional `Referral`. |
| Session | `sq-session` cookie: HS256 JWT, 7 days, `httpOnly`, `sameSite=lax`, `secure` in production, carries `sessionVersion` for revoke-all (`src/lib/auth.ts`). |
| Onboarding | `/owner/onboarding` "Setup guide" (`Onboarding` component in `experience.tsx` ~L754). API `/api/onboarding` actions: `organization`, `branch`, `seats` (bulk prefix+count), `shifts`, `fees`, `students-preview`, `students-import`, `verify-send`/`verify-check` (email code), `plan`, `skip`, `complete`. DB W `OnboardingDraft`, `Seat`, `Shift`, `MembershipPlan`, `VerificationCode`, `Organization.onboardingStatus`. |
| Failure states | Duplicate email → generic "Unable to sign in or register" message (no enumeration, but also no helpful hint). Zod errors → "Please check your entries…". Missing DB → explicit message. |
| Gaps | Email verification code needs `EMAIL_WEBHOOK_URL`; without it owners cannot verify by email in production. Duplicate-email error is unhelpful to genuine users. |

#### 2.1.2 Seats, shifts, timings, availability

* **UI:** `/owner/seats` (seat map), `/owner/shifts`, library hours and holidays in settings (`experience.tsx`, action `library-hours`, `holiday-add/remove`).
* **API:** `POST /api/workspace` actions `seats`, `shifts` (generic schema branch), `library-hours`. Listing: `GET /api/workspace?resource=seats&page=&q=`.
* **DB:** `Seat {label, floor, operationalStatus}`, `Shift {name, start, end minutes}`, `Library.hours/holidays`.
* **Availability:** computed from `SeatAssignment` overlap (date range × shift minutes). Public availability on `/discover` and `/l/[slug]` (`src/app/api/discovery/route.ts`).
* **Verified:** shift end-before-start rejected; name lengths now limited (60/80/120 chars).
* **Gap:** no seat edit/rename/delete flow was found in the audited actions other than maintenance status; confirm in UI before relying on it.

#### 2.1.3 Students: registration, IDs, admission, profile

Three entry paths exist:

1. **Student self-joins with Library ID.** Owner shares `libraryCode` (shown on `/owner/join-requests`). Student enters it on `/app/join` (`src/components/join.tsx` `StudentJoin`), previews library name/city (`GET /api/join?code=`, 30 lookups/10 min), sends request (`POST /api/join` `request` → `createJoinRequest` in `src/lib/join-request.ts`). Owner approves on `/owner/join-requests` (`approve` → `linkStudent()` transaction sets `User.libraryId`, `StudentProfile.libraryId`, notifies). Optional "Approve & allot seat" chains a `memberships` call.
2. **Owner invites by email** (since 23 Oct 2026). Owner "Add student" (`/owner/students`, action `students`) creates a `JoinRequest` with `invitedBy`; student must accept on `/app/join` (`invite-accept`). Owner cannot approve on the student's behalf; can withdraw. **Verified (12 API checks).**
3. **Register-with-code / pilot import.** Registration accepts `libraryCode` (auto-creates a join request). `/owner/import` (`src/components/pilot.tsx`, `/api/pilot-import` `validate`/`invite`) imports a paper register as `PendingStudent` records that link when the student registers with that email (`linkPendingStudent`).

* **Student ID:** there is no human-readable per-library student number; identity is the email + Mongo `_id`. Receipts use `SQ-<timestamp>`.
* **Profile:** `/app/profile` (student) → workspace action `profile` writes `StudentProfile {exam (free text), goalMinutes, anonymous}`.
* **Gap:** a student must already have a StudyQuest account before an owner can add them — no "create on behalf + invite link" for students without email/smartphone.

#### 2.1.4 Fees, payments, dues, receipts, renewals

* **Plans:** `MembershipPlan {name, amount (paise, int ≥0), days ≤365}`.
* **Membership (= admission + seat allocation):** action `memberships` validates plan/seat/student belong to the library, seat not in maintenance, discount ≤ price and **integer paise**, and no overlapping `SeatAssignment` for the same seat × date × shift. Writes `Membership` + `SeatAssignment`. **Verified:** parallel double-booking → exactly one succeeds.
* **Payment recording (offline cash/UPI):** action `payments` with client idempotency `key` (unique index `{libraryId, key}`), rejects amount > outstanding, increments `Membership.paid`. **Verified:** same key charged once; parallel payments cannot exceed fee.
* **Receipts:** `GET /api/receipts/[id]` — owner sees library receipts, student sees own. Receipt number `SQ-${Date.now()}` (`workspace/route.ts` L712, L906) — **not guaranteed unique and not sequential per library**.
* **Renewal:** action `renew` requires typed confirmation `RECEIVED`, blocks if previous dues are outstanding, needs new plan + seat.
* **Status:** `membership-status` (active/paused/cancelled; cancelled is final).
* **Dues:** computed `amount − discount − paid`; weekly in-app fee reminders job (`src/lib/jobs.ts` `feeDueReminders`).
* **Gaps:** no way to **void, edit or refund** a wrongly recorded payment (no action found); staff with `payments` permission get only their own receipts from `/api/receipts/[id]` (filter is `role === "owner" ? libraryId : userId`); no online fee collection; receipt numbering.

#### 2.1.5 Attendance, check-in/out, notifications

* **Student punch:** `/app/punch` → `POST /api/punch` `in` / `out` / `manual-out`. Optional geofence (`Library.geofence`, radius `PUNCH_RADIUS_M` in `src/lib/punch.ts`) and optional QR policy (`punchPolicy: "qr"`, `/api/attendance-qr`, Pro feature). Requires an active membership.
* **Owner attendance:** `/owner/attendance` (manual), `/owner/presence` (live list). Job `stale-punches` closes sessions open > 16 h.
* **Notifications:** in-app `Notification` documents; a post-save hook pushes to phones via Web Push (VAPID) (`src/lib/push.ts`, `/api/push`). Email/SMS/WhatsApp adapters exist (`src/lib/saas-notify.ts`, `messaging.ts`) but need provider URLs.
* **Not verified in this audit:** geofence and QR flows (need device location / QR scan).

#### 2.1.6 Dashboard, reports, settings, logout

* `/owner` overview (summary counts from `GET /api/workspace` → `summary`), `/owner/reports` (financial and occupancy reports), `/owner/billing` (SaaS plan, Razorpay checkout), `/owner/branches`, `/owner/crm` (leads + follow-ups), `/owner/support` (tickets).
* Logout: `POST /api/auth/logout` deletes cookie; "sign out everywhere" (`logout-all`) bumps `sessionVersion`.
* **Verified:** all 29 owner menu pages render without JS errors, failed requests or stuck loaders (crawl, 23 Oct).

### 2.2 Student

#### 2.2.1 Joining and first-time experience

* **Register:** `/register` as student → `User` + `StudentProfile`. Optional Library ID at sign-up.
* **First screen:** `/app` overview (`Student` component, `experience.tsx` ~L915): greeting, exam countdown (if exam set), quick stats (focus minutes, streak, XP, achievements), quests, today cards (3-task plan + reflection), weekly focus chart.
* **There is no guided student onboarding.** Exam, date, hours and weak subjects are captured in **three separate places**:
  * `/app/profile` → `StudentProfile.exam` (free text) + `goalMinutes`;
  * `/app/roadmap` (`phase2.tsx` `exam-save`) → `StudentExam {examKey, examDate, weeklyMinutes, subjectIds, weakTopicIds}`;
  * `/app/prep` goals → `ExamGoal`; plus `SelfGoal` (syllabus tracker) and legacy `StudyGoal` model.
  The exam countdown, prep and tracker read `StudentExam`; the profile's free-text exam is separate. **Risk of confusion and inconsistent data.**

#### 2.2.2 Daily study loop (what exists)

| Need | Where | Status |
|---|---|---|
| Today's tasks | Home "Aaj ke 3 kaam" (`self-study.tsx` `TodayCards`, `DailyPlan`) and `/app/planner` (`PlanTask` from generated `StudyPlan`) | Two separate task systems |
| Focus timer | `/app/focus` (`Focus` in `experience.tsx`, `/api/workspace` `focus.*`, `StudySession`), server-verified active time, subject tag, distraction count, full-screen + noise | Verified |
| Subject tracking | `StudySession.subject`; insights on `/app/progress` | Verified (API) |
| Syllabus progress | `/app/tracker` (`TopicProgress.steps`), `/app/roadmap` (`topic-progress`) | Verified (API) — needs syllabus content |
| Tests & practice | `/app/prep` (daily 10 Q, mini, templates, PYQ, current affairs), `/app/quiz` (separate quiz arena, `QuizAttempt`) | Two test systems |
| Revision | `/app/revisions` (`RevisionSchedule`, spaced intervals 1-3-7-14-30-60), flashcards in prep, mistake notebook + re-test | Implemented |
| Analytics | `/app/intelligence` (`WeeklyLearningInsight`), `/app/progress` (insights), `/app/report` (week/month) | Three analytics surfaces |
| Reminders | Daily revision reminder job, partner nudge, push notifications | Implemented, jobs need scheduler (Vercel Cron added) |

#### 2.2.3 Returning, missing tasks, changing goals, incomplete profile

* **Returns after a gap:** streak resets; no "welcome back" recovery plan. Yesterday's unfinished `DailyPlan` is returned by `GET /api/self-study?view=today` (`yesterday`) but **not shown in the UI**.
* **Misses plan tasks:** `PlanTask` status stays pending; no automatic rescheduling of the generated plan. Revision items can be snoozed/rescheduled (`/api/learning` `revision-snooze/reschedule`).
* **Changes goal/exam:** re-saving `exam-save` updates `StudentExam`; existing `StudyPlan` is not regenerated automatically.
* **Incomplete profile:** tracker shows "Pehle Exam prep me apna exam choose karo"; prep and plan generation throw "Select an exam…"; overview omits countdown. No single checklist tells the student what to set up.

### 2.3 Super-admin

`/super-admin/*`: business metrics (`computeMetrics`, `computeProductMetrics` in `src/lib/saas-metrics.ts` — MRR, ARR, trial conversion, churn, library engagement, student activation), plans and coupons, syllabus and question bank (with AI-assisted generation via `prep-ai.ts` when configured), feature access matrix (`src/lib/feature-matrix.ts`), student premium + free-trial switch, account suspension. **Verified:** all 11 pages render cleanly.

### 2.4 Three workflows traced UI → API → DB

**A. Seat allocation (owner)** — `/owner/memberships` form → `mutate("memberships", data)` (`experience.tsx`) → `POST /api/workspace` → auth (`currentUser`), origin check (`validOrigin`), 60 req/min (`limited`) → transaction: `Library.$inc __v` (tenant lock) → `assertWritable` → Zod parse → R `MembershipPlan`, `Seat`, `User` (all filtered by `libraryId`) → R `SeatAssignment` overlap check → W `Membership`, `SeatAssignment` → commit → client invalidates `["workspace"]` query.

**B. Fee payment (owner)** — Payments form → `POST /api/workspace` `payments {membershipId, amount, method, key}` → same lock → R `Payment` by `{libraryId,key}` (idempotent return) → R `Membership` → reject if `amount > amount−discount−paid` → W `Payment` (receipt `SQ-<ms>`) → W `Membership.paid += amount` → receipt at `GET /api/receipts/[id]`.

**C. Focus session (student)** — `/app/focus` → `focus.start {minutes, subject}` → transaction with `User.$inc __v` lock → W `StudySession` → client counts tab-hidden events → `focus.pause/complete {distractions}` → server computes `activeSeconds` from timestamps, refuses completion before target → W `XPTransaction` (daily cap via `reward()`), goal/weekly bonuses, `QuestProgress`, `StudentAchievement` → after commit `nudgePartners()` (`src/lib/partner-nudge.ts`) → `Notification` (+ push).

---

## 3. Codebase and architecture

### 3.1 Stack (installed versions)

| Layer | Technology |
|---|---|
| Framework | Next.js **16.4.2** (App Router, `output: "standalone"`), React **19.3.1**, TypeScript **5.9.3** |
| Styling/UI | Tailwind CSS **4.3.3** + a single hand-written `src/app/globals.css` (4,217 lines); shadcn (`@base-ui/react`) present but only `src/components/ui/button.tsx` is used; lucide icons; Motion **12.43** and GSAP **3.15** for animation; Recharts **3.10** |
| State/data | TanStack Query **5.104** (server state), Zustand **5.0** (`src/lib/ui-store.ts`: theme, language), React Hook Form + Zod resolvers on some forms |
| Backend | Next route handlers under `src/app/api/**/route.ts` (39 files), Node runtime |
| Database | MongoDB via Mongoose **8.24**; requires a **replica set** (transactions are used widely) |
| Auth | `jose` **6.2** HS256 JWT cookie; bcryptjs |
| Validation | Zod **4.6** on every route body |
| Notifications | `web-push` 3.6 (VAPID) + in-app `Notification` |
| Payments | Razorpay (REST + webhook HMAC) in `src/lib/billing.ts` — for owner SaaS subscriptions only |
| Testing | `node:test` via `tsx` (22 files, 118 tests), `scripts/test-db.ts`, `scripts/test-http.ts` (full HTTP suite against `next start` + in-memory replica set) |
| Code size | ~25,100 lines of TS/TSX across `src`, `scripts`, `tests` |

### 3.2 Directory tree (generated and vendor folders excluded)

```
.
├── .github/workflows/ci.yml      # typecheck, lint, unit, build, integration, HTTP tests, npm audit, Docker build
├── Dockerfile                    # web + worker targets
├── vercel.json                   # Vercel Cron: /api/jobs/run daily 02:30 UTC
├── next.config.mjs               # CSP + security headers, noindex for private routes
├── docs/                         # DEPLOYMENT, SECURITY, MONITORING, BACKUP_RESTORE, PILOT
├── scripts/                      # seed, worker, backup/restore, bootstrap-admin, migrate-orgs, qa-server, test-http, test-db, audits
├── tests/                        # node:test unit + integration tests per feature
├── public/                       # PWA manifest, service worker (sw.js), offline page, icons, guide media
└── src/
    ├── proxy.ts                  # request-id correlation (Next 16 "proxy" = middleware)
    ├── instrumentation.ts        # env validation on boot, onRequestError → log + alert webhook
    ├── app/
    │   ├── [[...slug]]/page.tsx  # single catch-all page → AppEntry
    │   ├── l/[slug]/             # public library page
    │   ├── privacy/, terms/      # legal pages
    │   ├── layout.tsx, globals.css
    │   └── api/<feature>/route.ts  # 39 route handlers (see 3.4)
    ├── components/               # one file per feature screen (experience.tsx = shell + owner/student core)
    └── lib/                      # server logic, models, pure rules
        ├── models.ts             # core domain (~75 models)
        ├── saas-models.ts        # organizations, plans, subscriptions, invoices, coupons, CRM, support
        ├── ops-models.ts         # rate limits, jobs, imports, password reset, join requests, product events
        ├── auth.ts, auth-extra.ts, security.ts, env.ts, log.ts, db.ts, indexes.ts
        ├── saas*.ts, billing.ts, referrals.ts, feature-matrix.ts, student-access*.ts
        ├── jobs.ts, saas-jobs.ts, push.ts, messaging.ts, saas-notify.ts
        └── pure logic: rules.ts, prep.ts, phase2.ts, learning.ts, self-study.ts, punch.ts, library-hours.ts, weekly-report.ts …
```

### 3.3 Frontend architecture

* **Routing:** one dynamic catch-all; `AppEntry` decides public vs workspace; `Experience` renders the shell (sidebar nav, header, toasts) and switches screens by `path` with a long conditional chain. Heavy screens are code-split with `next/dynamic` (`src/components/lazy.tsx`).
* **Data:** a single `["workspace"]` query (`GET /api/workspace`) feeds most of the shell; feature screens use their own queries (`["self-study", view]`, `["join", …]`, prep `useView`). Mutations go through `mutate()` → invalidate.
* **State:** Zustand for UI preferences (theme, language; persisted). No global client state for domain data.
* **Forms:** mostly uncontrolled `FormData` + server Zod validation; RHF used in some places.
* **i18n:** public site has an English/Hinglish switch (`src/lib/site-copy.ts`, `say(lang, …)`); the signed-in app is mostly English with some Hinglish strings in newer screens — **inconsistent**.
* **PWA:** manifest, service worker, offline page (`public/`), install handling in `src/components/pwa.tsx`.

### 3.4 Backend architecture

* **API style:** each feature has one route with `GET ?view=` and `POST {action, data}`. Common guard sequence: `validOrigin` (CSRF), `currentUser`, role check, rate limit (`limited` in-memory or `limitedShared` Mongo-backed), Zod parse, plan/feature gate, Mongo transaction for multi-document writes.
* **Routes (39):** `auth/[action]`, `workspace`, `onboarding`, `join`, `punch`, `attendance-qr`, `receipts/[id]`, `seat-change`, `billing` (+`webhook`), `saas-admin`, `saas-public`, `platform`, `org`, `org-analytics`, `crm`, `leads`, `pilot-import`, `discovery`, `maintenance`, `support`, `push`, `privacy`, `export`, `report`, `jobs/run`, `health`, `ready`, `prep`, `prep-admin`, `phase2`, `learning`, `doubts`, `rewards`, `community` (+`card`), `leaderboard`, `shared-notes`, `self-study`.
* **Business rules** are mostly pure, unit-tested functions (`rules.ts`, `prep.ts`, `phase2.ts`, `self-study.ts`, `weekly-report.ts`, `punch.ts`).
* **Background jobs:** `runAllJobs()` (`src/lib/jobs.ts`): saas-jobs (trials, renewals, notification retries), membership-expiry, stale-punches, fee-due-reminders, revision-reminders, billing-reconciliation, weekly-reports. Triggered by `scripts/worker.ts` (every `JOB_INTERVAL_MINUTES`) or `GET/POST /api/jobs/run` with `CRON_SECRET` (Vercel Cron daily).

### 3.5 Data model (≈100 Mongoose models)

Grouped by ownership:

* **Identity:** `User`, `StudentProfile`, `PasswordReset`, `VerificationCode`, `PushSubscription`.
* **Tenant (library):** `Organization`, `OrganizationMembership`, `Library`, `StaffMembership`, `Seat`, `Shift`, `MembershipPlan`, `Membership`, `SeatAssignment`, `Payment`, `Expense`, `Attendance`, `Complaint`, `JoinRequest`, `PendingStudent`, `SeatWaitlist`, `SeatChangeRequest`, `LibraryVisitRequest`, `AdmissionLead`, `FollowUpTask`, `MaintenanceIssue`, `LibraryEvent`, `LibraryFeedback`, `AuditLog`, `StudentTransfer`, `ImportBatch`.
* **SaaS:** `SaaSPlan`, `SaaSSubscription`, `BillingInvoice`, `BillingPayment`, `BillingWebhookEvent`, `BillingCheckout`, `SubscriptionCredit`, `Coupon`, `CouponRedemption`, `Referral`, `PlatformLead`, `SupportTicket`, `NotificationDelivery`, `SaaSAuditLog`, `PlatformSettings`.
* **Learning content (platform-owned):** `ExamCatalog`, `SyllabusNode` (subject → chapter → topic), `Question`, `TestTemplate`, `ExamDate`.
* **Student learning (student-owned):** `StudentExam`, `TopicProgress`, `StudyPlan`, `PlanTask`, `TestAttempt`, `TestAnswer`, `MistakeEntry`, `Flashcard`, `StudentNote`, `ExamGoal`, `RevisionSchedule`, `WeeklyLearningInsight`, `QuizAttempt`, `Doubt`, `AIUsage`, `DailyPlan`, `DailyReflection`, `SelfGoal`, `StudySession`.
* **Gamification/social:** `XPTransaction`, `CoinTransaction`, `Reward`, `RewardRedemption`, `Quest`, `QuestProgress`, `Achievement`, `StudentAchievement`, `StudentGarden`, `GardenTransaction`, `Friendship`, `LearningChallenge`, `ChallengeProgress`, `StudyRoom`, `RoomParticipant`, `Community*`, `SuccessPost`, `StudyPartner`, `ReportShare`.
* **Ops:** `RateLimit`, `JobRun`, `DataRequest`, `ProductEvent` (unused), `LearningAudit`.

**Indexes:** declared per model (e.g. unique `{libraryId,key}` on `Payment`, partial unique pending `JoinRequest` per user, unique `pairKey` on `StudyPartner`, unique `{userId, day}` on `DailyPlan`/`DailyReflection`); `src/lib/indexes.ts` syncs them. **Money** is integer paise; **times** are minutes from midnight; **day keys** use India time (`libraryClock` in `src/lib/library-hours.ts`).

### 3.6 Validation, errors, logging, security mechanisms

* Zod on every write; friendly messages in some routes, raw Zod messages in others (e.g. self-study returns "Too big: expected array to have <=3 items").
* Structured JSON logs (`src/lib/log.ts`), `onRequestError` → alert webhook (`ALERT_WEBHOOK_URL`, 1/min). Request correlation id via `src/proxy.ts`.
* Security headers + CSP in `next.config.mjs` (`script-src 'unsafe-inline'` remains — documented).
* Login lockout per account and per IP (Mongo-backed), constant-time-ish login (dummy bcrypt), no account enumeration on login/forgot.
* Health `/api/health`, readiness `/api/ready` (DB + last successful job age).

### 3.7 Files, notifications, payments, integrations

* **File uploads:** none found (no upload endpoints; notes are text). Photos for libraries are not supported.
* **Payments:** Razorpay subscriptions for owners with webhook signature verification and event de-duplication (`ingestWebhook` in `src/lib/billing.ts`); sandbox checkout for local testing (`ALLOW_BILLING_SANDBOX`, blocked in production by `checkEnv`).
* **AI:** optional Ollama endpoint for doubt solver and question generation; deterministic fallbacks otherwise.

### 3.8 Testing, deployment, hosting

* **CI** (`.github/workflows/ci.yml`): typecheck, lint, unit tests, build, DB integration, HTTP suite, `npm audit --omit=dev --audit-level=high`, Docker image build.
* **Hosting:** Docker (web + worker) documented in `docs/DEPLOYMENT.md`; Vercel supported via `vercel.json` cron (added 23 Oct 2026). The `.env.production` template exists locally (git-ignored).
* **Backups:** `npm run backup/restore` logical NDJSON backups with checksums; provider point-in-time backups are recommended but **not verifiable from the repo** (`docs/BACKUP_RESTORE.md` states targets are proposals).

---

## 4. Existing product inventory

| Feature | User role | Status | Evidence / file paths | Main dependencies | Gaps / risks |
|---|---|---|---|---|---|
| Registration & login | All | Implemented and verified | `src/app/api/auth/[action]/route.ts`, `auth.tsx` | `SESSION_SECRET`, MongoDB | Duplicate-email message unhelpful |
| Password reset | All | Implemented, not verified | `src/lib/auth-extra.ts` | `EMAIL_WEBHOOK_URL` | **No email provider configured → reset impossible in production** |
| Sign out everywhere | All | Implemented, not verified | `auth-extra.ts` `logout-all` | — | — |
| Role/tenant isolation | All | Implemented and verified | `workspace/route.ts`, `test-http.ts` | — | — |
| CSRF/origin check | All | Implemented and verified | `validOrigin` in `src/lib/auth.ts` | `APP_URL` | — |
| Owner onboarding wizard | Owner | Implemented, not verified | `/api/onboarding`, `experience.tsx` `Onboarding` | Email for verify step | Email verification needs provider |
| Seats / shifts / plans | Owner | Implemented and verified | `workspace/route.ts` schemas | — | No seat edit/delete observed |
| Seat allocation (membership) | Owner | Implemented and verified | `memberships` action | — | — |
| Offline fee recording | Owner/staff | Implemented and verified | `payments` action | — | **No void/refund/edit; receipt no. not unique** |
| Receipts | Owner/student | Implemented, not verified | `/api/receipts/[id]` | — | Staff cannot open library receipts |
| Renewals | Owner | Implemented, not verified | `renew` action | — | Must clear dues first |
| Pending dues & reminders | Owner/student | Implemented, not verified | `jobs.ts` `feeDueReminders` | Scheduler | In-app only unless SMS/WhatsApp configured |
| Online fee collection | Student | Missing | `/coming-soon` copy | Payment gateway | Owners still collect cash/UPI manually |
| Join with Library ID | Student/owner | Implemented and verified | `/api/join`, `join.tsx` | — | — |
| Owner invite (consent) | Owner/student | Implemented and verified | `workspace` `students`, `/api/join` `invite-*` | — | Student needs own account first |
| Paper-register import | Owner | Implemented, not verified | `/api/pilot-import`, `pilot.tsx` | — | — |
| Staff permissions | Owner/staff | Implemented and verified | `staff` action, `StaffMembership` | — | Staff must join library first |
| Punch in/out (app) | Student | Implemented, not verified | `/api/punch`, `punch.ts` | Active membership | — |
| Geofence / QR attendance | Owner/student | Implemented, not verified | `assertInside`, `/api/attendance-qr` | Device GPS, Pro plan | Indoor GPS accuracy |
| Live presence, attendance list | Owner | Implemented, not verified | `/owner/presence`, `/owner/attendance` | — | — |
| Expenses & reports | Owner | Implemented, not verified | `expenses`, `/owner/reports` | Plan feature `fees-expenses` | — |
| Admissions CRM | Owner | Implemented, not verified | `/api/crm`, `/api/leads` | — | — |
| Public listing, waitlist, visits | Owner/student | Implemented, not verified | `/api/discovery`, `/l/[slug]` | — | — |
| Branches / multi-library | Owner | Implemented, not verified | `/api/org` | Business plan | — |
| SaaS billing | Owner/admin | Implemented, not verified | `billing.ts`, `/api/billing` | Razorpay keys | Not tested with real gateway |
| Focus timer + XP | Student | Implemented and verified | `focus.*` in `workspace/route.ts` | — | — |
| Subject time, distraction count, focus mode | Student | Implemented and verified | `self-study.tsx`, `StudySession` | — | Distraction = tab hidden only |
| Daily 3-task plan & reflection | Student | Implemented and verified | `/api/self-study` | — | Yesterday's open tasks not surfaced |
| Study heatmap / insights | Student | Implemented and verified | `view=insights` | — | — |
| Monthly report | Student | Implemented and verified | `view=month`, `ReportSwitch` | — | — |
| Weekly report + parent share link | Student | Implemented, not verified | `weekly-report.ts`, `/r/[token]` | — | — |
| Syllabus tracker & goals | Student | Implemented and verified (API) | `view=tracker`, `step-set`, `goal-*` | Syllabus content | Empty without content |
| Study partner + nudge | Student | Implemented and verified | `partner-*`, `partner-nudge.ts` | Push/VAPID | — |
| Exam prep tests, PYQ, CA | Student | Implemented, not verified (unit tests pass) | `/api/prep`, `prep-server.ts` | **Question bank content** | Empty without content |
| Mistake notebook, reasons, re-test | Student | Implemented and verified (API); re-test screen not viewed | `prep.tsx` `Mistakes` | Questions | — |
| Flashcards, smart revision | Student | Implemented, not verified | `/api/prep`, `/api/learning` | Content | — |
| Study plan generator | Student | Implemented, not verified | `phase2.ts` `generateDeterministicPlan` | Syllabus | Single plan; no auto-reschedule |
| Learning insights (weekly) | Student | Implemented, not verified | `learning.ts`, `/app/intelligence` | — | Overlaps progress/report |
| Doubt solver | Student | Partially implemented | `/api/doubts`, `ai-provider.ts` | Optional Ollama | Fallback only without AI host |
| Quiz arena | Student | Implemented, not verified | `phase2` `quiz-*` | Questions | Duplicates prep tests |
| Rewards / coins / garden / quests / achievements / leaderboard | Student | Implemented, not verified | `rewards`, `phase2`, `leaderboard` | Owner rewards setup | Many overlapping systems |
| Community, buddies, rooms, challenges | Student | Implemented, not verified | `/api/community`, `phase2` | Moderation | Minor-safety handled by age band; needs real moderation capacity |
| Push notifications | All | Implemented, not verified | `push.ts`, `push-toggle.tsx` | `VAPID_*` | — |
| Email / SMS / WhatsApp | All | Partially implemented (adapters) | `saas-notify.ts`, `messaging.ts` | Provider URLs | Nothing sent without providers |
| Privacy export & deletion | All | Implemented, not verified (HTTP suite covers deletion) | `/api/privacy` | — | — |
| Super-admin metrics | Admin | Implemented, not verified | `saas-metrics.ts` | — | — |
| Product analytics events | Admin | UI only / mocked → **Missing** | `ProductEvent` model unused | — | No funnel/event data |
| Scheduled jobs | System | Implemented and verified (auth); jobs unit-tested | `jobs.ts`, `/api/jobs/run`, `vercel.json` | `CRON_SECRET` | Daily only on Vercel Hobby |
| Backups | System | Implemented, not verified | `scripts/backup.ts` | Provider backups | Restore drill not evidenced |
| Monitoring / alerts | System | Partially implemented | `log.ts`, `instrumentation.ts` | `ALERT_WEBHOOK_URL` | No error-tracking service |
| CI | System | Implemented, not verified (workflow file only) | `.github/workflows/ci.yml` | GitHub Actions | Run results not inspected |

---

## 5. Student product — improvement opportunities

**Vision test** — can a student open the app and answer these in under 10 seconds?

| Question | Today | Gap |
|---|---|---|
| What should I study today? | Partly: "Aaj ke 3 kaam" (self-written) and `/app/planner` tasks (if a plan was generated) live in different places | No single "Today" list combining plan tasks, due revisions and mistakes |
| Why? | Not shown | Tasks do not say "weak topic", "due for revision", "exam in 40 days" |
| How long? | Plan tasks have `durationMinutes`; focus lengths fixed 25/50… | Not connected — starting a task does not start a timed focus session on that topic |
| What have I completed? | Heatmap, minutes, tracker, quests | Spread over 5+ screens |
| Am I improving? | Test accuracy per topic (`topicStrength`), monthly comparison | No single trend of accuracy over time per subject |
| What to revise next? | Smart revision + flashcards + mistakes | Three queues, no unified "revise next" |

### Build first (high impact, low effort, uses existing data)

1. **One "Today" screen** merging: generated plan tasks for today (`PlanTask`), due revisions (`RevisionSchedule`), due flashcards, open mistakes (re-test), and the 3 self tasks. Each item carries a reason tag and minutes, and a "Start focus" button that passes subject/topic to `focus.start`. All deterministic.
2. **Guided student onboarding (one form, 4 steps):** exam, target date, hours/day by weekday, weak subjects → writes `StudentExam` once, generates the plan, sets `goalMinutes`. Retire the free-text `StudentProfile.exam` as a second source of truth.
3. **Recovery when a day is missed:** carry over yesterday's unfinished items (API already returns `yesterday`), offer "Light day" (Plan B) that keeps the streak with 1 focus session + 1 revision.
4. **Weekly review card:** 3 numbers (focus hours, accuracy change, tasks kept) + 1 recommendation rule (e.g. "accuracy in Polity fell 12% → 2 revision sessions scheduled").

### Then (P2)

* **Plan A/B/C:** compute from available hours: A = full plan, B = 70% load keeping weak topics, C = minimum viable (revision + 1 new topic). Deterministic, switchable per week.
* **Subject accuracy trend chart** from `TestAnswer`/`TestAttempt.result.topics`.
* **Gamification rebalance:** reward task completion, accuracy gains and revision done, not raw minutes; collapse XP/coins/garden/quests into one visible progress system.

### Wait

* AI-generated plans and narratives (deterministic first; AI only for explanation text).
* Social features expansion (rooms, challenges) until core loop retention is proven.

### Evidence of real learning improvement

* Per-student accuracy on repeated topics over 4–8 weeks (same difficulty band).
* Mistake "fixed" rate (2-correct-in-a-row, already tracked in `MistakeEntry.retries`).
* Revision adherence (due vs done) and its correlation with accuracy.
* Mock score trajectory vs. own baseline (not vs. other students).
* Self-reported exam outcome (opt-in) at exam date.

---

## 6. Library product — improvement opportunities

| Need | Today | Recommendation | Genuine need? |
|---|---|---|---|
| One-glance status | `/owner` summary exists | Morning card: occupancy %, free seats per shift, today's collections, total dues, renewals due in 7 days, absentees | **Yes** — core daily habit |
| Easy onboarding | Wizard + import + Library ID | Keep; add "invite link" (QR / WhatsApp text) that pre-fills Library ID | Yes |
| Fee mistakes | No void/edit | Add **void with reason** (audit logged, reverses `Membership.paid`), never hard delete | **Yes, critical** for trust |
| Receipts | `SQ-<ms>` | Per-library sequential receipt number; WhatsApp share of receipt link | Yes |
| Automated reminders | In-app weekly | WhatsApp/SMS via provider once configured; owner sees "reminded on" | Yes (biggest owner pain, hypothesis) |
| Student self-service | Join, punch, seat change, receipts | Keep; add "request renewal" | Yes |
| Attendance reliability | Geofence/QR | Measure false rejects; allow owner override | Yes |
| Staff | 4 permissions | Sufficient for now | — |
| CRM, branches, events, rewards, community moderation, maintenance, feedback | All present | Hide behind "More" until owners ask; they add menu weight (28 owner menu items) | **Probably unnecessary complexity for a small library at launch** |

---

## 7. UX and design audit

**Evidence base:** browser crawl of 32 student, 29 owner and 11 admin pages (no errors), phone-width (375 px) check of 14 key pages (no horizontal scroll), screenshots of new self-study screens, and code reading.

1. **Navigation overload.** Student sidebar has **30 items** (`studentNav`, `experience.tsx` L196–226); owner sidebar has **28** (`ownerNav`). Users cannot form a mental model. *Fix:* 5 primary items (Today, Study, Practice, Progress, Library) with sub-tabs.
2. **Duplicate functionality** (confusing, splits data):
   * Focus room (`/app/focus`) vs Focus rooms (`/app/rooms`).
   * Exam prep tests (`/app/prep`) vs Quiz arena (`/app/quiz`).
   * Study planner (`/app/planner`), Exam roadmap (`/app/roadmap`), Syllabus tracker (`/app/tracker`), daily plan (home).
   * Learning insights (`/app/intelligence`), My progress (`/app/progress`), Weekly report (`/app/report`).
   * Join a library (`/app/join`), My library (`/app/membership`), Library requests (`/app/library-requests`).
   * Goals: `ExamGoal`, `SelfGoal`, `StudyGoal`, `goalMinutes`.
   * Rewards systems: XP, Study Coins, garden, quests, achievements, leaderboard.
3. **First-time friction (student):** no setup checklist; features fail with "Select an exam first" in different words across screens.
4. **Content dependency hidden from users:** prep/tracker/quiz show empty states when the question bank is empty — new students will see an empty product.
5. **Loading states:** full-page brand loader on first load only (navigation fixed on 23 Oct by removing `[[...slug]]/loading.tsx`); feature screens use compact skeletons — good.
6. **Errors:** some routes surface raw Zod text ("Too big: expected array to have <=3 items"); others give friendly text. Standardise.
7. **Success feedback:** toast-based, consistent.
8. **Language:** public site toggles English/Hinglish; app mixes English with Hinglish only in newer screens.
9. **Accessibility:** good use of `aria-label`, `aria-pressed`, `role=status` in newer screens; no automated a11y audit was run (axe/Lighthouse not available in this audit). Many custom buttons use colour-only state; contrast not measured.
10. **Design system:** shadcn is configured but almost unused; most UI is bespoke CSS in a 4,217-line `globals.css` — increases inconsistency and maintenance cost.
11. **Responsiveness:** no horizontal overflow at 375 px on 14 key pages; tablet not tested.

---

## 8. Security, data integrity and reliability

| # | Finding | Evidence | Severity |
|---|---|---|---|
| S1 | **A database credential appears to be committed** in `.env.example` (tracked by git and pushed to GitHub). Value not reproduced here. | `.env.example` line 1 | **Critical** — rotate the Atlas password, replace with placeholder, consider history rewrite |
| S2 | Password reset and owner email verification depend on `EMAIL_WEBHOOK_URL`; not configured → users locked out | `auth-extra.ts` `forgot`, `env.ts` warning | High (availability) |
| S3 | `limited()` is an **in-memory** per-process rate limiter used by most routes; on serverless (Vercel) each instance has its own counter, so limits are weak. Login/registration use the Mongo-backed `limitedShared` (good). | `src/lib/auth.ts` `limited` | Medium |
| S4 | No void/refund/edit for library fee payments → owners cannot correct mistakes; workarounds will corrupt dues | `workspace/route.ts` `payments` | High (data integrity) |
| S5 | Receipt numbers `SQ-${Date.now()}` can collide and are not sequential | `workspace/route.ts` L712, L906 | Medium |
| S6 | CSP allows `'unsafe-inline'` scripts | `next.config.mjs` | Low–Medium (documented) |
| S7 | Staff with `payments` permission cannot view library receipts (filter uses `role === "owner"`) | `receipts/[id]/route.ts` | Low (functional) |
| S8 | `ProductEvent` unused → no audit trail of product usage for metrics | `ops-models.ts` | Low (business) |
| S9 | JWT sessions 7 days, revocable via `sessionVersion`; cookies httpOnly/secure/lax | `auth.ts` | ✓ Good |
| S10 | Tenant isolation, role checks, CSRF origin check, operator injection, overpayment, double booking, duplicate payments — **all verified** | QA scripts 23 Oct; `test-http.ts` | ✓ Good |
| S11 | Owners could convert any account to staff / attach any student without consent | Fixed 23 Oct 2026 (PR 19) | Resolved |
| S12 | Webhooks: Razorpay HMAC verification on raw body + event de-dup | `billing.ts` `ingestWebhook` | ✓ Good (not live-tested) |
| S13 | Backups: logical backup tooling exists; provider PITR and restore drill not evidenced | `docs/BACKUP_RESTORE.md` | Medium |
| S14 | Monitoring: logs + alert webhook; no error tracking/APM service; alerts silent unless `ALERT_WEBHOOK_URL` set | `log.ts`, `instrumentation.ts` | Medium |
| S15 | `npm audit --omit=dev`: 1 high (`body-parser` via `shadcn` CLI wrongly in production `dependencies`); CI audit job will fail. The `cn` package is also listed as a dependency and looks unintended. | `package.json`, Appendix A | Medium (CI blocker, low runtime risk) |

Sensitive logging: logs include user ids and IPs for auth events; no passwords or tokens were found in log calls reviewed (`warnAuth`, `log`).

---

## 9. Market differentiation and business potential

### Repository facts (what is actually different in the code)

* One product joins **library operations** and **student study tools** with a shared identity: a student's focus time, attendance and fees live in one account. Owner adoption can carry student adoption via Library ID and invites.
* **Server-verified study time** (focus timer computed on the server; geofence/QR attendance) — data a parent or owner can trust more than self-reported logs.
* India-specific details: paise math, IST day boundaries, Hinglish copy, cash/UPI recording, paper-register import.
* Consent-based linking of students to libraries, privacy export/deletion, minors' safety in community.

### Hypotheses (need validation, no evidence in repo)

* Owners will switch from a register/spreadsheet mainly for **dues tracking + automatic reminders**, not for seat maps.
* Students will return daily if "Today" tells them exactly what to do and shows improvement; gamification alone will not retain.
* Parents value the weekly report link; this could be a paid hook for libraries ("verified study report").
* Libraries will pay ₹X/month if the product demonstrably reduces unpaid dues.

### Questions for real users

1. Owners: How do you track dues today? How many students forget to pay each month? Would WhatsApp reminders from your own number matter?
2. Owners: Who enters data — you or staff? On phone or desktop?
3. Students: What do you open first in the morning to decide what to study? What made you stop using past study apps?
4. Students: Would you share your weekly report with parents? With your library?
5. Both: Who should pay — library, student, or parent?

_No competitor research or market statistics are included; none was available in this audit._

---

## 10. Monetization and fundraising readiness

### Models to evaluate (already partially wired)

| Model | Code support | Note |
|---|---|---|
| Library SaaS tiers (Free/Starter/Pro/Business) | `SaaSPlan`, `feature-matrix.ts`, Razorpay subscriptions, coupons, referrals | Ready to test pricing |
| Student premium | `STUDENT_FEATURES`, `premiumStudentFeatures`, free-trial switch | Students without a library have **no way to pay** yet |
| Library-sponsored student premium | Access currently "paid up at library" | Natural bundle: libraries include premium in fee |
| Online fee collection (take rate) | Missing | Highest revenue potential, needs payment-aggregator compliance |
| Parent reports | Share link exists | Possible paid add-on; validate first |

### Metrics required before fundraising

| Metric | Collected today? | Source / gap |
|---|---|---|
| Active libraries (30d) | **Yes** | `computeProductMetrics` (payments or attendance) |
| Library retention (30→60d) | **Yes** | same |
| Onboarding completion | **Yes** | `Organization.onboardingStatus` |
| Weekly active students | **Yes** | `StudySession`, `XPTransaction`, `TestAttempt` |
| Student activation (first focus within 7d) | **Yes** | same function |
| MRR / ARR / ARPA / churn / trial conversion | **Yes** (gateway-billed only) | `computeMetrics` |
| Student D1/D7/D30 retention cohorts | No | Needs event or daily-activity table |
| Funnel (visit → signup → setup → first value) | No | `ProductEvent` unused |
| CAC, channel attribution | No | No UTM capture |
| Referral conversion | Partial | `Referral` for orgs only |
| Learning outcome evidence | Partial | Accuracy and mistake-fix data exist; no analysis yet |
| Dues recovered for libraries | Partial | Payments vs dues over time computable |

_No traction, revenue or market-size figures are stated because none were found._

---

## 11. Prioritized roadmap

### P0 — Critical security, correctness, data loss

| # | Problem | Why | Solution | Files | Risks | Priority | Effort | Success metric |
|---|---|---|---|---|---|---|---|---|
| P0.1 | DB credential in `.env.example` on GitHub | Anyone with repo access can reach the database | Rotate Atlas password; placeholder in `.env.example`; restrict Atlas network access; consider history rewrite | `.env.example` | History rewrite affects clones | Critical | Small | Old credential rejected by Atlas |
| P0.2 | No email provider in production | Password reset and owner verification fail | Configure `EMAIL_WEBHOOK_URL` (transactional provider); add `/api/ready` warning | `saas-notify.ts`, env | Deliverability | Critical | Small | Reset email received in staging |
| P0.3 | Fee entries cannot be corrected | Wrong dues, lost owner trust | Void-with-reason action (audit log, reverses `paid`, receipt marked void) | `workspace/route.ts`, `Payment` model, Payments UI | Must stay idempotent & transactional | High | Medium | 0 support requests for "wrong payment" |
| P0.4 | Receipt number collisions | Duplicate receipts, accounting confusion | Per-library counter (`Library.receiptSeq` `$inc` inside the existing transaction), unique index | `workspace/route.ts`, `models.ts` | Migration for old receipts | High | Small | Unique, gap-free receipts per library |
| P0.5 | Weak rate limiting on serverless | Abuse of write endpoints | Use `limitedShared` for write-heavy routes or a hosted limiter | `auth.ts`, routes | Mongo load | Medium | Small | Limits hold across instances in test |
| P0.6 | Backups unproven | Data loss | Enable Atlas PITR; perform and document one restore drill | `docs/BACKUP_RESTORE.md` | Cost | High | Small | Restore drill time recorded |
| P0.7 | CI audit failing on `shadcn` in prod deps; local lint polluted by `.claude/worktrees` | Broken CI hides real regressions | Move `shadcn` (and likely `cn`) to `devDependencies`; ignore `.claude/**` in ESLint | `package.json`, `eslint.config.mjs` | Lockfile change | High | Small | CI green; `npm run lint` clean locally |

### P1 — Fix flows, remove friction

| # | Problem | Solution | Files | Priority | Effort | Metric |
|---|---|---|---|---|---|---|
| P1.1 | 30-item student nav, 28-item owner nav | Group into 5 sections; hide rarely used features | `experience.tsx` nav arrays | High | Medium | Time-to-first-action ↓; nav clicks per session |
| P1.2 | No student onboarding; exam stored in 3 places | 4-step setup writing `StudentExam` + plan + `goalMinutes`; deprecate `StudentProfile.exam` | `phase2.tsx`, `experience.tsx` profile, `/api/phase2` | High | Medium | % students with exam set in day 1 |
| P1.3 | Empty prep/tracker without content | Seed real syllabus + starter question sets for 2 exams (e.g. SSC, Banking); show "coming soon for your exam" state | `/super-admin/question-bank`, `scripts/seed.ts` | High | Large (content) | % sessions with ≥1 practice question |
| P1.4 | Raw validation errors | Map Zod issues to friendly Hinglish/English messages centrally | route `err` helpers | Medium | Small | 0 raw Zod strings in UI |
| P1.5 | Staff cannot open receipts | Allow staff with `payments` permission | `receipts/[id]/route.ts` | Low | Small | — |
| P1.6 | Owner daily status scattered | Morning summary card on `/owner` | `experience.tsx`, `/api/workspace` summary | High | Medium | Owner DAU |
| P1.7 | Students without a library cannot pay | Student plan via Razorpay before Free trial ends | `student-access-server.ts`, `billing.ts` | High | Medium | Paid conversion of solo students |
| P1.8 | No product analytics | Write `ProductEvent` for key funnel steps (signup, setup done, first focus, first test, join library, payment recorded) | `ops-models.ts`, routes | High | Small | Funnel dashboard exists |

### P2 — Core study-planning and improvement experience

| # | Problem | Solution | Priority | Effort | Metric |
|---|---|---|---|---|---|
| P2.1 | No single "what to do today" | Unified Today list (plan tasks + revisions + flashcards + mistakes + 3 self tasks) with reason + minutes + Start focus | High | Medium | Tasks completed / day |
| P2.2 | Missed days break the plan | Carry-over + Plan B "light day" + auto-reschedule pending `PlanTask`s | High | Medium | 7-day retention after a missed day |
| P2.3 | Plans not adaptive | Plan A/B/C from availability; weekly re-plan | Medium | Medium | Plan adherence % |
| P2.4 | "Am I improving?" unclear | Subject accuracy trend + weekly review with one rule-based recommendation | High | Medium | Accuracy change on repeated topics |
| P2.5 | Too many reward systems | One progress system rewarding completion + accuracy gains | Medium | Medium | Share of XP from tasks vs minutes |
| P2.6 | Consolidate duplicates (quiz vs prep, focus vs rooms, 3 analytics screens) | Merge into Practice and Progress | Medium | Large | Fewer screens, same usage |

### P3 — Differentiation, monetization, scale, fundraising

| # | Item | Priority | Effort | Metric |
|---|---|---|---|---|
| P3.1 | WhatsApp dues reminders + receipt share (provider integration) | High | Medium | Dues recovered within 7 days |
| P3.2 | Online fee collection for libraries | High | Large | % fees collected online; take rate |
| P3.3 | Verified parent report (library-branded) | Medium | Small | Share-link opens / week |
| P3.4 | Library-sponsored student premium bundle | Medium | Small | Libraries opting in |
| P3.5 | Learning-outcome study with 2–3 pilot libraries | High | Medium (ops) | Pre/post accuracy, mistake-fix rate |
| P3.6 | Error tracking + uptime monitoring | Medium | Small | MTTR |
| P3.7 | Move to design-system components (shadcn) per screen when touched | Low | Large | CSS size ↓ |

---

## 12. Final co-founder assessment

1. **What we have genuinely built.** A broad, production-minded web platform: secure multi-tenant library operations (seats, memberships, offline fees, attendance, staff, CRM, branches, SaaS billing) plus a large student study suite (verified focus timer, prep engine, revision, self-study tools, reports), with real tests, CI, security headers, jobs and backups tooling. Breadth is far ahead of what a small team usually ships; depth of **content** and **focus** is behind.
2. **Five biggest strengths.**
   1. Correctness on money and seats (transactions, idempotency, conflict checks — verified under concurrency).
   2. Security fundamentals (tenant isolation, CSRF, lockouts, consent for linking, privacy export/deletion).
   3. Server-verified study time and attendance — trustworthy data.
   4. Deterministic, unit-tested business logic, ready for metrics.
   5. India-specific design (paise, IST, Hinglish, cash/UPI, register import).
3. **Five biggest risks or gaps.**
   1. Committed database credential (S1).
   2. No email delivery → account recovery broken in production.
   3. Learning features depend on a question bank and syllabus that are mostly empty.
   4. Navigation and feature sprawl (30 student + 28 owner menu items, many duplicates) dilute the core value.
   5. No product analytics or retention cohorts → cannot prove traction.
4. **Three highest-impact improvements.**
   1. A unified **Today** screen with guided setup for students.
   2. **Dues automation** for owners (fee void/correct + sequential receipts + WhatsApp reminders).
   3. **Instrumentation** (ProductEvent funnel + student retention cohorts).
5. **Recommended next milestone:** "Pilot-ready v1" — P0 complete, student onboarding + Today screen, content for one exam family, owner morning summary, funnel events; run with 3–5 libraries for 6 weeks.
6. **Assumptions to validate.** Owners pay for dues recovery; students return for a clear daily plan; parents value verified reports; library-led distribution brings students at low cost; geofence/QR attendance works reliably indoors.
7. **Evidence for investment readiness.** Active libraries and their 30/60-day retention; weekly active students per library; student D7/D30 retention; dues recovered per library per month; paid conversion from trial; accuracy improvement on repeated topics for active students; qualitative owner testimonials with numbers.
8. **First implementation task:** **P0.1 — rotate the database password and remove it from `.env.example`.** It is the only issue that can cause irreversible harm today, it takes minutes, and every other piece of work is wasted if the database is compromised. Immediately after: **P0.2 email provider**, then **P1.8 funnel events**, so the pilot produces data from day one.

---

## Appendix A — Checks performed (27 Oct 2026, local, non-destructive)

| Check | Command / method | Result |
|---|---|---|
| Type check | `npx tsc --noEmit` | ✅ 0 errors |
| Lint | `npx eslint .` and `npx eslint src tests scripts` | ⚠️ `eslint .` reports 2,514 errors, **all inside the local, untracked `.claude/worktrees/` folder** (old copies of the repo). `src`, `tests`, `scripts`: ✅ 0 errors. CI is unaffected (folder not in git) but local `npm run lint` fails — add `.claude/**` to `globalIgnores` in `eslint.config.mjs`. |
| Unit tests | `npm test` | ✅ 118 tests: 116 pass, 0 fail, 2 skipped |
| Dependency audit (prod deps) | `npm audit --omit=dev` | ❌ 1 **high**: `body-parser` 2.0.0–2.3.0 DoS (GHSA-27r3-jxmh-p828), pulled in by `shadcn` → `@modelcontextprotocol/sdk` → `express`. `shadcn` is a CLI and is listed under production `dependencies`; the CI `dependency-audit` job (`--audit-level=high`) is therefore expected to fail. Not exploitable through the app's own routes (express is not used at runtime), but it blocks CI. |
| Prior session (23 Oct 2026), disposable DB | Browser crawl of 72 pages; 58 API security/logic checks; 12 invite checks; `npm run test:http` | All passed (documented in PR 19/20 descriptions) |

Not run: production or staging systems, Razorpay live/test gateway, real email/SMS delivery, geolocation/QR on a device, accessibility tooling (axe/Lighthouse), load testing, CI run history on GitHub.

## Appendix B — Environment variables (names only)

Required: `MONGODB_URI`, `SESSION_SECRET`, `APP_URL`.
Operations: `TRUST_PROXY`, `LOG_LEVEL`, `MONGODB_POOL_SIZE`, `CRON_SECRET`, `JOB_INTERVAL_MINUTES`, `JOBS_MAX_AGE_HOURS`, `ALERT_WEBHOOK_URL`.
Messaging: `EMAIL_WEBHOOK_URL`, `EMAIL_WEBHOOK_TOKEN`, `WHATSAPP_API_URL`, `WHATSAPP_API_TOKEN`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`.
Payments: `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, `ALLOW_BILLING_SANDBOX` (never in production), `SANDBOX_WEBHOOK_SECRET`.
AI: `STUDYQUEST_AI_PROVIDER`, `STUDYQUEST_AI_ENDPOINT`, `OLLAMA_BASE_URL`, `OLLAMA_MODEL`.
Scripts only: `SEED_EMAIL`, `SEED_PASSWORD`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `QA_PASSWORD`, `CHROME_PATH`.
