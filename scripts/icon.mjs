// Draws the app icon (512 px PNG) in code, so it needs no image tools:
// a laser beam striking a glowing spot, with speed lines (the "runner").
import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const S = 512;
const BG = [21, 23, 28];
const BEAM = [120, 170, 255];
const HOT = [255, 196, 90];

const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * Math.max(0, Math.min(1, t))));

function pixel(x, y) {
  // Rounded square background with transparent corners.
  const r = 96;
  const cx = Math.min(Math.max(x, r), S - r);
  const cy = Math.min(Math.max(y, r), S - r);
  if (Math.hypot(x - cx, y - cy) > r) return [0, 0, 0, 0];
  let c = BG;
  const spot = [300, 352];
  // Glow around the spot.
  const d = Math.hypot(x - spot[0], y - spot[1]);
  c = mix(c, HOT, Math.exp(-((d / 70) ** 2)) * 0.9);
  // The beam: from the top right down to the spot.
  const top = [380, 40];
  const vx = spot[0] - top[0];
  const vy = spot[1] - top[1];
  const len = Math.hypot(vx, vy);
  const t = ((x - top[0]) * vx + (y - top[1]) * vy) / (len * len);
  if (t > 0 && t < 1) {
    const dist = Math.abs((x - top[0]) * vy - (y - top[1]) * vx) / len;
    c = mix(c, BEAM, Math.exp(-((dist / 7) ** 2)));
    c = mix(c, [235, 245, 255], Math.exp(-((dist / 2.5) ** 2)));
  }
  // Speed lines trailing left from the spot.
  for (const [ly, x0, w] of [[322, 90, 150], [352, 60, 190], [382, 110, 140]]) {
    if (y >= ly - 7 && y <= ly + 7 && x >= x0 && x <= x0 + w) {
      const fade = (x - x0) / w;
      c = mix(c, HOT, 0.25 + fade * 0.7);
    }
  }
  // The bright core of the spot.
  c = mix(c, [255, 250, 235], Math.exp(-((d / 16) ** 2)));
  return [...c, 255];
}

const raw = Buffer.alloc((S * 4 + 1) * S);
for (let y = 0, i = 0; y < S; y++) {
  raw[i++] = 0;
  for (let x = 0; x < S; x++) for (const v of pixel(x, y)) raw[i++] = v;
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (data) => {
  let c = 0xffffffff;
  for (const b of data) c = crcTable[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const sum = Buffer.alloc(4);
  sum.writeUInt32BE(crc(body));
  return Buffer.concat([len, body, sum]);
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(S, 0);
ihdr.writeUInt32BE(S, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // RGBA
const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);

mkdirSync('build', { recursive: true });
writeFileSync('build/icon.png', png);
mkdirSync('public', { recursive: true });
writeFileSync('public/icon.png', png);
console.log(`build/icon.png (${png.length} bytes)`);
