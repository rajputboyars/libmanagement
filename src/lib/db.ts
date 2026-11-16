import mongoose from "mongoose";
import { defer } from "./defer";
import { mongoOptions, parsePoolSize } from "./db-config";
import { log } from "./log";

// One cached connection promise per process/instance (also across Next.js dev reloads), so a request never creates a pool of its own.
const globalForMongo = globalThis as typeof globalThis & { __sqMongoConnection?: Promise<typeof mongoose> };
export async function db() {
  if (!process.env.MONGODB_URI)
    throw new Error("Database is not configured. Set MONGODB_URI.");
  if (!globalForMongo.__sqMongoConnection) {
    const pool = parsePoolSize(process.env);
    if (pool.invalid) log("warn", "config.mongodb_pool_invalid", { message: pool.invalid, using: pool.size });
    globalForMongo.__sqMongoConnection = mongoose
      .connect(process.env.MONGODB_URI, mongoOptions(process.env))
      .then(async (m) => {
        // Indexes are created online and never block a request. Deferred (after the response on serverless hosts) so the work is not cut off.
        defer(() => import("./indexes").then((i) => i.ensureExtraIndexes()), { label: "ensure-indexes" });
        return m;
      })
      .catch((error) => {
        globalForMongo.__sqMongoConnection = undefined;
        throw error;
      });
  }
  return globalForMongo.__sqMongoConnection;
}
