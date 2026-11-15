// Validates a deployment environment against its profile BEFORE deploying. Prints variable NAMES and fixes only, never values.
//   npm run env:check -- --profile staging|production [--role web|worker|backup] [--env-file path]
// Without --env-file it validates the current process environment (for example inside the container, or in CI with secrets injected).
import { readFileSync } from "node:fs";
import { profileProblems, type Profile, type Role } from "../src/lib/env-profile";

const arg = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : undefined; };
function parseEnvFile(path: string) {
  const out: Record<string, string> = {};
  for (const raw of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 1) continue;
    out[line.slice(0, eq).trim()] = line.slice(eq + 1).trim().replace(/^(['"])(.*)\1$/, "$2");
  }
  return out;
}
const profile = arg("profile") as Profile | undefined;
const role = (arg("role") ?? "web") as Role;
if (profile !== "staging" && profile !== "production") { console.error("Usage: env:check --profile staging|production [--role web|worker|backup] [--env-file path]"); process.exit(2); }
if (!["web", "worker", "backup"].includes(role)) { console.error("--role must be web, worker or backup"); process.exit(2); }
const file = arg("env-file");
// An env file describes a DEPLOYED environment, where the build/runtime sets NODE_ENV=production unless the file says otherwise.
const env: Record<string, string | undefined> = file ? { NODE_ENV: "production", ...parseEnvFile(file) } : { ...process.env };
const problems = profileProblems(env, profile, role);
const errors = problems.filter((p) => p.level === "error");
console.log(`Environment check: profile=${profile} role=${role} source=${file ? file : "process environment"} (values are never printed)`);
for (const p of problems) console.log(`${p.level === "error" ? "FAIL" : "warn"}  ${p.key}: ${p.message}`);
console.log(errors.length ? `\nRESULT: NOT READY: ${errors.length} error(s), ${problems.length - errors.length} warning(s). The application refuses to start with these errors when APP_ENV=${profile}.` : `\nRESULT: configuration is valid for ${profile}/${role} (${problems.length} warning(s)). This checks configuration only; it does not prove the external services work.`);
process.exit(errors.length ? 1 : 0);
