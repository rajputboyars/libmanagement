// Migration: wraps every single-library account in an Organization (idempotent, safe to re-run).
//   npm run migrate:orgs            -> applies
//   npm run migrate:orgs -- --dry   -> reports what would change
// Existing libraries become branch #1 of a new organization. Operational records keep their libraryId,
// so Phases 1-4 behave exactly as before. Each migrated organization gets a 30-day Pro trial, then Free.
import mongoose from "mongoose";
import { Library } from "../src/lib/models";
import { ensureOrganizationForLibrary } from "../src/lib/saas-server";

async function main() {
  const dry = process.argv.includes("--dry");
  if (!process.env.MONGODB_URI) throw new Error("MONGODB_URI is required");
  await mongoose.connect(process.env.MONGODB_URI);
  const pending = await Library.find({ organizationId: { $exists: false } }).select("_id name").lean<{ _id: unknown; name: string }[]>();
  console.log(`${pending.length} libraries without an organization${dry ? " (dry run)" : ""}`);
  if (!dry) for (const l of pending) { const id = await ensureOrganizationForLibrary(l._id as never); console.log(`  ${l.name} -> organization ${id}`); }
  await mongoose.disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
