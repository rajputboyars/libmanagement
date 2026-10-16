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
