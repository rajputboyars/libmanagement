import mongoose from "mongoose";
import "./models";
import "./saas-models";
import "./ops-models";
import { log } from "./log";

/**
 * Additional compound indexes for the hottest tenant-scoped queries (dashboards, tables, reminders, analytics).
 * createIndex is idempotent and online; a failure is logged and never blocks requests.
 */
const EXTRA: [string, Record<string, 1 | -1>][] = [
  ["Notification", { userId: 1, createdAt: -1 }],
  ["Notification", { libraryId: 1, createdAt: -1 }],
  ["Membership", { libraryId: 1, status: 1, end: 1 }],
  ["Membership", { userId: 1, libraryId: 1, status: 1 }],
  ["Payment", { libraryId: 1, createdAt: -1 }],
  ["Payment", { membershipId: 1 }],
  ["Expense", { libraryId: 1, date: -1 }],
  ["Attendance", { libraryId: 1, checkIn: -1 }],
  ["User", { libraryId: 1, role: 1 }],
  ["SeatAssignment", { userId: 1, end: 1 }],
  ["SeatAssignment", { libraryId: 1, end: 1, start: 1 }],
  ["StudySession", { userId: 1, state: 1, completedAt: -1 }],
  ["XPTransaction", { userId: 1, createdAt: -1 }],
  ["Complaint", { libraryId: 1, createdAt: -1 }],
  ["AuditLog", { libraryId: 1, createdAt: -1 }],
  ["Seat", { libraryId: 1, operationalStatus: 1 }],
  ["BillingWebhookEvent", { status: 1, attempts: 1, createdAt: 1 }],
  ["NotificationDelivery", { status: 1, channel: 1, attempts: 1 }],
];
let done = false;
export async function ensureExtraIndexes() {
  if (done) return;
  done = true;
  for (const [name, spec] of EXTRA) {
    const model = mongoose.models[name];
    if (!model) continue;
    try { await model.collection.createIndex(spec, { background: true }); } catch (error) { log("warn", "index.create_failed", { name, message: error instanceof Error ? error.message : "error" }); }
  }
}
