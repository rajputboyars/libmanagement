# StudyQuest implementation progress

## Phase 1 baseline (verified 2026-10-16)

- [x] Next.js 16 application shell, responsive public site and role workspaces
- [x] Cookie authentication, role authorization and library tenant isolation
- [x] Memberships, seats, shifts, attendance, payments, receipts and expenses
- [x] Focus timer, study sessions, goals, quests, achievements and XP ledger
- [x] Student complaints, owner resolution workflow, notifications and audit logs
- [x] Unit, Mongo integration and HTTP workflow coverage

## Phase 2

- [x] 1. Exam catalog, syllabus hierarchy and student exam targets
- [x] 2. Deterministic study planner with edits and missed-task rescheduling
- [x] 3. Timed quiz engine, server scoring, history and anti-repeat XP
- [x] 4. Spaced revision scheduling and reminders
- [x] 5. Server-calculated study garden and collectible plants
- [x] 6. Friends, privacy controls and opt-in weekly challenges
- [x] 7. Private achievement-card generation and sharing
- [x] 8. Focus rooms with synchronized starts and solo fallback
- [x] 9. Feedback, events, registration, attendance and announcements

Every checked milestone has server validation, authorization, tenant checks, responsive UI and relevant automated validation.

### Milestone 1 validation

- Built-in SSC, Banking, Railway, UPSC and NEET catalogs plus custom exams
- Strict subject → chapter → topic hierarchy with super-admin management
- Student exam date, weekly target, weak-topic selection, countdown and topic completion
- Server-owned completion timestamps and automatic first revision scheduling
- Responsive adventure map verified at a 438px viewport with zero horizontal overflow
- Typecheck, ESLint, unit tests, Mongo integration tests and production build passing

## Phase 3

- [x] 1. Learning analytics and smart revision engine
- [x] 2. AI doubt solver with text/image input and pluggable providers
- [x] 3. Owner-managed rewards marketplace and Study Coins
- [x] 4. Public library discovery and seat waitlist
- [x] 5. Library maintenance management
- [x] 6. Opt-in community and moderated success wall
- [x] 7. Weekly AI insights with deterministic fallback
- [x] 8. Phase-wide security, upload and responsive hardening

### Phase 3 milestone 1 validation

- Deterministic topic priority from server-scored quiz accuracy, repeated mistakes, mastery, explicit weak topics and overdue revisions
- Eight-week accuracy and completed-revision trends without inferred or fabricated values
- Persisted weekly learning snapshots with one record per student and week
- Spaced revision calendar, weak-topic priority, confidence-based intervals, limited snooze and validated manual rescheduling
- Student-owned queries, rate-limited mutations and audit records for reviews, scheduling changes and saved insights
- In-app due reminders plus polished analytics and revision views
- Verified at 320px, 768px and desktop widths with zero horizontal overflow
- Typecheck, ESLint, 15 unit tests, 2 Mongo integration tests and production build passing

### Phase 3 milestone 2 validation

- Private text/image doubts with PNG, JPEG and WebP signature validation and a 2 MB limit
- Subject and difficulty controls, stepwise explanations, hints and saved paginated history
- Database-backed daily usage allowance plus request rate limiting
- Pluggable Ollama provider through `STUDYQUEST_AI_PROVIDER`, `OLLAMA_BASE_URL` and `OLLAMA_MODEL`
- Transparent deterministic fallback and unverified-assistance disclaimer
- Typecheck, ESLint and 17 unit tests passing

### Phase 3 milestone 3 validation

- Separate immutable Study Coin ledger with idempotent quiz and due-revision earning sources
- Owner reward catalog with inventory, coin cost, total budget and remaining budget controls
- Transaction-safe redemption, balance validation, stock/budget decrement, fulfillment and cancellation refunds
- Cash, transfers and chance-based reward descriptions rejected server-side
- Student ledger and redemption history plus owner fulfillment queue
- Typecheck, ESLint and concurrent Mongo redemption validation passing

### Phase 3 milestone 4 validation

