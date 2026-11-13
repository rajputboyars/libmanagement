// Restore drill on a DISPOSABLE in-memory MongoDB replica set. It never touches any configured database:
// it ignores .env files, builds its own connection strings and key, and uses a temporary directory as the "off-site" store.
//   npm run backup:drill
// It seeds multi-tenant application data through the real models, then runs the real CLI end to end:
//   backup run -> check --deep -> restore (dry run) -> restore --confirm -> independent per-tenant comparison.
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import mongoose from "mongoose";

const TENANTS = Number(process.env.DRILL_TENANTS ?? 3), STUDENTS = Number(process.env.DRILL_STUDENTS ?? 60), XP_ROWS = Number(process.env.DRILL_XP_ROWS ?? 4000);

async function main() {
  const replica = await MongoMemoryReplSet.create({ replSet: { count: 1 }, binary: { version: "7.0.14" } });
  const root = mkdtempSync(join(tmpdir(), "sq-drill-"));
  const dbUri = (name: string) => replica.getUri().replace(/\/(\?|$)/, `/${name}$1`);
  const sourceUri = dbUri("drill_prod_like"), targetUri = dbUri("drill_restore_check");
  const env = { PATH: process.env.PATH ?? "", SystemRoot: process.env.SystemRoot ?? "", BACKUP_SOURCE_URI: sourceUri, BACKUP_DIR: join(root, "offsite"), BACKUP_ENCRYPTION_KEYS: `drill1:${randomBytes(32).toString("base64")}`, BACKUP_TMP_DIR: join(root, "work"), RESTORE_TARGET_URI: targetUri, MONGODB_URI: sourceUri, NODE_ENV: "test" } as NodeJS.ProcessEnv;
  const timings: [string, number][] = [];
  // Asynchronous on purpose: the in-memory mongod pipes its log to this process, and a blocked event loop (spawnSync) would stall it.
  const cli = (...args: string[]) => new Promise<{ status: number | null; stdout: string; stderr: string }>((resolve) => {
    const t = Date.now();
    const child = spawn(process.execPath, ["--import", "tsx", "scripts/backup.ts", ...args], { env });
    let stdout = "", stderr = "";
    child.stdout.on("data", (d) => { stdout += d; });
    child.stderr.on("data", (d) => { stderr += d; });
    const timer = setTimeout(() => { stderr += " [drill] timed out"; child.kill(); }, 600000);
    child.on("close", (status) => { clearTimeout(timer); timings.push([args.join(" ").replace(/--confirm \S+/, "--confirm <db@host>"), Date.now() - t]); resolve({ status, stdout, stderr }); });
  });
  let ok = false;
  try {
    // --- seed realistic multi-tenant data with the real models (indexes included)
    console.log("seeding disposable database...");
    await mongoose.connect(sourceUri);
    const M = await import("../src/lib/models");
    await Promise.all(Object.values(M).filter((m): m is mongoose.Model<unknown> => typeof m === "function" && "init" in m).map((m) => m.init().catch(() => null)));
    console.log("indexes ready");
    const expected: Record<string, { students: number; payments: number; paid: number }> = {};
    for (let t = 0; t < TENANTS; t++) {
      const owner = await M.User.create({ name: `Owner ${t}`, email: `owner${t}@drill.invalid`, passwordHash: "x", role: "owner" });
      const lib = await M.Library.create({ libraryCode: `LIB-DRILL${t}`, name: `Drill Library ${t}`, ownerId: owner._id });
      await M.User.updateOne({ _id: owner._id }, { libraryId: lib._id });
      const seats = await M.Seat.insertMany(Array.from({ length: STUDENTS }, (_, i) => ({ libraryId: lib._id, label: `S${i}` })));
      let paid = 0;
      for (let i = 0; i < STUDENTS; i++) {
        const u = await M.User.create({ name: `Student ${t}-${i}`, email: `s${t}-${i}@drill.invalid`, passwordHash: "x", libraryId: lib._id });
        const amount = 100000 + i * 100, p = Math.round(amount / 2);
        const m = await M.Membership.create({ libraryId: lib._id, userId: u._id, start: new Date("2026-10-01"), end: new Date("2026-10-31"), amount, discount: 0, paid: p, status: "active" });
        await M.Payment.create({ libraryId: lib._id, membershipId: m._id, userId: u._id, key: `drill-${t}-${i}`, amount: p, method: "upi" });
        await M.SeatAssignment.create({ libraryId: lib._id, seatId: seats[i]._id, userId: u._id, membershipId: m._id, start: new Date("2026-10-01"), end: new Date("2026-10-31") });
        paid += p;
      }
      console.log(`tenant ${t} seeded`);
      expected[String(lib._id)] = { students: STUDENTS, payments: STUDENTS, paid };
    }
    const anyUser = await M.User.findOne({ role: { $ne: "owner" } });
    await M.XPTransaction.insertMany(Array.from({ length: XP_ROWS }, (_, i) => ({ userId: anyUser!._id, source: `drill-${i}`, amount: 5, day: "2026-10-16" })));
    await mongoose.disconnect();

    // --- 1. backup (encrypted, off-site store)
    const b = await cli("run");
    console.log(b.stdout.trim() || b.stderr.trim());
    if (b.status !== 0) throw new Error("backup run failed");
    const archive = readdirSync(join(root, "offsite")).find((f) => f.endsWith(".sqbak"))!;
    const size = statSync(join(root, "offsite", archive)).size;
    // --- 2. integrity check with real decryption
    const c = await cli("check", "--deep");
    if (c.status !== 0) throw new Error(`deep check failed: ${c.stdout}`);
    // --- 3. dry run, then confirmed restore into an empty target
    const d = await cli("restore", "--environment", "drill");
    if (d.status !== 0 || !/DRY RUN OK/.test(d.stdout)) throw new Error(`dry run failed: ${d.stdout}`);
    const r = await cli("restore", "--environment", "drill", "--confirm", `drill_restore_check@${new URL(targetUri.replace("mongodb://", "http://")).host}`);
    console.log(r.stdout.split("\n").filter((l) => /RESTORE|VERIFIED|FAILED/.test(l)).join("\n"));
    if (r.status !== 0) throw new Error(`restore failed: ${r.stdout}${r.stderr}`);
    const report = JSON.parse(r.stdout.slice(r.stdout.indexOf("{"), r.stdout.lastIndexOf("}") + 1));
    // --- 4. independent comparison of the restored database, per tenant, against what was seeded
    const conn = await mongoose.createConnection(targetUri).asPromise();
    const problems: string[] = [];
    for (const [lib, e] of Object.entries(expected)) {
      const id = new mongoose.Types.ObjectId(lib);
      const users = await conn.collection("users").countDocuments({ libraryId: id, role: { $ne: "owner" } });
      const pay = await conn.collection("payments").aggregate([{ $match: { libraryId: id } }, { $group: { _id: null, n: { $sum: 1 }, t: { $sum: "$amount" } } }]).toArray();
      const foreign = await conn.collection("payments").aggregate([{ $match: { libraryId: id } }, { $lookup: { from: "memberships", localField: "membershipId", foreignField: "_id", as: "m" } }, { $match: { $expr: { $ne: [{ $arrayElemAt: ["$m.libraryId", 0] }, "$libraryId"] } } }, { $count: "n" }]).toArray();
      if (users !== e.students) problems.push(`library ${lib}: ${users} students, expected ${e.students}`);
      if (pay[0]?.n !== e.payments || pay[0]?.t !== e.paid) problems.push(`library ${lib}: payments ${pay[0]?.n}/${pay[0]?.t}, expected ${e.payments}/${e.paid}`);
      if (foreign[0]?.n) problems.push(`library ${lib}: ${foreign[0].n} payments reference another tenant's membership`);
    }
    await conn.close();
    if (problems.length) throw new Error(problems.join("; "));
    ok = true;
    const total = timings.reduce((n, [, ms]) => n + ms, 0);
    console.log("\nDRILL RESULT: PASS");
    console.log(`  tenants=${TENANTS} students/tenant=${STUDENTS} documents=${report.documents} collections=${report.collections} archive=${(size / 1024).toFixed(0)} KiB (encrypted)`);
    for (const [name, ms] of timings) console.log(`  ${name.padEnd(36)} ${(ms / 1000).toFixed(1)} s`);
    for (const s of report.steps as { step: string; ms: number }[]) console.log(`    restore step ${s.step.padEnd(16)} ${s.ms} ms`);
    console.log(`  total (backup + check + dry run + restore) ${(total / 1000).toFixed(1)} s  — disposable in-memory database, small dataset: NOT a production RTO`);
    if (report.warnings?.length) console.log(`  warnings: ${report.warnings.join("; ")}`);
  } catch (e) {
    console.error("DRILL RESULT: FAIL: " + (e instanceof Error ? e.message : e));
    process.exitCode = 1;
  } finally {
    await replica.stop().catch(() => null); // cleanup problems (file locks on Windows) must not hide the real result
    rmSync(root, { recursive: true, force: true, maxRetries: 3 });
  }
  if (!ok) process.exitCode = 1;
}
main().catch((e) => { console.error("DRILL RESULT: FAIL\n" + (e instanceof Error ? e.message : e)); process.exit(1); });
