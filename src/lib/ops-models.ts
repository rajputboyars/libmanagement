import { Schema } from "mongoose";
import { id, model } from "./models";

const Mixed = Schema.Types.Mixed;

/** Shared (multi-instance) rate limiting. Documents expire automatically via the TTL index. */
export const RateLimit = model(
  "RateLimit",
  { key: { type: String, required: true, unique: true }, count: { type: Number, default: 0 }, resetAt: { type: Date, required: true, expires: 0 } },
);
export const PasswordReset = model(
  "PasswordReset",
  { userId: { type: id, required: true, index: true }, tokenHash: { type: String, required: true, unique: true }, expiresAt: { type: Date, required: true, expires: 86400 }, usedAt: Date },
);
/** One record per background job execution, used for heartbeat/staleness alerts. */
export const JobRun = model(
  "JobRun",
  { name: { type: String, required: true, index: true }, status: { type: String, enum: ["ok", "failed"], required: true }, durationMs: Number, result: Mixed, error: String, startedAt: { type: Date, required: true } },
  [[{ name: 1, startedAt: -1 }, {}]],
);
export const ImportBatch = model(
  "ImportBatch",
  { libraryId: { type: id, required: true }, hash: { type: String, required: true }, rows: Number, summary: Mixed, createdBy: id, status: { type: String, enum: ["committed"], default: "committed" } },
  [[{ libraryId: 1, hash: 1 }, { unique: true }]],
);
export const DataRequest = model(
  "DataRequest",
  { userId: { type: id, required: true, index: true }, organizationId: id, kind: { type: String, enum: ["export", "delete-account", "delete-organization"], required: true }, status: { type: String, enum: ["completed", "pending", "rejected"], default: "pending" }, note: { type: String, default: "", maxlength: 300 }, completedAt: Date },
);
/** Privacy-conscious product events: no free text, no student content. Retained 400 days. */
export const ProductEvent = model(
  "ProductEvent",
  { name: { type: String, required: true, maxlength: 60 }, organizationId: id, day: { type: String, required: true }, createdAt: { type: Date, default: Date.now, expires: 400 * 86400 } },
  [[{ name: 1, day: 1 }, {}]],
);

/** A student's request to join a library by its Library ID. The owner verifies it before the student is linked. */
export const JoinRequest = model(
  "JoinRequest",
  {
    libraryId: { type: id, required: true },
    userId: { type: id, required: true },
    status: { type: String, enum: ["pending", "approved", "rejected", "cancelled"], default: "pending" },
    message: { type: String, default: "", trim: true, maxlength: 300 },
    note: { type: String, default: "", trim: true, maxlength: 300 },
    decidedBy: id,
    decidedAt: Date,
    // Set when the library invited the student; the student must accept before joining.
    invitedBy: id,
  },
  [
    [{ libraryId: 1, status: 1, createdAt: -1 }, {}],
    [{ userId: 1, createdAt: -1 }, {}],
    [{ userId: 1 }, { unique: true, partialFilterExpression: { status: "pending" } }],
  ],
);

/**
 * Append-only consent log: who accepted/declined what, which version, when and where it was captured. Records belong to ONE user and are only
 * ever read back for that user (no tenant or organization field: a library owner cannot see a student's consent records through the API).
 * The newest record per kind is the current decision; history is kept as evidence.
 */
export const ConsentRecord = model(
  "ConsentRecord",
  {
    userId: { type: id, required: true },
    kind: { type: String, enum: ["terms", "marketing"], required: true },
    version: { type: String, required: true, maxlength: 60 },
    accepted: { type: Boolean, required: true },
    source: { type: String, enum: ["register", "invite-activation", "prompt", "settings", "checkout"], required: true },
  },
  [[{ userId: 1, kind: 1, createdAt: -1 }, {}]],
);
