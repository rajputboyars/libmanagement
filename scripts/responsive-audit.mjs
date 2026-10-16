// Responsive + basic visual-regression audit using Chrome DevTools Protocol (no extra dependencies; needs Node 22+ and Chrome).
//   node scripts/responsive-audit.mjs <baseUrl> --pages / /pricing /owner/seats --cookie "<sq-session value>" [--update] [--out artifacts/visual]
// For every page × viewport: reports horizontal overflow, small touch targets (mobile) and saves a screenshot.
// Screenshots are compared by SHA-256 to the stored baseline: a different hash is reported as CHANGED (review, then --update).
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const args = process.argv.slice(2);
const base = args[0];
const flag = (n) => args.indexOf(`--${n}`);
const value = (n) => (flag(n) >= 0 ? args[flag(n) + 1] : undefined);
const pagesIdx = flag("pages");
const pages = pagesIdx >= 0 ? args.slice(pagesIdx + 1).filter((a, i, arr) => !a.startsWith("--") && !(arr[i - 1] && ["--cookie", "--out"].includes(arr[i - 1]))) : ["/"];
const cookie = value("cookie"), update = flag("update") >= 0, out = value("out") ?? "artifacts/visual";
const widths = (value("widths") ?? "320,360,390,430,768,820,1024,1280,1440,1920").split(",").map(Number);
const chromePath = process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
if (!base) throw new Error("Usage: responsive-audit.mjs <baseUrl> --pages /a /b [--cookie v] [--update]");

const port = 9300 + Math.floor(Math.random() * 500);
const chrome = spawn(chromePath, [`--remote-debugging-port=${port}`, "--headless=new", "--no-sandbox", "--disable-gpu", `--user-data-dir=${mkdtempSync(join(tmpdir(), "sq-chrome-"))}`, "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let target;
for (let i = 0; i < 40 && !target; i++) { try { target = (await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" })).json()); } catch { await sleep(250); } }
if (!target) { chrome.kill(); throw new Error("Could not start Chrome"); }
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0; const pending = new Map(), waiters = [];
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } else if (d.method) waiters.splice(0).forEach((w) => w(d)); };
const send = (method, params = {}) => new Promise((resolve) => { const i = ++id; pending.set(i, resolve); ws.send(JSON.stringify({ id: i, method, params })); });
const waitFor = (method, ms = 15000) => new Promise((resolve) => { const t = setTimeout(resolve, ms); const handler = (d) => { if (d.method === method) { clearTimeout(t); resolve(d); } else waiters.push(handler); }; waiters.push(handler); });

await send("Network.enable"); await send("Page.enable");
if (cookie) await send("Network.setCookie", { name: "sq-session", value: cookie, url: base });

const measure = `(() => {
  const w = innerWidth, offenders = [], small = [];
  const scrolls = (el) => { for (let p = el.parentElement; p; p = p.parentElement) { const o = getComputedStyle(p).overflowX; if (o === 'auto' || o === 'scroll') return true; } return false; };
  for (const el of document.body.querySelectorAll('*')) {
    const r = el.getBoundingClientRect(); const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || r.width === 0) continue;
    if (r.right > w + 1 && r.left < w && !scrolls(el) && !el.closest('[aria-hidden="true"]') && cs.position !== 'fixed') offenders.push((el.className && String(el.className).slice(0, 40)) || el.tagName);
    if (w < 768 && el.matches('a[href],button,select,input:not([type=hidden]):not([type=checkbox]):not([type=radio]),textarea,[role=button]') && !el.closest('p,li,small') && r.left >= 0 && r.left < w && (r.height < 32 || r.width < 32) && !(el.tabIndex === -1 && el.getAttribute('aria-hidden') === 'true')) small.push((el.getAttribute('aria-label') || el.textContent || el.tagName).trim().slice(0, 24) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height));
  }
  return { sw: document.documentElement.scrollWidth, w, offenders: [...new Set(offenders)].slice(0, 5), small: [...new Set(small)].slice(0, 5), title: document.title.slice(0, 40) };
})()`;

mkdirSync(out, { recursive: true });
const results = [];
for (const path of pages) {
  for (const width of widths) {
    await send("Emulation.setDeviceMetricsOverride", { width, height: width < 768 ? 800 : 900, deviceScaleFactor: 1, mobile: width < 768 });
    const loaded = waitFor("Page.loadEventFired");
    await send("Page.navigate", { url: base + path });
    await loaded; await sleep(2200);
    const m = (await send("Runtime.evaluate", { expression: measure, returnByValue: true })).result?.result?.value ?? { sw: -1, w: width, offenders: ["measure failed"], small: [] };
    const shot = await send("Page.captureScreenshot", { format: "png" });
    const buf = Buffer.from(shot.result?.data ?? "", "base64");
    const hash = createHash("sha256").update(buf).digest("hex").slice(0, 16);
    const file = join(out, `${path.replace(/\W+/g, "_") || "home"}-${width}.png`), hashFile = file + ".sha";
    let visual = "NEW";
    if (existsSync(hashFile) && !update) visual = readFileSync(hashFile, "utf8") === hash ? "same" : "CHANGED";
    if (update || visual === "NEW") { writeFileSync(file, buf); writeFileSync(hashFile, hash); }
    results.push({ path, width, overflow: m.sw > m.w + 1, sw: m.sw, offenders: m.offenders, small: m.small, visual });
  }
}
ws.close(); chrome.kill();
const bad = results.filter((r) => r.overflow);
for (const path of pages) {
  const rows = results.filter((r) => r.path === path);
  console.log(`${path.padEnd(22)} ${rows.map((r) => `${r.width}:${r.overflow ? "OVERFLOW" : "ok"}`).join(" ")}`);
}
console.log(`\nOverflow failures: ${bad.length}/${results.length}`);
for (const r of bad) console.log(`  ${r.path} @${r.width}px sw=${r.sw} offenders=${r.offenders.join(",")}`);
const smalls = results.filter((r) => r.small.length);
console.log(`Small touch targets (<32px) at mobile widths: ${smalls.length} page/viewport combos`);
for (const r of smalls.slice(0, 12)) console.log(`  ${r.path} @${r.width}px: ${r.small.join(" | ")}`);
console.log(`Visual: ${results.filter((r) => r.visual === "NEW").length} new baselines, ${results.filter((r) => r.visual === "CHANGED").length} changed, ${results.filter((r) => r.visual === "same").length} unchanged`);
process.exit(bad.length ? 1 : 0);
