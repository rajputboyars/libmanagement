// Exports key screens of the seeded QA server as ONE self-contained HTML file (inlined CSS, one .sq-screen per screen)
// so it can be pushed to Figma with html_to_figma (cssSelector ".sq-screen"). Usage: node scripts/figma-export.mjs <baseUrl> <outFile> [group]
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [base, out, group = "all"] = process.argv.slice(2);
if (!base || !out) throw new Error("Usage: figma-export.mjs <baseUrl> <outFile> [group]");
const PASSWORD = process.env.QA_PASSWORD || "LocalTest#2026";
const chromePath = process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const groups = {
  public: { login: null, pages: ["/", "/features", "/pricing", "/discover", "/login", "/register"] },
  student: { login: "student@qa.in", pages: ["/app", "/app/join", "/app/punch", "/app/roadmap", "/app/planner", "/app/quiz", "/app/rewards"] },
  owner: { login: "owner@qa.in", pages: ["/owner", "/owner/join-requests", "/owner/presence", "/owner/students", "/owner/seats", "/owner/attendance", "/owner/payments"] },
  admin: { login: "admin@qa.in", pages: ["/super-admin"] },
};
const picked = group === "all" ? Object.entries(groups) : [[group, groups[group]]];

const port = 9500 + Math.floor(Math.random() * 150);
const chrome = spawn(chromePath, [`--remote-debugging-port=${port}`, "--headless=new", "--no-sandbox", "--disable-gpu", `--user-data-dir=${mkdtempSync(join(tmpdir(), "sq-fig-"))}`, "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let target;
for (let i = 0; i < 40 && !target; i++) { try { target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" })).json(); } catch { await sleep(250); } }
if (!target) { chrome.kill(); throw new Error("Could not start Chrome"); }
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0; const pending = new Map();
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } };
const send = (method, params = {}) => new Promise((resolve) => { const i = ++id; pending.set(i, resolve); ws.send(JSON.stringify({ id: i, method, params })); });
await send("Page.enable"); await send("Network.enable"); await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });

async function sessionFor(email) {
  const r = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json", Origin: base }, body: JSON.stringify({ email, password: PASSWORD }) });
  if (!r.ok) throw new Error(`Login failed for ${email}: ${r.status}`);
  return (r.headers.get("set-cookie") ?? "").split(";")[0].split("=")[1];
}
// Runs in the page: collect all CSS, drop scripts, return the body markup.
const grab = `(() => {
  let css = ""; for (const s of document.styleSheets) { try { for (const r of s.cssRules) css += r.cssText + "\\n"; } catch {} }
  const body = document.body.cloneNode(true);
  body.querySelectorAll("script,noscript,link,iframe,video").forEach((n) => n.remove());
  body.querySelectorAll("img").forEach((n) => { if (!n.src.startsWith("data:")) n.removeAttribute("src"); n.removeAttribute("srcset"); });
  return { css, html: body.innerHTML, title: document.querySelector("h1")?.innerText || document.title };
})()`;

let css = "", screens = "";
for (const [role, g] of picked) {
  await send("Network.clearBrowserCookies");
  if (g.login) await send("Network.setCookie", { name: "sq-session", value: await sessionFor(g.login), url: base });
  for (const path of g.pages) {
    await send("Page.navigate", { url: base + path });
    await sleep(3500);
    const v = (await send("Runtime.evaluate", { expression: grab, returnByValue: true })).result?.result?.value;
    if (!v) { console.log("skip", path); continue; }
    if (!css) css = v.css;
    const name = `${role} ${path}`.replace(/"/g, "");
    screens += `<section class="sq-screen" data-name="${name}">${v.html}</section>\n`;
    console.log("captured", name);
  }
}
const html = `<!doctype html><html><head><meta charset="utf-8"><style>${css}
.sq-screen{width:1280px;min-height:900px;position:relative;overflow:hidden;transform:translateZ(0);margin:0 0 40px;background:#f4f6f3}</style></head><body>${screens}</body></html>`;
writeFileSync(out, html);
console.log(`wrote ${out} (${(html.length / 1024).toFixed(0)} KB)`);
ws.close(); chrome.kill();
