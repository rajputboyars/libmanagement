# Hometown library pilot (50–100 fixed seats)

Goal: run one real library on StudyQuest, in parallel with its paper register, until the numbers match and the owner is confident. Nothing here should be done for a live library without that library's explicit agreement.

## Roles

- **Pilot owner:** the library owner (decisions, final acceptance).
- **Pilot lead:** the StudyQuest person who supports the library daily during the pilot.
- **Staff:** desk operators who record admissions, payments and attendance.

## Phase 0 — Preparation (before the library touches the software)

- [ ] Agree pilot dates (suggested: 6 weeks) and success criteria (below).
- [ ] Owner registers, completes the **Setup guide** (`/owner/onboarding`): organization, branch, shifts, seats (one label per physical seat), fee plans with real prices.
- [ ] Photograph or scan the paper register; owner confirms who is *currently* active.
- [ ] Decide mapping: every paper seat number → a software seat label; every timing → a shift; every fee type → a plan name.
- [ ] Production prerequisites confirmed (HTTPS domain, backups enabled, email provider, monitoring) — see RELEASE_READINESS.md. If any are missing, run the pilot on **staging with copied, consented data** only.

## Phase 1 — Register import (`/owner/import`)

CSV columns: `name, email, phone, seat, shift, plan, start_date (YYYY-MM-DD), paid_rupees, discount_rupees`.

1. Type the register into the template (download it from the import page). Email is required so each student can activate an account; collect missing emails at the desk first.
2. **Validate.** Fix every reported problem. The tool checks seat/shift/plan mapping, dates, impossible amounts (paid more than owed), duplicate emails, duplicate phone numbers with different emails (possible duplicate student), and seat clashes inside the file and against existing assignments.
3. Enter the register's control totals (total paid, total outstanding). The import is blocked if the file does not add up.
4. Tick the review confirmation and **import**. The import is all-or-nothing and cannot be applied twice.
5. **Reconcile** (same page): every student has a membership, payments match, no seat overlaps, outstanding total equals the paper register.
6. **Send invitations.** Students receive a link to choose a password (or use *Forgot password*).

## Phase 2 — Parallel run (2–6 weeks)

- Staff record every admission, payment and attendance in StudyQuest **and** on paper.
- Every evening: compare today's collections and attendance count between paper and software; log differences.
- Weekly: owner checks outstanding dues (software vs paper), seat map vs the physical hall, and expired memberships.
- Gamification stays optional: students may study with or without the timer; library operations never depend on it.

## Staff training guide (30-minute session + a printed cheat-sheet)

1. Sign in; switch branch (if several).
2. **Admit a student:** Students → add by registered email → Memberships → choose plan, seat, shift, start date.
3. **Collect a fee:** Payments → membership → amount → method (cash/UPI) → receipt. Partial payments are allowed; overpayment is blocked.
4. **Attendance:** open Attendance → show the QR code (valid 10 minutes); the student scans and confirms. Manual check-in is available.
5. **Renew / pause / cancel** a membership; seat stays reserved while paused.
6. **Handle a complaint** and a maintenance issue; **admission enquiries** under Admissions.
7. What to do when the internet is down: keep paper; enter later; never mark payments received that were not.

## Student invitation workflow

Owner imports register → sends invitations → student opens link → sets password → sees membership, seat, dues, notifications → optional focus timer/XP.

## Support and feedback during the pilot

- Pilot lead is reachable on an agreed channel with a same-day response target.
- Owner and staff can raise tickets under Support; capture the `x-request-id` for any error.
- Weekly 20-minute review: issues, time saved, trust in numbers; log in a shared sheet.

## Acceptance criteria

| # | Criterion | Evidence |
|---|---|---|
| 1 | Every active student has the correct membership (plan, seat, shift, dates) | Reconcile view + spot check of 20 students against paper |
| 2 | No overlapping seat assignments | Reconcile view shows 0 overlaps; hall walk-through |
| 3 | Due balances reconcile | Software outstanding total equals paper total (±₹0) for 2 consecutive weeks |
| 4 | Payments reconcile | Daily cash/UPI totals match the paper register for 10 consecutive working days |
| 5 | Attendance works | QR and manual check-in used daily; counts match the desk |
| 6 | Owner runs daily operations unaided | Owner completes a day without pilot-lead intervention |
| 7 | Students access memberships | At least 80% of invited students have activated and viewed their membership |
| 8 | Gamification does not interfere | No staff or owner report of disruption; XP/timer optional |
| 9 | No data-loss or double-charge incident | Incident log empty |

Pilot decision: accept / extend / stop, recorded with date and signatures of the pilot owner and lead.

## Rollback

The paper register is never retired during the pilot. If the pilot is stopped: export data (Billing page → CSV exports), keep or delete per the library's wishes (deletion request flow), and continue on paper.
