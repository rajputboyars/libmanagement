# StudyQuest

A Next.js 16 / React 19 study-library SaaS with MongoDB-backed owner workspaces and a gamified student experience. Built with TypeScript, Tailwind v4, Mongoose, TanStack Query, Zustand, React Hook Form, Zod, Recharts, Motion, and locally hosted Plus Jakarta Sans.

## Run locally

Requires Node.js 22+ and a MongoDB **replica set** (MongoDB Atlas works). Transactions are required; a standalone MongoDB server is insufficient.

```powershell
npm ci
Copy-Item .env.example .env.local
# Set MONGODB_URI, SESSION_SECRET (32+ random characters), APP_URL.
npm run dev
```

Open http://127.0.0.1:3000. Without a database, the public site and explicitly labeled student/owner previews work. Preview timers run locally and award no saved XP. Account creation and all persisted actions require MongoDB and a session secret. No account credentials are hardcoded.

Register as an owner to create a library, configure shifts and seats, create plans, and connect registered student accounts by email. Register separately as a student for standalone study mode. Staff permissions are granted by the owner from Settings to an eligible registered account. Memberships use prices in **integer paise**, daily shift boundaries in minutes from midnight, and UTC timestamps. Display currency is INR.

## Local fictional seed

Add `SEED_EMAIL` and `SEED_PASSWORD` (10+ characters) to `.env.local`, then run `npm run seed`. The transaction creates a fictional library, 60 seats, two shifts, two plans, an owner using your supplied email, and a student using `student+<your supplied email>`. Both use your supplied local seed password. Existing accounts are never overwritten. The seed refuses production mode.

For a platform administrator, set `ADMIN_EMAIL` and `ADMIN_PASSWORD` (12+ characters), then run `npm run bootstrap-admin`. It creates a new account only and never promotes an existing account.

## Working workflows

- Public landing, product features, pricing, account registration and sign-in. Demo links open the product directly; no sales message is silently sent.
- Owner: library creation, registered-student linking, floors/seats, shifts, fee plans, membership allocation, partial payments, discounts, outstanding balances, payment records with receipt numbers, attendance, expenses, profitability, announcements, complaints, scoped staff permissions and audit history.
- Memberships: creation, pause/resume, cancellation and renewal with explicitly confirmed full payment. Pausing retains the reserved seat; cancellation releases future availability. Renewal preserves the previous membership and payment history.
- Seat allocation: date and shift overlap checks inside a transaction, with a tenant-level write lock to serialize concurrent reservations. Adjacent shifts are permitted. Full-day assignments conflict with all overlapping shifts. Overnight shifts should be represented as separate same-day shifts.
- Payments: confirmed cash/UPI records only, integer amounts, overpayment prevention and a unique per-library idempotency key. No payment gateway is implied.
- Student: profile/exam preferences, daily goal, private-by-default profile, server-backed focus timer, pause/resume, XP ledger, levels, goal and weekly consistency bonuses, quest progress, achievement milestones, streaks, two rest days per rolling week, progress charts, membership and notifications.
- QR attendance: owner Attendance page generates a signed QR code valid for ten minutes. A signed-in student scans it and explicitly confirms check-in. The API verifies the library, active membership, token purpose and expiry. Set `APP_URL` to an address reachable from the scanning device.
- Super admin: tenant overview and manual subscription plan/status management. Status changes do not charge a customer.

## Verification

```powershell
npm run typecheck
npm run lint
npm test
npm run build
npm run test:integration
npm run test:http
```

`npm test` runs business-rule and token tests; the database test is skipped unless `TEST_MONGODB_URI` points at a disposable replica set. `test:integration` creates its own isolated MongoDB replica set, runs database integration checks, and destroys the test data. `test:http` starts an isolated production server on port 3101 and exercises actual account, authorization, allocation, payment and focus APIs. Run `npm run build` first. The test runtime may download the official MongoDB binary on its first invocation. It never connects to your application database.

The HTTP suite verifies registration, cookie sessions, role/tenant isolation, overlapping allocations, overpayments, idempotent partial payments, early timer completion rejection, and exactly one focus reward. Rule tests cover pricing, overlaps, XP caps, levels, streaks/rest days and paused timer behavior.

