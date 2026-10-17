// PWA verification via Chrome DevTools Protocol: manifest, icons, installability, service worker, caching rules, offline behaviour, logout cache clearing.
//   node scripts/pwa-check.mjs http://127.0.0.1:3170
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const base = process.argv[2];
if (!base) throw new Error("Usage: pwa-check.mjs <baseUrl>");
const chromePath = process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const port = 9650 + Math.floor(Math.random() * 100);
const chrome = spawn(chromePath, [`--remote-debugging-port=${port}`, "--headless=new", "--no-sandbox", "--disable-gpu", `--user-data-dir=${mkdtempSync(join(tmpdir(), "sq-pwa-"))}`, "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let target;
for (let i = 0; i < 40 && !target; i++) { try { target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" })).json(); } catch { await sleep(250); } }
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0; const pending = new Map(); let events = [];
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } else if (d.method) events.push(d); };
const send = (method, params = {}, sessionId) => new Promise((resolve) => { const i = ++id; pending.set(i, resolve); ws.send(JSON.stringify({ id: i, method, params, ...(sessionId ? { sessionId } : {}) })); });
const ev = async (expression) => (await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })).result?.result?.value;
const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`); };
for (const m of ["Network.enable", "Page.enable", "Runtime.enable", "ServiceWorker.enable"]) await send(m);
await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 800, deviceScaleFactor: 2, mobile: true });

// --- manifest ---
const manifestRes = await fetch(`${base}/manifest.webmanifest`);
const manifest = await manifestRes.json();
check("manifest served as JSON", manifestRes.ok && /json/.test(manifestRes.headers.get("content-type") ?? ""), manifestRes.headers.get("content-type"));
check("manifest has name, start_url, standalone display, theme/background colors", !!(manifest.name && manifest.start_url && manifest.display === "standalone" && manifest.theme_color && manifest.background_color));
const sizes = (manifest.icons ?? []).map((i) => `${i.sizes}:${i.purpose}`);
check("192 and 512 PNG icons plus a maskable icon", ["192x192:any", "512x512:any", "512x512:maskable"].every((s) => sizes.includes(s)), sizes.join(" "));
for (const icon of manifest.icons ?? []) {
  const r = await fetch(new URL(icon.src, base)); const buf = Buffer.from(await r.arrayBuffer());
  const isPng = buf.slice(1, 4).toString() === "PNG";
  const dim = isPng ? `${buf.readUInt32BE(16)}x${buf.readUInt32BE(20)}` : "n/a";
  check(`icon ${icon.src} loads${isPng ? " and matches declared size" : ""}`, r.ok && (!isPng || dim === icon.sizes), `${r.status} ${dim}`);
}

// --- page, manifest link, SW registration ---
const loaded = (async () => { for (let i = 0; i < 60; i++) { if (events.some((e) => e.method === "Page.loadEventFired")) return; await sleep(250); } })();
await send("Page.navigate", { url: `${base}/pricing` });
await loaded; await sleep(2500);
check("page links the manifest", await ev(`!!document.querySelector('link[rel=manifest]')`));
check("theme-color meta present", await ev(`!!document.querySelector('meta[name=theme-color]')`));
check("apple-touch-icon link present", await ev(`!!document.querySelector('link[rel=apple-touch-icon]')`));
const swState = await ev(`navigator.serviceWorker.getRegistration().then(r => r ? ((r.active||r.waiting||r.installing)?.state) : 'none')`);
check("service worker registered and active", swState === "activated", String(swState));
const inst = await send("Page.getInstallabilityErrors");
const errs = (inst.result?.installabilityErrors ?? []).map((e) => e.errorId);
check("Chrome installability errors", errs.length === 0, errs.join(", ") || "none");

// second visit: the worker controls the page now, so static assets get cached at runtime
events = [];
await send("Page.reload"); await sleep(3500);
// --- cache contents ---
await ev(`fetch('/api/health').then(r=>r.text())`);
await ev(`fetch('/api/saas-public').then(r=>r.text())`);
const cached = await ev(`(async()=>{ const out=[]; for (const k of await caches.keys()) { const c=await caches.open(k); for (const r of await c.keys()) out.push(new URL(r.url).pathname); } return out; })()`);
check("precache holds offline page and icons", ["/offline.html", "/icons/icon-192.png"].every((p) => cached.includes(p)), cached.join(", ").slice(0, 120));
check("no /api responses cached", !cached.some((p) => p.startsWith("/api/")));
check("no HTML pages cached (other than offline.html)", !cached.some((p) => !/\.(png|svg|js|css|woff2?)$/.test(p) && p !== "/offline.html"), cached.filter((p) => !/\.(png|svg|js|css|woff2?)$/.test(p)).join(", "));
check("static assets cached at runtime", cached.some((p) => p.startsWith("/_next/static/")), `${cached.filter((p) => p.startsWith("/_next/static/")).length} files`);

// --- offline behaviour (CDP emulation must be applied to the service worker target too, or its fetches stay online) ---
const targets = (await send("Target.getTargets")).result?.targetInfos ?? [];
const swTarget = targets.find((t) => t.type === "service_worker" && t.url.includes("/sw.js"));
let swSession;
if (swTarget) { swSession = (await send("Target.attachToTarget", { targetId: swTarget.targetId, flatten: true })).result?.sessionId; await send("Network.enable", {}, swSession); }
check("service worker target attachable for offline emulation", !!swSession);
const setOffline = async (offline) => { const p = { offline, latency: 0, downloadThroughput: offline ? 0 : -1, uploadThroughput: offline ? 0 : -1 }; await send("Network.emulateNetworkConditions", p); if (swSession) await send("Network.emulateNetworkConditions", p, swSession); };
await setOffline(true);
events = [];
await send("Page.navigate", { url: `${base}/pricing?offline=1` });
await sleep(2500);
const offlineText = await ev(`document.body.innerText`);
check("offline navigation shows the offline page", /You.re offline/i.test(offlineText ?? ""), (offlineText ?? "").slice(0, 60).replace(/\n/g, " "));
const apiOffline = await ev(`fetch('/api/health').then(()=> 'served').catch(()=> 'failed')`);
check("API calls fail while offline (never answered from cache)", apiOffline === "failed", apiOffline);
await setOffline(false);

// --- offline banner inside the app ---
await send("Page.navigate", { url: `${base}/pricing` }); await sleep(2500);
await ev(`window.dispatchEvent(new Event('offline'))`); await send("Network.emulateNetworkConditions", { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
await ev(`window.dispatchEvent(new Event('offline'))`); await sleep(500);
check("in-app offline banner appears", /offline/i.test((await ev(`document.querySelector('.sq-offline')?.innerText || ''`)) ?? ""));
await send("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
await ev(`window.dispatchEvent(new Event('online'))`); await sleep(500);
check("banner disappears when back online", !(await ev(`!!document.querySelector('.sq-offline')`)));

// --- cache clearing used on sign-out ---
await ev(`import('/_next/static/chunks/').catch(()=>0)`);
const cleared = await ev(`(async()=>{ const reg = await navigator.serviceWorker.getRegistration(); reg.active.postMessage({type:'clear-caches'}); await new Promise(r=>setTimeout(r,800)); return (await caches.keys()).length; })()`);
check("clear-caches message empties all caches", cleared === 0, `${cleared} caches left`);

// --- headers ---
const sw = await fetch(`${base}/sw.js`);
check("sw.js is never cached by the browser", /no-cache|no-store/.test(sw.headers.get("cache-control") ?? ""), sw.headers.get("cache-control"));
check("sw.js scope allowed at /", sw.headers.get("service-worker-allowed") === "/");
const offlineHtml = await fetch(`${base}/offline.html`);
check("offline.html served and not indexable", offlineHtml.ok && /noindex/.test(await offlineHtml.text()));


// --- regressions for the issues found in the first PWA review (P1–P5) ---
await send("Page.navigate", { url: `${base}/pricing` }); await sleep(2500);
await ev(`(async()=>{ for (let i=0;i<150;i++) await fetch('/icons/icon-192.png?v='+i).then(r=>r.arrayBuffer()); })()`);
await sleep(800);
const runtimeCount = await ev(`(async()=>{ const c=await caches.open('sq-static-v2'); const keys=await c.keys(); return keys.filter(r=>{ const u=new URL(r.url); return !(u.search==='' && ['/offline.html','/icon.svg','/icons/icon-192.png','/icons/icon-512.png'].includes(u.pathname)); }).length; })()`);
check("P4 runtime cache is bounded (150 distinct assets fetched)", runtimeCount <= 120, `${runtimeCount} runtime entries`);
const loginAs = async (email) => { const r = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json", Origin: base }, body: JSON.stringify({ email, password: process.env.QA_PASSWORD || "LocalTest#2026" }) }); return r.ok ? (r.headers.get("set-cookie") ?? "").split(";")[0].split("=")[1] : null; };
const ownerCookie = await loginAs("owner@qa.in"), studentCookie = await loginAs("student@qa.in"), adminCookie = await loginAs("admin@qa.in");
if (ownerCookie && studentCookie) {
  await send("Network.clearBrowserCookies");
  await send("Page.navigate", { url: `${base}/app?source=pwa` }); await sleep(3500);
  check("P5 signed-out installed-app launch opens sign-in", (await ev("location.pathname")) === "/login", await ev("location.pathname"));
  await send("Network.setCookie", { name: "sq-session", value: ownerCookie, url: base });
  await send("Page.navigate", { url: `${base}/app?source=pwa` }); await sleep(3500);
  check("P1 owner launching the installed app lands in /owner", (await ev("location.pathname")) === "/owner", await ev("location.pathname"));
  await send("Network.setCookie", { name: "sq-session", value: adminCookie, url: base });
  await send("Page.navigate", { url: `${base}/owner` }); await sleep(3500);
  check("P1 admin opening an owner URL lands in /super-admin", (await ev("location.pathname")) === "/super-admin", await ev("location.pathname"));
  await send("Network.setCookie", { name: "sq-session", value: studentCookie, url: base });
  await send("Page.navigate", { url: `${base}/owner/seats` }); await sleep(3500);
  check("P1 student opening an owner URL lands in /app", (await ev("location.pathname")) === "/app", await ev("location.pathname"));
  await send("Page.navigate", { url: `${base}/app/focus` }); await sleep(3500);
  await setOffline(true); await ev("window.dispatchEvent(new Event('offline'))"); await sleep(600);
  const g = await ev(`(() => { const b=document.querySelector('.sq-offline')?.getBoundingClientRect(); const n=document.querySelector('.bottom-nav')?.getBoundingClientRect(); return { b: b ? [Math.round(b.top), Math.round(b.bottom)] : null, n: n ? [Math.round(n.top), Math.round(n.bottom)] : null, h: innerHeight }; })()`);
  check("P2 offline banner does not overlap the bottom navigation", !!g?.b && !!g?.n && g.b[1] <= g.n[0], JSON.stringify(g));
  await ev(`(() => { const b=[...document.querySelectorAll('button')].find(b=>/^start|begin/i.test(b.innerText.trim())); b && b.click(); })()`); await sleep(1500);
  const toast = await ev(`document.body.innerText`);
  check("P3 offline action shows a friendly message, not 'Failed to fetch'", /offline\. Reconnect/i.test(toast) && !/Failed to fetch/i.test(toast), /Failed to fetch/i.test(toast) ? "raw error still shown" : "friendly message");
  await setOffline(false);
} else console.log("SKIP  P1–P3, P5 (QA accounts not available: start scripts/qa-server.ts)");

ws.close(); chrome.kill();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} PWA checks passed`);
process.exit(failed.length ? 1 : 0);
