// Full-platform smoke tour: signs in as each role through the real login API, opens every screen in headless Chrome and reports
// page errors, failed API calls and error screens. Run against the seeded local QA server:
//   npx tsx scripts/qa-server.ts   (in another terminal)   then   node scripts/smoke-tour.mjs http://127.0.0.1:3170
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const base = process.argv[2];
if (!base) throw new Error("Usage: smoke-tour.mjs <baseUrl>");
const PASSWORD = process.env.QA_PASSWORD || "LocalTest#2026";
const chromePath = process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const tours = {
  public: { login: null, pages: ["/", "/features", "/pricing", "/discover", "/demo", "/login", "/register", "/forgot-password", "/privacy", "/terms", "/l/qa-library"] },
  owner: { login: "owner@qa.in", pages: ["/owner", "/owner/students", "/owner/seats", "/owner/shifts", "/owner/plans", "/owner/memberships", "/owner/payments", "/owner/attendance", "/owner/expenses", "/owner/reports", "/owner/complaints", "/owner/rewards", "/owner/discovery", "/owner/waitlist", "/owner/maintenance", "/owner/crm", "/owner/branches", "/owner/billing", "/owner/support", "/owner/import", "/owner/onboarding", "/owner/moderation", "/owner/feedback", "/owner/events", "/owner/security", "/owner/settings"] },
  student: { login: "student@qa.in", pages: ["/app", "/app/roadmap", "/app/planner", "/app/quiz", "/app/prep", "/app/intelligence", "/app/revisions", "/app/doubts", "/app/rewards", "/app/library-requests", "/app/community", "/app/friends", "/app/garden", "/app/rooms", "/app/events", "/app/share", "/app/maintenance", "/app/focus", "/app/quests", "/app/progress", "/app/achievements", "/app/membership", "/app/security"] },
  admin: { login: "admin@qa.in", pages: ["/super-admin", "/super-admin/libraries", "/super-admin/subscriptions", "/super-admin/analytics", "/super-admin/business", "/super-admin/syllabus", "/super-admin/question-bank"] },
};

const port = 9800 + Math.floor(Math.random() * 150);
const chrome = spawn(chromePath, [`--remote-debugging-port=${port}`, "--headless=new", "--no-sandbox", "--disable-gpu", `--user-data-dir=${mkdtempSync(join(tmpdir(), "sq-tour-"))}`, "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let target;
for (let i = 0; i < 40 && !target; i++) { try { target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" })).json(); } catch { await sleep(250); } }
if (!target) { chrome.kill(); throw new Error("Could not start Chrome"); }
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0; const pending = new Map(); let events = [];
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } else if (d.method) events.push(d); };
const send = (method, params = {}) => new Promise((resolve) => { const i = ++id; pending.set(i, resolve); ws.send(JSON.stringify({ id: i, method, params })); });
await send("Network.enable"); await send("Page.enable"); await send("Runtime.enable"); await send("Log.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });

async function sessionFor(email) {
  const r = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json", Origin: base }, body: JSON.stringify({ email, password: PASSWORD }) });
  if (!r.ok) throw new Error(`Login failed for ${email}: ${r.status}`);
  return (r.headers.get("set-cookie") ?? "").split(";")[0].split("=")[1];
}
const probe = `(() => { const t = document.body.innerText; return { h1: (document.querySelector('h1')?.innerText || '').slice(0, 70), title: document.title, errorScreen: /couldn.t load|something went wrong|application error|could not load|unable to load/i.test(t), text: t.length }; })()`;

let failures = 0, total = 0;
for (const [role, tour] of Object.entries(tours)) {
  await send("Network.clearBrowserCookies");
  if (tour.login) await send("Network.setCookie", { name: "sq-session", value: await sessionFor(tour.login), url: base });
  for (const path of tour.pages) {
    events = []; total++;
    await send("Page.navigate", { url: base + path });
    await sleep(3200);
    const r = (await send("Runtime.evaluate", { expression: probe, returnByValue: true })).result?.result?.value ?? { h1: "", errorScreen: true, text: 0 };
    const apiFailures = events.filter((e) => e.method === "Network.responseReceived" && e.params.response.status >= 400 && /\/api\//.test(e.params.response.url) && !/\/api\/auth\/(login|register)/.test(e.params.response.url)).map((e) => `${e.params.response.status} ${new URL(e.params.response.url).pathname}`);
    const exceptions = events.filter((e) => e.method === "Runtime.exceptionThrown").map((e) => (e.params.exceptionDetails.exception?.description || e.params.exceptionDetails.text || "").split("\n")[0].slice(0, 90));
    const consoleErrors = events.filter((e) => e.method === "Log.entryAdded" && e.params.entry.level === "error" && !/Failed to load resource/.test(e.params.entry.text)).map((e) => e.params.entry.text.slice(0, 90));
    const ok = !r.errorScreen && r.text > 80 && !exceptions.length && !apiFailures.length && !consoleErrors.length;
    if (!ok) failures++;
    console.log(`${ok ? "PASS" : "FAIL"} ${role.padEnd(8)} ${path.padEnd(28)} ${r.h1}${ok ? "" : `  [${[r.errorScreen ? "error screen" : "", r.text <= 80 ? "empty page" : "", ...apiFailures, ...exceptions, ...consoleErrors].filter(Boolean).join("; ")}]`}`);
  }
}
ws.close(); chrome.kill();
console.log(`\n${total - failures}/${total} screens clean`);
process.exit(failures ? 1 : 0);
