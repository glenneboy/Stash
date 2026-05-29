// Generates the PWA / favicon PNGs as a solid accent tile with a checkmark.
// No image deps — hand-rolled PNG encoder (RGBA, filter 0 per scanline).
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';

const BG = [15, 15, 15]; // #0F0F0F
const ACCENT = [240, 101, 58]; // #F0653A

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeData));
  return Buffer.concat([len, typeData, crc]);
}

function png(size) {
  const px = (x, y) => {
    // Draw a thick checkmark in the accent color on a dark tile.
    const s = size;
    const fx = x / s;
    const fy = y / s;
    const t = 0.07; // stroke half-thickness
    // Segment 1: (0.28,0.52) -> (0.44,0.68)
    const seg = (ax, ay, bx, by) => {
      const dx = bx - ax;
      const dy = by - ay;
      const len2 = dx * dx + dy * dy;
      let u = ((fx - ax) * dx + (fy - ay) * dy) / len2;
      u = Math.max(0, Math.min(1, u));
      const cx = ax + u * dx;
      const cy = ay + u * dy;
      return Math.hypot(fx - cx, fy - cy) < t;
    };
    const on = seg(0.28, 0.52, 0.44, 0.68) || seg(0.44, 0.68, 0.74, 0.34);
    return on ? ACCENT : BG;
  };

  const raw = Buffer.alloc((size * 4 + 1) * size);
  let o = 0;
  for (let y = 0; y < size; y++) {
    raw[o++] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const [r, g, b] = px(x, y);
      raw[o++] = r;
      raw[o++] = g;
      raw[o++] = b;
      raw[o++] = 255;
    }
  }

  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync('public', { recursive: true });
const out = [
  ['public/pwa-192.png', 192],
  ['public/pwa-512.png', 512],
  ['public/apple-touch-icon.png', 180],
];
for (const [path, size] of out) {
  writeFileSync(path, png(size));
  console.log('wrote', path);
}
