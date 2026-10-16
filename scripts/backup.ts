// Logical backup / restore CLI.
//   npm run backup -- --out backups/2026-10-16                   (source: MONGODB_URI, read-only)
//   npm run restore -- --from backups/2026-10-16 --target-uri "mongodb://staging/restore-drill" --confirm
// Restore NEVER uses MONGODB_URI as a default and refuses non-empty targets. Without --confirm it only verifies the backup.
import { backupDatabase, restoreDatabase, verifyBackup } from "../src/lib/backup";

const arg = (name: string) => { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : undefined; };
const flag = (name: string) => process.argv.includes(`--${name}`);

async function main() {
  const mode = process.argv[2];
  if (mode === "backup") {
    const uri = process.env.MONGODB_URI, out = arg("out");
    if (!uri || !out) throw new Error("Usage: backup --out <dir> (MONGODB_URI must be set)");
    const m = await backupDatabase(uri, out);
    console.log(`Backup of "${m.sourceDb}" written to ${out}: ${m.collections.length} collections, ${m.collections.reduce((s, c) => s + c.count, 0)} documents`);
  } else if (mode === "restore") {
    const from = arg("from"), target = arg("target-uri");
    if (!from || !target) throw new Error("Usage: restore --from <dir> --target-uri <empty database uri> [--confirm]");
    const { manifest, problems } = await verifyBackup(from);
    if (problems.length) throw new Error(`Backup invalid: ${problems.join("; ")}`);
    console.log(`Backup from ${manifest.createdAt} verified (${manifest.collections.length} collections).`);
    if (!flag("confirm")) return console.log("Dry run only. Add --confirm to restore into the target database.");
    if (process.env.MONGODB_URI && process.env.MONGODB_URI === target && !flag("i-know-this-is-production")) throw new Error("Target equals MONGODB_URI. Refusing to restore over the live database.");
    const r = await restoreDatabase(from, target, { allowNonEmpty: flag("allow-non-empty") });
    console.log(r.ok ? "Restore verified: all document counts match." : `Restore completed with mismatches: ${r.mismatches.join("; ")}`);
    if (!r.ok) process.exitCode = 1;
  } else throw new Error("Usage: backup | restore");
}
main().catch((e) => { console.error(e.message); process.exit(1); });
