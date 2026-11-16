// Pilot health metrics: aggregate counts only, no personal data. Read-only.   npm run pilot:metrics
import mongoose from "mongoose";
import { pilotMetrics } from "../src/lib/pilot-metrics";

async function main() {
  if (!process.env.MONGODB_URI) throw new Error("MONGODB_URI is required");
  await mongoose.connect(process.env.MONGODB_URI);
  console.log(JSON.stringify(await pilotMetrics(), null, 2));
  await mongoose.disconnect();
  process.exit(0);
}
main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
