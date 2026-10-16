import { normalizePhone } from "./saas";

export type PilotRef = { seats: Map<string, string>; shifts: Map<string, { id: string; start: number; end: number }>; plans: Map<string, { id: string; amount: number; days: number }> };
export type ExistingAssignment = { seatId: string; start: Date; end: Date; shiftStart: number; shiftEnd: number };
export type PilotRow = { line: number; name: string; email: string; phone: string; seatId: string; seatLabel: string; shiftId: string; shiftStart: number; shiftEnd: number; planId: string; start: Date; end: Date; pricePaise: number; discountPaise: number; paidPaise: number; duePaise: number };
export type PilotIssue = { line: number; error: string };

const HEADERS = ["name", "email", "phone", "seat", "shift", "plan", "start_date", "paid_rupees", "discount_rupees"];
const key = (v: string) => v.trim().toLowerCase();
const paise = (v: string) => { const n = Number(v.replace(/,/g, "")); return Number.isFinite(n) && n >= 0 && n <= 10_000_000 ? Math.round(n * 100) : null; };

function splitCsv(line: string) {
  const out: string[] = []; let cur = "", quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) { if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') quoted = false; else cur += c; }
    else if (c === '"') quoted = true; else if (c === ",") { out.push(cur.trim()); cur = ""; } else cur += c;
  }
  out.push(cur.trim());
  return out;
}

const overlapInDay = (a: { start: number; end: number }, b: { start: number; end: number }) => a.start < b.end && b.start < a.end;
export const intervalsOverlap = (a: { start: Date; end: Date; shiftStart: number; shiftEnd: number }, b: { start: Date; end: Date; shiftStart: number; shiftEnd: number }) =>
  a.start < b.end && b.start < a.end && overlapInDay({ start: a.shiftStart, end: a.shiftEnd }, { start: b.shiftStart, end: b.shiftEnd });

/**
 * Validates a paper-register CSV against the branch's real seats, shifts and plans. Nothing is written here.
 * The whole file is all-or-nothing: any error means no row is imported, so the data stays consistent.
 */
export function validatePilotCsv(text: string, ref: PilotRef, existing: ExistingAssignment[] = [], max = 300) {
  const issues: PilotIssue[] = [], rows: PilotRow[] = [];
  const lines = text.replace(/\r/g, "").split("\n").filter((l) => l.trim());
  if (!lines.length) return { rows, issues: [{ line: 0, error: "File is empty" }], totals: totals(rows) };
  const header = splitCsv(lines[0]).map(key);
  const missing = HEADERS.filter((h) => !header.includes(h) && h !== "discount_rupees" && h !== "phone");
  if (missing.length) return { rows, issues: [{ line: 1, error: `Missing columns: ${missing.join(", ")}` }], totals: totals(rows) };
  const col = (cells: string[], name: string) => (header.indexOf(name) >= 0 ? cells[header.indexOf(name)] ?? "" : "");
  if (lines.length - 1 > max) issues.push({ line: max + 2, error: `A pilot import handles at most ${max} rows at a time` });
  const emails = new Map<string, number>(), phones = new Map<string, { line: number; email: string }>();
  const batch: ExistingAssignment[] = [];
  lines.slice(1, max + 1).forEach((raw, i) => {
    const line = i + 2, cells = splitCsv(raw);
    const fail = (error: string) => { issues.push({ line, error }); };
    const name = col(cells, "name"), email = key(col(cells, "email")), phone = normalizePhone(col(cells, "phone"));
    if (name.length < 2 || name.length > 80) return fail("Name must be 2-80 characters");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail("A valid email is required so the student can activate their account");
    if (emails.has(email)) return fail(`Duplicate email (also on line ${emails.get(email)})`);
    if (phone) { const prior = phones.get(phone); if (prior && prior.email !== email) return fail(`Same phone as ${prior.email} on line ${prior.line}: possible duplicate student, resolve before importing`); phones.set(phone, { line, email }); }
    emails.set(email, line);
    const seatId = ref.seats.get(key(col(cells, "seat"))), shift = ref.shifts.get(key(col(cells, "shift"))), plan = ref.plans.get(key(col(cells, "plan")));
    if (!seatId) return fail(`Unknown seat "${col(cells, "seat")}"`);
    if (!shift) return fail(`Unknown shift "${col(cells, "shift")}"`);
    if (!plan) return fail(`Unknown plan "${col(cells, "plan")}"`);
    const dateText = col(cells, "start_date");
    const start = /^\d{4}-\d{2}-\d{2}$/.test(dateText) ? new Date(`${dateText}T00:00:00.000Z`) : null;
    if (!start || isNaN(+start)) return fail("start_date must be YYYY-MM-DD");
    if (Math.abs(start.getTime() - Date.now()) > 400 * 86400000) return fail("start_date is more than a year from today");
    const paid = paise(col(cells, "paid_rupees") || "0"), discount = paise(col(cells, "discount_rupees") || "0");
    if (paid === null) return fail("paid_rupees must be a non-negative number");
    if (discount === null) return fail("discount_rupees must be a non-negative number");
    if (discount > plan.amount) return fail("Discount exceeds the plan price");
    if (paid > plan.amount - discount) return fail("Paid amount exceeds what is owed (price minus discount)");
    const end = new Date(start.getTime() + plan.days * 86400000);
    const candidate = { seatId, start, end, shiftStart: shift.start, shiftEnd: shift.end };
    const clash = [...existing, ...batch].find((a) => a.seatId === seatId && intervalsOverlap(a, candidate));
    if (clash) return fail(`Seat ${col(cells, "seat")} is already assigned in that shift and period`);
    batch.push(candidate);
    rows.push({ line, name, email, phone, seatId, seatLabel: col(cells, "seat"), shiftId: shift.id, shiftStart: shift.start, shiftEnd: shift.end, planId: plan.id, start, end, pricePaise: plan.amount, discountPaise: discount, paidPaise: paid, duePaise: plan.amount - discount - paid });
  });
  return { rows, issues, totals: totals(rows) };
}

