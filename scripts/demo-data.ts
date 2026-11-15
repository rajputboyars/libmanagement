// Synthetic, clearly labelled demo tenants for rehearsals and training. Refused when APP_ENV=production.
//   (both need --target-is-not-production: you confirm the database is local or staging, never one holding real libraries)
//   npm run demo:seed -- --label "Training" [--students 5]      creates "[DEMO] Training" with @demo.invalid accounts (password printed once)
//   npm run demo:purge [-- --confirm]                            lists, or with --confirm deletes, ONLY [DEMO] test tenants and their data
import mongoose from "mongoose";
import { assertDemoAllowed, createDemoTenant, purgeDemoTenants } from "../src/lib/demo-data";

const arg = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : undefined; };
async function main() {
  const mode = process.argv[2];
  assertDemoAllowed();
  if (!process.argv.includes("--target-is-not-production")) throw new Error("Demo data must never go into a database holding real libraries. Re-run with --target-is-not-production to confirm the target is a local or staging database you own.");
  if (!process.env.MONGODB_URI) throw new Error("MONGODB_URI is required (use a staging or local database)");
  await mongoose.connect(process.env.MONGODB_URI);
  if (mode === "seed") {
    const r = await createDemoTenant({ label: arg("label") ?? "Demo", students: Number(arg("students") ?? 5) });
    console.log(`Created demo tenant (isTest): ${r.students} synthetic students.\n  owner login: ${r.ownerEmail}\n  throwaway password (shown once): ${r.password}\nThe owner must enrol in two-step sign-in at first sign-in, like any owner. Remove with: npm run demo:purge -- --confirm`);
  } else if (mode === "purge") {
    const r = await purgeDemoTenants({ confirm: process.argv.includes("--confirm") });
    console.log(JSON.stringify(r, null, 2));
    console.log(r.deleted ? "Demo tenants deleted." : "Dry run: nothing deleted. Add --confirm to delete exactly the records listed above.");
  } else throw new Error("Usage: seed | purge");
  await mongoose.disconnect();
  process.exit(0);
}
main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
