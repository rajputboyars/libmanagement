// Records the public explainer videos from the seeded LOCAL QA server (disposable in-memory MongoDB; never production data).
//   npm run build                      (the QA server uses `next start`)
//   node scripts/record-guide.mjs [owner|student ...]
// Output in public/guide/explainer/: <role>.mp4, <role>.jpg, <role>.en.vtt, <role>.hi.vtt, plus durations on stdout.
// Needs: Chrome (CHROME_PATH), ffmpeg on PATH. Captions only; add a voice-over track later with ffmpeg if wanted.
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { storyboards } from "./guide-storyboard.mjs";

const base = "http://127.0.0.1:3170";
const chromePath = process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const args = process.argv.slice(2);
// Default: the two home-page tours. "pages" records every per-page guide video; otherwise name storyboards explicitly.
const roles = args.includes("pages") ? Object.keys(storyboards).filter((k) => storyboards[k].group === "pages") : args.length ? args : Object.keys(storyboards).filter((k) => !storyboards[k].group);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const kill = (child) => { if (!child?.pid) return; if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" }); else child.kill(); };

// 1. Seeded local QA server with enrolled owner so signed-in screens can be filmed.
const qa = spawn(process.execPath, ["--import", "tsx", "scripts/qa-server.ts"], { env: { ...process.env, QA_ENROLLED: "1" }, stdio: ["ignore", "pipe", "inherit"] });
const sessions = await new Promise((resolve, reject) => {
  let buf = "";
  qa.stdout.on("data", (d) => { buf += d; const m = /READY (\{.*\})/.exec(buf); if (m) resolve(JSON.parse(m[1])); });
  qa.on("exit", () => reject(new Error("QA server exited before it was ready")));
  setTimeout(() => reject(new Error("QA server start timed out")), 180000);
}).catch((e) => { kill(qa); throw e; });

// Give the demo library something to show: an active membership with a part payment (local QA database only).
{
  const call = (path, init = {}) => fetch(base + path, { ...init, headers: { cookie: `sq-session=${sessions.owner}`, Origin: base, "Content-Type": "application/json" } });
  const post = (action, data) => call("/api/workspace", { method: "POST", body: JSON.stringify({ action, data }) });
  const ws = await (await call("/api/workspace")).json();
  const [student, seat, shift, plan] = [ws.students[0], ws.seats[11], ws.shifts[0], ws.plans[0]];
  const m = await post("memberships", { userId: student._id, planId: plan._id, seatId: seat._id, start: new Date().toISOString(), shiftStart: shift.start, shiftEnd: shift.end, discount: 0 });
  const membership = (await (await call("/api/workspace")).json()).memberships?.[0];
  if (m.ok && membership) await post("payments", { membershipId: membership._id, amount: Math.round(plan.amount / 2), method: "upi", key: "guide-demo-0001" });
  else console.warn(`Demo membership was not created (HTTP ${m.status}); videos will show an empty library`);
}

const profile = mkdtempSync(join(tmpdir(), "sq-rec-"));
const port = 9300 + Math.floor(Math.random() * 400);
const chrome = spawn(chromePath, [`--remote-debugging-port=${port}`, "--headless=new", "--no-sandbox", "--disable-gpu", "--hide-scrollbars", `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" });
const cleanup = () => { kill(chrome); kill(qa); try { rmSync(profile, { recursive: true, force: true }); } catch {} };
process.on("SIGINT", () => { cleanup(); process.exit(130); });

try {
  let target;
  for (let i = 0; i < 40 && !target; i++) { try { target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" })).json(); } catch { await sleep(250); } }
  if (!target) throw new Error("Could not start Chrome");
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0; const pending = new Map(); let frames = [];
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); }
    // Frame times use arrival (wall clock): the metadata clock differs from Date.now().
    else if (d.method === "Page.screencastFrame") { frames.push({ t: Date.now() / 1000, data: d.params.data }); send("Page.screencastFrameAck", { sessionId: d.params.sessionId }); }
  };
  const send = (method, params = {}) => new Promise((resolve) => { const i = ++id; pending.set(i, resolve); ws.send(JSON.stringify({ id: i, method, params })); });
  await send("Page.enable"); await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
  const evaluate = (expression) => send("Runtime.evaluate", { expression, returnByValue: true });

  for (const role of roles) {
    const sb = storyboards[role];
    if (!sb) throw new Error(`Unknown storyboard "${role}"`);
    const outDir = join("public", "guide", sb.dir ?? "explainer"), name = sb.name ?? role;
    mkdirSync(outDir, { recursive: true });
    await send("Network.clearBrowserCookies");
    await send("Network.setCookie", { name: "sq-session", value: sessions[sb.session], url: base });
    await send("Page.navigate", { url: base + sb.scenes[0].path });
    await sleep(3500); // warm up so the first filmed frame is already rendered
    frames = [];
    await send("Page.startScreencast", { format: "jpeg", quality: 82, maxWidth: 1280, maxHeight: 720, everyNthFrame: 1 });
    const t0 = Date.now() / 1000;
    const cues = [];
    for (const [i, s] of sb.scenes.entries()) {
      const start = Date.now() / 1000 - t0;
      if (i > 0 && s.path !== sb.scenes[i - 1].path) { await send("Page.navigate", { url: base + s.path }); await sleep(2200); }
      if (s.click) await evaluate(`[...document.querySelectorAll('button,a')].find(e => e.innerText.trim() === ${JSON.stringify(s.click)})?.click()`);
      if (s.scroll) await evaluate(`(() => { const els = [...document.querySelectorAll('*')].filter((e) => !e.closest('nav,aside') && e.scrollHeight > e.clientHeight + 40 && /auto|scroll/.test(getComputedStyle(e).overflowY)); const el = els.sort((a, b) => b.clientHeight - a.clientHeight)[0]; (el || window).scrollBy({ top: ${s.scroll}, behavior: 'smooth' }); })()`);
      const hold = s.hold ?? Math.max(6000, s.caption[0].length * 75); // ~13 characters per second reading speed
      await sleep(Math.max(0, hold - (Date.now() / 1000 - t0 - start) * 1000));
      cues.push({ start, end: Date.now() / 1000 - t0, caption: s.caption });
    }
    await send("Page.stopScreencast");
    if (frames.length < 1) throw new Error(`Only ${frames.length} frames captured for ${role}`);

    // 2. Frames (with real timestamps) to a constant-rate H.264 mp4.
    // Chrome can replay frames stamped before recording began: keep only the last of those, starting at t0.
    const firstLive = frames.findIndex((f) => f.t >= t0);
    if (firstLive > 0) { frames = frames.slice(firstLive - 1); frames[0].t = t0; }
    const lead = Math.max(0, frames[0].t - t0); // the first frame can arrive after the first caption starts: shift captions to the video timeline
    for (const c of cues) { c.start = Math.max(0, c.start - lead); c.end = Math.max(0, c.end - lead); }
    if (process.env.REC_DEBUG) console.log(role, "lead", lead.toFixed(2), "first", (frames[0].t - t0).toFixed(2), "last", (frames[frames.length - 1].t - t0).toFixed(2), "end", cues[cues.length - 1].end.toFixed(2));
    const dir = mkdtempSync(join(tmpdir(), "sq-frames-"));
    const lines = [];
    frames.forEach((f, i) => {
      const name = `f${String(i).padStart(5, "0")}.jpg`;
      writeFileSync(join(dir, name), Buffer.from(f.data, "base64"));
      const next = frames[i + 1]?.t ?? Math.max(f.t + 0.5, t0 + cues[cues.length - 1].end); // static pages emit no new frames: hold the last one to the end of the final scene
      lines.push(`file '${name}'`, `duration ${Math.max(0.02, next - f.t).toFixed(3)}`);
    });
    lines.push(`file 'f${String(frames.length - 1).padStart(5, "0")}.jpg'`);
    writeFileSync(join(dir, "list.txt"), lines.join("\n"));
    const mp4 = join(outDir, `${name}.mp4`);
    const run = (args) => { const r = spawnSync("ffmpeg", ["-y", "-loglevel", "error", ...args], { stdio: "inherit" }); if (r.status !== 0) throw new Error(`ffmpeg failed for ${role}`); };
    run(["-f", "concat", "-safe", "0", "-i", join(dir, "list.txt"), "-vf", "fps=25,format=yuv420p", "-t", cues[cues.length - 1].end.toFixed(2), "-c:v", "libx264", "-crf", "28", "-preset", "slow", "-movflags", "+faststart", mp4]);
    run(["-i", mp4, "-ss", "00:00:03", "-frames:v", "1", "-q:v", "4", join(outDir, `${name}.jpg`)]);
    rmSync(dir, { recursive: true, force: true });

    // 3. Caption files.
    const ts = (s) => { const ms = Math.round(s * 1000); const p = (n, l = 2) => String(n).padStart(l, "0"); return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)}.${p(ms % 1000, 3)}`; };
    for (const [lang, idx] of [["en", 0], ["hi", 1]]) writeFileSync(join(outDir, `${name}.${lang}.vtt`), "WEBVTT\n\n" + cues.map((c) => `${ts(c.start)} --> ${ts(c.end - 0.1)}\n${c.caption[idx]}\n`).join("\n"));
    const seconds = Math.round(cues[cues.length - 1].end);
    console.log(`${role}: ${seconds}s, ${frames.length} frames -> ${mp4}`);
  }
  ws.close();
} finally {
  cleanup();
}
