// Draws the app icon (gold ring with a small coral segment on forest green) as PNG files.
import { deflateSync, crc32 } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const out = resolve(import.meta.dirname, '..', 'icons');
mkdirSync(out, { recursive: true });

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const BG = hex('#1F4A35');
const BG2 = hex('#265640');
const GOLD = hex('#BFA160');
const CORAL = hex('#C47A68');

function draw(size) {
  const ss = 4; // supersampling for smooth edges
  const px = Buffer.alloc(size * (size * 4 + 1));
  const cx = size / 2, cy = size / 2;
  const R = size * 0.285, T = size * 0.07;
  for (let y = 0; y < size; y++) {
    px[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      let acc = [0, 0, 0];
      for (let sy = 0; sy < ss; sy++) for (let sx = 0; sx < ss; sx++) {
        const fx = x + (sx + 0.5) / ss, fy = y + (sy + 0.5) / ss;
        const dx = fx - cx, dy = fy - cy;
        const d = Math.hypot(dx, dy);
        // soft radial glow
        const g = Math.max(0, 1 - d / (size * 0.75));
        let c = BG.map((v, i) => v + (BG2[i] - v) * g);
        if (Math.abs(d - R) <= T / 2) {
          // angle clockwise from 12 o'clock, 0..360
          const a = (Math.atan2(dx, -dy) * 180 / Math.PI + 360) % 360;
          if (a >= 8 && a < 262) c = GOLD;
          else if (a >= 272 && a < 340) c = CORAL;
        }
        acc = acc.map((v, i) => v + c[i]);
      }
      const o = y * (size * 4 + 1) + 1 + x * 4;
      px[o] = Math.round(acc[0] / (ss * ss));
      px[o + 1] = Math.round(acc[1] / (ss * ss));
      px[o + 2] = Math.round(acc[2] / (ss * ss));
      px[o + 3] = 255;
    }
  }
  return png(size, px);
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

for (const [name, size] of [['icon-192.png', 192], ['icon-512.png', 512], ['apple-touch-icon.png', 180]]) {
  writeFileSync(resolve(out, name), draw(size));
  console.log('wrote', name);
}