export function totals(rows: PilotRow[]) {
  return { students: rows.length, pricePaise: rows.reduce((s, r) => s + r.pricePaise, 0), discountPaise: rows.reduce((s, r) => s + r.discountPaise, 0), paidPaise: rows.reduce((s, r) => s + r.paidPaise, 0), duePaise: rows.reduce((s, r) => s + r.duePaise, 0) };
}

/** Post-import integrity checks over already-loaded records. Pure so it can be unit tested. */
export function integrityReport(input: { students: string[]; memberships: { id: string; userId: string; amount: number; discount: number; paid: number; status: string }[]; payments: { membershipId: string; amount: number }[]; assignments: ExistingAssignment[] }) {
  const problems: string[] = [];
  const paidBy = new Map<string, number>();
  input.payments.forEach((p) => paidBy.set(p.membershipId, (paidBy.get(p.membershipId) ?? 0) + p.amount));
  const hasMembership = new Set(input.memberships.filter((m) => m.status === "active" || m.status === "paused").map((m) => m.userId));
  const withoutMembership = input.students.filter((s) => !hasMembership.has(s));
  if (withoutMembership.length) problems.push(`${withoutMembership.length} student(s) have no active membership`);
  const mismatched = input.memberships.filter((m) => (paidBy.get(m.id) ?? 0) !== m.paid);
  if (mismatched.length) problems.push(`${mismatched.length} membership(s) whose recorded paid amount differs from the sum of payments`);
  const overpaid = input.memberships.filter((m) => m.paid > m.amount - m.discount);
  if (overpaid.length) problems.push(`${overpaid.length} membership(s) overpaid`);
  let overlaps = 0;
  const sorted = [...input.assignments].sort((a, b) => (a.seatId < b.seatId ? -1 : 1));
  for (let i = 0; i < sorted.length; i++) for (let j = i + 1; j < sorted.length && sorted[j].seatId === sorted[i].seatId; j++) if (intervalsOverlap(sorted[i], sorted[j])) overlaps++;
  if (overlaps) problems.push(`${overlaps} overlapping seat assignment(s)`);
  const dueTotal = input.memberships.filter((m) => m.status !== "cancelled").reduce((s, m) => s + Math.max(0, m.amount - m.discount - m.paid), 0);
  return { ok: problems.length === 0, problems, duePaise: dueTotal, studentsWithoutMembership: withoutMembership.length, overlaps };
}
