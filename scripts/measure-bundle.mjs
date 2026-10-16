// Measures first-load JavaScript (gzip) for public pages of a running server.
//   node scripts/measure-bundle.mjs http://127.0.0.1:3000 /pricing /login /
import { gzipSync } from "node:zlib";

const [base, ...paths] = process.argv.slice(2);
if (!base) throw new Error("Usage: measure-bundle.mjs <baseUrl> [paths…]");
const cache = new Map();
async function size(url) {
  if (!cache.has(url)) { const buf = Buffer.from(await (await fetch(url)).arrayBuffer()); cache.set(url, { raw: buf.length, gz: gzipSync(buf).length }); }
  return cache.get(url);
}
for (const path of paths.length ? paths : ["/"]) {
  const html = await (await fetch(base + path)).text();
  const scripts = [...new Set([...html.matchAll(/<script[^>]+src="([^"]+\.js[^"]*)"/g)].map((m) => m[1]))];
  const css = [...new Set([...html.matchAll(/<link[^>]+href="([^"]+\.css[^"]*)"/g)].map((m) => m[1]))];
  let js = 0, jsRaw = 0, cs = 0;
  for (const s of scripts) { const r = await size(new URL(s, base).href); js += r.gz; jsRaw += r.raw; }
  for (const c of css) cs += (await size(new URL(c, base).href)).gz;
  console.log(`${path.padEnd(22)} html ${(Buffer.byteLength(html) / 1024).toFixed(1)} KB | JS ${scripts.length} files ${(js / 1024).toFixed(0)} KB gz (${(jsRaw / 1024).toFixed(0)} KB raw) | CSS ${(cs / 1024).toFixed(0)} KB gz`);
}
