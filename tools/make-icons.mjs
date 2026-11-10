// Draws the My Budget app icon: four rounded bars rising across the bottom with a zig-zag
// trend line climbing over them to a dot. Writes icons/icon.svg and the PNG sizes.
// The PNGs are drawn directly from the same shapes (no outside tools needed).
import { deflateSync, crc32 } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const out = resolve(import.meta.dirname, '..', 'icons');
mkdirSync(out, { recursive: true });

// ---------- Design (on a 512 × 512 grid) ----------
const C = {
  bg: '#2C3035',      // the app's charcoal
  bar: '#56626E',     // soft slate bars
  line: '#A3CDB8',    // the app's "money in" green
};
const SIZE = 512;
const CORNER = 112;
const BARS = [ // x, top y, width — short, taller, medium, tallest
  { x: 86, y: 330, w: 64 },
  { x: 178, y: 250, w: 64 },
  { x: 270, y: 290, w: 64 },
  { x: 362, y: 200, w: 64 },
];
const BAR_BOTTOM = 420;
const BAR_R = 20;
const LINE = [[100, 300], [196, 206], [280, 250], [392, 124]];
const LINE_W = 40;
const HALO_W = LINE_W + 22; // a band of background around the line keeps it crisp over the bars
const DOT_R = 33;
const DOT = LINE[LINE.length - 1];

// ---------- SVG ----------
function svg({ rounded = true } = {}) {
  const pts = LINE.map(([x, y]) => `${x},${y}`).join(' ');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SIZE} ${SIZE}" width="${SIZE}" height="${SIZE}">
  <title>My Budget</title>
  <rect width="${SIZE}" height="${SIZE}" rx="${rounded ? CORNER : 0}" fill="${C.bg}"/>
  ${BARS.map((b) => `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${BAR_BOTTOM - b.y}" rx="${BAR_R}" fill="${C.bar}"/>`).join('\n  ')}
  <polyline points="${pts}" fill="none" stroke="${C.bg}" stroke-width="${HALO_W}" stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="${DOT[0]}" cy="${DOT[1]}" r="${DOT_R + (HALO_W - LINE_W) / 2}" fill="${C.bg}"/>
  <polyline points="${pts}" fill="none" stroke="${C.line}" stroke-width="${LINE_W}" stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="${DOT[0]}" cy="${DOT[1]}" r="${DOT_R}" fill="${C.line}"/>
</svg>
`;
}

// ---------- Drawing the same shapes as pixels ----------
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const RGB = { bg: hex(C.bg), bar: hex(C.bar), line: hex(C.line) };

function roundRectDist(px, py, x, y, w, h, r) {
  const cx = x + w / 2;
  const cy = y + h / 2;
  const qx = Math.abs(px - cx) - (w / 2 - r);
  const qy = Math.abs(py - cy) - (h / 2 - r);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

function segDist(px, py, [ax, ay], [bx, by]) {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function lineDist(px, py) {
  let d = Infinity;
  for (let i = 0; i < LINE.length - 1; i++) d = Math.min(d, segDist(px, py, LINE[i], LINE[i + 1]));
  return d;
}

// Colour at a point in 512-space; returns [r,g,b,a]
function sample(x, y, rounded) {
  if (rounded && roundRectDist(x, y, 0, 0, SIZE, SIZE, CORNER) > 0) return [0, 0, 0, 0];
  let c = RGB.bg;
  for (const b of BARS) if (roundRectDist(x, y, b.x, b.y, b.w, BAR_BOTTOM - b.y, BAR_R) <= 0) c = RGB.bar;
  const ld = lineDist(x, y);
  const dd = Math.hypot(x - DOT[0], y - DOT[1]);
  if (ld <= HALO_W / 2 || dd <= DOT_R + (HALO_W - LINE_W) / 2) c = RGB.bg;
  if (ld <= LINE_W / 2 || dd <= DOT_R) c = RGB.line;
  return [...c, 255];
}

// size: output pixels. rounded: transparent corners. scale: shrink artwork inside (for maskable icons).
function draw(size, { rounded = false, scale = 1 } = {}) {
  const ss = 4;
  const raw = Buffer.alloc(size * (size * 4 + 1));
  const k = SIZE / size;
  for (let py = 0; py < size; py++) {
    raw[py * (size * 4 + 1)] = 0;
    for (let px = 0; px < size; px++) {
      const acc = [0, 0, 0, 0];
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          let x = (px + (sx + 0.5) / ss) * k;
          let y = (py + (sy + 0.5) / ss) * k;
          // maskable: artwork scaled toward the centre, background fills the rest
          x = SIZE / 2 + (x - SIZE / 2) / scale;
          y = SIZE / 2 + (y - SIZE / 2) / scale;
          const inside = x >= 0 && y >= 0 && x <= SIZE && y <= SIZE;
          const c = inside ? sample(x, y, rounded) : [...RGB.bg, 255];
          // premultiply so transparent corners blend cleanly
          acc[0] += c[0] * c[3]; acc[1] += c[1] * c[3]; acc[2] += c[2] * c[3]; acc[3] += c[3];
        }
      }
      const o = py * (size * 4 + 1) + 1 + px * 4;
      const a = acc[3];
      raw[o] = a ? Math.round(acc[0] / a) : 0;
      raw[o + 1] = a ? Math.round(acc[1] / a) : 0;
      raw[o + 2] = a ? Math.round(acc[2] / a) : 0;
      raw[o + 3] = Math.round(a / (ss * ss));
    }
  }
  return png(size, raw);
}

function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td) >>> 0);
  return Buffer.concat([len, td, crc]);
}

function png(size, raw) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------- Write everything ----------
writeFileSync(resolve(out, 'icon.svg'), svg());
const files = [
  // iPhone home screen: square, iOS rounds the corners itself
  ['apple-touch-icon.png', 180, { rounded: false }],
  // web app manifest / browser tab: rounded square with clear corners
  ['icon-192.png', 192, { rounded: true }],
  ['icon-512.png', 512, { rounded: true }],
  // Android "maskable": full square, artwork kept inside the safe zone
  ['icon-maskable-512.png', 512, { rounded: false, scale: 0.8 }],
];
for (const [name, size, opts] of files) {
  writeFileSync(resolve(out, name), draw(size, opts));
  console.log('wrote', name);
}
console.log('wrote icon.svg');