## Security and operations

Sessions use expiring HS256 tokens in HttpOnly, SameSite=Lax cookies (Secure in production). User roles are reloaded from MongoDB on each authenticated request. Passwords use bcrypt with cost 12. Public registration cannot create staff or administrator accounts. Mutations validate origin, authorization, tenant ownership and Zod inputs. Client timers are presentation only; reward eligibility is checked using server timestamps. Tenant writes, membership changes, payments and rewards use transactions. Schema indexes enforce unique emails, seat labels, payment keys, XP sources and daily attendance. Owner mutations are audited.

Deploy behind HTTPS, set `APP_URL` to the canonical origin, keep MongoDB credentials server-side, and provision indexes before accepting writes. In-process rate limits are suitable for one instance; use a shared rate-limit store when scaling to multiple instances. Database backup, monitoring, account recovery, email verification and production operational policies must be configured before a public launch. The manifest is PWA-ready; offline data synchronization and a service worker are not enabled.

The WhatsApp adapter in `src/lib/messaging.ts` saves an actual in-app notification and optionally calls a configured provider. It reports absent configuration and provider failure distinctly. Match its request contract to your chosen provider before enabling it; the app does not claim external delivery. No provider is configured by default.

## Scope limits

This is a functional core implementation, not a claim that every feature in the full roadmap is complete. Quiz verification, revision-task management, anonymous leaderboards, automated renewal scheduling, a public library directory, configurable hourly/custom billing, subscription checkout, support-ticket administration and offline sync are not implemented. Future concepts are not presented as working student navigation. Staff permissions can be added or fully revoked from owner Settings. Receipt links open printable documents scoped to the owner or the paying student.

Owner tables use server-side search and pagination (25 rows per page). Financial totals, student counts, seat counts and cumulative XP use database aggregation/counts rather than table snapshots. Selection controls currently use snapshots of 100 records; seat maps load up to 500 seats and 200 assignments, and study charts use the 500 most recent XP entries. Extend searchable selectors and assignment loading for larger deployments. XP award values are centralized in `src/lib/rules.ts`; change and revalidate that configuration as part of a deployment. Study days and shift display calculations use UTC consistently. All same-day shifts must end after their start.

## Structure

- `src/app`: App Router pages, layouts, errors, API handlers, responsive styles.
- `src/components`: shared app shell, public/auth/student/owner/admin experiences, forms and charts.
- `src/lib`: schemas/indexes, database connection, session/RBAC helpers, business rules and messaging adapter.
- `scripts`: safe local seed, administrator bootstrap and isolated integration runners.
- `tests`: business-rule, authentication and MongoDB integration tests.

Build for deployment with `npm run build`, then `npm start`. Supply production environment variables through your hosting provider.

## Production readiness (Phase 6)

- Release gate: [RELEASE_READINESS.md](RELEASE_READINESS.md) — the current decision and every blocker.
- Operations docs: [deployment](docs/DEPLOYMENT.md) · [backup & restore](docs/BACKUP_RESTORE.md) · [monitoring](docs/MONITORING.md) · [security](docs/SECURITY.md) · [pilot](docs/PILOT.md).
- Health: `GET /api/health` (liveness), `GET /api/ready` (config + database + job heartbeat).
- Background jobs: `npm run worker` (or `POST /api/jobs/run` with `x-cron-secret`).
- Backups: `npm run backup -- --out backups/<date>`; `npm run restore -- --from <dir> --target-uri <empty db> --confirm`.
- Existing databases: `npm run migrate:orgs -- --dry` then apply with approval.
- Tools: `scripts/responsive-audit.mjs` (overflow, touch targets and screenshot baselines across 10 viewports via Chrome DevTools Protocol), `scripts/measure-bundle.mjs` (first-load JS), `scripts/qa-server.ts` (seeded local server on a disposable in-memory database).
- Verification: `npm run typecheck && npm run lint && npm test && npm run build && npm run test:integration && npm run test:http`.
