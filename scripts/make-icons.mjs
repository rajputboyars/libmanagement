// Generates the PWA PNG icons (no image dependencies): a green tile with a white asterisk.
// node scripts/make-icons.mjs
import fs from "node:fs"; import zlib from "node:zlib"; import path from "node:path"; import { fileURLToPath } from "node:url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const crc = (() => { const t = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; }); return (b) => { let c = ~0; for (const x of b) c = t[(c ^ x) & 255] ^ (c >>> 8); return ~c >>> 0; }; })();
const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
function png(size, { maskable }) {
  const bg = [22, 118, 96], fg = [255, 255, 255], raw = Buffer.alloc((size * 4 + 1) * size);
  const cx = size / 2, radius = size * (maskable ? 0.2 : 0.3), w = size * 0.055, corner = size * (maskable ? 0 : 0.22);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const dx = x - cx + 0.5, dy = y - cx + 0.5; let a = 255, ink = false;
      if (corner) { const ex = Math.max(Math.abs(dx) - (cx - corner), 0), ey = Math.max(Math.abs(dy) - (cx - corner), 0); if (Math.hypot(ex, ey) > corner) a = 0; }
      for (let k = 0; k < 3 && !ink; k++) { const ang = (k * Math.PI) / 3, d = Math.abs(dx * Math.sin(ang) - dy * Math.cos(ang)), along = Math.abs(dx * Math.cos(ang) + dy * Math.sin(ang)); if (d < w && along < radius) ink = true; }
      const [r, g, b] = ink ? fg : bg, i = y * (size * 4 + 1) + 1 + x * 4; raw[i] = r; raw[i + 1] = g; raw[i + 2] = b; raw[i + 3] = a;
    }
  }
  const head = Buffer.alloc(13); head.writeUInt32BE(size, 0); head.writeUInt32BE(size, 4); head[8] = 8; head[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", head), chunk("IDAT", zlib.deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}
const dir = path.join(__dirname, "..", "public", "icons"); fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, "icon-192.png"), png(192, {})); fs.writeFileSync(path.join(dir, "icon-512.png"), png(512, {}));
fs.writeFileSync(path.join(dir, "icon-maskable-512.png"), png(512, { maskable: true })); fs.writeFileSync(path.join(dir, "apple-touch-icon.png"), png(180, { maskable: true }));
console.log("icons written");