- Public `/discover` search by location/facility with live seat availability; owner-controlled listing visibility
- Visit requests (create, approve/decline, student cancel) and seat waitlist (join, offer, accept, confirm, leave)
- 24-hour offers lazily expire; a seat cannot hold two active offers per shift; acceptance never auto-assigns a seat
- Student "Library requests" page at `/app/library-requests`
- Typecheck, ESLint, 21 unit tests (3 new waitlist), Mongo integration and production build passing
- Not run: HTTP workflow suite and viewport check for the new page; PROGRESS Phase 2 items 2–9 remain unchecked although code exists (needs audit)

### Phase 3 milestone 5 validation

- Facility issues: category, priority, optional seat, status workflow (open → assigned → in-progress → resolved/cancelled, reopen), assignee, repair cost (owner-only, integer paise), per-issue event history
- Students report and see only their own issues (no cost or assignee); team sets priority and seat-offline; reporter notified on status change; audited
- Seats flagged offline become `maintenance` and return to `available` only when no active offline issue remains; existing assignments are never removed (API reports the count)
- Allocation rejects out-of-service seats (waitlist and discovery already excluded them); renewals on an already-assigned seat are intentionally not blocked
- Owner `/owner/maintenance` (summary, filter, pagination, manage + history) and student `/app/maintenance`
- Added the missing CSS for discovery/waitlist (previous milestone's classes were unstyled) in `src/app/maintenance-discovery.css`
- Typecheck, ESLint, 24 unit tests, Mongo integration, production build and HTTP workflow (tenant isolation, offline-seat allocation block, restore on resolve, cost privacy) passing
- Not verified: browser check at 320/768/1440px for maintenance and discovery pages

### Phase 3 milestone 6 validation

- Opt-in community profile: alias (no real name), exam group derived from the student's saved exam target, optional shared goal, buddy and mentorship preferences; leaving hides posts and ends connections
- Deterministic buddy matching (same library, exam and age group; closer weekly target and shared subjects rank higher); mentorship requests are seeker-initiated; no chat and no contact details shown
- Free text rejects emails, links, handles, social-app names and phone-like numbers
- Under-18 safeguards: guardian name/contact collected, visible only to library staff; nothing visible or usable until staff confirm consent; minors match only with minors; no public sharing; self-switch to adult blocked
- Block (ends links, hides both ways), report (post or member, duplicate-protected), owner/staff moderation queue: dismiss, remove post, suspend/restore, consent approve/reject; all audited
- Success wall: milestones (focus hours, level, streak) verified server-side from sessions/XP; per-card explicit consent; private/library/public (public adults only); change visibility or delete; moderators can remove
- Server-rendered SVG achievement cards (escaped text, private no-store, access checked per viewer); download link
- Pages: `/app/community`, `/owner/moderation`
- Typecheck, ESLint, 29 unit tests, Mongo integration, production build and HTTP workflow (consent gating, tenant isolation, unverified milestones, card access, report → removal, block) passing
- Not verified: browser check at 320/768/1440px; guardian consent is staff-attested, not an automated guardian verification; the achievement card is SVG only (no PNG export)

### Phase 3 milestone 7 validation

- Weekly summary built only from verified focus sessions, scored quiz answers and completed revisions; missing data is stated, never estimated
- Suggested next-week goals (focus time bounded to ~+10%, revisions, priority-topic quizzes); saved with the weekly snapshot
- Optional Ollama rewording: output rejected (falls back to the deterministic text) if it contains outcome/selection/rank claims, markup, or numbers not in the verified facts; rate limited; labeled as AI-worded
- Typecheck, ESLint and 3 new unit tests passing

### Phase 3 milestone 8 validation

- Security headers (nosniff, frame deny, referrer policy, permissions policy) and `X-Powered-By` removed via `next.config.mjs`
- Audit of new Phase 3 routes: origin check, session + role check, tenant-scoped queries, Zod validation, per-user rate limits, paginated lists, audited sensitive actions; image uploads keep signature + 2 MB validation
- Preview pages (`/app/intelligence`, `/app/community`, `/owner/maintenance`, `/discover`) show no horizontal overflow at 320px; global `img, svg { max-width: 100% }`, reduced-motion respected
- Final run: typecheck, ESLint, 31 unit tests, Mongo integration, production build and HTTP workflow all passing

### Phase 3 known gaps

- Signed-in layouts (real data) were not visually verified at 320/768/1440px; `/discover` needs a database to render content
- No Content-Security-Policy; in-process rate limits suit one instance only
- Guardian consent is staff-attested; achievement cards are SVG only
- Phase 2 items 2–9 are still unchecked above although their code exists and is covered by `tests/phase2.test.ts`; they need a formal audit

## Phase 4 — Complete exam preparation

- [x] 1. Exam catalog and syllabus (reused Phase 2 catalog/syllabus/enrollment; added syllabus version + source + verified-on, admin-entered official dates with source URL and verification time, stale-date flag)
- [x] 2. Question bank and admin tools (`/super-admin/question-bank`: draft → in-review → published → archived, source/year/copyright metadata, duplicate detection by content hash, validated bulk JSON import with dry run, edits to published questions return to review)
- [x] 3. Mock test engine (full/sectional/topic templates, per-section marks and negative marking, server deadlines, autosave with flags, resume, auto-submit on expiry, atomic idempotent submit, answer key never sent before submission)
- [x] 4. Results and analytics (score, accuracy, sections, topics, server-measured time per question, history chart, strength classification with minimum sample; relative rank only within a library cohort of 10+ first attempts, never national)
- [x] 5. Mistake notebook (auto-collected, retry with server check, understood, notes, topic filter, retry history)
- [x] 6. Revision and flashcards (spaced intervals, confidence-based reviews, missed-card rescheduling, planner sync, in-app reminder)
- [x] 7. Daily practice and gamification (one deterministic daily set per day weighted to weak topics, topic mini challenges, personal best, XP once per activity with 60 XP/day prep cap)
- [x] 8. Exam journey (chapter/subject progress, checkpoints, goals, countdown, sourced official dates)
- [x] 9. Optional AI assistance (Ollama: draft questions land as AI-labelled drafts needing human review; explanation simplification labelled and rate limited; everything works without AI)
- [x] 10. Student notes (private, searchable, bookmarks, topic links) and regression tests

Legacy Phase 2 quiz hardening: published-only questions, no explanation in `quiz-start`, direct `question-save` removed in favour of the reviewed workflow.

### Phase 4 validation

- New routes: `/api/prep`, `/api/prep-admin`; pages `/app/prep`, full-screen `/app/prep/test/:id`, `/app/prep/result/:id`, `/super-admin/question-bank`
- 15 new unit tests (scoring/negative marking, timer, duplicates, import validation, cohort rule, spacing, determinism)
- HTTP workflow covers: import dry-run/duplicates/invalid, review gating, publish-shortfall guard, no key leak before submit, no repeated question in an attempt, resume, concurrent duplicate submit (one result, XP once), score and negative marking, expiry auto-submit and rejected late saves, ownership isolation, mistakes, flashcards, notes, daily/mini sets
- Layout check on a seeded server: runner, results, hub and admin pages show no horizontal overflow at 320px; runner verified at 768px and 1280px (navigator sidebar at desktop, drawer on mobile); refresh resumes selected answer, flag and server timer
- Typecheck, ESLint, 46 unit tests, Mongo integration, production build and HTTP workflow passing

### Phase 4 known gaps

- No bundled question content: the bank starts empty by design (nothing fabricated); content must be authored/imported by an administrator
- Syllabus roadmap tree is a list/accordion, not a graphical map (the Phase 2 adventure map remains for visual progress)
- Phase 2 pages `/app/quiz`, `/app/planner`, `/app/garden`, `/app/rooms`, `/app/events` still exist only as unwired components in `phase2.tsx`
- Daily/mini attempts are capped by bank size; recommendation-by-weak-topic needs mistakes data first
- Rate limits are in-process; AI features need `STUDYQUEST_AI_PROVIDER=ollama`

### Phase 1/2 audit (after Phase 4)

- Phase 1 and Phase 2 code and data models are intact (nothing removed or rebuilt); regression covered by the HTTP workflow, integration and unit suites
- Phase 2 pages that existed only as unlinked components are now reachable: `/app/planner`, `/app/quiz`, `/app/garden`, `/app/rooms`, `/app/events`, `/app/share`, `/owner/feedback`, `/owner/events` (sidebar entries added)
- `/super-admin/questions` stays unlinked: it is superseded by `/super-admin/question-bank`
- Not verified: these Phase 2 screens were not exercised in a browser with data (typecheck, lint and build only); `/app/quiz` predates Phase 4 mock tests and overlaps with them

### Phase 2 linking check

- Linked and rendered with seeded data (no errors): planner, quiz arena, garden, focus rooms, events and feedback, share card (student); owner feedback and events pages. Milestones 2, 3, 4, 5, 7, 8, 9 are checked above on that basis plus existing unit/HTTP coverage
- Milestone 6 stays open: friends, privacy and weekly challenges exist server-side, but their screen (`Community` in `phase2.tsx`) is shadowed by the Phase 3 community page at `/app/community`; it needs its own route
- Not exercised end to end in the browser: generating a plan, running a quiz arena match, joining a room, registering for an event

### Phase 2 milestone 6 completion

- Friends screen now has its own route `/app/friends` (menu: "Friends & challenges"), no longer shadowed by the Phase 3 community page
- HTTP workflow covers: unknown/self requests rejected, only the recipient can respond, challenges only with accepted friends, uninvited users cannot join, friendship data private to participants
- Not verified in a browser (route wired, typecheck, lint, build and API flow only)
- All Phase 1–4 milestones are now checked

## Phase 5 — SaaS business & monetization

- [x] 1. Audit and multi-tenant foundation: Organization → branches (a branch is an existing `Library`, so Phases 1–4 keep working unchanged); org owners, branch managers and staff via `OrganizationMembership`; server-verified branch switching; consolidated reporting; migration (`scripts/migrate-orgs.ts` / lazy `ensureOrganizationForLibrary`, 30-day Pro trial then Free)
- [x] 2. Subscription plans and entitlement engine (DB-stored, versioned plans; trials, grace, cancel, downgrade to Free, usage limits, admin overrides/grants, data retained and exportable)
- [x] 3. Onboarding wizard (`/owner/onboarding`): draft with safe retries, email verification (provider or labelled sandbox code), branch, shifts, seats, fees, CSV import (pending students auto-link on registration), plan choice; no payment needed for Free
- [x] 4. Billing: provider abstraction, Razorpay integration, local sandbox through the same signed-webhook path, raw-body HMAC verification, event-id dedupe, out-of-order handling, retryable failed events, invoices/payments/refund tracking, failed-payment grace
- [x] 5. Super-admin business panel (`/super-admin/business`): metrics, organizations (suspend/reinstate, trial, grant, override, test flag, credit), subscriptions, plan editor + tax/grace/referral settings, billing & webhook monitor, support inbox, coupons/referrals/demo leads, audit log
- [x] 6. Multi-branch operations (`/owner/branches`): branch CRUD with plan limits, team assignment, branch comparison charts, student transfers with immutable `StudentTransfer` history
- [x] 7. Library CRM (`/owner/crm`): stages, assignment, follow-ups, source attribution, conversion stats, consent-gated contact, public enquiry form on the library page with honeypot, duplicate detection and rate limits
- [x] 8. Referrals and promotions: unique codes, abuse checks (self, same owner, shared business domain, repeats, monthly cap), reward only after a verified live paid payment, idempotent credit ledger, coupons with expiry/limits/plan scoping, credit prepay (kept separate from Study Coins/XP)
- [x] 9. Notifications and support: idempotent background jobs (`POST /api/jobs/run`, admin "Run jobs"), trial/billing/payment/onboarding reminders, delivery records, opt-in marketing, support tickets with history
- [x] 10. Business analytics with documented formulas (MRR, ARR, ARPA, trial conversion, churn, collections, refunds, tax, outstanding, growth, utilization, lead conversion, engagement); test orgs and sandbox payments excluded by default
- [x] 11. Public pricing (`/pricing`, DB-driven, comparison + FAQ), demo booking (`/demo`), sandbox checkout

### Phase 5 validation

- 21 new unit tests (plans, entitlements, invoices/tax, coupons, signatures, ordering, metrics helpers, referral abuse, CRM, CSV)
- HTTP workflow additions: cross-tenant denial, branch permissions, limits and Free fallback, checkout never activating a plan, signed/duplicate/reordered webhooks, refund-before-payment retry, failed billing and grace, plan versions, suspension with exports kept, overrides, coupons and tax from configuration, referral abuse and idempotent credit, credit prepay, jobs idempotency, marketing opt-in, analytics exclusions, CRM duplicates/consent/rate limits, support threads, onboarding recovery
- Layout check on a seeded server at 320px: pricing, demo, billing, branches, CRM, support, onboarding and the admin dashboard show no horizontal overflow; admin dashboard verified at 1280px
- Typecheck, ESLint, 67 unit tests, Mongo integration, production build and HTTP workflow passing

### Phase 5 blockers and compliance notes (action needed before production)

- No live money has been moved: the Razorpay integration is structured and tested against signed, Razorpay-shaped events, but real credentials, plan ids (set in the plan editor) and a registered webhook URL are needed; test with `rzp_test_` keys first
- Razorpay coupons need an offer id (set on the coupon) for live billing; subscription credit prepays a plan only when no gateway subscription is running
- Tax is deliberately unconfigured (no rate assumed). Review GST invoicing, TDS, Razorpay merchant terms, RBI recurring-payment (e-mandate) rules, DPDP Act 2023 consent and retention duties, and children's-data obligations with qualified advisers before launch
- Email/SMS delivery needs a provider (`EMAIL_WEBHOOK_URL`, WhatsApp variables); without one, deliveries are recorded as skipped and verification codes can only be shown in the local sandbox
- Scheduler: nothing runs jobs automatically; point cron at `/api/jobs/run` with `CRON_SECRET`
- In-process rate limits remain single-instance; run `npm run migrate:orgs` on existing databases (also happens lazily)

## Phase 6 — Production launch & optimization

Release decision: **NOT READY** — see [RELEASE_READINESS.md](RELEASE_READINESS.md) for the 8 exact blockers (backups, monitoring, live payments, MFA/CSP/pen-test, legal pages, infrastructure, landing-page performance, pilot).

- [x] Audit: found and fixed critical defects — spoofable/shared login rate limit (now shared MongoDB limiter, per-account lockout, trusted-proxy IP handling), no session revocation or password reset, Origin check allowed cross-site requests without Origin, no CSP, `package-lock.json` unusable with `npm ci` on Linux
- [x] Security: sessionVersion revocation, password reset/change/sign-out-all, CSRF tightening, CSP + security headers + noindex for private routes, env validation, redacted structured logs, correlation ids, data export and account deletion, organization deletion request
- [x] Reliability: health/readiness endpoints, global error hook + alert webhook, job runner (membership expiry, fee-due and revision reminders, reconciliation, weekly reports), worker process, job heartbeat
- [x] Database: compound indexes for hot paths, connection pool settings
- [x] Backups: logical backup/restore CLI with checksums and safety rails; automated restore drill into a separate database (PASS)
- [x] Performance: route-level code splitting (public first-load JS 466 → 192 KB gzip), Lighthouse measured (landing page still below target)
- [x] PWA: PNG icons, manifest, safe service worker (static assets only), offline page, cache clearing on sign-out
- [x] SEO: robots, sitemap, canonical/OG metadata, library pages with JSON-LD and real 404, privacy/terms placeholders
- [x] Analytics: privacy-conscious product metrics (admin → Product), no new trackers
- [x] Accessibility/responsive: Lighthouse a11y 100 on 30+ pages after fixes; responsive audit tool across 10 viewports (0 overflow); visual baselines (117)
- [x] Pilot tooling: validated register import with control totals, all-or-nothing commit, reconciliation, invitations; docs/PILOT.md
- [x] Deployment: Dockerfile (web + worker, both build; web smoke-tested), CI workflow, deployment/rollback/backup/monitoring/security docs, `.env.example`
- [x] Tests: 80 unit (78 pass, 2 skipped DB tests that run in integration), 3 integration, extended HTTP workflow (security, privacy, concurrency, pilot, jobs, SEO/PWA endpoints); all PASS

Not done (blocked on external access): provider backups, monitoring provider, Razorpay test/live verification, email provider, hosted CI run, staging/production infrastructure, legal review, real pilot.
