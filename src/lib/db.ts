import mongoose from "mongoose";
let connection: Promise<typeof mongoose> | undefined;
export async function db() {
  if (!process.env.MONGODB_URI)
    throw new Error("Database is not configured. Set MONGODB_URI.");
  connection ??= mongoose
    .connect(process.env.MONGODB_URI, { maxPoolSize: Number(process.env.MONGODB_POOL_SIZE || 20), serverSelectionTimeoutMS: 8000, socketTimeoutMS: 45000 })
    .then(async (m) => {
      // Fire-and-forget: indexes are created online and never block a request.
      import("./indexes").then((i) => i.ensureExtraIndexes()).catch(() => null);
      return m;
    })
    .catch((error) => {
      connection = undefined;
      throw error;
    });
  return connection;
}
